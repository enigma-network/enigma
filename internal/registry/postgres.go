package registry

import (
	"context"
	"database/sql"
	"encoding/json"
	"enigma/internal/types"
	"fmt"
	"time"
)

type PostgresRegistry struct{ db *sql.DB }

func NewPostgresRegistry(db *sql.DB) *PostgresRegistry { return &PostgresRegistry{db: db} }

func (r *PostgresRegistry) Register(ctx context.Context, node types.Node) error {
	models, _ := json.Marshal(node.Models)
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO nodes (id, address, backend, models, gpu_vram_mb, gpu_model, benchmark_score, avg_rating, reliability, status, last_heartbeat)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'online',NOW())
		ON CONFLICT(id) DO UPDATE SET
			address=EXCLUDED.address, backend=EXCLUDED.backend, models=EXCLUDED.models,
			gpu_vram_mb=EXCLUDED.gpu_vram_mb, gpu_model=EXCLUDED.gpu_model,
			status=CASE WHEN nodes.status='suspended' THEN 'suspended' ELSE 'online' END,
			last_heartbeat=NOW()`,
		node.ID, node.Address, string(node.Backend), string(models),
		node.GPUVRAMMb, node.GPUModel, node.BenchmarkScore, node.AvgRating, node.Reliability,
	)
	return err
}

func (r *PostgresRegistry) Deregister(ctx context.Context, nodeID string) error {
	_, err := r.db.ExecContext(ctx, `UPDATE nodes SET status='offline' WHERE id=$1`, nodeID)
	return err
}

func (r *PostgresRegistry) Heartbeat(ctx context.Context, nodeID string) error {
	// Keep suspended status — only update heartbeat timestamp and set online if not suspended
	res, err := r.db.ExecContext(ctx,
		`UPDATE nodes SET last_heartbeat=NOW(),
		 status=CASE WHEN status='suspended' THEN 'suspended' ELSE 'online' END
		 WHERE id=$1`, nodeID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("node %q not found", nodeID)
	}
	return nil
}

func (r *PostgresRegistry) SetStatus(ctx context.Context, nodeID string, status types.NodeStatus) error {
	_, err := r.db.ExecContext(ctx, `UPDATE nodes SET status=$1 WHERE id=$2`, string(status), nodeID)
	return err
}

func (r *PostgresRegistry) List(ctx context.Context) ([]types.Node, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT id, address, backend, models, gpu_vram_mb, gpu_model, benchmark_score, avg_rating, reliability, status, last_heartbeat FROM nodes WHERE status='online'`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanPGNodes(rows)
}

func (r *PostgresRegistry) Get(ctx context.Context, nodeID string) (types.Node, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT id, address, backend, models, gpu_vram_mb, gpu_model, benchmark_score, avg_rating, reliability, status, last_heartbeat FROM nodes WHERE id=$1`, nodeID)
	if err != nil {
		return types.Node{}, err
	}
	defer rows.Close()
	nodes, err := scanPGNodes(rows)
	if err != nil {
		return types.Node{}, err
	}
	if len(nodes) == 0 {
		return types.Node{}, fmt.Errorf("node %q not found", nodeID)
	}
	return nodes[0], nil
}

func (r *PostgresRegistry) UpdateScores(ctx context.Context, nodeID string, benchmark, rating, reliability float64) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE nodes SET benchmark_score=$1, avg_rating=$2, reliability=$3 WHERE id=$4`,
		benchmark, rating, reliability, nodeID)
	return err
}

func scanPGNodes(rows *sql.Rows) ([]types.Node, error) {
	var nodes []types.Node
	for rows.Next() {
		var n types.Node
		var modelsJSON string
		var hb time.Time
		if err := rows.Scan(&n.ID, &n.Address, (*string)(&n.Backend), &modelsJSON,
			&n.GPUVRAMMb, &n.GPUModel, &n.BenchmarkScore, &n.AvgRating, &n.Reliability,
			(*string)(&n.Status), &hb); err != nil {
			return nil, err
		}
		json.Unmarshal([]byte(modelsJSON), &n.Models)
		n.LastHeartbeat = hb
		nodes = append(nodes, n)
	}
	return nodes, rows.Err()
}
