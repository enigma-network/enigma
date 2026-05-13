package api

import (
	"context"
	"database/sql"
	"time"
)

// StartMonitor runs background tasks: heartbeat watchdog + job re-queue + cleanup.
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
				deleteStaleNodes(ctx, db)
			}
		}
	}()
}

// markOfflineNodes marks nodes as offline if no heartbeat for 90s.
func markOfflineNodes(ctx context.Context, db *sql.DB) {
	db.ExecContext(ctx,
		`UPDATE nodes SET status='offline'
		 WHERE status='online' AND last_heartbeat < NOW() - INTERVAL '90 seconds'`,
	)
}

// deleteStaleNodes deletes nodes that have been offline for more than 7 days.
func deleteStaleNodes(ctx context.Context, db *sql.DB) {
	db.ExecContext(ctx,
		`DELETE FROM nodes
		 WHERE status='offline' AND last_heartbeat < NOW() - INTERVAL '7 days'`,
	)
}

// requeueOrphanedJobs re-queues running jobs whose node went offline.
func requeueOrphanedJobs(ctx context.Context, db *sql.DB) {
	db.ExecContext(ctx, `
		UPDATE jobs SET status='pending', assigned_node=''
		WHERE status='running'
		AND assigned_node IN (SELECT id FROM nodes WHERE status='offline')
	`)
}
