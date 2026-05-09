package pubsub

import "context"

type PubSub interface {
	Publish(ctx context.Context, channel, message string) error
	Subscribe(ctx context.Context, channel string) (<-chan string, error)
	Unsubscribe(channel string) error
	Close() error
}
