# Multi-Instance Scaling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace SQLite + long-polling with PostgreSQL + SSE + Redis Pub/Sub to support 5000+ concurrent nodes across multiple server instances.

**Architecture:** Each server instance is stateless — node SSE connections are held in memory per instance, cross-instance job delivery uses Redis Pub/Sub, all persistent state lives in PostgreSQL. A nginx load balancer distributes connections with `least_conn`.

**Tech Stack:** Go 1.23, `jackc/pgx/v5` (PostgreSQL driver), `redis/go-redis/v9`, SSE (text/event-stream), nginx, Docker Compose

---

## File Map

### Phase 1 — PostgreSQL (replaces SQLite)
| File | Action | Purpose |
|------|--------|---------|
| `go.mod` | Modify | Add pgx/v5, go-redis/v9; remove sqlite |
| `internal/db/db.go` | Replace `migrate.go` | Open pgx pool, run migrations |
| `db/migrations/001_initial.sql` | Create | PG schema with indexes |
| `internal/registry/postgres.go` | Create | PG impl of RegistryStore (replaces sqlite.go) |
| `internal/ledger/postgres.go` | Create | PG impl of Ledger (replaces sqlite.go) |
| `internal/api/jobstore.go` | Modify | Replace `?` with `$N`, use `time.Time` |
| `cmd/server/main.go` | Modify | Read `DATABASE_URL`, open PG pool |
| `Dockerfile.server` | Modify | Remove SQLite build deps |

### Phase 2 — SSE (replaces long-polling)
| File | Action | Purpose |
|------|--------|---------|
| `internal/api/stream.go` | Create | SSE handler + in-memory connection map |
| `internal/api/server.go` | Modify | Register `/api/v1/nodes/{id}/stream` |
| `cmd/node/main.go` | Modify | Replace poll loop with SSE client + reconnect |

### Phase 3 — Redis Pub/Sub (cross-instance routing)
| File | Action | Purpose |
|------|--------|---------|
| `internal/pubsub/pubsub.go` | Create | Publisher/Subscriber interface |
| `internal/pubsub/redis.go` | Create | Redis implementation |
| `internal/api/stream.go` | Modify | Subscribe to `node:{id}:job` on connect |
| `internal/api/jobs.go` | Modify | Publish to `node:{id}:job` on assignment; await `job:{id}:done` |
| `cmd/server/main.go` | Modify | Read `REDIS_URL`, create pub/sub |

### Phase 4 — Deployment
| File | Action | Purpose |
|------|--------|---------|
| `docker-compose.production.yml` | Replace | PostgreSQL + Redis + nginx + server replicas |
| `nginx.conf` | Create | Upstream config with SSE timeouts |

---

## Phase 1: PostgreSQL

### Task 1: Add dependencies, remove SQLite

**Files:**
- Modify: `go.mod`
- Modify: `go.sum` (auto-updated)

- [ ] **Step 1: Add pgx and go-redis, remove sqlite**

```bash
cd /path/to/enigma
/home/volker/go/bin/go get jackc/pgx/v5@latest
/home/volker/go/bin/go get github.com/redis/go-redis/v9@latest
/home/volker/go/bin/go get github.com/jackc/pgx/v5@latest
/home/volker/go/bin/go get github.com/jackc/pgx/v5/stdlib@latest
/home/volker/go/bin/go mod tidy
```

After this `go.mod` should contain:
```
require (
    github.com/google/uuid v1.6.0
    github.com/jackc/pgx/v5 v5.x.x
    github.com/redis/go-redis/v9 v9.x.x
)
```
`modernc.org/sqlite` should be gone.

- [ ] **Step 2: Verify build still compiles (will fail — expected)**

```bash
/home/volker/go/bin/go build ./... 2>&1
```
Expected: errors about missing sqlite import. That's fine — we'll fix in Task 2.

- [ ] **Step 3: Commit**

```bash
git add go.mod go.sum
git commit -m "deps: add pgx/v5 + go-redis/v9, remove sqlite"
```

---

### Task 2: PostgreSQL schema and connection

**Files:**
- Create: `db/migrations/001_initial.sql`
- Create: `internal/db/db.go` (replaces `internal/db/migrate.go`)
- Delete: `internal/db/migrate.go`

- [ ] **Step 1: Create migration file**

Create `db/migrations/001_initial.sql`:
```sql
CREATE TABLE IF NOT EXISTS nodes (
    id              TEXT PRIMARY KEY,
    address         TEXT NOT NULL,
    backend         TEXT NOT NULL DEFAULT 'ollama',
    models          TEXT NOT NULL DEFAULT '[]',
    gpu_vram_mb     INT NOT NULL DEFAULT 0,
    gpu_model       TEXT NOT NULL DEFAULT '',
    benchmark_score FLOAT NOT NULL DEFAULT 0.5,
    avg_rating      FLOAT NOT NULL DEFAULT 0.5,
    reliability     FLOAT NOT NULL DEFAULT 1.0,
    status          TEXT NOT NULL DEFAULT 'offline',
    last_heartbeat  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_nodes_status ON nodes(status);

CREATE TABLE IF NOT EXISTS jobs (
    id            TEXT PRIMARY KEY,
    prompt        TEXT NOT NULL,
    model         TEXT NOT NULL DEFAULT '',
    status        TEXT NOT NULL DEFAULT 'pending',
    assigned_node TEXT NOT NULL DEFAULT '',
    result        TEXT NOT NULL DEFAULT '',
    duration_ms   BIGINT NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_assigned ON jobs(assigned_node);

CREATE TABLE IF NOT EXISTS ledger (
    id         BIGSERIAL PRIMARY KEY,
    node_id    TEXT NOT NULL,
    amount     FLOAT NOT NULL,
    reason     TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ledger_node ON ledger(node_id);

CREATE TABLE IF NOT EXISTS ratings (
    id         BIGSERIAL PRIMARY KEY,
    job_id     TEXT NOT NULL,
    node_id    TEXT NOT NULL,
    score      INT NOT NULL CHECK(score BETWEEN 1 AND 5),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

- [ ] **Step 2: Create `internal/db/db.go`**

```go
package db

import (
	"database/sql"
	"fmt"
	"os"

	_ "github.com/jackc/pgx/v5/stdlib"
)

func Open(connStr string) (*sql.DB, error) {
	db, err := sql.Open("pgx", connStr)
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)

	migration, err := os.ReadFile("db/migrations/001_initial.sql")
	if err != nil {
		return nil, fmt.Errorf("read migration: %w", err)
	}
	if _, err := db.Exec(string(migration)); err != nil {
		db.Close()
		return nil, fmt.Errorf("run migration: %w", err)
	}
	return db, nil
}
```

- [ ] **Step 3: Delete old migrate.go**

```bash
rm internal/db/migrate.go
```

- [ ] **Step 4: Build check**

```bash
/home/volker/go/bin/go build ./internal/db/...
```
Expected: compiles cleanly.

- [ ] **Step 5: Commit**

```bash
git add db/migrations/001_initial.sql internal/db/db.go
git rm internal/db/migrate.go
git commit -m "feat(db): PostgreSQL schema + pgx connection pool"
```

---

### Task 3: PostgreSQL Registry

**Files:**
- Create: `internal/registry/postgres.go`
- Delete: `internal/registry/sqlite.go`

- [ ] **Step 1: Write failing test**

Create `internal/registry/postgres_test.go`:
```go
//go:build integration
package registry_test

import (
	"context"
	"enigma/internal/db"
	"enigma/internal/registry"
	"enigma/internal/types"
	"os"
	"testing"
	"time"
)

func TestPostgresRegistry(t *testing.T) {
	connStr := os.Getenv("TEST_DATABASE_URL")
	if connStr == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	sqldb, err := db.Open(connStr)
	if err != nil {
		t.Fatal(err)
	}
	defer sqldb.Close()

	reg := registry.NewPostgresRegistry(sqldb)
	ctx := context.Background()

	node := types.Node{
		ID: "test-node-1", Address: "localhost:11434",
		Backend: types.BackendOllama, Models: []string{"phi3:mini"},
		BenchmarkScore: 0.8, AvgRating: 0.9, Reliability: 1.0,
	}

	if err := reg.Register(ctx, node); err != nil {
		t.Fatalf("Register: %v", err)
	}
	nodes, err := reg.List(ctx)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(nodes) == 0 {
		t.Fatal("expected 1 node, got 0")
	}
	if err := reg.Deregister(ctx, node.ID); err != nil {
		t.Fatalf("Deregister: %v", err)
	}
}
```

- [ ] **Step 2: Create `internal/registry/postgres.go`**

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
			status='online', last_heartbeat=NOW()`,
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
	res, err := r.db.ExecContext(ctx, `UPDATE nodes SET last_heartbeat=NOW(), status='online' WHERE id=$1`, nodeID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("node %q not found", nodeID)
	}
	return nil
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
```

- [ ] **Step 3: Delete sqlite registry**

```bash
rm internal/registry/sqlite.go
```

- [ ] **Step 4: Build check**

```bash
/home/volker/go/bin/go build ./internal/registry/...
```
Expected: compiles cleanly.

- [ ] **Step 5: Commit**

```bash
git add internal/registry/postgres.go internal/registry/postgres_test.go
git rm internal/registry/sqlite.go
git commit -m "feat(registry): PostgreSQL implementation"
```

---

### Task 4: PostgreSQL Ledger

**Files:**
- Create: `internal/ledger/postgres.go`
- Delete: `internal/ledger/sqlite.go`

- [ ] **Step 1: Create `internal/ledger/postgres.go`**

```go
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
```

- [ ] **Step 2: Delete sqlite ledger**

```bash
rm internal/ledger/sqlite.go
```

- [ ] **Step 3: Build check**

```bash
/home/volker/go/bin/go build ./internal/ledger/...
```

- [ ] **Step 4: Commit**

```bash
git add internal/ledger/postgres.go
git rm internal/ledger/sqlite.go
git commit -m "feat(ledger): PostgreSQL implementation"
```

---

### Task 5: Update jobStore SQL + server main

**Files:**
- Modify: `internal/api/jobstore.go`
- Modify: `cmd/server/main.go`

- [ ] **Step 1: Update jobstore.go — replace `?` with `$N`, use `time.Time`**

Replace the full content of `internal/api/jobstore.go`:
```go
package api

import (
	"context"
	"database/sql"
	"enigma/internal/types"
	"fmt"
	"time"
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
```

- [ ] **Step 2: Update `cmd/server/main.go` — use DATABASE_URL**

Replace the full content of `cmd/server/main.go`:
```go
package main

import (
	"context"
	"enigma/internal/api"
	"enigma/internal/db"
	"enigma/internal/ledger"
	"enigma/internal/registry"
	"flag"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
)

func main() {
	dbURL := flag.String("db", "", "PostgreSQL connection string (overrides DATABASE_URL env)")
	addr := flag.String("addr", "", "Listen address (overrides PORT env, default :8080)")
	logPath := flag.String("log", "enigma.log", "JSON log file path")
	flag.Parse()

	connStr := *dbURL
	if connStr == "" {
		connStr = os.Getenv("DATABASE_URL")
	}
	if connStr == "" {
		connStr = "postgres://enigma:enigma@localhost:5432/enigma?sslmode=disable"
	}

	if *addr == "" {
		if p := os.Getenv("PORT"); p != "" {
			*addr = ":" + p
		} else {
			*addr = ":8080"
		}
	}

	logFile, err := os.OpenFile(*logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
	if err != nil {
		slog.Error("failed to open log file", "error", err)
		os.Exit(1)
	}
	defer logFile.Close()
	slog.SetDefault(slog.New(slog.NewJSONHandler(logFile, nil)))

	sqldb, err := db.Open(connStr)
	if err != nil {
		slog.Error("failed to open database", "error", err)
		os.Exit(1)
	}
	defer sqldb.Close()

	reg := registry.NewPostgresRegistry(sqldb)
	led := ledger.NewPostgresLedger(sqldb)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	api.StartMonitor(ctx, sqldb)

	srv := api.NewServer(sqldb, reg, led)
	httpSrv := &http.Server{Addr: *addr, Handler: srv.Handler()}

	go func() {
		<-ctx.Done()
		httpSrv.Shutdown(context.Background())
	}()

	slog.Info("enigma-server starting", "addr", *addr, "db", connStr)
	if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		slog.Error("server error", "error", err)
		os.Exit(1)
	}
}
```

- [ ] **Step 3: Update `internal/api/server.go` — accept registry + ledger as params**

`api.NewServer` currently takes `*sql.DB` and creates registry/ledger internally. Update it to accept them as parameters (injected from main):

```go
func NewServer(db *sql.DB, reg registry.RegistryStore, led ledger.Ledger) *Server {
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
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
	mux.HandleFunc("POST /api/v1/nodes/register", nodesH.register)
	mux.HandleFunc("PUT /api/v1/nodes/{id}/heartbeat", nodesH.heartbeat)
	mux.HandleFunc("DELETE /api/v1/nodes/{id}", nodesH.deregister)
	mux.HandleFunc("GET /api/v1/nodes/{id}/jobs", nodesH.pollJob)
	mux.HandleFunc("GET /api/v1/nodes/{id}/balance", nodesH.balance)
	mux.HandleFunc("POST /api/v1/jobs", jobsH.submit)
	mux.HandleFunc("GET /api/v1/jobs/{id}", jobsH.status)
	mux.HandleFunc("POST /api/v1/jobs/{id}/result", jobsH.result)
	mux.HandleFunc("POST /api/v1/jobs/{id}/rate", ratingsH.rate)

	adminH := &adminHandler{db: db}
	mux.HandleFunc("GET /api/v1/admin/stats", adminAuth(adminH.stats))
	mux.HandleFunc("GET /api/v1/admin/nodes", adminAuth(adminH.nodes))
	mux.HandleFunc("GET /api/v1/admin/jobs", adminAuth(adminH.jobs))
	mux.HandleFunc("GET /api/v1/admin/ledger", adminAuth(adminH.ledger))

	return &Server{mux: mux, db: db}
}
```

- [ ] **Step 4: Full build check**

```bash
/home/volker/go/bin/go build ./...
```
Expected: no errors.

- [ ] **Step 5: Run existing tests**

```bash
/home/volker/go/bin/go test ./... -short
```
Expected: all pass (integration tests skipped without TEST_DATABASE_URL).

- [ ] **Step 6: Commit**

```bash
git add internal/api/jobstore.go internal/api/server.go cmd/server/main.go
git commit -m "feat(server): wire PostgreSQL registry+ledger, read DATABASE_URL"
```

---

### Task 6: Update Dockerfile.server

**Files:**
- Modify: `Dockerfile.server`

- [ ] **Step 1: Remove SQLite deps from Dockerfile.server**

Replace `Dockerfile.server` content:
```dockerfile
FROM golang:1.23-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o enigma-server ./cmd/server

FROM alpine:3.19
RUN apk add --no-cache ca-certificates
COPY --from=builder /app/enigma-server /usr/local/bin/enigma-server
COPY --from=builder /app/db /db
ENV PORT=8080
EXPOSE 8080
VOLUME ["/data"]
ENTRYPOINT ["enigma-server", "-log", "/data/enigma.log"]
```

- [ ] **Step 2: Commit**

```bash
git add Dockerfile.server
git commit -m "feat(docker): remove sqlite, copy db/migrations into server image"
```

---

## Phase 2: SSE (replaces long-polling)

### Task 7: SSE stream handler (server-side)

**Files:**
- Create: `internal/api/stream.go`
- Modify: `internal/api/server.go`

- [ ] **Step 1: Write failing test for stream hub**

Create `internal/api/stream_test.go`:
```go
package api

import (
	"testing"
)

func TestStreamHub_SendDelivers(t *testing.T) {
	hub := newStreamHub()
	ch := hub.connect("node-1")
	defer hub.disconnect("node-1")

	job := streamJob{ID: "job-1", Prompt: "hello", Model: "phi3:mini"}
	hub.send("node-1", job)

	select {
	case received := <-ch:
		if received.ID != "job-1" {
			t.Errorf("expected job-1, got %s", received.ID)
		}
	default:
		t.Error("expected job on channel, got nothing")
	}
}

func TestStreamHub_SendUnknownNode(t *testing.T) {
	hub := newStreamHub()
	// Should not panic for unknown node
	hub.send("unknown", streamJob{ID: "x"})
}
```

- [ ] **Step 2: Run test — verify it fails**

```bash
/home/volker/go/bin/go test ./internal/api/... -run TestStreamHub -v
```
Expected: FAIL — `newStreamHub` not defined.

- [ ] **Step 3: Create `internal/api/stream.go`**

```go
package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
)

type streamJob struct {
	ID     string `json:"job_id"`
	Prompt string `json:"prompt"`
	Model  string `json:"model"`
}

type streamHub struct {
	mu    sync.RWMutex
	chans map[string]chan streamJob
}

func newStreamHub() *streamHub {
	return &streamHub{chans: make(map[string]chan streamJob)}
}

func (h *streamHub) connect(nodeID string) <-chan streamJob {
	h.mu.Lock()
	defer h.mu.Unlock()
	ch := make(chan streamJob, 8)
	h.chans[nodeID] = ch
	return ch
}

func (h *streamHub) disconnect(nodeID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if ch, ok := h.chans[nodeID]; ok {
		close(ch)
		delete(h.chans, nodeID)
	}
}

func (h *streamHub) send(nodeID string, job streamJob) {
	h.mu.RLock()
	ch, ok := h.chans[nodeID]
	h.mu.RUnlock()
	if !ok {
		return
	}
	select {
	case ch <- job:
	default:
		// channel full — node is slow, skip
	}
}

// serveStream handles GET /api/v1/nodes/{id}/stream
func (h *streamHub) serveStream(w http.ResponseWriter, r *http.Request) {
	nodeID := r.PathValue("id")

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no") // disable nginx buffering

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	jobs := h.connect(nodeID)
	defer h.disconnect(nodeID)

	// Send connected event
	fmt.Fprintf(w, "event: connected\ndata: {\"node_id\":%q}\n\n", nodeID)
	flusher.Flush()

	// Keepalive ticker + job delivery
	for {
		select {
		case <-r.Context().Done():
			return
		case job, ok := <-jobs:
			if !ok {
				return
			}
			data, _ := json.Marshal(job)
			fmt.Fprintf(w, "event: job\ndata: %s\n\n", data)
			flusher.Flush()
		}
	}
}
```

- [ ] **Step 4: Run test — verify it passes**

```bash
/home/volker/go/bin/go test ./internal/api/... -run TestStreamHub -v
```
Expected: PASS.

- [ ] **Step 5: Register SSE route in `internal/api/server.go`**

Add `hub *streamHub` field to `Server` struct and register the route:

In `NewServer`, add after existing mux registrations:
```go
hub := newStreamHub()
mux.HandleFunc("GET /api/v1/nodes/{id}/stream", hub.serveStream)

return &Server{mux: mux, db: db, hub: hub}
```

Update `Server` struct:
```go
type Server struct {
	mux *http.ServeMux
	db  *sql.DB
	hub *streamHub
}
```

Add method to expose hub (needed by jobs handler in Phase 3):
```go
func (s *Server) Hub() *streamHub { return s.hub }
```

- [ ] **Step 6: Build check**

```bash
/home/volker/go/bin/go build ./...
```

- [ ] **Step 7: Commit**

```bash
git add internal/api/stream.go internal/api/stream_test.go internal/api/server.go
git commit -m "feat(sse): add SSE stream hub and GET /api/v1/nodes/{id}/stream"
```

---

### Task 8: Update job submit to push via SSE hub

**Files:**
- Modify: `internal/api/jobs.go`

When a job is assigned, push it to the node's SSE channel immediately (instead of waiting for it to be polled).

- [ ] **Step 1: Add hub to jobsHandler**

In `internal/api/server.go`, update `jobsH` construction:
```go
jobsH := &jobsHandler{jobs: jobs, registry: reg, router: rtr, ledger: led, hub: hub}
```

In `internal/api/jobs.go`, add `hub *streamHub` to `jobsHandler`:
```go
type jobsHandler struct {
	jobs     *jobStore
	registry registry.RegistryStore
	router   router.Router
	ledger   ledger.Ledger
	hub      *streamHub
}
```

- [ ] **Step 2: Push job via hub after create**

In `jobsHandler.submit`, after `h.jobs.create(...)`:
```go
if err := h.jobs.create(r.Context(), job); err != nil {
	http.Error(w, "failed to create job", http.StatusInternalServerError)
	return
}

// Deliver to node via SSE (if connected to this instance)
if h.hub != nil {
	h.hub.send(job.AssignedNode, streamJob{ID: job.ID, Prompt: job.Prompt, Model: job.Model})
}

w.Header().Set("Content-Type", "application/json")
w.WriteHeader(http.StatusCreated)
json.NewEncoder(w).Encode(map[string]string{"job_id": job.ID})
```

- [ ] **Step 3: Build and test**

```bash
/home/volker/go/bin/go build ./...
/home/volker/go/bin/go test ./internal/api/... -short -v
```

- [ ] **Step 4: Commit**

```bash
git add internal/api/jobs.go internal/api/server.go
git commit -m "feat(sse): push job to node SSE channel on submit"
```

---

### Task 9: Update enigma-node — SSE client with reconnect

**Files:**
- Modify: `cmd/node/main.go`

- [ ] **Step 1: Replace poll loop with SSE client**

Replace the heartbeat goroutine and job poll loop section of `cmd/node/main.go` (from "Heartbeat loop" to end of main) with:

```go
	// SSE job stream with reconnect
	backoff := time.Second
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		err := runSSELoop(ctx, *serverURL, nodeID, llmBackend)
		if err == nil || ctx.Err() != nil {
			return
		}
		log.Printf("SSE disconnected: %v — reconnecting in %s", err, backoff)
		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}
		if backoff < 30*time.Second {
			backoff *= 2
		}
	}
```

Add the `runSSELoop` function at the bottom of `cmd/node/main.go`:

```go
func runSSELoop(ctx context.Context, serverURL, nodeID string, backend llm.LLMBackend) error {
	req, err := http.NewRequestWithContext(ctx, "GET",
		fmt.Sprintf("%s/api/v1/nodes/%s/stream", serverURL, nodeID), nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "text/event-stream")
	req.Header.Set("Cache-Control", "no-cache")

	client := &http.Client{Timeout: 0} // no timeout for SSE
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("stream status %d", resp.StatusCode)
	}

	// Send heartbeat via separate goroutine (PUT /heartbeat every 30s)
	heartbeatCtx, cancelHB := context.WithCancel(ctx)
	defer cancelHB()
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		hbClient := &http.Client{Timeout: 5 * time.Second}
		for {
			select {
			case <-heartbeatCtx.Done():
				return
			case <-ticker.C:
				req, _ := http.NewRequestWithContext(heartbeatCtx, "PUT",
					fmt.Sprintf("%s/api/v1/nodes/%s/heartbeat", serverURL, nodeID), nil)
				hbClient.Do(req)
			}
		}
	}()

	scanner := bufio.NewScanner(resp.Body)
	var eventType, dataLine string
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			// Dispatch event
			if eventType == "job" && dataLine != "" {
				var job struct {
					ID     string `json:"job_id"`
					Prompt string `json:"prompt"`
					Model  string `json:"model"`
				}
				if err := json.Unmarshal([]byte(dataLine), &job); err == nil && job.ID != "" {
					go processJob(ctx, serverURL, nodeID, job.ID, job.Prompt, job.Model, backend)
				}
			}
			eventType, dataLine = "", ""
			continue
		}
		if strings.HasPrefix(line, "event:") {
			eventType = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
		} else if strings.HasPrefix(line, "data:") {
			dataLine = strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		}
	}
	return scanner.Err()
}

func processJob(ctx context.Context, serverURL, nodeID, jobID, prompt, model string, backend llm.LLMBackend) {
	log.Printf("running job %s (model: %s)", jobID, model)
	start := time.Now()
	inferCtx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	result, err := backend.Infer(inferCtx, model, prompt)
	cancel()
	elapsed := time.Since(start).Milliseconds()

	var body []byte
	if err != nil {
		log.Printf("inference failed for job %s: %v", jobID, err)
		body, _ = json.Marshal(map[string]any{"result": "", "duration_ms": elapsed})
	} else {
		body, _ = json.Marshal(map[string]any{"result": result, "duration_ms": elapsed})
		log.Printf("job %s done in %dms", jobID, elapsed)
	}

	postResp, _ := http.Post(serverURL+"/api/v1/jobs/"+jobID+"/result",
		"application/json", bytes.NewReader(body))
	if postResp != nil {
		io.Copy(io.Discard, postResp.Body)
		postResp.Body.Close()
	}
}
```

Add missing imports to `cmd/node/main.go`:
```go
import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"enigma/internal/llm"
	"enigma/internal/types"
)
```

- [ ] **Step 2: Build check**

```bash
/home/volker/go/bin/go build ./cmd/node/...
```

- [ ] **Step 3: Commit**

```bash
git add cmd/node/main.go
git commit -m "feat(node): replace long-polling with SSE client + exponential backoff reconnect"
```

---

## Phase 3: Redis Pub/Sub

### Task 10: Pub/Sub interface + Redis implementation

**Files:**
- Create: `internal/pubsub/pubsub.go`
- Create: `internal/pubsub/redis.go`

- [ ] **Step 1: Write failing test**

Create `internal/pubsub/redis_test.go`:
```go
//go:build integration
package pubsub_test

import (
	"context"
	"enigma/internal/pubsub"
	"os"
	"testing"
	"time"
)

func TestRedisRoundtrip(t *testing.T) {
	url := os.Getenv("TEST_REDIS_URL")
	if url == "" {
		t.Skip("TEST_REDIS_URL not set")
	}
	ps, err := pubsub.NewRedis(url)
	if err != nil {
		t.Fatal(err)
	}
	defer ps.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	ch, err := ps.Subscribe(ctx, "test-channel")
	if err != nil {
		t.Fatal(err)
	}

	if err := ps.Publish(ctx, "test-channel", "hello"); err != nil {
		t.Fatal(err)
	}

	select {
	case msg := <-ch:
		if msg != "hello" {
			t.Errorf("expected 'hello', got %q", msg)
		}
	case <-ctx.Done():
		t.Fatal("timeout waiting for message")
	}
}
```

- [ ] **Step 2: Create `internal/pubsub/pubsub.go`**

```go
package pubsub

import "context"

type PubSub interface {
	Publish(ctx context.Context, channel, message string) error
	Subscribe(ctx context.Context, channel string) (<-chan string, error)
	Unsubscribe(channel string) error
	Close() error
}
```

- [ ] **Step 3: Create `internal/pubsub/redis.go`**

```go
package pubsub

import (
	"context"
	"fmt"
	"sync"

	"github.com/redis/go-redis/v9"
)

type RedisPubSub struct {
	client *redis.Client
	mu     sync.Mutex
	subs   map[string]*redis.PubSub
}

func NewRedis(redisURL string) (*RedisPubSub, error) {
	opts, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, fmt.Errorf("parse redis URL: %w", err)
	}
	client := redis.NewClient(opts)
	if err := client.Ping(context.Background()).Err(); err != nil {
		return nil, fmt.Errorf("redis ping: %w", err)
	}
	return &RedisPubSub{client: client, subs: make(map[string]*redis.PubSub)}, nil
}

func (r *RedisPubSub) Publish(ctx context.Context, channel, message string) error {
	return r.client.Publish(ctx, channel, message).Err()
}

func (r *RedisPubSub) Subscribe(ctx context.Context, channel string) (<-chan string, error) {
	sub := r.client.Subscribe(ctx, channel)
	r.mu.Lock()
	r.subs[channel] = sub
	r.mu.Unlock()

	out := make(chan string, 16)
	go func() {
		defer close(out)
		ch := sub.Channel()
		for msg := range ch {
			select {
			case out <- msg.Payload:
			case <-ctx.Done():
				return
			}
		}
	}()
	return out, nil
}

func (r *RedisPubSub) Unsubscribe(channel string) error {
	r.mu.Lock()
	sub, ok := r.subs[channel]
	delete(r.subs, channel)
	r.mu.Unlock()
	if !ok {
		return nil
	}
	return sub.Close()
}

func (r *RedisPubSub) Close() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, sub := range r.subs {
		sub.Close()
	}
	return r.client.Close()
}
```

- [ ] **Step 4: Build check**

```bash
/home/volker/go/bin/go build ./internal/pubsub/...
```

- [ ] **Step 5: Commit**

```bash
git add internal/pubsub/pubsub.go internal/pubsub/redis.go internal/pubsub/redis_test.go
git commit -m "feat(pubsub): Redis pub/sub implementation"
```

---

### Task 11: Wire Redis into stream hub (cross-instance delivery)

**Files:**
- Modify: `internal/api/stream.go`
- Modify: `internal/api/server.go`
- Modify: `cmd/server/main.go`

- [ ] **Step 1: Add PubSub to streamHub**

Update `internal/api/stream.go` — add pubsub field and subscribe on connect:

```go
package api

import (
	"context"
	"encoding/json"
	"enigma/internal/pubsub"
	"fmt"
	"net/http"
	"sync"
)

type streamHub struct {
	mu    sync.RWMutex
	chans map[string]chan streamJob
	ps    pubsub.PubSub // nil in single-instance mode
}

func newStreamHub(ps pubsub.PubSub) *streamHub {
	return &streamHub{chans: make(map[string]chan streamJob), ps: ps}
}

func (h *streamHub) connect(ctx context.Context, nodeID string) <-chan streamJob {
	h.mu.Lock()
	ch := make(chan streamJob, 8)
	h.chans[nodeID] = ch
	h.mu.Unlock()

	// Subscribe to Redis channel for cross-instance delivery
	if h.ps != nil {
		redisCh, err := h.ps.Subscribe(ctx, "node:"+nodeID+":job")
		if err == nil {
			go func() {
				for payload := range redisCh {
					var job streamJob
					if json.Unmarshal([]byte(payload), &job) == nil {
						h.mu.RLock()
						localCh, ok := h.chans[nodeID]
						h.mu.RUnlock()
						if ok {
							select {
							case localCh <- job:
							default:
							}
						}
					}
				}
			}()
		}
	}
	return ch
}

func (h *streamHub) disconnect(nodeID string) {
	h.mu.Lock()
	if ch, ok := h.chans[nodeID]; ok {
		close(ch)
		delete(h.chans, nodeID)
	}
	h.mu.Unlock()
	if h.ps != nil {
		h.ps.Unsubscribe("node:" + nodeID + ":job")
	}
}

func (h *streamHub) send(nodeID string, job streamJob) {
	// Try local delivery first
	h.mu.RLock()
	ch, ok := h.chans[nodeID]
	h.mu.RUnlock()
	if ok {
		select {
		case ch <- job:
		default:
		}
		return
	}
	// Node not on this instance — publish to Redis for cross-instance delivery
	if h.ps != nil {
		data, _ := json.Marshal(job)
		h.ps.Publish(context.Background(), "node:"+nodeID+":job", string(data))
	}
}

func (h *streamHub) serveStream(w http.ResponseWriter, r *http.Request) {
	nodeID := r.PathValue("id")

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	jobs := h.connect(r.Context(), nodeID)
	defer h.disconnect(nodeID)

	fmt.Fprintf(w, "event: connected\ndata: {\"node_id\":%q}\n\n", nodeID)
	flusher.Flush()

	for {
		select {
		case <-r.Context().Done():
			return
		case job, ok := <-jobs:
			if !ok {
				return
			}
			data, _ := json.Marshal(job)
			fmt.Fprintf(w, "event: job\ndata: %s\n\n", data)
			flusher.Flush()
		}
	}
}
```

- [ ] **Step 2: Update `NewServer` signature to accept PubSub**

In `internal/api/server.go`, update `NewServer`:
```go
func NewServer(db *sql.DB, reg registry.RegistryStore, led ledger.Ledger, ps pubsub.PubSub) *Server {
	// ...
	hub := newStreamHub(ps)
	// rest unchanged
}
```

- [ ] **Step 3: Update `cmd/server/main.go` to read REDIS_URL and wire pubsub**

Add to main after opening DB:
```go
var ps pubsub.PubSub
if redisURL := os.Getenv("REDIS_URL"); redisURL != "" {
	rps, err := pubsub.NewRedis(redisURL)
	if err != nil {
		slog.Warn("redis unavailable — running single-instance mode", "error", err)
	} else {
		ps = rps
		defer rps.Close()
		slog.Info("redis connected", "url", redisURL)
	}
}

srv := api.NewServer(sqldb, reg, led, ps)
```

Add import: `"enigma/internal/pubsub"`

- [ ] **Step 4: Build + test**

```bash
/home/volker/go/bin/go build ./...
/home/volker/go/bin/go test ./... -short
```

- [ ] **Step 5: Commit**

```bash
git add internal/api/stream.go internal/api/server.go cmd/server/main.go
git commit -m "feat(pubsub): wire Redis into stream hub for cross-instance job delivery"
```

---

## Phase 4: Deployment

### Task 12: Docker Compose + nginx

**Files:**
- Replace: `docker-compose.production.yml`
- Create: `nginx.conf`

- [ ] **Step 1: Create `nginx.conf`**

```nginx
upstream enigma_server {
    least_conn;
    server server:8080;
}

server {
    listen 80;

    location / {
        proxy_pass http://enigma_server;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header Connection '';
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering off;
        proxy_cache off;
    }
}
```

- [ ] **Step 2: Replace `docker-compose.production.yml`**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: enigma-postgres
    environment:
      POSTGRES_DB: enigma
      POSTGRES_USER: enigma
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - postgres-data:/var/lib/postgresql/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U enigma"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    container_name: enigma-redis
    command: redis-server --appendonly yes
    volumes:
      - redis-data:/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  server:
    image: ghcr.io/enigma-network/enigma-server:latest
    deploy:
      replicas: 2
    environment:
      DATABASE_URL: postgres://enigma:${POSTGRES_PASSWORD}@postgres:5432/enigma?sslmode=disable
      REDIS_URL: redis://redis:6379
      PORT: 8080
      ENIGMA_ADMIN_TOKEN: ${ENIGMA_ADMIN_TOKEN:-}
    volumes:
      - server-data:/data
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    restart: unless-stopped

  nginx:
    image: nginx:alpine
    container_name: enigma-nginx
    ports:
      - "80:80"
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
    depends_on:
      - server
    restart: unless-stopped

  web:
    image: ghcr.io/enigma-network/enigma-web:latest
    container_name: enigma-web
    ports:
      - "443:80"
    volumes:
      - web-data:/data
    environment:
      NEXTAUTH_URL: ${NEXTAUTH_URL:-https://www.enigmanet.org}
      NEXTAUTH_SECRET: ${NEXTAUTH_SECRET}
      AUTH_GITHUB_ID: ${AUTH_GITHUB_ID}
      AUTH_GITHUB_SECRET: ${AUTH_GITHUB_SECRET}
      AUTH_GOOGLE_ID: ${AUTH_GOOGLE_ID:-}
      AUTH_GOOGLE_SECRET: ${AUTH_GOOGLE_SECRET:-}
      DATABASE_URL: file:/data/web.db
      ENIGMA_SERVER_URL: http://nginx:80
      ENIGMA_NODE_SERVER_URL: https://server.enigmanet.org
      ENIGMA_ADMIN_TOKEN: ${ENIGMA_ADMIN_TOKEN:-}
    depends_on:
      - nginx
    restart: unless-stopped

volumes:
  postgres-data:
  server-data:
  web-data:
  redis-data:
```

- [ ] **Step 3: Create `.env.production.example`**

```env
POSTGRES_PASSWORD=change_me_strong_password
NEXTAUTH_SECRET=change_me_32_char_secret
NEXTAUTH_URL=https://www.enigmanet.org
AUTH_GITHUB_ID=your_github_oauth_app_id
AUTH_GITHUB_SECRET=your_github_oauth_app_secret
AUTH_GOOGLE_ID=
AUTH_GOOGLE_SECRET=
ENIGMA_ADMIN_TOKEN=
```

- [ ] **Step 4: Commit**

```bash
git add docker-compose.production.yml nginx.conf .env.production.example
git commit -m "feat(deploy): multi-instance docker-compose — postgres + redis + nginx + 2 server replicas"
```

---

### Task 13: Update GitHub Actions for multi-stage build

**Files:**
- Modify: `.github/workflows/docker-publish.yml`

- [ ] **Step 1: Verify server build still works with new Dockerfile**

The server Dockerfile copies `db/migrations/` — make sure the build context includes it. In `.github/workflows/docker-publish.yml`, the `build-server` job uses `context: .` which is correct.

Verify the `build-server` job `context` is `.` (repo root):
```yaml
- uses: docker/build-push-action@v5
  with:
    context: .
    file: ./Dockerfile.server
```
No change needed if already set to `.`.

- [ ] **Step 2: Full build verification**

```bash
/home/volker/go/bin/go build ./...
/home/volker/go/bin/go test ./... -short -v
```
Expected: all pass.

- [ ] **Step 3: Final commit + push**

```bash
git add .
git commit -m "chore: verify build — phase 4 complete"
git push
```

---

## Capacity After Implementation

| Phase complete | Nodes | Notes |
|----------------|-------|-------|
| Phase 1 only | ~500 | PG connection pool, no polling bottleneck |
| Phase 1+2 | ~500 | SSE holds connections efficiently |
| Phase 1+2+3 | ~5000+ | Cross-instance routing, linear horizontal scale |
| Phase 1+2+3+4 | ~5000+ per cluster | Add more server replicas as needed |
