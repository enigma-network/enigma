package pubsub

import (
	"context"
	"fmt"
	"sync"

	"github.com/redis/go-redis/v9"
)

type RedisPubSub struct {
	client *redis.Client
	mu     sync.Mutex
	subs   map[string]*redis.PubSub
}

func NewRedis(redisURL string) (*RedisPubSub, error) {
	opts, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, fmt.Errorf("parse redis URL: %w", err)
	}
	client := redis.NewClient(opts)
	if err := client.Ping(context.Background()).Err(); err != nil {
		return nil, fmt.Errorf("redis ping: %w", err)
	}
	return &RedisPubSub{client: client, subs: make(map[string]*redis.PubSub)}, nil
}

func (r *RedisPubSub) Publish(ctx context.Context, channel, message string) error {
	return r.client.Publish(ctx, channel, message).Err()
}

func (r *RedisPubSub) Subscribe(ctx context.Context, channel string) (<-chan string, error) {
	sub := r.client.Subscribe(ctx, channel)
	r.mu.Lock()
	r.subs[channel] = sub
	r.mu.Unlock()

	out := make(chan string, 16)
	go func() {
		defer close(out)
		ch := sub.Channel()
		for msg := range ch {
			select {
			case out <- msg.Payload:
			case <-ctx.Done():
				return
			}
		}
	}()
	return out, nil
}

func (r *RedisPubSub) Unsubscribe(channel string) error {
	r.mu.Lock()
	sub, ok := r.subs[channel]
	delete(r.subs, channel)
	r.mu.Unlock()
	if !ok {
		return nil
	}
	return sub.Close()
}

func (r *RedisPubSub) Close() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, sub := range r.subs {
		sub.Close()
	}
	return r.client.Close()
}
