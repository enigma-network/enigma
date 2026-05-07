package router

import (
	"context"
	"enigma/internal/types"
	"errors"
	"sync/atomic"
)

type RoundRobinRouter struct {
	counter atomic.Uint64
}

func NewRoundRobinRouter() *RoundRobinRouter {
	return &RoundRobinRouter{}
}

func (r *RoundRobinRouter) SelectNode(_ context.Context, _ types.Job, nodes []types.Node) (types.Node, error) {
	if len(nodes) == 0 {
		return types.Node{}, errors.New("no nodes available")
	}
	idx := r.counter.Add(1) - 1
	return nodes[idx%uint64(len(nodes))], nil
}
