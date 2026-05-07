package router

import (
	"context"
	"enigma/internal/types"
	"testing"
)

func TestRoundRobinDistributes(t *testing.T) {
	r := NewRoundRobinRouter()
	nodes := []types.Node{{ID: "a"}, {ID: "b"}, {ID: "c"}}
	ctx := context.Background()
	job := types.Job{}

	counts := map[string]int{}
	for i := 0; i < 9; i++ {
		n, err := r.SelectNode(ctx, job, nodes)
		if err != nil {
			t.Fatal(err)
		}
		counts[n.ID]++
	}
	for _, id := range []string{"a", "b", "c"} {
		if counts[id] != 3 {
			t.Errorf("node %q got %d calls, expected 3", id, counts[id])
		}
	}
}

func TestRoundRobinNoNodes(t *testing.T) {
	r := NewRoundRobinRouter()
	_, err := r.SelectNode(context.Background(), types.Job{}, nil)
	if err == nil {
		t.Error("expected error for empty nodes, got nil")
	}
}
