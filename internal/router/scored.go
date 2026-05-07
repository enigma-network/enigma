package router

import (
	"context"
	"enigma/internal/types"
	"errors"
)

const (
	weightBenchmark   = 0.4
	weightRating      = 0.4
	weightReliability = 0.2
)

type ScoredRouter struct {
	fallback Router
}

func NewScoredRouter(fallback Router) *ScoredRouter {
	return &ScoredRouter{fallback: fallback}
}

func score(n types.Node) float64 {
	return n.BenchmarkScore*weightBenchmark +
		n.AvgRating*weightRating +
		n.Reliability*weightReliability
}

func (r *ScoredRouter) SelectNode(ctx context.Context, job types.Job, nodes []types.Node) (types.Node, error) {
	if len(nodes) == 0 {
		return types.Node{}, errors.New("no nodes available")
	}

	// Filter to nodes that support the requested model
	var candidates []types.Node
	for _, n := range nodes {
		if job.Model == "" {
			candidates = append(candidates, n)
			continue
		}
		for _, m := range n.Models {
			if m == job.Model {
				candidates = append(candidates, n)
				break
			}
		}
	}
	if len(candidates) == 0 {
		candidates = nodes // fallback: ignore model filter
	}

	// Check if any node has been scored (not all at defaults)
	hasScores := false
	for _, n := range candidates {
		if n.BenchmarkScore != 0.5 || n.AvgRating != 0.5 {
			hasScores = true
			break
		}
	}
	if !hasScores {
		return r.fallback.SelectNode(ctx, job, candidates)
	}

	best := candidates[0]
	bestScore := score(best)
	for _, n := range candidates[1:] {
		if s := score(n); s > bestScore {
			bestScore = s
			best = n
		}
	}
	return best, nil
}
