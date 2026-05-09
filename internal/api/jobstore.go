package api

import (
	"context"
	"database/sql"
	"enigma/internal/types"
	"fmt"
)

type jobStore struct{ db *sql.DB }

func newJobStore(db *sql.DB) *jobStore { return &jobStore{db: db} }

func (s *jobStore) create(ctx context.Context, job types.Job) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO jobs (id, prompt, model, status, assigned_node, created_at) VALUES ($1,$2,$3,'pending',$4,NOW())`,
		job.ID, job.Prompt, job.Model, job.AssignedNode)
	return err
}

func (s *jobStore) get(ctx context.Context, id string) (types.Job, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT id, prompt, model, status, assigned_node, result, duration_ms, created_at, completed_at FROM jobs WHERE id=$1`, id)
	return scanJob(row)
}

func (s *jobStore) nextForNode(ctx context.Context, nodeID string) (types.Job, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT id, prompt, model, status, assigned_node, result, duration_ms, created_at, completed_at
		 FROM jobs WHERE assigned_node=$1 AND status='pending' LIMIT 1`, nodeID)
	return scanJob(row)
}

func (s *jobStore) setRunning(ctx context.Context, id string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE jobs SET status='running' WHERE id=$1`, id)
	return err
}

func (s *jobStore) complete(ctx context.Context, id, result string, durationMs int64) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE jobs SET status='done', result=$1, duration_ms=$2, completed_at=NOW() WHERE id=$3`,
		result, durationMs, id)
	return err
}

func (s *jobStore) fail(ctx context.Context, id string) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE jobs SET status='failed', completed_at=NOW() WHERE id=$1`, id)
	return err
}

func scanJob(row *sql.Row) (types.Job, error) {
	var j types.Job
	var completedAt sql.NullTime
	err := row.Scan(&j.ID, &j.Prompt, &j.Model, (*string)(&j.Status),
		&j.AssignedNode, &j.Result, &j.DurationMs, &j.CreatedAt, &completedAt)
	if err == sql.ErrNoRows {
		return types.Job{}, fmt.Errorf("job not found")
	}
	if err != nil {
		return types.Job{}, err
	}
	if completedAt.Valid {
		j.CompletedAt = &completedAt.Time
	}
	return j, nil
}
