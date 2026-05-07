package router

import (
	"context"
	"enigma/internal/types"
	"testing"
)

func TestScoredRouterSelectsBest(t *testing.T) {
	r := NewScoredRouter(NewRoundRobinRouter())
	ctx := context.Background()
	job := types.Job{Model: "gemma3:4b"}

	nodes := []types.Node{
		{ID: "weak", BenchmarkScore: 0.3, AvgRating: 0.4, Reliability: 0.6, Models: []string{"gemma3:4b"}},
		{ID: "strong", BenchmarkScore: 0.9, AvgRating: 0.8, Reliability: 0.95, Models: []string{"gemma3:4b"}},
		{ID: "medium", BenchmarkScore: 0.6, AvgRating: 0.6, Reliability: 0.7, Models: []string{"gemma3:4b"}},
	}

	selected, err := r.SelectNode(ctx, job, nodes)
	if err != nil {
		t.Fatal(err)
	}
	if selected.ID != "strong" {
		t.Errorf("expected 'strong', got %q (scores: weak=%.2f, strong=%.2f, medium=%.2f)",
			selected.ID, score(nodes[0]), score(nodes[1]), score(nodes[2]))
	}
}

func TestScoredRouterFiltersModel(t *testing.T) {
	r := NewScoredRouter(NewRoundRobinRouter())
	ctx := context.Background()
	job := types.Job{Model: "phi3:mini"}

	nodes := []types.Node{
		{ID: "no-phi", BenchmarkScore: 0.9, AvgRating: 0.9, Reliability: 0.99, Models: []string{"gemma3:4b"}},
		{ID: "has-phi", BenchmarkScore: 0.5, AvgRating: 0.5, Reliability: 0.5, Models: []string{"phi3:mini"}},
	}

	selected, err := r.SelectNode(ctx, job, nodes)
	if err != nil {
		t.Fatal(err)
	}
	if selected.ID != "has-phi" {
		t.Errorf("expected 'has-phi' (only node with phi3:mini), got %q", selected.ID)
	}
}

func TestScoredRouterFallsBackToRoundRobin(t *testing.T) {
	r := NewScoredRouter(NewRoundRobinRouter())
	ctx := context.Background()
	job := types.Job{}

	// All nodes at defaults — should use round-robin
	nodes := []types.Node{
		{ID: "a", BenchmarkScore: 0.5, AvgRating: 0.5, Reliability: 1.0},
		{ID: "b", BenchmarkScore: 0.5, AvgRating: 0.5, Reliability: 1.0},
	}

	seen := map[string]bool{}
	for i := 0; i < 4; i++ {
		n, _ := r.SelectNode(ctx, job, nodes)
		seen[n.ID] = true
	}
	if !seen["a"] || !seen["b"] {
		t.Errorf("round-robin fallback didn't distribute: %v", seen)
	}
}
