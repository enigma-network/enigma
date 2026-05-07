package registry

import (
	"context"
	"enigma/internal/db"
	"enigma/internal/types"
	"testing"
)

func newTestRegistry(t *testing.T) *SQLiteRegistry {
	t.Helper()
	sqldb, err := db.Open(t.TempDir() + "/test.db")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sqldb.Close() })
	return NewSQLiteRegistry(sqldb)
}

func TestRegisterAndList(t *testing.T) {
	r := newTestRegistry(t)
	ctx := context.Background()

	node := types.Node{
		ID:      "node-1",
		Address: "localhost:9001",
		Backend: types.BackendOllama,
		Models:  []string{"gemma3:4b"},
	}
	if err := r.Register(ctx, node); err != nil {
		t.Fatal(err)
	}

	nodes, err := r.List(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(nodes) != 1 || nodes[0].ID != "node-1" {
		t.Errorf("expected 1 node, got %d", len(nodes))
	}
}

func TestDeregister(t *testing.T) {
	r := newTestRegistry(t)
	ctx := context.Background()

	r.Register(ctx, types.Node{ID: "node-1", Address: "localhost:9001", Backend: types.BackendOllama})
	r.Deregister(ctx, "node-1")

	nodes, _ := r.List(ctx)
	if len(nodes) != 0 {
		t.Errorf("expected 0 nodes after deregister, got %d", len(nodes))
	}
}

func TestHeartbeat(t *testing.T) {
	r := newTestRegistry(t)
	ctx := context.Background()

	r.Register(ctx, types.Node{ID: "node-1", Address: "localhost:9001", Backend: types.BackendOllama})
	if err := r.Heartbeat(ctx, "node-1"); err != nil {
		t.Errorf("heartbeat failed: %v", err)
	}
}

func TestUpdateScores(t *testing.T) {
	r := newTestRegistry(t)
	ctx := context.Background()

	r.Register(ctx, types.Node{ID: "node-1", Address: "localhost:9001", Backend: types.BackendOllama})
	r.UpdateScores(ctx, "node-1", 0.9, 0.8, 0.95)

	node, err := r.Get(ctx, "node-1")
	if err != nil {
		t.Fatal(err)
	}
	if node.BenchmarkScore != 0.9 || node.AvgRating != 0.8 || node.Reliability != 0.95 {
		t.Errorf("scores not updated: %+v", node)
	}
}
