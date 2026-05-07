package ledger

import (
	"context"
	"database/sql"
	"enigma/internal/types"
	"time"
)

type SQLiteLedger struct {
	db *sql.DB
}

func NewSQLiteLedger(db *sql.DB) *SQLiteLedger {
	return &SQLiteLedger{db: db}
}

func (l *SQLiteLedger) Credit(ctx context.Context, nodeID string, amount float64, reason string) error {
	_, err := l.db.ExecContext(ctx,
		`INSERT INTO ledger (node_id, amount, reason, created_at) VALUES (?, ?, ?, ?)`,
		nodeID, amount, reason, time.Now().UTC(),
	)
	return err
}

func (l *SQLiteLedger) Balance(ctx context.Context, nodeID string) (float64, error) {
	var balance sql.NullFloat64
	err := l.db.QueryRowContext(ctx,
		`SELECT SUM(amount) FROM ledger WHERE node_id=?`, nodeID,
	).Scan(&balance)
	if err != nil {
		return 0, err
	}
	return balance.Float64, nil
}

func (l *SQLiteLedger) History(ctx context.Context, nodeID string) ([]types.Transaction, error) {
	rows, err := l.db.QueryContext(ctx,
		`SELECT id, node_id, amount, reason, created_at FROM ledger WHERE node_id=? ORDER BY created_at DESC`,
		nodeID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var txs []types.Transaction
	for rows.Next() {
		var tx types.Transaction
		var createdAt string
		if err := rows.Scan(&tx.ID, &tx.NodeID, &tx.Amount, &tx.Reason, &createdAt); err != nil {
			return nil, err
		}
		tx.CreatedAt, _ = time.Parse(time.RFC3339, createdAt)
		txs = append(txs, tx)
	}
	return txs, nil
}
