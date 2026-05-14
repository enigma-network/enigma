# Enigma Load Test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simulate 13.027 User und 16.761 Nodes (3% offline) gegen Prod-Enigma, alle echten Chat-Jobs über einen lokalen Ollama-Node, um Latenz (p50/p95/p99) und Server-Verteilung über beide Replicas zu messen.

**Architecture:** Ghost Manager (Go) seeded 16.761 Nodes via neuem Admin-Endpoint ohne Benchmark, startet dann 16.258 Goroutinen (Heartbeat + Job-Poll + Sofort-Complete). Echter lokaler enigma-node verarbeitet alle realen Jobs via Ollama. k6 simuliert 13.027 VUs mit Chat-Requests.

**Tech Stack:** Go 1.23, PostgreSQL, k6 (JavaScript), Docker Compose, Ollama (qwen2.5:0.5b)

---

## File Map

| Datei | Aktion | Zweck |
|---|---|---|
| `internal/registry/registry.go` | Modify | +`BulkSeed` zur Interface |
| `internal/registry/postgres.go` | Modify | +`BulkSeed` Implementierung |
| `internal/api/admin.go` | Modify | +`registry` Feld, +`bulkSeed` Handler |
| `internal/api/server.go` | Modify | +Seed-Route, adminH init mit registry |
| `internal/api/integration_test.go` | Modify | +adminH + Seed-Route im Testserver |
| `internal/api/admin_seed_test.go` | Create | Integration-Test für bulkSeed |
| `tools/ghost-manager/main.go` | Create | Ghost Manager Service |
| `tools/seed-cleanup/main.go` | Create | Cleanup-Tool |
| `loadtest/docker-compose.loadtest.yml` | Create | Ollama + enigma-node + ghost-manager |
| `loadtest/Dockerfile.ghost-manager` | Create | Ghost Manager Image |
| `loadtest/k6/load-test.js` | Create | k6 Load Test Script |
| `loadtest/README.md` | Create | Schritt-für-Schritt Anleitung |

---

## Task 1: BulkSeed zur RegistryStore Interface + PostgresRegistry

**Files:**
- Modify: `enigma/internal/registry/registry.go`
- Modify: `enigma/internal/registry/postgres.go`

- [ ] **Step 1: BulkSeed zur Interface hinzufügen**

Öffne `enigma/internal/registry/registry.go`. Füge die Methode ans Ende der Interface hinzu:

```go
type RegistryStore interface {
	Register(ctx context.Context, node types.Node) error
	Deregister(ctx context.Context, nodeID string) error
	List(ctx context.Context) ([]types.Node, error)
	Get(ctx context.Context, nodeID string) (types.Node, error)
	Heartbeat(ctx context.Context, nodeID string) error
	UpdateScores(ctx context.Context, nodeID string, benchmarkScore, avgRating, reliability float64) error
	SetStatus(ctx context.Context, nodeID string, status types.NodeStatus) error
	BulkSeed(ctx context.Context, nodes []types.Node) ([]string, error)
}
```

- [ ] **Step 2: BulkSeed in PostgresRegistry implementieren**

Ans Ende von `enigma/internal/registry/postgres.go` anfügen. Die Methode verwendet eine Transaktion für Performance, setzt `last_heartbeat` auf `NOW() + 2h` damit Online-Ghost-Nodes 2 Stunden ohne Heartbeat-Service online bleiben:

```go
func (r *PostgresRegistry) BulkSeed(ctx context.Context, nodes []types.Node) ([]string, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	heartbeat := time.Now().UTC().Add(2 * time.Hour)
	ids := make([]string, 0, len(nodes))

	for _, n := range nodes {
		models, _ := json.Marshal(n.Models)
		_, err := tx.ExecContext(ctx, `
			INSERT INTO nodes (id, address, backend, models, gpu_vram_mb, gpu_model,
				benchmark_score, avg_rating, reliability, status, last_heartbeat)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
			ON CONFLICT(id) DO NOTHING`,
			n.ID, n.Address, string(n.Backend), string(models),
			n.GPUVRAMMb, n.GPUModel, n.BenchmarkScore, n.AvgRating, n.Reliability,
			string(n.Status), heartbeat,
		)
		if err != nil {
			return nil, fmt.Errorf("insert node %s: %w", n.ID, err)
		}
		ids = append(ids, n.ID)
	}

	return ids, tx.Commit()
}
```

- [ ] **Step 3: Build prüfen**

```bash
cd enigma && go build ./internal/registry/...
```

Expected: kein Output (kompiliert fehlerfrei).

- [ ] **Step 4: Commit**

```bash
git add enigma/internal/registry/registry.go enigma/internal/registry/postgres.go
git commit -m "feat(registry): add BulkSeed for ghost node seeding without benchmark"
```

---

## Task 2: bulkSeed Handler in adminHandler + Route registrieren

**Files:**
- Modify: `enigma/internal/api/admin.go`
- Modify: `enigma/internal/api/server.go`

- [ ] **Step 1: registry-Feld zu adminHandler hinzufügen und bulkSeed implementieren**

In `enigma/internal/api/admin.go`:

1. Import-Block erweitern (bestehende Imports behalten, diese hinzufügen):
```go
import (
	"database/sql"
	"encoding/json"
	"enigma/internal/instancetracker"
	"enigma/internal/registry"
	"enigma/internal/types"
	"net/http"
	"os"
	"strconv"

	"github.com/google/uuid"
)
```

2. Struct ändern (Zeile 12-14):
```go
type adminHandler struct {
	db       *sql.DB
	registry registry.RegistryStore
}
```

3. Ans Ende der Datei anfügen:
```go
func (h *adminHandler) bulkSeed(w http.ResponseWriter, r *http.Request) {
	var inputs []struct {
		Address        string   `json:"address"`
		Backend        string   `json:"backend"`
		Models         []string `json:"models"`
		GPUVRAMMb      int      `json:"gpu_vram_mb"`
		GPUModel       string   `json:"gpu_model"`
		BenchmarkScore float64  `json:"benchmark_score"`
		AvgRating      float64  `json:"avg_rating"`
		Reliability    float64  `json:"reliability"`
		Status         string   `json:"status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&inputs); err != nil || len(inputs) == 0 {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	nodes := make([]types.Node, len(inputs))
	for i, inp := range inputs {
		status := types.NodeStatus(inp.Status)
		if status == "" {
			status = types.NodeStatusOnline
		}
		backend := types.Backend(inp.Backend)
		if backend == "" {
			backend = types.BackendOllama
		}
		models := inp.Models
		if len(models) == 0 {
			models = []string{"gemma3:4b"}
		}
		nodes[i] = types.Node{
			ID:             uuid.NewString(),
			Address:        inp.Address,
			Backend:        backend,
			Models:         models,
			GPUVRAMMb:      inp.GPUVRAMMb,
			GPUModel:       inp.GPUModel,
			BenchmarkScore: inp.BenchmarkScore,
			AvgRating:      inp.AvgRating,
			Reliability:    inp.Reliability,
			Status:         status,
		}
	}

	ids, err := h.registry.BulkSeed(r.Context(), nodes)
	if err != nil {
		http.Error(w, "seed failed: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"seeded":   len(ids),
		"node_ids": ids,
	})
}
```

- [ ] **Step 2: server.go — adminH mit registry initialisieren + Route registrieren**

In `enigma/internal/api/server.go` Zeile 52:
```go
// ALT:
adminH := &adminHandler{db: db}

// NEU:
adminH := &adminHandler{db: db, registry: reg}
```

Direkt nach der letzten admin-Route (nach `GET /api/v1/admin/instances`) einfügen:
```go
mux.HandleFunc("POST /api/v1/admin/nodes/seed", adminAuth(adminH.bulkSeed))
```

- [ ] **Step 3: Build prüfen**

```bash
cd enigma && go build ./...
```

Expected: kein Output.

- [ ] **Step 4: Commit**

```bash
git add enigma/internal/api/admin.go enigma/internal/api/server.go
git commit -m "feat(api): add POST /api/v1/admin/nodes/seed endpoint for ghost node bulk insert"
```

---

## Task 3: Integration Test für bulkSeed

**Files:**
- Modify: `enigma/internal/api/integration_test.go`
- Create: `enigma/internal/api/admin_seed_test.go`

- [ ] **Step 1: adminH zum Testserver hinzufügen**

In `enigma/internal/api/integration_test.go`, in `newTestServer` nach Zeile 60 (`ratingsH := ...`) einfügen:

```go
adminH := &adminHandler{db: sqldb, registry: reg}
```

Und vor `srv := httptest.NewServer(mux)` die Route hinzufügen:

```go
mux.HandleFunc("POST /api/v1/admin/nodes/seed", adminH.bulkSeed)
```

- [ ] **Step 2: Testdatei erstellen**

Erstelle `enigma/internal/api/admin_seed_test.go`:

```go
package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
)

func TestBulkSeed(t *testing.T) {
	srv, sqldb := newTestServer(t)

	// Build 5 ghost node inputs
	inputs := make([]map[string]any, 5)
	for i := range inputs {
		inputs[i] = map[string]any{
			"address":         fmt.Sprintf("ghost-%06d.local:11434", i),
			"backend":         "ollama",
			"models":          []string{"gemma3:4b"},
			"gpu_vram_mb":     8192,
			"gpu_model":       "RTX 3060",
			"benchmark_score": 0.20,
			"avg_rating":      0.65,
			"reliability":     0.80,
			"status":          "online",
		}
	}

	body, _ := json.Marshal(inputs)
	req, _ := http.NewRequest("POST", srv.URL+"/api/v1/admin/nodes/seed", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var result struct {
		Seeded  int      `json:"seeded"`
		NodeIDs []string `json:"node_ids"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}

	if result.Seeded != 5 {
		t.Errorf("expected 5 seeded, got %d", result.Seeded)
	}
	if len(result.NodeIDs) != 5 {
		t.Errorf("expected 5 node_ids, got %d", len(result.NodeIDs))
	}
	for _, id := range result.NodeIDs {
		if id == "" {
			t.Error("empty node_id in response")
		}
	}

	// Verify nodes in DB
	var count int
	if err := sqldb.QueryRow(`SELECT COUNT(*) FROM nodes WHERE address LIKE 'ghost-%'`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 5 {
		t.Errorf("expected 5 ghost nodes in DB, got %d", count)
	}

	// Cleanup
	sqldb.Exec(`DELETE FROM nodes WHERE address LIKE 'ghost-%'`)
}

func TestBulkSeedOfflineStatus(t *testing.T) {
	srv, sqldb := newTestServer(t)

	inputs := []map[string]any{
		{"address": "ghost-offline-001.local:11434", "backend": "ollama",
			"models": []string{"phi3:mini"}, "status": "offline",
			"benchmark_score": 0.15, "avg_rating": 0.5, "reliability": 0.7},
	}

	body, _ := json.Marshal(inputs)
	req, _ := http.NewRequest("POST", srv.URL+"/api/v1/admin/nodes/seed", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var status string
	sqldb.QueryRow(`SELECT status FROM nodes WHERE address='ghost-offline-001.local:11434'`).Scan(&status)
	if status != "offline" {
		t.Errorf("expected status=offline, got %q", status)
	}

	sqldb.Exec(`DELETE FROM nodes WHERE address LIKE 'ghost-%'`)
}

func TestBulkSeedEmptyBody(t *testing.T) {
	srv, _ := newTestServer(t)

	req, _ := http.NewRequest("POST", srv.URL+"/api/v1/admin/nodes/seed",
		bytes.NewReader([]byte("[]")))
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()

	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("expected 400 for empty body, got %d", resp.StatusCode)
	}
}
```

- [ ] **Step 3: Test ausführen (braucht TEST_DATABASE_URL)**

```bash
cd enigma && TEST_DATABASE_URL="postgres://enigma:PASSWORD@localhost:5432/enigma_test?sslmode=disable" \
  go test ./internal/api/... -run TestBulkSeed -v
```

Expected: `PASS` für alle drei Tests (oder `SKIP` wenn TEST_DATABASE_URL nicht gesetzt).

- [ ] **Step 4: Commit**

```bash
git add enigma/internal/api/integration_test.go enigma/internal/api/admin_seed_test.go
git commit -m "test(api): integration tests for BulkSeed endpoint"
```

---

## Task 4: Ghost Manager — Seeding-Phase + CLI

**Files:**
- Create: `enigma/tools/ghost-manager/main.go`

- [ ] **Step 1: Verzeichnis anlegen**

```bash
mkdir -p enigma/tools/ghost-manager
```

- [ ] **Step 2: main.go erstellen**

Erstelle `enigma/tools/ghost-manager/main.go`:

```go
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
)

var (
	serverURL    = flag.String("server", "http://40.113.111.66:8080", "Enigma server URL")
	adminToken   = flag.String("token", "", "X-Admin-Token (or set ENIGMA_ADMIN_TOKEN env)")
	totalNodes   = flag.Int("nodes", 16761, "Total ghost nodes to create")
	offlinePct   = flag.Float64("offline-pct", 0.03, "Fraction to set offline (0.03 = 3%)")
	batchSz      = flag.Int("batch", 500, "Nodes per seed API call")
	startRate    = flag.Int("start-rate", 500, "Goroutines started per second during ramp-up")
	hbInterval   = flag.Duration("heartbeat-interval", 30*time.Second, "Heartbeat interval")
	pollInterval = flag.Duration("poll-interval", 30*time.Second, "Job poll interval")
	jitter       = flag.Duration("jitter", 5*time.Second, "Random ±jitter added to intervals")
	metricsEvery = flag.Duration("metrics-interval", 60*time.Second, "Metrics report interval")
)

var backends = []string{"ollama", "vllm", "lmstudio", "localai"}
var modelSets = [][]string{
	{"gemma3:4b"},
	{"phi3:mini"},
	{"qwen2.5:7b"},
	{"llama3.2:3b"},
	{"gemma3:4b", "phi3:mini"},
}
var gpuVRAMs = []int{4096, 6144, 8192, 12288, 16384, 24576}
var gpuModels = []string{"RTX 3060", "RTX 4070", "A10G", "RTX 3090", "T4"}

type ghostNode struct {
	id     string
	online bool
}

type seedInput struct {
	Address        string   `json:"address"`
	Backend        string   `json:"backend"`
	Models         []string `json:"models"`
	GPUVRAMMb      int      `json:"gpu_vram_mb"`
	GPUModel       string   `json:"gpu_model"`
	BenchmarkScore float64  `json:"benchmark_score"`
	AvgRating      float64  `json:"avg_rating"`
	Reliability    float64  `json:"reliability"`
	Status         string   `json:"status"`
}

type seedResponse struct {
	Seeded  int      `json:"seeded"`
	NodeIDs []string `json:"node_ids"`
}

type jobResponse struct {
	ID string `json:"id"`
}

type metrics struct {
	heartbeats    atomic.Int64
	heartbeatErrs atomic.Int64
	polls         atomic.Int64
	pollErrs      atomic.Int64
	jobsReceived  atomic.Int64
	jobsCompleted atomic.Int64
}

func main() {
	flag.Parse()
	if tok := os.Getenv("ENIGMA_ADMIN_TOKEN"); tok != "" && *adminToken == "" {
		*adminToken = tok
	}

	client := &http.Client{
		Timeout: 30 * time.Second,
		Transport: &http.Transport{
			MaxIdleConns:        2000,
			MaxIdleConnsPerHost: 2000,
			IdleConnTimeout:     90 * time.Second,
		},
	}

	m := &metrics{}
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	// Phase 1: Seed
	log.Printf("Seeding %d ghost nodes (%.0f%% offline, batch=%d)...",
		*totalNodes, *offlinePct*100, *batchSz)
	nodes, err := seedNodes(ctx, client, m)
	if err != nil {
		log.Fatalf("seed failed: %v", err)
	}
	online := filterOnline(nodes)
	log.Printf("Seeded %d nodes total, %d online, %d offline",
		len(nodes), len(online), len(nodes)-len(online))

	// Phase 2: Ramp up goroutines
	log.Printf("Starting %d goroutines at %d/s...", len(online), *startRate)
	var wg sync.WaitGroup
	rateTicker := time.NewTicker(time.Second / time.Duration(*startRate))
	defer rateTicker.Stop()

	for _, node := range online {
		select {
		case <-ctx.Done():
			goto shutdown
		case <-rateTicker.C:
		}
		wg.Add(1)
		n := node
		go func() {
			defer wg.Done()
			runGhostNode(ctx, client, n, m)
		}()
	}
	log.Printf("All %d goroutines running", len(online))

	// Phase 3: Metrics reporter
	go reportMetrics(ctx, m)

	<-ctx.Done()
shutdown:
	log.Println("Shutdown signal received, waiting for goroutines...")
	wg.Wait()
	log.Println("Ghost manager stopped.")
}

func seedNodes(ctx context.Context, client *http.Client, m *metrics) ([]ghostNode, error) {
	offlineCount := int(float64(*totalNodes) * *offlinePct)
	var all []ghostNode

	for sent := 0; sent < *totalNodes; {
		end := sent + *batchSz
		if end > *totalNodes {
			end = *totalNodes
		}

		batch := make([]seedInput, end-sent)
		for i := range batch {
			idx := sent + i
			isOffline := idx < offlineCount
			status := "online"
			if isOffline {
				status = "offline"
			}
			batch[i] = seedInput{
				Address:        fmt.Sprintf("ghost-%06d.local:11434", idx),
				Backend:        backends[rand.Intn(len(backends))],
				Models:         modelSets[rand.Intn(len(modelSets))],
				GPUVRAMMb:      gpuVRAMs[rand.Intn(len(gpuVRAMs))],
				GPUModel:       gpuModels[rand.Intn(len(gpuModels))],
				BenchmarkScore: 0.10 + rand.Float64()*0.20,
				AvgRating:      0.40 + rand.Float64()*0.40,
				Reliability:    0.60 + rand.Float64()*0.35,
				Status:         status,
			}
		}

		body, _ := json.Marshal(batch)
		req, err := http.NewRequestWithContext(ctx, "POST",
			*serverURL+"/api/v1/admin/nodes/seed", bytes.NewReader(body))
		if err != nil {
			return nil, err
		}
		req.Header.Set("Content-Type", "application/json")
		if *adminToken != "" {
			req.Header.Set("X-Admin-Token", *adminToken)
		}

		resp, err := client.Do(req)
		if err != nil {
			return nil, fmt.Errorf("batch %d-%d: %w", sent, end, err)
		}
		var sr seedResponse
		json.NewDecoder(resp.Body).Decode(&sr)
		resp.Body.Close()

		for i, id := range sr.NodeIDs {
			idx := sent + i
			all = append(all, ghostNode{id: id, online: idx >= offlineCount})
		}
		sent = end
		log.Printf("  seeded %d/%d", len(all), *totalNodes)
	}
	return all, nil
}

func filterOnline(nodes []ghostNode) []ghostNode {
	out := make([]ghostNode, 0, len(nodes))
	for _, n := range nodes {
		if n.online {
			out = append(out, n)
		}
	}
	return out
}

func runGhostNode(ctx context.Context, client *http.Client, node ghostNode, m *metrics) {
	hbTimer := time.NewTimer(jitteredDur(*hbInterval, *jitter))
	pollTimer := time.NewTimer(jitteredDur(*pollInterval, *jitter))
	defer hbTimer.Stop()
	defer pollTimer.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-hbTimer.C:
			doHeartbeat(ctx, client, node.id, m)
			hbTimer.Reset(jitteredDur(*hbInterval, *jitter))
		case <-pollTimer.C:
			doPoll(ctx, client, node.id, m)
			pollTimer.Reset(jitteredDur(*pollInterval, *jitter))
		}
	}
}

func doHeartbeat(ctx context.Context, client *http.Client, nodeID string, m *metrics) {
	req, err := http.NewRequestWithContext(ctx, "PUT",
		fmt.Sprintf("%s/api/v1/nodes/%s/heartbeat", *serverURL, nodeID), nil)
	if err != nil {
		m.heartbeatErrs.Add(1)
		return
	}
	resp, err := client.Do(req)
	if err != nil {
		m.heartbeatErrs.Add(1)
		return
	}
	resp.Body.Close()
	if resp.StatusCode == http.StatusOK {
		m.heartbeats.Add(1)
	} else {
		m.heartbeatErrs.Add(1)
	}
}

func doPoll(ctx context.Context, client *http.Client, nodeID string, m *metrics) {
	req, err := http.NewRequestWithContext(ctx, "GET",
		fmt.Sprintf("%s/api/v1/nodes/%s/jobs", *serverURL, nodeID), nil)
	if err != nil {
		m.pollErrs.Add(1)
		return
	}
	resp, err := client.Do(req)
	if err != nil {
		m.pollErrs.Add(1)
		return
	}
	defer resp.Body.Close()
	m.polls.Add(1)

	if resp.StatusCode == http.StatusNoContent || resp.StatusCode == http.StatusNotFound {
		return
	}
	if resp.StatusCode != http.StatusOK {
		m.pollErrs.Add(1)
		return
	}

	var job jobResponse
	if err := json.NewDecoder(resp.Body).Decode(&job); err != nil || job.ID == "" {
		return
	}
	m.jobsReceived.Add(1)
	completeJob(ctx, client, job.ID, m)
}

func completeJob(ctx context.Context, client *http.Client, jobID string, m *metrics) {
	body, _ := json.Marshal(map[string]any{
		"result":      "mock response from ghost node",
		"duration_ms": 42,
	})
	req, err := http.NewRequestWithContext(ctx, "POST",
		fmt.Sprintf("%s/api/v1/jobs/%s/result", *serverURL, jobID),
		bytes.NewReader(body))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return
	}
	resp.Body.Close()
	m.jobsCompleted.Add(1)
}

func reportMetrics(ctx context.Context, m *metrics) {
	ticker := time.NewTicker(*metricsEvery)
	defer ticker.Stop()
	var lastHB, lastPoll, lastDone int64
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			hb := m.heartbeats.Load()
			poll := m.polls.Load()
			done := m.jobsCompleted.Load()
			log.Printf("METRICS heartbeats=%d(+%d) hb_errs=%d polls=%d(+%d) poll_errs=%d jobs_recv=%d jobs_done=%d(+%d)",
				hb, hb-lastHB, m.heartbeatErrs.Load(),
				poll, poll-lastPoll, m.pollErrs.Load(),
				m.jobsReceived.Load(), done, done-lastDone)
			lastHB, lastPoll, lastDone = hb, poll, done
		}
	}
}

func jitteredDur(base, jit time.Duration) time.Duration {
	if jit == 0 {
		return base
	}
	delta := time.Duration(rand.Int63n(int64(jit)*2)) - jit
	d := base + delta
	if d < time.Second {
		d = time.Second
	}
	return d
}
```

- [ ] **Step 3: Ghost Manager bauen**

```bash
cd enigma && go build ./tools/ghost-manager/
```

Expected: Binary `ghost-manager` im Enigma-Verzeichnis, kein Output.

- [ ] **Step 4: Commit**

```bash
git add enigma/tools/ghost-manager/main.go
git commit -m "feat(tools): ghost-manager — seed 16k nodes + 16k goroutine heartbeat/poll loops"
```

---

## Task 5: Seed-Cleanup Tool

**Files:**
- Create: `enigma/tools/seed-cleanup/main.go`

- [ ] **Step 1: Verzeichnis anlegen**

```bash
mkdir -p enigma/tools/seed-cleanup
```

- [ ] **Step 2: main.go erstellen**

Erstelle `enigma/tools/seed-cleanup/main.go`:

```go
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
)

var (
	serverURL  = flag.String("server", "http://40.113.111.66:8080", "Enigma server URL")
	adminToken = flag.String("token", "", "X-Admin-Token (or ENIGMA_ADMIN_TOKEN env)")
	workers    = flag.Int("workers", 50, "Concurrent delete workers")
)

func main() {
	flag.Parse()
	if tok := os.Getenv("ENIGMA_ADMIN_TOKEN"); tok != "" && *adminToken == "" {
		*adminToken = tok
	}

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	client := &http.Client{
		Timeout: 15 * time.Second,
		Transport: &http.Transport{
			MaxIdleConnsPerHost: *workers + 10,
		},
	}

	// List all nodes
	req, _ := http.NewRequestWithContext(ctx, "GET", *serverURL+"/api/v1/admin/nodes", nil)
	if *adminToken != "" {
		req.Header.Set("X-Admin-Token", *adminToken)
	}
	resp, err := client.Do(req)
	if err != nil {
		log.Fatalf("list nodes: %v", err)
	}
	var nodes []struct {
		ID      string `json:"id"`
		Address string `json:"address"`
	}
	json.NewDecoder(resp.Body).Decode(&nodes)
	resp.Body.Close()

	// Filter ghost nodes (address starts with "ghost-")
	var ghostIDs []string
	for _, n := range nodes {
		if strings.HasPrefix(n.Address, "ghost-") {
			ghostIDs = append(ghostIDs, n.ID)
		}
	}
	log.Printf("Found %d ghost nodes to delete (out of %d total)", len(ghostIDs), len(nodes))

	if len(ghostIDs) == 0 {
		log.Println("Nothing to clean up.")
		return
	}

	// Delete concurrently
	var deleted atomic.Int64
	sem := make(chan struct{}, *workers)
	var wg sync.WaitGroup

	for _, id := range ghostIDs {
		select {
		case <-ctx.Done():
			log.Println("Interrupted.")
			goto done
		case sem <- struct{}{}:
		}
		wg.Add(1)
		nodeID := id
		go func() {
			defer wg.Done()
			defer func() { <-sem }()

			req, err := http.NewRequestWithContext(ctx, "DELETE",
				fmt.Sprintf("%s/api/v1/nodes/%s", *serverURL, nodeID), nil)
			if err != nil {
				return
			}
			resp, err := client.Do(req)
			if err == nil {
				resp.Body.Close()
				deleted.Add(1)
			}
		}()
	}

done:
	wg.Wait()
	log.Printf("Deleted %d ghost nodes.", deleted.Load())
}
```

- [ ] **Step 3: Build prüfen**

```bash
cd enigma && go build ./tools/seed-cleanup/
```

Expected: kein Output.

- [ ] **Step 4: Commit**

```bash
git add enigma/tools/seed-cleanup/main.go
git commit -m "feat(tools): seed-cleanup — concurrent delete of all ghost-* nodes"
```

---

## Task 6: Docker Compose Loadtest + Dockerfile

**Files:**
- Create: `enigma/loadtest/docker-compose.loadtest.yml`
- Create: `enigma/loadtest/Dockerfile.ghost-manager`

- [ ] **Step 1: Verzeichnis anlegen**

```bash
mkdir -p enigma/loadtest/k6
```

- [ ] **Step 2: Dockerfile für Ghost Manager erstellen**

Erstelle `enigma/loadtest/Dockerfile.ghost-manager`:

```dockerfile
FROM golang:1.23-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /ghost-manager ./tools/ghost-manager

FROM alpine:3.20
COPY --from=builder /ghost-manager /ghost-manager
ENTRYPOINT ["/ghost-manager"]
```

- [ ] **Step 3: docker-compose.loadtest.yml erstellen**

Erstelle `enigma/loadtest/docker-compose.loadtest.yml`:

```yaml
# Enigma Load Test — lokale Komponenten
# Verwendung: docker compose -f loadtest/docker-compose.loadtest.yml up
# Voraussetzung: ENIGMA_ADMIN_TOKEN und ENIGMA_SERVER_URL in Umgebung oder .env.loadtest

services:
  ollama:
    image: ollama/ollama:latest
    container_name: enigma-lt-ollama
    volumes:
      - ollama-data:/root/.ollama
    ports:
      - "11434:11434"
    restart: unless-stopped
    # Startet ollama, zieht das Modell, bleibt dann laufen
    entrypoint: >
      /bin/sh -c "
        ollama serve &
        sleep 8 &&
        ollama pull qwen2.5:0.5b &&
        wait
      "
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:11434/api/tags"]
      interval: 15s
      timeout: 5s
      retries: 10
      start_period: 60s

  enigma-node:
    build:
      context: ..
      dockerfile: Dockerfile
    container_name: enigma-lt-node
    command:
      - "-server=${ENIGMA_SERVER_URL:-http://40.113.111.66:8080}"
      - "-backend=ollama"
      - "-backend-addr=ollama:11434"
    depends_on:
      ollama:
        condition: service_healthy
    restart: on-failure

  ghost-manager:
    build:
      context: ..
      dockerfile: loadtest/Dockerfile.ghost-manager
    container_name: enigma-lt-ghost
    environment:
      ENIGMA_ADMIN_TOKEN: ${ENIGMA_ADMIN_TOKEN}
    command:
      - "-server=${ENIGMA_SERVER_URL:-http://40.113.111.66:8080}"
      - "-nodes=${GHOST_NODES:-16761}"
      - "-offline-pct=${GHOST_OFFLINE_PCT:-0.03}"
      - "-batch=500"
      - "-start-rate=500"
      - "-heartbeat-interval=30s"
      - "-poll-interval=30s"
      - "-jitter=5s"
    depends_on:
      - enigma-node
    restart: on-failure

volumes:
  ollama-data:
```

- [ ] **Step 4: Testbuild des Ghost Manager Images**

```bash
cd enigma && docker build -f loadtest/Dockerfile.ghost-manager -t enigma-ghost-manager:test .
```

Expected: `Successfully built ...` ohne Fehler.

- [ ] **Step 5: Commit**

```bash
git add enigma/loadtest/
git commit -m "feat(loadtest): docker-compose with ollama, enigma-node and ghost-manager"
```

---

## Task 7: k6 Load Test Script

**Files:**
- Create: `enigma/loadtest/k6/load-test.js`

- [ ] **Step 1: k6 installieren (falls nicht vorhanden)**

```bash
which k6 || (curl -s https://dl.k6.io/key.gpg | sudo gpg --dearmor -o /usr/share/keyrings/k6-archive-keyring.gpg && \
  echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list && \
  sudo apt update && sudo apt install k6)
```

- [ ] **Step 2: k6 Script erstellen**

Erstelle `enigma/loadtest/k6/load-test.js`:

```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const ttJobDone = new Trend('tt_job_done_ms', true);
const serverHits = new Counter('server_hits');

const SERVER_URL = __ENV.ENIGMA_SERVER_URL || 'http://40.113.111.66:8080';
const MODEL = __ENV.MODEL || 'qwen2.5:0.5b';

export const options = {
  stages: [
    { duration: '5m',  target: 13027 },  // Ramp-up
    { duration: '10m', target: 13027 },  // Sustained load
    { duration: '2m',  target: 0     },  // Ramp-down
  ],
  thresholds: {
    'http_req_failed':  ['rate<0.01'],   // <1% HTTP errors
    'errors':           ['rate<0.01'],   // <1% job failures
    'tt_job_done_ms':   ['p(99)<30000'], // p99 < 30s
  },
};

const PROMPTS = [
  'Was ist 2+2?',
  'Name three colors.',
  'What is the capital of France?',
  'Say hello in German.',
  'Count to five.',
  'What color is the sky?',
  'Name a mammal.',
];

export default function () {
  const prompt = PROMPTS[Math.floor(Math.random() * PROMPTS.length)];
  const start = Date.now();

  // 1. Submit job
  const submitRes = http.post(
    `${SERVER_URL}/api/v1/jobs`,
    JSON.stringify({ prompt, model: MODEL }),
    {
      headers: { 'Content-Type': 'application/json' },
      tags: { endpoint: 'submit' },
    }
  );

  const submitOk = check(submitRes, {
    'job submitted (201)': (r) => r.status === 201,
  });
  errorRate.add(!submitOk);
  if (!submitOk) return;

  const jobID = submitRes.json('job_id');
  if (!jobID) {
    errorRate.add(1);
    return;
  }

  // Track which enigma server instance handled the submit
  const serverInst = submitRes.headers['X-Enigma-Server'] || 'unknown';
  serverHits.add(1, { server: serverInst });

  // 2. Poll for completion (max 60 attempts × 1s = 60s timeout)
  let done = false;
  for (let i = 0; i < 60 && !done; i++) {
    sleep(1);

    const statusRes = http.get(
      `${SERVER_URL}/api/v1/jobs/${jobID}`,
      { tags: { endpoint: 'poll' } }
    );

    if (statusRes.status !== 200) continue;

    const jobStatus = statusRes.json('status');
    if (jobStatus === 'done') {
      done = true;
      ttJobDone.add(Date.now() - start);
    } else if (jobStatus === 'failed') {
      done = true;
      errorRate.add(1);
    }
  }

  if (!done) {
    errorRate.add(1);
  }
}

export function handleSummary(data) {
  return {
    'stdout': textSummary(data, { indent: ' ', enableColors: true }),
    'loadtest/k6/results.json': JSON.stringify(data, null, 2),
  };
}

// Minimal textSummary for handleSummary
function textSummary(data, opts) {
  const metrics = data.metrics;
  const lines = [
    `\n=== Enigma Load Test Summary ===`,
    `Errors:          ${(metrics.errors?.values?.rate * 100 || 0).toFixed(2)}%`,
    `p50 job done:    ${metrics.tt_job_done_ms?.values?.['p(50)'] || 'n/a'}ms`,
    `p95 job done:    ${metrics.tt_job_done_ms?.values?.['p(95)'] || 'n/a'}ms`,
    `p99 job done:    ${metrics.tt_job_done_ms?.values?.['p(99)'] || 'n/a'}ms`,
    `HTTP req failed: ${(metrics.http_req_failed?.values?.rate * 100 || 0).toFixed(2)}%`,
    `Total requests:  ${metrics.http_reqs?.values?.count || 0}`,
    ``,
  ];
  return lines.join('\n');
}
```

- [ ] **Step 3: Smoke-Test mit 10 VUs (braucht laufendes Enigma)**

```bash
ENIGMA_SERVER_URL=http://40.113.111.66:8080 \
  k6 run --vus 10 --duration 30s enigma/loadtest/k6/load-test.js
```

Expected: Ausgabe mit Metrics-Tabelle, Fehlerrate < 5% (bei laufendem Server).

- [ ] **Step 4: Commit**

```bash
git add enigma/loadtest/k6/load-test.js
git commit -m "feat(loadtest): k6 script — 13027 VUs, 17min profile, p99/distribution metrics"
```

---

## Task 8: Nginx-Patch + README

**Files:**
- Modify: `enigma/nginx.conf`
- Create: `enigma/loadtest/README.md`

- [ ] **Step 1: Nginx-Patch für X-Enigma-Server Header**

Öffne `enigma/nginx.conf`. Im `location /` Block (oder in dem Block der zu den upstream-Servern routet) folgende Zeile hinzufügen:

```nginx
add_header X-Enigma-Server $hostname always;
```

Vollständiges Beispiel wie der location-Block danach aussieht:

```nginx
location / {
    proxy_pass http://enigma_servers;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_read_timeout 120s;
    add_header X-Enigma-Server $hostname always;   # ← neu (nur während Loadtest!)
}
```

> **Wichtig:** Nach dem Loadtest diese Zeile wieder entfernen.

- [ ] **Step 2: README erstellen**

Erstelle `enigma/loadtest/README.md`:

```markdown
# Enigma Load Test

Simuliert 13.027 User und 16.761 Nodes (3% offline) gegen Prod-Enigma.

## Voraussetzungen

- Docker + Docker Compose
- k6 (`sudo apt install k6`)
- SSH-Zugang zum Prod-VPS (für nginx.conf Patch)
- `ENIGMA_ADMIN_TOKEN` aus Prod-Deployment bekannt

## Schritte

### 1. Nginx-Patch auf VPS deployen

```bash
# nginx.conf lokal editieren (add_header X-Enigma-Server $hostname always;)
# dann neues Enigma-Image bauen und deployen:
cd enigma && docker compose -f docker-compose.production.yml up -d nginx
```

### 2. Enigma-Server mit neuem seed-Endpoint deployen

```bash
cd enigma
docker build -f Dockerfile.server -t ghcr.io/enigma-network/enigma-server:loadtest .
# Auf VPS: neues Image laden + server replicas neustarten
```

### 3. Lokale Load-Test-Komponenten starten

```bash
cd enigma
export ENIGMA_ADMIN_TOKEN=dein-admin-token
export ENIGMA_SERVER_URL=http://40.113.111.66:8080

docker compose -f loadtest/docker-compose.loadtest.yml up -d

# Logs beobachten:
docker logs -f enigma-lt-ghost
```

Ghost Manager gibt alle 60s Metriken aus:
```
METRICS heartbeats=16258(+16258) hb_errs=0 polls=16258(+16258) ...
```

### 4. Warten bis Ghost-Seeding abgeschlossen (~35s)

```bash
docker logs enigma-lt-ghost 2>&1 | grep "All.*goroutines running"
```

### 5. k6 Load Test starten

```bash
ENIGMA_SERVER_URL=http://40.113.111.66:8080 \
  k6 run loadtest/k6/load-test.js
```

Dauer: ~17 Minuten (5m Ramp + 10m Sustain + 2m Ramp-down)

### 6. Ergebnisse auswerten

k6 gibt am Ende eine Zusammenfassung aus:
```
=== Enigma Load Test Summary ===
Errors:          0.12%
p50 job done:    3240ms
p95 job done:    8920ms
p99 job done:    14200ms
...
```

Server-Verteilung: k6 trackt `X-Enigma-Server` Header per `server_hits` Counter.
Detaillierte JSON-Ergebnisse: `loadtest/k6/results.json`

### 7. Cleanup nach dem Test

```bash
# Ghost Nodes löschen
cd enigma && go run ./tools/seed-cleanup/ \
  -server=http://40.113.111.66:8080 \
  -token=$ENIGMA_ADMIN_TOKEN

# Lokale Container stoppen
docker compose -f loadtest/docker-compose.loadtest.yml down

# Nginx-Patch rückgängig machen (X-Enigma-Server Header entfernen)
# nginx.conf editieren, server neu deployen
```

## Konfiguration

| Variable | Default | Bedeutung |
|---|---|---|
| `ENIGMA_SERVER_URL` | `http://40.113.111.66:8080` | Prod-Server URL |
| `ENIGMA_ADMIN_TOKEN` | — | Admin-Token (required) |
| `GHOST_NODES` | `16761` | Anzahl Ghost-Nodes |
| `GHOST_OFFLINE_PCT` | `0.03` | Anteil offline (3%) |
| `MODEL` | `qwen2.5:0.5b` | LLM-Modell für k6-Requests |

## Erwartete Last auf Prod-VPS

| Traffic-Art | Rate |
|---|---|
| Ghost-Heartbeats | ~542 req/s |
| Ghost-Job-Polls | ~542 req/s |
| k6 Chat-Jobs | variabel |
| **Peak gesamt** | **~1.300 req/s** |

Für vorsichtigen Start: `GHOST_NODES=1000` verwenden.
```

- [ ] **Step 3: Commit**

```bash
git add enigma/nginx.conf enigma/loadtest/README.md
git commit -m "docs(loadtest): nginx X-Enigma-Server patch + complete load test README"
```

---

## Task 9: Verifikation — End-to-End Smoke Test

- [ ] **Step 1: Alle Go-Pakete bauen**

```bash
cd enigma && go build ./...
```

Expected: kein Output, kein Fehler.

- [ ] **Step 2: Alle Tests ausführen**

```bash
cd enigma && go test ./internal/... -v -short 2>&1 | tail -30
```

Expected: `ok` für alle Pakete (oder `SKIP` für Tests die `TEST_DATABASE_URL` benötigen).

- [ ] **Step 3: Ghost Manager Hilfe prüfen**

```bash
cd enigma && go run ./tools/ghost-manager/ -help
```

Expected: Liste aller Flags ohne Panic.

- [ ] **Step 4: Seed Cleanup Hilfe prüfen**

```bash
cd enigma && go run ./tools/seed-cleanup/ -help
```

Expected: Liste aller Flags ohne Panic.

- [ ] **Step 5: Docker Image Ghost Manager bauen**

```bash
cd enigma && docker build -f loadtest/Dockerfile.ghost-manager -t enigma-ghost-manager:latest . 2>&1 | tail -5
```

Expected: `Successfully built ...`

- [ ] **Step 6: k6 Script Syntax prüfen**

```bash
k6 inspect enigma/loadtest/k6/load-test.js
```

Expected: Ausgabe mit stages und thresholds, kein Syntax-Fehler.

- [ ] **Step 7: Final Commit**

```bash
git add -A
git status  # prüfen ob alles committed
git log --oneline -8
```

Expected: 8 neue Commits, alle Tasks abgedeckt.

---

## Erfolgskriterien (aus Spec)

| Kriterium | Ziel |
|---|---|
| Server-Distribution | 45–55% pro Replica (±10%) |
| p95 Job-Completion | < 8s |
| p99 Job-Completion | < 30s |
| Heartbeat-Erfolgsrate | > 98% |
| HTTP-5xx-Rate | < 1% |
| Ghost-Job-Completion | 100% nach Poll |
