package ledger

import (
	"context"
	"database/sql"
	"enigma/internal/types"
	"time"
)

type PostgresLedger struct{ db *sql.DB }

func NewPostgresLedger(db *sql.DB) *PostgresLedger { return &PostgresLedger{db: db} }

func (l *PostgresLedger) Credit(ctx context.Context, nodeID string, amount float64, reason string) error {
	_, err := l.db.ExecContext(ctx,
		`INSERT INTO ledger (node_id, amount, reason) VALUES ($1, $2, $3)`,
		nodeID, amount, reason)
	return err
}

func (l *PostgresLedger) Balance(ctx context.Context, nodeID string) (float64, error) {
	var balance sql.NullFloat64
	err := l.db.QueryRowContext(ctx, `SELECT SUM(amount) FROM ledger WHERE node_id=$1`, nodeID).Scan(&balance)
	return balance.Float64, err
}

func (l *PostgresLedger) History(ctx context.Context, nodeID string) ([]types.Transaction, error) {
	rows, err := l.db.QueryContext(ctx,
		`SELECT id, node_id, amount, reason, created_at FROM ledger WHERE node_id=$1 ORDER BY created_at DESC`, nodeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var txs []types.Transaction
	for rows.Next() {
		var tx types.Transaction
		var t time.Time
		if err := rows.Scan(&tx.ID, &tx.NodeID, &tx.Amount, &tx.Reason, &t); err != nil {
			return nil, err
		}
		tx.CreatedAt = t
		txs = append(txs, tx)
	}
	return txs, rows.Err()
}
