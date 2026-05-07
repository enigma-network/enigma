package router

import (
	"context"
	"enigma/internal/types"
)

type Router interface {
	SelectNode(ctx context.Context, job types.Job, nodes []types.Node) (types.Node, error)
}
