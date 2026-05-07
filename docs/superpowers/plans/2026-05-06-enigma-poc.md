# Enigma PoC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local proof-of-concept for a decentralized AI compute network where provider nodes run LLM inference and earn simulated ENI tokens, routed by an intelligent scoring system.

**Architecture:** Three Go binaries (`enigma-server`, `enigma-node`, `enigma-cli`) communicate via REST/HTTP. The server coordinates job routing using a score-based router (benchmark + user ratings + reliability), persists everything in SQLite, and tracks ENI rewards in an append-only ledger. All core server components are behind interfaces for future scale path (etcd, distributed scheduler, blockchain).

**Tech Stack:** Go 1.22, `modernc.org/sqlite` (pure Go SQLite, no CGO), `github.com/google/uuid`, standard library `net/http` + `encoding/json`

---

## File Map

| File | Responsibility |
|---|---|
| `internal/types/types.go` | Shared domain types: Node, Job, Transaction, enums |
| `internal/db/migrate.go` | SQLite schema creation + migration |
| `internal/registry/registry.go` | RegistryStore interface |
| `internal/registry/sqlite.go` | SQLiteRegistry implementation |
| `internal/ledger/ledger.go` | Ledger interface |
| `internal/ledger/sqlite.go` | SQLiteLedger implementation |
| `internal/llm/backend.go` | LLMBackend interface |
| `internal/llm/ollama.go` | OllamaBackend (calls Ollama HTTP API) |
| `internal/llm/llamacpp.go` | LlamaCppBackend (calls llama.cpp server API) |
| `internal/router/router.go` | Router interface |
| `internal/router/roundrobin.go` | RoundRobinRouter (fallback) |
| `internal/router/scored.go` | ScoredRouter (benchmark×0.4 + rating×0.4 + reliability×0.2) |
| `internal/benchmark/runner.go` | Runs 3 standard prompts on a node, returns score 0.0–1.0 |
| `internal/api/nodes.go` | HTTP handlers: register, heartbeat, deregister, poll-job, balance |
| `internal/api/jobs.go` | HTTP handlers: submit, status, result |
| `internal/api/ratings.go` | HTTP handler: rate job |
| `internal/api/monitor.go` | Background goroutine: heartbeat watchdog + job re-queue |
| `internal/api/server.go` | HTTP server setup, route registration |
| `cmd/server/main.go` | enigma-server binary entrypoint |
| `cmd/node/main.go` | enigma-node binary: register, poll, infer, heartbeat loop |
| `cmd/cli/main.go` | enigma-cli binary: submit, poll result, rate, balance |
| `Makefile` | build, run-server, run-node, run-cli, test, sim targets |

---

## Phase 1 — Project Scaffolding

### Task 1: Go module + directory structure + Makefile

**Files:**
- Create: `go.mod`
- Create: `Makefile`
- Create: all directories

- [ ] **Step 1: Create directory tree**

```bash
cd /path/to/enigma
mkdir -p cmd/server cmd/node cmd/cli
mkdir -p internal/types internal/db internal/registry internal/ledger
mkdir -p internal/llm internal/router internal/benchmark internal/api
```

- [ ] **Step 2: Initialize Go module**

```bash
cd /path/to/enigma
go mod init enigma
```

Expected: `go.mod` created with `module enigma` and `go 1.22`

- [ ] **Step 3: Add dependencies**

```bash
go get modernc.org/sqlite
go get github.com/google/uuid
```

- [ ] **Step 4: Create Makefile**

`Makefile`:
```makefile
.PHONY: build test sim clean run-server run-node run-cli

build:
	go build -o bin/enigma-server ./cmd/server
	go build -o bin/enigma-node   ./cmd/node
	go build -o bin/enigma-cli    ./cmd/cli

test:
	go test ./...

sim: build
	@echo "Starting simulation: 3 nodes, 10 jobs..."
	./bin/enigma-server -db /tmp/enigma-sim.db &
	sleep 1
	./bin/enigma-node -server http://localhost:8080 -backend ollama &
	./bin/enigma-node -server http://localhost:8080 -backend ollama &
	./bin/enigma-node -server http://localhost:8080 -backend ollama &
	sleep 2
	for i in $$(seq 1 10); do \
		./bin/enigma-cli -server http://localhost:8080 submit -model gemma3:4b -prompt "Was ist $$i × $$i?"; \
	done
	sleep 30
	./bin/enigma-cli -server http://localhost:8080 stats

clean:
	rm -rf bin/ /tmp/enigma-sim.db

run-server:
	./bin/enigma-server -db ./enigma.db

run-node:
	./bin/enigma-node -server http://localhost:8080 -backend ollama
```

- [ ] **Step 5: Verify module**

```bash
go mod tidy
```

Expected: `go.sum` created, no errors.

- [ ] **Step 6: Commit**

```bash
git add go.mod go.sum Makefile cmd/ internal/ docs/
git commit -m "chore(enigma): scaffold Go module, Makefile, directory structure"
```

---

## Phase 2 — Shared Types + DB

### Task 2: Shared domain types

**Files:**
- Create: `internal/types/types.go`

- [ ] **Step 1: Write types**

`internal/types/types.go`:
```go
package types

import "time"

type NodeStatus string
type Backend string
type JobStatus string

const (
	NodeStatusOnline  NodeStatus = "online"
	NodeStatusOffline NodeStatus = "offline"

	BackendOllama   Backend = "ollama"
	BackendLlamaCpp Backend = "llamacpp"

	JobStatusPending JobStatus = "pending"
	JobStatusRunning JobStatus = "running"
	JobStatusDone    JobStatus = "done"
	JobStatusFailed  JobStatus = "failed"
)

type Node struct {
	ID             string
	Address        string
	Backend        Backend
	Models         []string
	GPUVRAMMb      int
	GPUModel       string
	BenchmarkScore float64
	AvgRating      float64
	Reliability    float64
	Status         NodeStatus
	LastHeartbeat  time.Time
}

type Job struct {
	ID           string
	Prompt       string
	Model        string
	Status       JobStatus
	AssignedNode string
	Result       string
	DurationMs   int64
	CreatedAt    time.Time
	CompletedAt  *time.Time
}

type Transaction struct {
	ID        int64
	NodeID    string
	Amount    float64
	Reason    string
	CreatedAt time.Time
}
```

- [ ] **Step 2: Verify it compiles**

```bash
go build ./internal/types/...
```

Expected: no output, no errors.

- [ ] **Step 3: Commit**

```bash
git add internal/types/
git commit -m "feat(enigma): add shared domain types"
```

---

### Task 3: SQLite migrations

**Files:**
- Create: `internal/db/migrate.go`

- [ ] **Step 1: Write migration**

`internal/db/migrate.go`:
```go
package db

import (
	"database/sql"
	_ "modernc.org/sqlite"
)

const schema = `
CREATE TABLE IF NOT EXISTS nodes (
	id             TEXT PRIMARY KEY,
	address        TEXT NOT NULL,
	backend        TEXT NOT NULL,
	models         TEXT NOT NULL DEFAULT '[]',
	gpu_vram_mb    INTEGER NOT NULL DEFAULT 0,
	gpu_model      TEXT NOT NULL DEFAULT '',
	benchmark_score REAL NOT NULL DEFAULT 0.5,
	avg_rating     REAL NOT NULL DEFAULT 0.5,
	reliability    REAL NOT NULL DEFAULT 1.0,
	status         TEXT NOT NULL DEFAULT 'online',
	last_heartbeat DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
	id            TEXT PRIMARY KEY,
	prompt        TEXT NOT NULL,
	model         TEXT NOT NULL,
	status        TEXT NOT NULL DEFAULT 'pending',
	assigned_node TEXT,
	result        TEXT,
	duration_ms   INTEGER,
	created_at    DATETIME NOT NULL,
	completed_at  DATETIME
);

CREATE TABLE IF NOT EXISTS ledger (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	node_id    TEXT NOT NULL,
	amount     REAL NOT NULL,
	reason     TEXT NOT NULL,
	created_at DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS ratings (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	job_id     TEXT NOT NULL,
	node_id    TEXT NOT NULL,
	score      INTEGER NOT NULL CHECK(score BETWEEN 1 AND 5),
	created_at DATETIME NOT NULL
);
`

func Open(path string) (*sql.DB, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}
```

- [ ] **Step 2: Write test**

`internal/db/migrate_test.go`:
```go
package db

import (
	"os"
	"testing"
)

func TestOpen(t *testing.T) {
	path := t.TempDir() + "/test.db"
	db, err := Open(path)
	if err != nil {
		t.Fatalf("Open failed: %v", err)
	}
	defer db.Close()

	for _, table := range []string{"nodes", "jobs", "ledger", "ratings"} {
		var name string
		err := db.QueryRow("SELECT name FROM sqlite_master WHERE type='table' AND name=?", table).Scan(&name)
		if err != nil || name != table {
			t.Errorf("table %q not created", table)
		}
	}
}

func TestOpenIdempotent(t *testing.T) {
	path := t.TempDir() + "/test.db"
	db1, _ := Open(path)
	db1.Close()
	db2, err := Open(path)
	if err != nil {
		t.Fatalf("second Open failed: %v", err)
	}
	db2.Close()
	os.Remove(path)
}
```

- [ ] **Step 3: Run test**

```bash
go test ./internal/db/... -v
```

Expected: `PASS TestOpen`, `PASS TestOpenIdempotent`

- [ ] **Step 4: Commit**

```bash
git add internal/db/
git commit -m "feat(enigma): SQLite schema migrations"
```

---

## Phase 3 — Registry

### Task 4: RegistryStore interface + SQLiteRegistry

**Files:**
- Create: `internal/registry/registry.go`
- Create: `internal/registry/sqlite.go`
- Create: `internal/registry/sqlite_test.go`

- [ ] **Step 1: Write interface**

`internal/registry/registry.go`:
```go
package registry

import (
	"context"
	"enigma/internal/types"
)

type RegistryStore interface {
	Register(ctx context.Context, node types.Node) error
	Deregister(ctx context.Context, nodeID string) error
	List(ctx context.Context) ([]types.Node, error)
	Get(ctx context.Context, nodeID string) (types.Node, error)
	Heartbeat(ctx context.Context, nodeID string) error
	UpdateScores(ctx context.Context, nodeID string, benchmarkScore, avgRating, reliability float64) error
}
```

- [ ] **Step 2: Write SQLiteRegistry**

`internal/registry/sqlite.go`:
```go
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
		time.Now().UTC(),
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
	nodes, err := scanNodes(&rowsAdapter{row})
	if err != nil || len(nodes) == 0 {
		return types.Node{}, fmt.Errorf("node %q not found", nodeID)
	}
	return nodes[0], nil
}

func (r *SQLiteRegistry) Heartbeat(ctx context.Context, nodeID string) error {
	res, err := r.db.ExecContext(ctx, `UPDATE nodes SET last_heartbeat=?, status='online' WHERE id=?`, time.Now().UTC(), nodeID)
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
	row *sql.Row
}

func (a *rowsAdapter) Next() bool        { return true }
func (a *rowsAdapter) Close() error      { return nil }
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
```

- [ ] **Step 3: Write tests**

`internal/registry/sqlite_test.go`:
```go
package registry

import (
	"context"
	"enigma/internal/db"
	"enigma/internal/types"
	"testing"
)

func newTestRegistry(t *testing.T) *SQLiteRegistry {
	t.Helper()
	sqldb, err := db.Open(t.TempDir() + "/test.db")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sqldb.Close() })
	return NewSQLiteRegistry(sqldb)
}

func TestRegisterAndList(t *testing.T) {
	r := newTestRegistry(t)
	ctx := context.Background()

	node := types.Node{
		ID:      "node-1",
		Address: "localhost:9001",
		Backend: types.BackendOllama,
		Models:  []string{"gemma3:4b"},
	}
	if err := r.Register(ctx, node); err != nil {
		t.Fatal(err)
	}

	nodes, err := r.List(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(nodes) != 1 || nodes[0].ID != "node-1" {
		t.Errorf("expected 1 node, got %d", len(nodes))
	}
}

func TestDeregister(t *testing.T) {
	r := newTestRegistry(t)
	ctx := context.Background()

	r.Register(ctx, types.Node{ID: "node-1", Address: "localhost:9001", Backend: types.BackendOllama})
	r.Deregister(ctx, "node-1")

	nodes, _ := r.List(ctx)
	if len(nodes) != 0 {
		t.Errorf("expected 0 nodes after deregister, got %d", len(nodes))
	}
}

func TestHeartbeat(t *testing.T) {
	r := newTestRegistry(t)
	ctx := context.Background()

	r.Register(ctx, types.Node{ID: "node-1", Address: "localhost:9001", Backend: types.BackendOllama})
	if err := r.Heartbeat(ctx, "node-1"); err != nil {
		t.Errorf("heartbeat failed: %v", err)
	}
}

func TestUpdateScores(t *testing.T) {
	r := newTestRegistry(t)
	ctx := context.Background()

	r.Register(ctx, types.Node{ID: "node-1", Address: "localhost:9001", Backend: types.BackendOllama})
	r.UpdateScores(ctx, "node-1", 0.9, 0.8, 0.95)

	node, err := r.Get(ctx, "node-1")
	if err != nil {
		t.Fatal(err)
	}
	if node.BenchmarkScore != 0.9 || node.AvgRating != 0.8 || node.Reliability != 0.95 {
		t.Errorf("scores not updated: %+v", node)
	}
}
```

- [ ] **Step 4: Run tests**

```bash
go test ./internal/registry/... -v
```

Expected: all 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add internal/registry/
git commit -m "feat(enigma): RegistryStore interface + SQLiteRegistry"
```

---

## Phase 4 — Ledger

### Task 5: Ledger interface + SQLiteLedger

**Files:**
- Create: `internal/ledger/ledger.go`
- Create: `internal/ledger/sqlite.go`
- Create: `internal/ledger/sqlite_test.go`

- [ ] **Step 1: Write interface**

`internal/ledger/ledger.go`:
```go
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
```

- [ ] **Step 2: Write SQLiteLedger**

`internal/ledger/sqlite.go`:
```go
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
```

- [ ] **Step 3: Write tests**

`internal/ledger/sqlite_test.go`:
```go
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
```

- [ ] **Step 4: Run tests**

```bash
go test ./internal/ledger/... -v
```

Expected: all 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add internal/ledger/
git commit -m "feat(enigma): Ledger interface + SQLiteLedger"
```

---

## Phase 5 — LLM Backends

### Task 6: LLMBackend interface + OllamaBackend

**Files:**
- Create: `internal/llm/backend.go`
- Create: `internal/llm/ollama.go`
- Create: `internal/llm/ollama_test.go`

- [ ] **Step 1: Write LLMBackend interface**

`internal/llm/backend.go`:
```go
package llm

import "context"

type LLMBackend interface {
	Infer(ctx context.Context, model string, prompt string) (string, error)
	ListModels(ctx context.Context) ([]string, error)
}
```

- [ ] **Step 2: Write OllamaBackend**

`internal/llm/ollama.go`:
```go
package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
)

type OllamaBackend struct {
	baseURL string
	client  *http.Client
}

func NewOllamaBackend(baseURL string) *OllamaBackend {
	return &OllamaBackend{baseURL: baseURL, client: &http.Client{}}
}

func (o *OllamaBackend) Infer(ctx context.Context, model, prompt string) (string, error) {
	body, _ := json.Marshal(map[string]any{
		"model":  model,
		"prompt": prompt,
		"stream": false,
	})
	req, err := http.NewRequestWithContext(ctx, "POST", o.baseURL+"/api/generate", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := o.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("ollama: %w", err)
	}
	defer resp.Body.Close()

	var result struct {
		Response string `json:"response"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", err
	}
	return result.Response, nil
}

func (o *OllamaBackend) ListModels(ctx context.Context) ([]string, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", o.baseURL+"/api/tags", nil)
	if err != nil {
		return nil, err
	}
	resp, err := o.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("ollama: %w", err)
	}
	defer resp.Body.Close()

	var result struct {
		Models []struct {
			Name string `json:"name"`
		} `json:"models"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}
	names := make([]string, len(result.Models))
	for i, m := range result.Models {
		names[i] = m.Name
	}
	return names, nil
}
```

- [ ] **Step 3: Write unit test with mock server**

`internal/llm/ollama_test.go`:
```go
package llm

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestOllamaInfer(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/generate" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		json.NewEncoder(w).Encode(map[string]string{"response": "pong"})
	}))
	defer srv.Close()

	b := NewOllamaBackend(srv.URL)
	result, err := b.Infer(context.Background(), "test-model", "ping")
	if err != nil {
		t.Fatal(err)
	}
	if result != "pong" {
		t.Errorf("expected 'pong', got %q", result)
	}
}

func TestOllamaListModels(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{
			"models": []map[string]string{{"name": "gemma3:4b"}, {"name": "phi3:mini"}},
		})
	}))
	defer srv.Close()

	b := NewOllamaBackend(srv.URL)
	models, err := b.ListModels(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(models) != 2 || models[0] != "gemma3:4b" {
		t.Errorf("unexpected models: %v", models)
	}
}
```

- [ ] **Step 4: Run tests**

```bash
go test ./internal/llm/... -v -run TestOllama
```

Expected: `PASS TestOllamaInfer`, `PASS TestOllamaListModels`

- [ ] **Step 5: Commit**

```bash
git add internal/llm/backend.go internal/llm/ollama.go internal/llm/ollama_test.go
git commit -m "feat(enigma): LLMBackend interface + OllamaBackend"
```

---

### Task 7: LlamaCppBackend

**Files:**
- Create: `internal/llm/llamacpp.go`
- Create: `internal/llm/llamacpp_test.go`

- [ ] **Step 1: Write LlamaCppBackend**

`internal/llm/llamacpp.go`:
```go
package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
)

type LlamaCppBackend struct {
	baseURL string
	client  *http.Client
}

func NewLlamaCppBackend(baseURL string) *LlamaCppBackend {
	return &LlamaCppBackend{baseURL: baseURL, client: &http.Client{}}
}

func (l *LlamaCppBackend) Infer(ctx context.Context, _ string, prompt string) (string, error) {
	body, _ := json.Marshal(map[string]any{
		"prompt": prompt,
		"n_predict": 512,
		"stream": false,
	})
	req, err := http.NewRequestWithContext(ctx, "POST", l.baseURL+"/completion", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := l.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("llamacpp: %w", err)
	}
	defer resp.Body.Close()

	var result struct {
		Content string `json:"content"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", err
	}
	return result.Content, nil
}

func (l *LlamaCppBackend) ListModels(ctx context.Context) ([]string, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", l.baseURL+"/v1/models", nil)
	if err != nil {
		return nil, err
	}
	resp, err := l.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("llamacpp: %w", err)
	}
	defer resp.Body.Close()

	var result struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}
	ids := make([]string, len(result.Data))
	for i, m := range result.Data {
		ids[i] = m.ID
	}
	return ids, nil
}
```

- [ ] **Step 2: Write test**

`internal/llm/llamacpp_test.go`:
```go
package llm

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestLlamaCppInfer(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/completion" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		json.NewEncoder(w).Encode(map[string]string{"content": "hello"})
	}))
	defer srv.Close()

	b := NewLlamaCppBackend(srv.URL)
	result, err := b.Infer(context.Background(), "any-model", "hi")
	if err != nil {
		t.Fatal(err)
	}
	if result != "hello" {
		t.Errorf("expected 'hello', got %q", result)
	}
}
```

- [ ] **Step 3: Run tests**

```bash
go test ./internal/llm/... -v
```

Expected: all 3 LLM tests PASS

- [ ] **Step 4: Commit**

```bash
git add internal/llm/llamacpp.go internal/llm/llamacpp_test.go
git commit -m "feat(enigma): LlamaCppBackend"
```

---

## Phase 6 — Router

### Task 8: Router interface + RoundRobinRouter

**Files:**
- Create: `internal/router/router.go`
- Create: `internal/router/roundrobin.go`
- Create: `internal/router/roundrobin_test.go`

- [ ] **Step 1: Write Router interface**

`internal/router/router.go`:
```go
package router

import (
	"context"
	"enigma/internal/types"
)

type Router interface {
	SelectNode(ctx context.Context, job types.Job, nodes []types.Node) (types.Node, error)
}
```

- [ ] **Step 2: Write RoundRobinRouter**

`internal/router/roundrobin.go`:
```go
package router

import (
	"context"
	"enigma/internal/types"
	"errors"
	"sync/atomic"
)

type RoundRobinRouter struct {
	counter atomic.Uint64
}

func NewRoundRobinRouter() *RoundRobinRouter {
	return &RoundRobinRouter{}
}

func (r *RoundRobinRouter) SelectNode(_ context.Context, _ types.Job, nodes []types.Node) (types.Node, error) {
	if len(nodes) == 0 {
		return types.Node{}, errors.New("no nodes available")
	}
	idx := r.counter.Add(1) - 1
	return nodes[idx%uint64(len(nodes))], nil
}
```

- [ ] **Step 3: Write test**

`internal/router/roundrobin_test.go`:
```go
package router

import (
	"context"
	"enigma/internal/types"
	"errors"
	"testing"
)

func TestRoundRobinDistributes(t *testing.T) {
	r := NewRoundRobinRouter()
	nodes := []types.Node{{ID: "a"}, {ID: "b"}, {ID: "c"}}
	ctx := context.Background()
	job := types.Job{}

	counts := map[string]int{}
	for i := 0; i < 9; i++ {
		n, err := r.SelectNode(ctx, job, nodes)
		if err != nil {
			t.Fatal(err)
		}
		counts[n.ID]++
	}
	for _, id := range []string{"a", "b", "c"} {
		if counts[id] != 3 {
			t.Errorf("node %q got %d calls, expected 3", id, counts[id])
		}
	}
}

func TestRoundRobinNoNodes(t *testing.T) {
	r := NewRoundRobinRouter()
	_, err := r.SelectNode(context.Background(), types.Job{}, nil)
	if err == nil {
		t.Error("expected error for empty nodes, got nil")
	}
}
```

- [ ] **Step 4: Run tests**

```bash
go test ./internal/router/... -v -run TestRoundRobin
```

Expected: both tests PASS

- [ ] **Step 5: Commit**

```bash
git add internal/router/router.go internal/router/roundrobin.go internal/router/roundrobin_test.go
git commit -m "feat(enigma): Router interface + RoundRobinRouter"
```

---

### Task 9: ScoredRouter

**Files:**
- Create: `internal/router/scored.go`
- Create: `internal/router/scored_test.go`

- [ ] **Step 1: Write ScoredRouter**

`internal/router/scored.go`:
```go
package router

import (
	"context"
	"enigma/internal/types"
	"errors"
)

const (
	weightBenchmark  = 0.4
	weightRating     = 0.4
	weightReliability = 0.2
)

type ScoredRouter struct {
	fallback Router
}

func NewScoredRouter(fallback Router) *ScoredRouter {
	return &ScoredRouter{fallback: fallback}
}

func score(n types.Node) float64 {
	return n.BenchmarkScore*weightBenchmark +
		n.AvgRating*weightRating +
		n.Reliability*weightReliability
}

func (r *ScoredRouter) SelectNode(ctx context.Context, job types.Job, nodes []types.Node) (types.Node, error) {
	if len(nodes) == 0 {
		return types.Node{}, errors.New("no nodes available")
	}

	// Filter to nodes that support the requested model
	var candidates []types.Node
	for _, n := range nodes {
		if job.Model == "" {
			candidates = append(candidates, n)
			continue
		}
		for _, m := range n.Models {
			if m == job.Model {
				candidates = append(candidates, n)
				break
			}
		}
	}
	if len(candidates) == 0 {
		candidates = nodes // fallback: ignore model filter
	}

	// Check if any node has been scored (not all at defaults)
	hasScores := false
	for _, n := range candidates {
		if n.BenchmarkScore != 0.5 || n.AvgRating != 0.5 {
			hasScores = true
			break
		}
	}
	if !hasScores {
		return r.fallback.SelectNode(ctx, job, candidates)
	}

	best := candidates[0]
	bestScore := score(best)
	for _, n := range candidates[1:] {
		if s := score(n); s > bestScore {
			bestScore = s
			best = n
		}
	}
	return best, nil
}
```

- [ ] **Step 2: Write tests**

`internal/router/scored_test.go`:
```go
package router

import (
	"context"
	"enigma/internal/types"
	"testing"
)

func TestScoredRouterSelectsBest(t *testing.T) {
	r := NewScoredRouter(NewRoundRobinRouter())
	ctx := context.Background()
	job := types.Job{Model: "gemma3:4b"}

	nodes := []types.Node{
		{ID: "weak", BenchmarkScore: 0.3, AvgRating: 0.4, Reliability: 0.6, Models: []string{"gemma3:4b"}},
		{ID: "strong", BenchmarkScore: 0.9, AvgRating: 0.8, Reliability: 0.95, Models: []string{"gemma3:4b"}},
		{ID: "medium", BenchmarkScore: 0.6, AvgRating: 0.6, Reliability: 0.7, Models: []string{"gemma3:4b"}},
	}

	selected, err := r.SelectNode(ctx, job, nodes)
	if err != nil {
		t.Fatal(err)
	}
	if selected.ID != "strong" {
		t.Errorf("expected 'strong', got %q (scores: weak=%.2f, strong=%.2f, medium=%.2f)",
			selected.ID, score(nodes[0]), score(nodes[1]), score(nodes[2]))
	}
}

func TestScoredRouterFiltersModel(t *testing.T) {
	r := NewScoredRouter(NewRoundRobinRouter())
	ctx := context.Background()
	job := types.Job{Model: "phi3:mini"}

	nodes := []types.Node{
		{ID: "no-phi", BenchmarkScore: 0.9, AvgRating: 0.9, Reliability: 0.99, Models: []string{"gemma3:4b"}},
		{ID: "has-phi", BenchmarkScore: 0.5, AvgRating: 0.5, Reliability: 0.5, Models: []string{"phi3:mini"}},
	}

	selected, err := r.SelectNode(ctx, job, nodes)
	if err != nil {
		t.Fatal(err)
	}
	if selected.ID != "has-phi" {
		t.Errorf("expected 'has-phi' (only node with phi3:mini), got %q", selected.ID)
	}
}

func TestScoredRouterFallsBackToRoundRobin(t *testing.T) {
	r := NewScoredRouter(NewRoundRobinRouter())
	ctx := context.Background()
	job := types.Job{}

	// All nodes at defaults — should use round-robin
	nodes := []types.Node{
		{ID: "a", BenchmarkScore: 0.5, AvgRating: 0.5, Reliability: 1.0},
		{ID: "b", BenchmarkScore: 0.5, AvgRating: 0.5, Reliability: 1.0},
	}

	seen := map[string]bool{}
	for i := 0; i < 4; i++ {
		n, _ := r.SelectNode(ctx, job, nodes)
		seen[n.ID] = true
	}
	if !seen["a"] || !seen["b"] {
		t.Errorf("round-robin fallback didn't distribute: %v", seen)
	}
}
```

- [ ] **Step 3: Run tests**

```bash
go test ./internal/router/... -v
```

Expected: all 5 router tests PASS

- [ ] **Step 4: Commit**

```bash
git add internal/router/scored.go internal/router/scored_test.go
git commit -m "feat(enigma): ScoredRouter (benchmark×0.4 + rating×0.4 + reliability×0.2)"
```

---

## Phase 7 — Benchmark

### Task 10: Benchmark runner

**Files:**
- Create: `internal/benchmark/runner.go`
- Create: `internal/benchmark/runner_test.go`

- [ ] **Step 1: Write benchmark runner**

`internal/benchmark/runner.go`:
```go
package benchmark

import (
	"context"
	"enigma/internal/llm"
	"strings"
	"time"
)

type Result struct {
	Score float64
	Error error
}

type testCase struct {
	prompt   string
	expected string // empty = no correctness check, time-only
}

var testCases = []testCase{
	{"Was ist die Hauptstadt von Frankreich?", "paris"},
	{"Wie viel ist 17 mal 24? Antworte nur mit der Zahl.", "408"},
	{"Erkläre in einem Satz was HTTP ist.", ""},
}

const maxLatencyMs = 10_000 // 10s per prompt = score 0

func Run(ctx context.Context, backend llm.LLMBackend, model string) Result {
	totalScore := 0.0

	for _, tc := range testCases {
		start := time.Now()
		ctxTimeout, cancel := context.WithTimeout(ctx, 30*time.Second)
		response, err := backend.Infer(ctxTimeout, model, tc.prompt)
		cancel()
		elapsed := time.Since(start).Milliseconds()

		if err != nil {
			// Inference failure: 0 points for this case
			continue
		}

		var caseScore float64

		if tc.expected == "" {
			// Time-only scoring: 1.0 at 1s, 0.0 at 10s
			caseScore = 1.0 - clamp(float64(elapsed)/float64(maxLatencyMs), 0, 1)
		} else {
			// Correctness check
			if strings.Contains(strings.ToLower(response), tc.expected) {
				// Correct: full point minus latency penalty (max 20%)
				latencyPenalty := 0.2 * clamp(float64(elapsed)/float64(maxLatencyMs), 0, 1)
				caseScore = 1.0 - latencyPenalty
			}
			// Wrong answer: 0 points
		}

		totalScore += caseScore
	}

	return Result{Score: clamp(totalScore/float64(len(testCases)), 0, 1)}
}

func clamp(v, min, max float64) float64 {
	if v < min {
		return min
	}
	if v > max {
		return max
	}
	return v
}
```

- [ ] **Step 2: Write test with mock backend**

`internal/benchmark/runner_test.go`:
```go
package benchmark

import (
	"context"
	"testing"
)

type mockBackend struct {
	response string
	err      error
}

func (m *mockBackend) Infer(_ context.Context, _, _ string) (string, error) {
	return m.response, m.err
}

func (m *mockBackend) ListModels(_ context.Context) ([]string, error) {
	return nil, nil
}

func TestRunPerfectScore(t *testing.T) {
	// Answers both factual questions correctly and quickly
	b := &mockBackend{response: "Paris ist die Hauptstadt. 408 ist korrekt. HTTP ist ein Protokoll."}
	result := Run(context.Background(), b, "test-model")
	if result.Error != nil {
		t.Fatal(result.Error)
	}
	if result.Score <= 0.5 {
		t.Errorf("expected high score for correct answers, got %.2f", result.Score)
	}
}

func TestRunWrongAnswers(t *testing.T) {
	b := &mockBackend{response: "Ich weiß es nicht."}
	result := Run(context.Background(), b, "test-model")
	if result.Error != nil {
		t.Fatal(result.Error)
	}
	// Only the time-only question (3rd) scores — expect low score
	if result.Score > 0.5 {
		t.Errorf("expected low score for wrong answers, got %.2f", result.Score)
	}
}
```

- [ ] **Step 3: Run tests**

```bash
go test ./internal/benchmark/... -v
```

Expected: both tests PASS

- [ ] **Step 4: Commit**

```bash
git add internal/benchmark/
git commit -m "feat(enigma): benchmark runner (3 standard prompts, score 0.0–1.0)"
```

---

## Phase 8 — API Server

### Task 11: Job store helper + jobs handler

**Files:**
- Create: `internal/api/jobstore.go`
- Create: `internal/api/jobs.go`
- Create: `internal/api/jobs_test.go`

- [ ] **Step 1: Write job store (SQLite)**

`internal/api/jobstore.go`:
```go
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
		job.ID, job.Prompt, job.Model, job.AssignedNode, time.Now().UTC(),
	)
	return err
}

func (s *jobStore) get(ctx context.Context, id string) (types.Job, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT id, prompt, model, status, assigned_node, result, duration_ms, created_at, completed_at FROM jobs WHERE id=?`, id)
	return scanJob(row)
}

func (s *jobStore) nextForNode(ctx context.Context, nodeID string) (types.Job, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT id, prompt, model, status, assigned_node, result, duration_ms, created_at, completed_at FROM jobs WHERE assigned_node=? AND status='pending' LIMIT 1`, nodeID)
	return scanJob(row)
}

func (s *jobStore) setRunning(ctx context.Context, id string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE jobs SET status='running' WHERE id=?`, id)
	return err
}

func (s *jobStore) complete(ctx context.Context, id, result string, durationMs int64) error {
	now := time.Now().UTC()
	_, err := s.db.ExecContext(ctx,
		`UPDATE jobs SET status='done', result=?, duration_ms=?, completed_at=? WHERE id=?`,
		result, durationMs, now, id)
	return err
}

func (s *jobStore) fail(ctx context.Context, id string) error {
	now := time.Now().UTC()
	_, err := s.db.ExecContext(ctx, `UPDATE jobs SET status='failed', completed_at=? WHERE id=?`, now, id)
	return err
}

func (s *jobStore) pendingForNode(ctx context.Context, nodeID string) ([]types.Job, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, prompt, model, status, assigned_node, result, duration_ms, created_at, completed_at FROM jobs WHERE assigned_node=? AND status IN ('pending','running')`, nodeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var jobs []types.Job
	for rows.Next() {
		j, err := scanJobRow(rows)
		if err != nil {
			return nil, err
		}
		jobs = append(jobs, j)
	}
	return jobs, nil
}

func scanJob(row *sql.Row) (types.Job, error) {
	var j types.Job
	var completedAt sql.NullString
	var createdAt string
	var durationMs sql.NullInt64
	err := row.Scan(&j.ID, &j.Prompt, &j.Model, (*string)(&j.Status), &j.AssignedNode, &j.Result, &durationMs, &createdAt, &completedAt)
	if err == sql.ErrNoRows {
		return types.Job{}, fmt.Errorf("job not found")
	}
	if err != nil {
		return types.Job{}, err
	}
	j.DurationMs = durationMs.Int64
	j.CreatedAt, _ = time.Parse(time.RFC3339, createdAt)
	if completedAt.Valid {
		t, _ := time.Parse(time.RFC3339, completedAt.String)
		j.CompletedAt = &t
	}
	return j, nil
}

func scanJobRow(row *sql.Rows) (types.Job, error) {
	var j types.Job
	var completedAt sql.NullString
	var createdAt string
	var durationMs sql.NullInt64
	err := row.Scan(&j.ID, &j.Prompt, &j.Model, (*string)(&j.Status), &j.AssignedNode, &j.Result, &durationMs, &createdAt, &completedAt)
	if err != nil {
		return types.Job{}, err
	}
	j.DurationMs = durationMs.Int64
	j.CreatedAt, _ = time.Parse(time.RFC3339, createdAt)
	if completedAt.Valid {
		t, _ := time.Parse(time.RFC3339, completedAt.String)
		j.CompletedAt = &t
	}
	return j, nil
}
```

- [ ] **Step 2: Write jobs HTTP handler**

`internal/api/jobs.go`:
```go
package api

import (
	"encoding/json"
	"enigma/internal/ledger"
	"enigma/internal/registry"
	"enigma/internal/router"
	"enigma/internal/types"
	"net/http"

	"github.com/google/uuid"
)

type jobsHandler struct {
	jobs     *jobStore
	registry registry.RegistryStore
	router   router.Router
	ledger   ledger.Ledger
}

func (h *jobsHandler) submit(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Prompt string `json:"prompt"`
		Model  string `json:"model"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	if req.Prompt == "" {
		http.Error(w, "prompt required", http.StatusBadRequest)
		return
	}

	nodes, err := h.registry.List(r.Context())
	if err != nil || len(nodes) == 0 {
		http.Error(w, "no nodes available", http.StatusServiceUnavailable)
		return
	}

	job := types.Job{ID: uuid.NewString(), Prompt: req.Prompt, Model: req.Model}
	selected, err := h.router.SelectNode(r.Context(), job, nodes)
	if err != nil {
		http.Error(w, "routing failed", http.StatusServiceUnavailable)
		return
	}
	job.AssignedNode = selected.ID

	if err := h.jobs.create(r.Context(), job); err != nil {
		http.Error(w, "failed to create job", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]string{"job_id": job.ID})
}

func (h *jobsHandler) status(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	job, err := h.jobs.get(r.Context(), id)
	if err != nil {
		http.Error(w, "job not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(job)
}

func (h *jobsHandler) result(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var req struct {
		Result     string `json:"result"`
		DurationMs int64  `json:"duration_ms"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}

	job, err := h.jobs.get(r.Context(), id)
	if err != nil {
		http.Error(w, "job not found", http.StatusNotFound)
		return
	}

	if err := h.jobs.complete(r.Context(), id, req.Result, req.DurationMs); err != nil {
		http.Error(w, "failed to complete job", http.StatusInternalServerError)
		return
	}

	h.ledger.Credit(r.Context(), job.AssignedNode, 1.0, "job_complete")

	w.WriteHeader(http.StatusNoContent)
}
```

- [ ] **Step 3: Write test**

`internal/api/jobs_test.go`:
```go
package api

import (
	"bytes"
	"context"
	"encoding/json"
	"enigma/internal/db"
	"enigma/internal/ledger"
	"enigma/internal/registry"
	"enigma/internal/router"
	"enigma/internal/types"
	"net/http"
	"net/http/httptest"
	"testing"
)

func setupJobsHandler(t *testing.T) (*jobsHandler, *sql.DB) {
	t.Helper()
	sqldb, _ := db.Open(t.TempDir() + "/test.db")
	t.Cleanup(func() { sqldb.Close() })
	return &jobsHandler{
		jobs:     newJobStore(sqldb),
		registry: registry.NewSQLiteRegistry(sqldb),
		router:   router.NewScoredRouter(router.NewRoundRobinRouter()),
		ledger:   ledger.NewSQLiteLedger(sqldb),
	}, sqldb
}

func TestSubmitJob(t *testing.T) {
	h, sqldb := setupJobsHandler(t)
	ctx := context.Background()

	// Register a node first
	reg := registry.NewSQLiteRegistry(sqldb)
	reg.Register(ctx, types.Node{ID: "node-1", Address: "localhost:9001", Backend: types.BackendOllama, Models: []string{"gemma3:4b"}})

	body, _ := json.Marshal(map[string]string{"prompt": "hello", "model": "gemma3:4b"})
	req := httptest.NewRequest("POST", "/api/v1/jobs", bytes.NewReader(body))
	w := httptest.NewRecorder()
	h.submit(w, req)

	if w.Code != http.StatusCreated {
		t.Errorf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var resp map[string]string
	json.NewDecoder(w.Body).Decode(&resp)
	if resp["job_id"] == "" {
		t.Error("expected job_id in response")
	}
}

func TestSubmitNoNodes(t *testing.T) {
	h, _ := setupJobsHandler(t)
	body, _ := json.Marshal(map[string]string{"prompt": "hello"})
	req := httptest.NewRequest("POST", "/api/v1/jobs", bytes.NewReader(body))
	w := httptest.NewRecorder()
	h.submit(w, req)

	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("expected 503, got %d", w.Code)
	}
}
```

Note: Fix the import of `database/sql` in jobs_test.go:

`internal/api/jobs_test.go` line 10 should be:
```go
import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	...
```

- [ ] **Step 4: Run tests**

```bash
go test ./internal/api/... -v -run TestSubmit
```

Expected: both job tests PASS

- [ ] **Step 5: Commit**

```bash
git add internal/api/jobstore.go internal/api/jobs.go internal/api/jobs_test.go
git commit -m "feat(enigma): job store + jobs HTTP handler"
```

---

### Task 12: Nodes handler (register, heartbeat, deregister, poll)

**Files:**
- Create: `internal/api/nodes.go`
- Create: `internal/api/nodes_test.go`

- [ ] **Step 1: Write nodes handler**

`internal/api/nodes.go`:
```go
package api

import (
	"context"
	"encoding/json"
	"enigma/internal/benchmark"
	"enigma/internal/ledger"
	"enigma/internal/llm"
	"enigma/internal/registry"
	"enigma/internal/types"
	"net/http"
	"time"

	"github.com/google/uuid"
)

type nodesHandler struct {
	registry  registry.RegistryStore
	ledger    ledger.Ledger
	jobs      *jobStore
	newBackend func(backend types.Backend, address string) llm.LLMBackend
}

func defaultNewBackend(backend types.Backend, address string) llm.LLMBackend {
	switch backend {
	case types.BackendLlamaCpp:
		return llm.NewLlamaCppBackend("http://" + address)
	default:
		return llm.NewOllamaBackend("http://" + address)
	}
}

func (h *nodesHandler) register(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Address   string        `json:"address"`
		Backend   types.Backend `json:"backend"`
		Models    []string      `json:"models"`
		GPUVRAMMb int           `json:"gpu_vram_mb"`
		GPUModel  string        `json:"gpu_model"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Address == "" {
		http.Error(w, "invalid request: address required", http.StatusBadRequest)
		return
	}

	node := types.Node{
		ID:          uuid.NewString(),
		Address:     req.Address,
		Backend:     req.Backend,
		Models:      req.Models,
		GPUVRAMMb:   req.GPUVRAMMb,
		GPUModel:    req.GPUModel,
		AvgRating:   0.5,
		Reliability: 1.0,
	}

	// Run benchmark
	backend := h.newBackend(req.Backend, req.Address)
	model := ""
	if len(req.Models) > 0 {
		model = req.Models[0]
	}
	ctx, cancel := context.WithTimeout(r.Context(), 120*time.Second)
	defer cancel()
	bResult := benchmark.Run(ctx, backend, model)
	node.BenchmarkScore = bResult.Score

	if err := h.registry.Register(r.Context(), node); err != nil {
		http.Error(w, "failed to register", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]string{"node_id": node.ID})
}

func (h *nodesHandler) heartbeat(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := h.registry.Heartbeat(r.Context(), id); err != nil {
		http.Error(w, "node not found", http.StatusNotFound)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *nodesHandler) deregister(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	h.registry.Deregister(r.Context(), id)
	w.WriteHeader(http.StatusNoContent)
}

func (h *nodesHandler) pollJob(w http.ResponseWriter, r *http.Request) {
	nodeID := r.PathValue("id")

	// Long-poll: check every 500ms for up to 30s
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()

	for {
		job, err := h.jobs.nextForNode(ctx, nodeID)
		if err == nil {
			h.jobs.setRunning(ctx, job.ID)
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(job)
			return
		}
		select {
		case <-ctx.Done():
			w.WriteHeader(http.StatusNoContent)
			return
		case <-time.After(500 * time.Millisecond):
		}
	}
}

func (h *nodesHandler) balance(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	bal, err := h.ledger.Balance(r.Context(), id)
	if err != nil {
		http.Error(w, "failed to get balance", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]float64{"balance": bal})
}
```

- [ ] **Step 2: Write test**

`internal/api/nodes_test.go`:
```go
package api

import (
	"bytes"
	"context"
	"encoding/json"
	"enigma/internal/db"
	"enigma/internal/ledger"
	"enigma/internal/llm"
	"enigma/internal/registry"
	"enigma/internal/types"
	"net/http"
	"net/http/httptest"
	"testing"
)

type mockLLMBackend struct{}

func (m *mockLLMBackend) Infer(_ context.Context, _, _ string) (string, error) {
	return "Paris. 408. HTTP ist ein Protokoll.", nil
}
func (m *mockLLMBackend) ListModels(_ context.Context) ([]string, error) { return nil, nil }

func setupNodesHandler(t *testing.T) *nodesHandler {
	t.Helper()
	sqldb, _ := db.Open(t.TempDir() + "/test.db")
	t.Cleanup(func() { sqldb.Close() })
	return &nodesHandler{
		registry: registry.NewSQLiteRegistry(sqldb),
		ledger:   ledger.NewSQLiteLedger(sqldb),
		jobs:     newJobStore(sqldb),
		newBackend: func(_ types.Backend, _ string) llm.LLMBackend {
			return &mockLLMBackend{}
		},
	}
}

func TestRegisterNode(t *testing.T) {
	h := setupNodesHandler(t)

	body, _ := json.Marshal(map[string]any{
		"address": "localhost:11434",
		"backend": "ollama",
		"models":  []string{"gemma3:4b"},
	})
	req := httptest.NewRequest("POST", "/api/v1/nodes/register", bytes.NewReader(body))
	w := httptest.NewRecorder()
	h.register(w, req)

	if w.Code != http.StatusCreated {
		t.Errorf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var resp map[string]string
	json.NewDecoder(w.Body).Decode(&resp)
	if resp["node_id"] == "" {
		t.Error("expected node_id in response")
	}
}
```

- [ ] **Step 3: Run tests**

```bash
go test ./internal/api/... -v -run TestRegister
```

Expected: `PASS TestRegisterNode`

- [ ] **Step 4: Commit**

```bash
git add internal/api/nodes.go internal/api/nodes_test.go
git commit -m "feat(enigma): nodes HTTP handler (register, heartbeat, deregister, poll, balance)"
```

---

### Task 13: Ratings handler + heartbeat monitor

**Files:**
- Create: `internal/api/ratings.go`
- Create: `internal/api/monitor.go`

- [ ] **Step 1: Write ratings handler**

`internal/api/ratings.go`:
```go
package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"enigma/internal/registry"
	"net/http"
	"time"
)

type ratingsHandler struct {
	db       *sql.DB
	jobs     *jobStore
	registry registry.RegistryStore
}

func (h *ratingsHandler) rate(w http.ResponseWriter, r *http.Request) {
	jobID := r.PathValue("id")
	var req struct {
		Score int `json:"score"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Score < 1 || req.Score > 5 {
		http.Error(w, "score must be 1–5", http.StatusBadRequest)
		return
	}

	job, err := h.jobs.get(r.Context(), jobID)
	if err != nil {
		http.Error(w, "job not found", http.StatusNotFound)
		return
	}

	_, err = h.db.ExecContext(r.Context(),
		`INSERT INTO ratings (job_id, node_id, score, created_at) VALUES (?, ?, ?, ?)`,
		jobID, job.AssignedNode, req.Score, time.Now().UTC(),
	)
	if err != nil {
		http.Error(w, "failed to save rating", http.StatusInternalServerError)
		return
	}

	// Recalculate avg_rating for the node
	h.recalcRating(r.Context(), job.AssignedNode)

	w.WriteHeader(http.StatusNoContent)
}

func (h *ratingsHandler) recalcRating(ctx context.Context, nodeID string) {
	var avg sql.NullFloat64
	h.db.QueryRowContext(ctx,
		`SELECT AVG(CAST(score AS REAL) / 5.0) FROM ratings WHERE node_id=?`, nodeID,
	).Scan(&avg)
	if avg.Valid {
		h.db.ExecContext(ctx, `UPDATE nodes SET avg_rating=? WHERE id=?`, avg.Float64, nodeID)
	}
}
```

- [ ] **Step 2: Write heartbeat monitor**

`internal/api/monitor.go`:
```go
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
	cutoff := time.Now().UTC().Add(-90 * time.Second)
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
```

- [ ] **Step 3: Commit**

```bash
git add internal/api/ratings.go internal/api/monitor.go
git commit -m "feat(enigma): ratings handler + heartbeat watchdog"
```

---

### Task 14: HTTP server wiring

**Files:**
- Create: `internal/api/server.go`

- [ ] **Step 1: Write server**

`internal/api/server.go`:
```go
package api

import (
	"database/sql"
	"enigma/internal/ledger"
	"enigma/internal/llm"
	"enigma/internal/registry"
	"enigma/internal/router"
	"enigma/internal/types"
	"net/http"
)

type Server struct {
	mux *http.ServeMux
	db  *sql.DB
}

func NewServer(db *sql.DB) *Server {
	reg := registry.NewSQLiteRegistry(db)
	led := ledger.NewSQLiteLedger(db)
	jobs := newJobStore(db)
	rtr := router.NewScoredRouter(router.NewRoundRobinRouter())

	jobsH := &jobsHandler{jobs: jobs, registry: reg, router: rtr, ledger: led}
	nodesH := &nodesHandler{
		registry: reg, ledger: led, jobs: jobs,
		newBackend: func(backend types.Backend, address string) llm.LLMBackend {
			return defaultNewBackend(backend, address)
		},
	}
	ratingsH := &ratingsHandler{db: db, jobs: jobs, registry: reg}

	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/v1/nodes/register", nodesH.register)
	mux.HandleFunc("PUT /api/v1/nodes/{id}/heartbeat", nodesH.heartbeat)
	mux.HandleFunc("DELETE /api/v1/nodes/{id}", nodesH.deregister)
	mux.HandleFunc("GET /api/v1/nodes/{id}/jobs", nodesH.pollJob)
	mux.HandleFunc("GET /api/v1/nodes/{id}/balance", nodesH.balance)
	mux.HandleFunc("POST /api/v1/jobs", jobsH.submit)
	mux.HandleFunc("GET /api/v1/jobs/{id}", jobsH.status)
	mux.HandleFunc("POST /api/v1/jobs/{id}/result", jobsH.result)
	mux.HandleFunc("POST /api/v1/jobs/{id}/rate", ratingsH.rate)

	return &Server{mux: mux, db: db}
}

func (s *Server) Handler() http.Handler { return s.mux }
```

- [ ] **Step 2: Verify it compiles**

```bash
go build ./internal/api/...
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add internal/api/server.go
git commit -m "feat(enigma): HTTP server wiring + route registration"
```

---

## Phase 9 — Binaries

### Task 15: enigma-server binary

**Files:**
- Create: `cmd/server/main.go`

- [ ] **Step 1: Write main**

`cmd/server/main.go`:
```go
package main

import (
	"context"
	"enigma/internal/api"
	"enigma/internal/db"
	"flag"
	"log"
	"net/http"
	"os/signal"
	"syscall"
)

func main() {
	dbPath := flag.String("db", "enigma.db", "SQLite database path")
	addr := flag.String("addr", ":8080", "Listen address")
	flag.Parse()

	sqldb, err := db.Open(*dbPath)
	if err != nil {
		log.Fatalf("failed to open database: %v", err)
	}
	defer sqldb.Close()

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	api.StartMonitor(ctx, sqldb)

	srv := api.NewServer(sqldb)
	httpSrv := &http.Server{Addr: *addr, Handler: srv.Handler()}

	go func() {
		<-ctx.Done()
		httpSrv.Shutdown(context.Background())
	}()

	log.Printf("enigma-server listening on %s", *addr)
	if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("server error: %v", err)
	}
}
```

- [ ] **Step 2: Build**

```bash
go build -o bin/enigma-server ./cmd/server
```

Expected: `bin/enigma-server` created

- [ ] **Step 3: Smoke test**

```bash
./bin/enigma-server -db /tmp/test-enigma.db &
sleep 1
curl -s http://localhost:8080/api/v1/jobs/nonexistent
kill %1
```

Expected: `job not found` (404 response)

- [ ] **Step 4: Commit**

```bash
git add cmd/server/
git commit -m "feat(enigma): enigma-server binary"
```

---

### Task 16: enigma-node binary

**Files:**
- Create: `cmd/node/main.go`

- [ ] **Step 1: Write main**

`cmd/node/main.go`:
```go
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os/signal"
	"syscall"
	"time"

	"enigma/internal/llm"
	"enigma/internal/types"
)

func main() {
	serverURL := flag.String("server", "http://localhost:8080", "enigma-server URL")
	backendStr := flag.String("backend", "ollama", "LLM backend: ollama or llamacpp")
	backendAddr := flag.String("backend-addr", "localhost:11434", "Backend host:port")
	flag.Parse()

	backend := types.BackendOllama
	if *backendStr == "llamacpp" {
		backend = types.BackendLlamaCpp
	}

	var llmBackend llm.LLMBackend
	switch backend {
	case types.BackendLlamaCpp:
		llmBackend = llm.NewLlamaCppBackend("http://" + *backendAddr)
	default:
		llmBackend = llm.NewOllamaBackend("http://" + *backendAddr)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	// List available models
	models, err := llmBackend.ListModels(ctx)
	if err != nil {
		log.Printf("warning: could not list models: %v", err)
	}

	// Register with server
	regBody, _ := json.Marshal(map[string]any{
		"address":     *backendAddr,
		"backend":     string(backend),
		"models":      models,
		"gpu_vram_mb": 0,
	})
	resp, err := http.Post(*serverURL+"/api/v1/nodes/register", "application/json", bytes.NewReader(regBody))
	if err != nil {
		log.Fatalf("failed to register: %v", err)
	}
	var regResp map[string]string
	json.NewDecoder(resp.Body).Decode(&regResp)
	resp.Body.Close()
	nodeID := regResp["node_id"]
	if nodeID == "" {
		log.Fatal("no node_id in register response")
	}
	log.Printf("registered as node %s", nodeID)
	defer http.NewRequest("DELETE", *serverURL+"/api/v1/nodes/"+nodeID, nil)

	// Heartbeat loop
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		client := &http.Client{}
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				req, _ := http.NewRequestWithContext(ctx, "PUT", *serverURL+"/api/v1/nodes/"+nodeID+"/heartbeat", nil)
				client.Do(req)
			}
		}
	}()

	// Job poll loop
	client := &http.Client{Timeout: 35 * time.Second}
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		req, _ := http.NewRequestWithContext(ctx, "GET", fmt.Sprintf("%s/api/v1/nodes/%s/jobs", *serverURL, nodeID), nil)
		resp, err := client.Do(req)
		if err != nil {
			time.Sleep(2 * time.Second)
			continue
		}
		if resp.StatusCode == http.StatusNoContent {
			resp.Body.Close()
			continue
		}

		var job struct {
			ID     string `json:"id"`
			Prompt string `json:"prompt"`
			Model  string `json:"model"`
		}
		json.NewDecoder(resp.Body).Decode(&job)
		resp.Body.Close()

		if job.ID == "" {
			continue
		}

		log.Printf("running job %s (model: %s)", job.ID, job.Model)
		start := time.Now()
		inferCtx, cancel := context.WithTimeout(ctx, 5*time.Minute)
		result, err := llmBackend.Infer(inferCtx, job.Model, job.Prompt)
		cancel()
		elapsed := time.Since(start).Milliseconds()

		if err != nil {
			log.Printf("inference failed: %v", err)
			// Report failure
			body, _ := json.Marshal(map[string]any{"result": "", "duration_ms": elapsed})
			http.Post(*serverURL+"/api/v1/jobs/"+job.ID+"/result", "application/json", bytes.NewReader(body))
			continue
		}

		body, _ := json.Marshal(map[string]any{"result": result, "duration_ms": elapsed})
		postResp, _ := http.Post(*serverURL+"/api/v1/jobs/"+job.ID+"/result", "application/json", bytes.NewReader(body))
		if postResp != nil {
			io.Copy(io.Discard, postResp.Body)
			postResp.Body.Close()
		}
		log.Printf("job %s done in %dms", job.ID, elapsed)
	}
}
```

- [ ] **Step 2: Build**

```bash
go build -o bin/enigma-node ./cmd/node
```

Expected: `bin/enigma-node` created, no errors

- [ ] **Step 3: Commit**

```bash
git add cmd/node/
git commit -m "feat(enigma): enigma-node binary (register, poll, infer, heartbeat)"
```

---

### Task 17: enigma-cli binary

**Files:**
- Create: `cmd/cli/main.go`

- [ ] **Step 1: Write main**

`cmd/cli/main.go`:
```go
package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"time"
)

func main() {
	serverURL := flag.String("server", "http://localhost:8080", "enigma-server URL")
	flag.Parse()

	if flag.NArg() == 0 {
		fmt.Println("Usage: enigma-cli -server <url> <command> [args]")
		fmt.Println("Commands: submit, status, rate, balance, stats")
		os.Exit(1)
	}

	switch flag.Arg(0) {
	case "submit":
		submitCmd(*serverURL)
	case "status":
		statusCmd(*serverURL)
	case "rate":
		rateCmd(*serverURL)
	case "balance":
		balanceCmd(*serverURL)
	case "stats":
		statsCmd(*serverURL)
	default:
		log.Fatalf("unknown command: %s", flag.Arg(0))
	}
}

func submitCmd(server string) {
	fs := flag.NewFlagSet("submit", flag.ExitOnError)
	model := fs.String("model", "", "Model name")
	prompt := fs.String("prompt", "", "Prompt text")
	wait := fs.Bool("wait", true, "Wait for result")
	fs.Parse(flag.Args()[1:])

	if *prompt == "" {
		log.Fatal("--prompt required")
	}

	body, _ := json.Marshal(map[string]string{"prompt": *prompt, "model": *model})
	resp, err := http.Post(server+"/api/v1/jobs", "application/json", bytes.NewReader(body))
	if err != nil {
		log.Fatalf("submit failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated {
		b, _ := io.ReadAll(resp.Body)
		log.Fatalf("submit error %d: %s", resp.StatusCode, b)
	}

	var result map[string]string
	json.NewDecoder(resp.Body).Decode(&result)
	jobID := result["job_id"]
	fmt.Printf("job_id: %s\n", jobID)

	if !*wait {
		return
	}

	// Poll for result
	for i := 0; i < 120; i++ {
		time.Sleep(2 * time.Second)
		resp, _ := http.Get(server + "/api/v1/jobs/" + jobID)
		if resp == nil {
			continue
		}
		var job map[string]any
		json.NewDecoder(resp.Body).Decode(&job)
		resp.Body.Close()

		status, _ := job["Status"].(string)
		if status == "done" {
			fmt.Printf("\nResult: %v\n", job["Result"])
			return
		}
		if status == "failed" {
			fmt.Println("\nJob failed.")
			return
		}
		fmt.Print(".")
	}
	fmt.Println("\ntimeout waiting for result")
}

func statusCmd(server string) {
	if flag.NArg() < 2 {
		log.Fatal("usage: status <job_id>")
	}
	resp, err := http.Get(server + "/api/v1/jobs/" + flag.Arg(1))
	if err != nil {
		log.Fatal(err)
	}
	defer resp.Body.Close()
	io.Copy(os.Stdout, resp.Body)
	fmt.Println()
}

func rateCmd(server string) {
	fs := flag.NewFlagSet("rate", flag.ExitOnError)
	score := fs.Int("score", 0, "Rating 1–5")
	fs.Parse(flag.Args()[1:])
	if fs.NArg() < 1 || *score < 1 || *score > 5 {
		log.Fatal("usage: rate --score 1-5 <job_id>")
	}
	body, _ := json.Marshal(map[string]int{"score": *score})
	resp, _ := http.Post(server+"/api/v1/jobs/"+fs.Arg(0)+"/rate", "application/json", bytes.NewReader(body))
	if resp.StatusCode == http.StatusNoContent {
		fmt.Println("rated.")
	}
}

func balanceCmd(server string) {
	if flag.NArg() < 2 {
		log.Fatal("usage: balance <node_id>")
	}
	resp, _ := http.Get(server + "/api/v1/nodes/" + flag.Arg(1) + "/balance")
	defer resp.Body.Close()
	io.Copy(os.Stdout, resp.Body)
	fmt.Println()
}

func statsCmd(server string) {
	// Show all nodes and their scores (query via DB not exposed — show as-is for PoC)
	fmt.Println("stats: use enigma-server logs or query enigma.db directly")
	fmt.Printf("  sqlite3 enigma.db 'SELECT id, benchmark_score, avg_rating, reliability FROM nodes'\n")
}
```

- [ ] **Step 2: Build all**

```bash
make build
```

Expected: `bin/enigma-server`, `bin/enigma-node`, `bin/enigma-cli` all created

- [ ] **Step 3: Commit**

```bash
git add cmd/cli/
git commit -m "feat(enigma): enigma-cli binary (submit, status, rate, balance)"
```

---

## Phase 10 — Integration Test + Simulation

### Task 18: Full integration test

**Files:**
- Create: `internal/api/integration_test.go`

- [ ] **Step 1: Write integration test**

`internal/api/integration_test.go`:
```go
package api

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"enigma/internal/db"
	"enigma/internal/llm"
	"enigma/internal/types"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func setupTestServer(t *testing.T, mockLLM llm.LLMBackend) (*httptest.Server, *sql.DB) {
	t.Helper()
	sqldb, _ := db.Open(t.TempDir() + "/test.db")
	t.Cleanup(func() { sqldb.Close() })

	apiServer := NewServer(sqldb)
	// Override backend factory with mock
	reg := apiServer.(*Server) // Note: need to expose for test — see note below
	_ = reg
	srv := httptest.NewServer(apiServer.Handler())
	t.Cleanup(srv.Close)
	return srv, sqldb
}
```

Note: `NewServer` returns `*Server`, not an interface. Update the integration test to directly wire a mock:

`internal/api/integration_test.go` (complete version):
```go
package api

import (
	"bytes"
	"context"
	"encoding/json"
	"enigma/internal/db"
	"enigma/internal/ledger"
	"enigma/internal/llm"
	"enigma/internal/registry"
	"enigma/internal/router"
	"enigma/internal/types"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

type fastMockBackend struct{}

func (f *fastMockBackend) Infer(_ context.Context, _, prompt string) (string, error) {
	return "Paris. 408. HTTP ist ein Protokoll fuer Webanfragen.", nil
}
func (f *fastMockBackend) ListModels(_ context.Context) ([]string, error) {
	return []string{"gemma3:4b"}, nil
}

func newTestServer(t *testing.T) *httptest.Server {
	t.Helper()
	sqldb, _ := db.Open(t.TempDir() + "/test.db")
	t.Cleanup(func() { sqldb.Close() })

	reg := registry.NewSQLiteRegistry(sqldb)
	led := ledger.NewSQLiteLedger(sqldb)
	jobs := newJobStore(sqldb)
	rtr := router.NewScoredRouter(router.NewRoundRobinRouter())

	jobsH := &jobsHandler{jobs: jobs, registry: reg, router: rtr, ledger: led}
	nodesH := &nodesHandler{
		registry: reg, ledger: led, jobs: jobs,
		newBackend: func(_ types.Backend, _ string) llm.LLMBackend {
			return &fastMockBackend{}
		},
	}
	ratingsH := &ratingsHandler{db: sqldb, jobs: jobs, registry: reg}

	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/v1/nodes/register", nodesH.register)
	mux.HandleFunc("PUT /api/v1/nodes/{id}/heartbeat", nodesH.heartbeat)
	mux.HandleFunc("DELETE /api/v1/nodes/{id}", nodesH.deregister)
	mux.HandleFunc("GET /api/v1/nodes/{id}/jobs", nodesH.pollJob)
	mux.HandleFunc("GET /api/v1/nodes/{id}/balance", nodesH.balance)
	mux.HandleFunc("POST /api/v1/jobs", jobsH.submit)
	mux.HandleFunc("GET /api/v1/jobs/{id}", jobsH.status)
	mux.HandleFunc("POST /api/v1/jobs/{id}/result", jobsH.result)
	mux.HandleFunc("POST /api/v1/jobs/{id}/rate", ratingsH.rate)

	return httptest.NewServer(mux)
}

func TestFullJobFlow(t *testing.T) {
	srv := newTestServer(t)

	// 1. Register node
	regBody, _ := json.Marshal(map[string]any{
		"address": "localhost:11434", "backend": "ollama", "models": []string{"gemma3:4b"},
	})
	resp, _ := http.Post(srv.URL+"/api/v1/nodes/register", "application/json", bytes.NewReader(regBody))
	var regResp map[string]string
	json.NewDecoder(resp.Body).Decode(&regResp)
	resp.Body.Close()
	nodeID := regResp["node_id"]
	if nodeID == "" {
		t.Fatal("no node_id")
	}

	// 2. Submit job
	jobBody, _ := json.Marshal(map[string]string{"prompt": "test", "model": "gemma3:4b"})
	resp, _ = http.Post(srv.URL+"/api/v1/jobs", "application/json", bytes.NewReader(jobBody))
	var jobResp map[string]string
	json.NewDecoder(resp.Body).Decode(&jobResp)
	resp.Body.Close()
	jobID := jobResp["job_id"]
	if jobID == "" {
		t.Fatal("no job_id")
	}

	// 3. Node polls job (in background goroutine)
	go func() {
		time.Sleep(100 * time.Millisecond)
		resp, _ := http.Get(srv.URL + "/api/v1/nodes/" + nodeID + "/jobs")
		if resp.StatusCode != http.StatusOK {
			return
		}
		var job map[string]string
		json.NewDecoder(resp.Body).Decode(&job)
		resp.Body.Close()

		// Report result
		resultBody, _ := json.Marshal(map[string]any{"result": "answer", "duration_ms": 500})
		http.Post(srv.URL+"/api/v1/jobs/"+job["ID"]+"/result", "application/json", bytes.NewReader(resultBody))
	}()

	// 4. Wait for job to complete and verify
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		time.Sleep(200 * time.Millisecond)
		resp, _ := http.Get(srv.URL + "/api/v1/jobs/" + jobID)
		var status map[string]any
		json.NewDecoder(resp.Body).Decode(&status)
		resp.Body.Close()
		if status["Status"] == "done" {
			break
		}
	}

	// 5. Check balance
	resp, _ = http.Get(srv.URL + "/api/v1/nodes/" + nodeID + "/balance")
	var bal map[string]float64
	json.NewDecoder(resp.Body).Decode(&bal)
	resp.Body.Close()
	if bal["balance"] != 1.0 {
		t.Errorf("expected balance 1.0 ENI, got %f", bal["balance"])
	}
}
```

- [ ] **Step 2: Run integration test**

```bash
go test ./internal/api/... -v -run TestFullJobFlow -timeout 30s
```

Expected: `PASS TestFullJobFlow`

- [ ] **Step 3: Run all tests**

```bash
go test ./... -v
```

Expected: all tests PASS

- [ ] **Step 4: Commit**

```bash
git add internal/api/integration_test.go
git commit -m "test(enigma): full job flow integration test"
```

---

### Task 19: Run simulation + final build

- [ ] **Step 1: Full build**

```bash
make build
```

Expected: all 3 binaries in `bin/`

- [ ] **Step 2: Run simulation**

Requires: Ollama running on `localhost:11434` with at least one model (e.g. `gemma3:4b`).

Terminal 1:
```bash
./bin/enigma-server -db /tmp/enigma-sim.db
```

Terminal 2 (3 nodes):
```bash
./bin/enigma-node -server http://localhost:8080 -backend ollama -backend-addr localhost:11434 &
./bin/enigma-node -server http://localhost:8080 -backend ollama -backend-addr localhost:11434 &
./bin/enigma-node -server http://localhost:8080 -backend ollama -backend-addr localhost:11434 &
```

Terminal 3 (submit 5 jobs):
```bash
for i in 1 2 3 4 5; do
  ./bin/enigma-cli -server http://localhost:8080 submit --model gemma3:4b --prompt "Was ist $i hoch 2?" --wait=false
done
```

Wait 60s, then check balances:
```bash
sqlite3 /tmp/enigma-sim.db "SELECT n.id, n.benchmark_score, n.avg_rating, n.reliability, l.total FROM nodes n LEFT JOIN (SELECT node_id, SUM(amount) as total FROM ledger GROUP BY node_id) l ON n.id=l.node_id"
```

Expected: jobs distributed across nodes, each node has ENI balance > 0.

- [ ] **Step 3: Final commit**

```bash
git add .
git commit -m "feat(enigma): complete PoC implementation — server, node, cli, tests, simulation"
```

---

## Summary

| Phase | Tasks | Output |
|---|---|---|
| 1 | 1 | Go module, Makefile, dir structure |
| 2 | 2–3 | Shared types (incl. GPUModel), SQLite schema (incl. gpu_model) |
| 3 | 4 | RegistryStore + SQLiteRegistry |
| 4 | 5 | Ledger + SQLiteLedger |
| 5 | 6–7 | LLMBackend + Ollama + llama.cpp |
| 6 | 8–9 | Router + RoundRobin + Scored |
| 7 | 10 | Benchmark runner |
| 8 | 11–14 | API handlers + server wiring |
| 9 | 15–17 | 3 binaries (node registration mit gpu_model) |
| 10 | 18–19 | Integration test + simulation |

## Scale Path (aus Technical Deep Dive)

| Komponente | PoC | Nächste Stufe |
|---|---|---|
| Validation | Rating + Benchmark | Validator Nodes (Redundant Execution, Spot Checking) |
| Reward | Flat 1.0 ENI/Job | Pay-per-token-output / Pay-per-second GPU |
| Node Discovery | Server-URL hardcoded | DHT (libp2p) + NAT Traversal |
| GPU-Scheduling | gpu_model als Metadaten | Weighted Matching nach GPU-Typ (RTX 3060 vs 4090) |
| Security | Kein TEE | TEE (Trusted Execution Environments) + ZK-Proofs |
