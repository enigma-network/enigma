package registry

import (
	"context"
	"database/sql"
	"encoding/json"
	"enigma/internal/types"
	"fmt"
	"time"
)

type SQLiteRegistry struct {
	db *sql.DB
}

func NewSQLiteRegistry(db *sql.DB) *SQLiteRegistry {
	return &SQLiteRegistry{db: db}
}

func (r *SQLiteRegistry) Register(ctx context.Context, node types.Node) error {
	modelsJSON, err := json.Marshal(node.Models)
	if err != nil {
		return err
	}
	_, err = r.db.ExecContext(ctx, `
		INSERT INTO nodes (id, address, backend, models, gpu_vram_mb, gpu_model, benchmark_score, avg_rating, reliability, status, last_heartbeat)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'online', ?)
		ON CONFLICT(id) DO UPDATE SET
			address=excluded.address, backend=excluded.backend, models=excluded.models,
			gpu_vram_mb=excluded.gpu_vram_mb, gpu_model=excluded.gpu_model, status='online', last_heartbeat=excluded.last_heartbeat`,
		node.ID, node.Address, string(node.Backend), string(modelsJSON),
		node.GPUVRAMMb, node.GPUModel, node.BenchmarkScore, node.AvgRating, node.Reliability,
		time.Now().UTC().Format(time.RFC3339),
	)
	return err
}

func (r *SQLiteRegistry) Deregister(ctx context.Context, nodeID string) error {
	_, err := r.db.ExecContext(ctx, `UPDATE nodes SET status='offline' WHERE id=?`, nodeID)
	return err
}

func (r *SQLiteRegistry) List(ctx context.Context) ([]types.Node, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT id, address, backend, models, gpu_vram_mb, gpu_model, benchmark_score, avg_rating, reliability, status, last_heartbeat FROM nodes WHERE status='online'`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanNodes(rows)
}

func (r *SQLiteRegistry) Get(ctx context.Context, nodeID string) (types.Node, error) {
	row := r.db.QueryRowContext(ctx, `SELECT id, address, backend, models, gpu_vram_mb, gpu_model, benchmark_score, avg_rating, reliability, status, last_heartbeat FROM nodes WHERE id=?`, nodeID)
	nodes, err := scanNodes(&rowsAdapter{row: row})
	if err != nil {
		return types.Node{}, err
	}
	if len(nodes) == 0 {
		return types.Node{}, fmt.Errorf("node %q not found", nodeID)
	}
	return nodes[0], nil
}

func (r *SQLiteRegistry) Heartbeat(ctx context.Context, nodeID string) error {
	res, err := r.db.ExecContext(ctx, `UPDATE nodes SET last_heartbeat=?, status='online' WHERE id=?`, time.Now().UTC().Format(time.RFC3339), nodeID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("node %q not found", nodeID)
	}
	return nil
}

func (r *SQLiteRegistry) UpdateScores(ctx context.Context, nodeID string, benchmarkScore, avgRating, reliability float64) error {
	_, err := r.db.ExecContext(ctx, `UPDATE nodes SET benchmark_score=?, avg_rating=?, reliability=? WHERE id=?`,
		benchmarkScore, avgRating, reliability, nodeID)
	return err
}

// rowsAdapter lets us reuse scanNodes for single-row queries.
type rowsAdapter struct {
	row  *sql.Row
	done bool
}

func (a *rowsAdapter) Next() bool {
	if a.done {
		return false
	}
	a.done = true
	return true
}
func (a *rowsAdapter) Close() error           { return nil }
func (a *rowsAdapter) Scan(dest ...any) error { return a.row.Scan(dest...) }

type scanner interface {
	Next() bool
	Close() error
	Scan(dest ...any) error
}

func scanNodes(rows scanner) ([]types.Node, error) {
	var nodes []types.Node
	for rows.Next() {
		var n types.Node
		var modelsJSON string
		var lastHB string
		err := rows.Scan(&n.ID, &n.Address, (*string)(&n.Backend), &modelsJSON,
			&n.GPUVRAMMb, &n.GPUModel, &n.BenchmarkScore, &n.AvgRating, &n.Reliability,
			(*string)(&n.Status), &lastHB)
		if err != nil {
			rows.Close()
			return nil, err
		}
		json.Unmarshal([]byte(modelsJSON), &n.Models)
		n.LastHeartbeat, _ = time.Parse(time.RFC3339, lastHB)
		nodes = append(nodes, n)
	}
	rows.Close()
	return nodes, nil
}
