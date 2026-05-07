package api

import (
	"context"
	"database/sql"
	"enigma/internal/types"
	"fmt"
	"time"
)

type jobStore struct {
	db *sql.DB
}

func newJobStore(db *sql.DB) *jobStore { return &jobStore{db: db} }

func (s *jobStore) create(ctx context.Context, job types.Job) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO jobs (id, prompt, model, status, assigned_node, created_at) VALUES (?, ?, ?, 'pending', ?, ?)`,
		job.ID, job.Prompt, job.Model, job.AssignedNode, time.Now().UTC().Format(time.RFC3339),
	)
	return err
}

func (s *jobStore) get(ctx context.Context, id string) (types.Job, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT id, prompt, model, status, assigned_node, COALESCE(result,''), COALESCE(duration_ms,0), created_at, completed_at FROM jobs WHERE id=?`, id)
	return scanJob(row)
}

func (s *jobStore) nextForNode(ctx context.Context, nodeID string) (types.Job, error) {
	// Also picks up re-queued jobs (assigned_node=NULL) from crashed nodes
	row := s.db.QueryRowContext(ctx,
		`SELECT id, prompt, model, status, COALESCE(assigned_node,''), COALESCE(result,''), COALESCE(duration_ms,0), created_at, completed_at FROM jobs WHERE (assigned_node=? OR assigned_node IS NULL) AND status='pending' LIMIT 1`, nodeID)
	return scanJob(row)
}

func (s *jobStore) setRunning(ctx context.Context, id string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE jobs SET status='running' WHERE id=?`, id)
	return err
}

func (s *jobStore) complete(ctx context.Context, id, result string, durationMs int64) error {
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := s.db.ExecContext(ctx,
		`UPDATE jobs SET status='done', result=?, duration_ms=?, completed_at=? WHERE id=?`,
		result, durationMs, now, id)
	return err
}

func (s *jobStore) fail(ctx context.Context, id string) error {
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := s.db.ExecContext(ctx, `UPDATE jobs SET status='failed', completed_at=? WHERE id=?`, now, id)
	return err
}

func scanJob(row *sql.Row) (types.Job, error) {
	var j types.Job
	var completedAt sql.NullString
	var createdAt string
	err := row.Scan(&j.ID, &j.Prompt, &j.Model, (*string)(&j.Status), &j.AssignedNode, &j.Result, &j.DurationMs, &createdAt, &completedAt)
	if err == sql.ErrNoRows {
		return types.Job{}, fmt.Errorf("job not found")
	}
	if err != nil {
		return types.Job{}, err
	}
	j.CreatedAt, _ = time.Parse(time.RFC3339, createdAt)
	if completedAt.Valid {
		t, _ := time.Parse(time.RFC3339, completedAt.String)
		j.CompletedAt = &t
	}
	return j, nil
}
