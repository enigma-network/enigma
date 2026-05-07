package ledger

import (
	"context"
	"enigma/internal/db"
	"testing"
)

func newTestLedger(t *testing.T) *SQLiteLedger {
	t.Helper()
	sqldb, err := db.Open(t.TempDir() + "/test.db")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sqldb.Close() })
	return NewSQLiteLedger(sqldb)
}

func TestCreditAndBalance(t *testing.T) {
	l := newTestLedger(t)
	ctx := context.Background()

	l.Credit(ctx, "node-1", 1.0, "job_complete")
	l.Credit(ctx, "node-1", 1.0, "job_complete")

	balance, err := l.Balance(ctx, "node-1")
	if err != nil {
		t.Fatal(err)
	}
	if balance != 2.0 {
		t.Errorf("expected balance 2.0, got %f", balance)
	}
}

func TestBalanceZeroForUnknownNode(t *testing.T) {
	l := newTestLedger(t)
	ctx := context.Background()

	balance, err := l.Balance(ctx, "unknown")
	if err != nil {
		t.Fatal(err)
	}
	if balance != 0 {
		t.Errorf("expected 0 for unknown node, got %f", balance)
	}
}

func TestHistory(t *testing.T) {
	l := newTestLedger(t)
	ctx := context.Background()

	l.Credit(ctx, "node-1", 1.0, "job_complete")
	l.Credit(ctx, "node-1", 0.5, "bonus")

	txs, err := l.History(ctx, "node-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(txs) != 2 {
		t.Errorf("expected 2 transactions, got %d", len(txs))
	}
}
