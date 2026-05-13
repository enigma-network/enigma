package registry

import (
	"context"
	"enigma/internal/types"
)

type RegistryStore interface {
	Register(ctx context.Context, node types.Node) error
	Deregister(ctx context.Context, nodeID string) error
	List(ctx context.Context) ([]types.Node, error)
	Get(ctx context.Context, nodeID string) (types.Node, error)
	Heartbeat(ctx context.Context, nodeID string) error
	UpdateScores(ctx context.Context, nodeID string, benchmarkScore, avgRating, reliability float64) error
	SetStatus(ctx context.Context, nodeID string, status types.NodeStatus) error
}
