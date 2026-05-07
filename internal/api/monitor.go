package api

import (
	"context"
	"database/sql"
	"time"
)

// StartMonitor runs background tasks: heartbeat watchdog + job re-queue.
func StartMonitor(ctx context.Context, db *sql.DB) {
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				markOfflineNodes(ctx, db)
				requeueOrphanedJobs(ctx, db)
			}
		}
	}()
}

func markOfflineNodes(ctx context.Context, db *sql.DB) {
	cutoff := time.Now().UTC().Add(-90 * time.Second).Format(time.RFC3339)
	db.ExecContext(ctx,
		`UPDATE nodes SET status='offline' WHERE status='online' AND last_heartbeat < ?`,
		cutoff,
	)
}

func requeueOrphanedJobs(ctx context.Context, db *sql.DB) {
	// Re-queue running jobs whose node went offline
	db.ExecContext(ctx, `
		UPDATE jobs SET status='pending', assigned_node=NULL
		WHERE status='running'
		AND assigned_node IN (SELECT id FROM nodes WHERE status='offline')
	`)
}
