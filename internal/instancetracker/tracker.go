package instancetracker

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

const ttl = 20 * time.Second
const prefix = "enigma:instance:"

type Tracker struct {
	client *redis.Client
	id     string
}

func New(redisURL string) (*Tracker, error) {
	opts, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, fmt.Errorf("parse redis URL: %w", err)
	}
	client := redis.NewClient(opts)
	hostname, _ := os.Hostname()
	return &Tracker{client: client, id: hostname}, nil
}

// Run registers this instance and refreshes it every 10s until ctx is cancelled.
func (t *Tracker) Run(ctx context.Context) {
	t.register(ctx)
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			t.client.Del(context.Background(), prefix+t.id)
			t.client.Close()
			return
		case <-ticker.C:
			t.register(ctx)
		}
	}
}

func (t *Tracker) register(ctx context.Context) {
	t.client.Set(ctx, prefix+t.id, "online", ttl)
}

// List returns all active instance hostnames.
func List(redisURL string) ([]string, error) {
	opts, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, err
	}
	client := redis.NewClient(opts)
	defer client.Close()

	keys, err := client.Keys(context.Background(), prefix+"*").Result()
	if err != nil {
		return nil, err
	}
	instances := make([]string, len(keys))
	for i, k := range keys {
		instances[i] = strings.TrimPrefix(k, prefix)
	}
	return instances, nil
}
