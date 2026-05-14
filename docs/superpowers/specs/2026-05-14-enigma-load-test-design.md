# Enigma Load Test — Design Spec

**Date:** 2026-05-14  
**Branch:** feat/multi-instance-scaling  
**Goal:** Simulate 13.027 Benutzer und 16.761 Nodes (3% offline), alle echten Chat-Requests über lokale LLM-Instanz, um Antwortzeiten und Server-Verteilung über beide Enigma-Replicas zu messen.

---

## 1. Ziele

| Ziel | Messgröße |
|---|---|
| Server-Distribution | % Jobs pro Replica (via `X-Enigma-Server` Header) |
| Latenz unter Last | p50 / p95 / p99 Time-to-First-Token + Total |
| Registry-Performance | List-Query-Zeit bei 16k+ Nodes |
| Heartbeat-Stabilität | Erfolgsrate Ghost-Heartbeats über 15min |
| Fehlerrate | HTTP 5xx / Timeouts unter Volllast |

---

## 2. Systemarchitektur

```
Lokaler PC
├── docker-compose.loadtest.yml
│   ├── ollama              (qwen2.5:0.5b, CPU-only)
│   ├── enigma-node         (echter Node, verbunden mit Prod)
│   └── ghost-manager       (Go-Service, Kernstück des Tests)
│
└── loadtest/k6/load-test.js   (13.027 simulierte VUs)

              ↕ öffentliches Internet (40.113.111.66:8080)

Prod-VPS
├── nginx                   (temp: X-Enigma-Server Header)
├── enigma-server (replica 1)
├── enigma-server (replica 2)
├── postgres                (Node-Registry, Jobs, Ledger)
└── redis                   (Pub/Sub zwischen Replicas)
```

---

## 3. Komponenten

### 3.1 Ollama Docker Container

- **Image:** `ollama/ollama:latest`
- **Modell:** `qwen2.5:0.5b` (kleinster brauchbarer CPU-Footprint)
- **Port:** `11434` (nur lokal, kein Expose nach außen)
- **RAM:** ~500 MB
- **Zweck:** Echte LLM-Inferenz für alle Jobs die über den Real-Node laufen

### 3.2 Echter enigma-node (lokal)

- Enigma-Node-Binary, verbunden mit lokalem Ollama
- Registriert sich bei Prod-Server (`http://40.113.111.66:8080`)
- **BenchmarkScore:** wird durch echten Benchmark ermittelt (CPU → niedrig, das ist OK)
- **Aufgabe:** Alle echten Chat-Jobs abarbeiten die k6 erzeugt

> Hinweis: Da Ghost-Nodes keinen aktiven Job-Poller auf Server-Seite haben der Priorität setzt, und der ScoredRouter den Node mit höchstem Score wählt, muss der Real-Node im Vergleich zu Ghost-Nodes konkurrenzfähig sein. Ghost-Nodes bekommen zufällige Scores (0.1–0.8), Real-Node bekommt was der Benchmark ergibt. Falls nötig: Ghost-Scores auf max 0.3 kappen sodass Real-Node bevorzugt wird.

### 3.3 Ghost Manager (neuer Go-Service)

**Pfad:** `enigma/tools/ghost-manager/main.go`

#### Phase 1 — Seeding (einmalig beim Start)

- Ruft `POST /api/v1/admin/nodes/seed` auf (neuer Endpoint, s. 3.5)
- Erstellt 16.761 Ghost-Nodes in Batches à 500
- Jeder Node bekommt zufällige, realistische Attribute:
  - `backend`: zufällig aus `[ollama, vllm, lmstudio, localai]`
  - `models`: zufällig aus `[gemma3:4b, phi3:mini, qwen2.5:7b, llama3.2:3b]`
  - `gpu_vram_mb`: zufällig aus `[4096, 6144, 8192, 12288, 16384, 24576]`
  - `gpu_model`: zufällig aus `[RTX 3060, RTX 4070, A10G, RTX 3090, T4]`
  - `benchmark_score`: zufällig 0.10–0.30 (unter Real-Node)
  - `avg_rating`: zufällig 0.4–0.8
  - `reliability`: zufällig 0.6–0.95
- **503 Nodes** (3%): werden mit `status='offline'` gesetzt — kriegen keine Goroutinen

#### Phase 2 — Ghost Polling Loops (16.258 Goroutinen)

- Gestaffelter Start: **500 Goroutinen/Sekunde** (verhindert Thundering-Herd)
- Pro Online-Ghost-Node eine Goroutine mit zwei unabhängigen Timern:

```
Goroutine(nodeID):
  ticker_heartbeat := 30s
  ticker_poll      := 30s
  
  loop:
    case ticker_heartbeat:
      PUT /api/v1/nodes/{nodeID}/heartbeat
      
    case ticker_poll:
      GET /api/v1/nodes/{nodeID}/jobs
      if job received:
        sofort POST /api/v1/jobs/{jobID}/result
        mit body: {result: "mock response from ghost node {nodeID}", duration_ms: 42}
```

- HTTP Keep-Alive aktiviert (Connection-Pool pro Goroutine)
- Jitter: ±5s auf beide Timer (verhindert synchronisierte Bursts)

#### Phase 3 — Metriken

Ghost Manager sammelt intern:
- Heartbeat-Erfolgsrate (pro Minute)
- Jobs empfangen / sofort-completed pro Node
- HTTP-Fehler (5xx, Timeouts)
- Ausgabe: JSON-Logfile `ghost-metrics.jsonl` + Stdout-Summary alle 60s

#### Phase 4 — Cleanup

Nach Test-Ende: `DELETE /api/v1/nodes/{id}` für alle Ghost-Nodes (oder separates Cleanup-Script `tools/seed-cleanup/main.go`).

### 3.4 k6 Load Test

**Pfad:** `enigma/loadtest/k6/load-test.js`

**Load Profile:**
```
Stage 1:  0 → 13.027 VUs über 5 Minuten  (Ramp-Up)
Stage 2: 13.027 VUs sustained, 10 Minuten (Volllast)
Stage 3: 13.027 → 0 VUs über 2 Minuten  (Ramp-Down)
```

**Pro VU:**
1. `POST /api/v1/jobs` mit kurzem Prompt (`"Was ist 2+2?"`) → erhält `job_id`
2. Polling `GET /api/v1/jobs/{job_id}` bis `status == "complete"` (max 60s Timeout)
3. Metriken erfassen:
   - `time_to_first_token`: Zeit bis erstes SSE-Event
   - `total_duration`: Zeit bis Stream-Ende
   - `server_instance`: Wert aus `X-Enigma-Server` Response-Header
   - `http_status`: Statuscode

**Output:** k6-Summary + JSON-Output für Analyse

### 3.5 Neuer Admin-Endpoint: Bulk Node Seed

**Pfad:** `enigma/internal/api/admin.go`

```
POST /api/v1/admin/nodes/seed
Authorization: Bearer {ENIGMA_ADMIN_TOKEN}

Request Body:
[
  {
    "address":        "ghost-192-168-1-1:11434",
    "backend":        "ollama",
    "models":         ["gemma3:4b"],
    "gpu_vram_mb":    8192,
    "gpu_model":      "RTX 3060",
    "benchmark_score": 0.22,
    "avg_rating":     0.65,
    "reliability":    0.81,
    "status":         "online"   // oder "offline" für 3%
  },
  ...
]

Response:
{"seeded": 500, "skipped": 0}
```

- Kein Benchmark-Run (direkter DB-Insert)
- Batch-Size: 500 Nodes pro Request
- Idempotent: bestehende IDs werden übersprungen

### 3.6 Nginx Config Patch (temporär)

Zur Server-Distribution-Messung: in `nginx.conf` während des Tests:

```nginx
add_header X-Enigma-Server $hostname always;
```

Nach dem Test entfernen.

---

## 4. Dateistruktur

```
enigma/
├── internal/api/admin.go              ← +bulkSeed Endpoint
├── tools/
│   ├── ghost-manager/
│   │   ├── main.go                   ← Ghost Manager Service
│   │   └── README.md
│   └── seed-cleanup/
│       └── main.go                   ← Löscht alle Ghost-Nodes
└── loadtest/
    ├── docker-compose.loadtest.yml   ← Ollama + enigma-node + ghost-manager
    ├── k6/
    │   └── load-test.js              ← k6 Load Test Script
    └── README.md                     ← Anleitung: Start, Auswertung, Cleanup
```

---

## 5. Ressourcenabschätzung (lokaler PC)

| Komponente | RAM | CPU |
|---|---|---|
| Ollama (qwen2.5:0.5b) | ~500 MB | ~100% 1 Core während Inferenz |
| enigma-node | ~20 MB | minimal |
| ghost-manager (16k Goroutinen) | ~400 MB | minimal (I/O-bound) |
| k6 (13.027 VUs) | ~300 MB | ~1–2 Cores |
| **Gesamt** | **~1.2 GB** | **~3–4 Cores** |

---

## 6. Prod-VPS Last während Test

| Traffic-Art | Rate |
|---|---|
| Ghost-Heartbeats | ~542 req/s |
| Ghost-Job-Polls | ~542 req/s |
| k6 Chat-Requests + Polling | variabel, bis ~433 req/s bei 13k VUs (submit + status-poll) |
| **Gesamt** | **~1.300 req/s Peak** |

> Ghost Manager Rate-Limiting: konfigurierbar via `--heartbeat-interval` und `--poll-interval` Flags. Standard: 30s. Für vorsichtigen Start: 60s.

---

## 7. Ablauf

```
1. enigma-server builden + deployen (mit neuem seed-Endpoint)
2. nginx.conf patchen (X-Enigma-Server Header)
3. docker-compose.loadtest.yml starten (ollama pull qwen2.5:0.5b)
4. ghost-manager starten (seeding + goroutinen)
   → warten bis alle 16.761 Nodes registriert (ca. 35 Batches × ~1s = ~35s)
5. k6 starten: k6 run loadtest/k6/load-test.js
6. 17 Minuten Test laufen lassen
7. k6-Report + ghost-metrics.jsonl auswerten
8. seed-cleanup laufen lassen
9. nginx.conf-Patch rückgängig machen
```

---

## 8. Erfolgskriterien

| Kriterium | Ziel |
|---|---|
| Server-Distribution | 45–55% pro Replica (±10% Toleranz) |
| p95 Time-to-First-Token | < 5s |
| p99 Total-Latenz | < 30s |
| Heartbeat-Erfolgsrate | > 98% |
| HTTP-5xx-Rate | < 1% |
| Ghost-Job-Completion | 100% sofort nach Poll |
