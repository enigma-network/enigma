package ledger

import (
	"context"
	"enigma/internal/types"
)

type Ledger interface {
	Credit(ctx context.Context, nodeID string, amount float64, reason string) error
	Balance(ctx context.Context, nodeID string) (float64, error)
	History(ctx context.Context, nodeID string) ([]types.Transaction, error)
}
