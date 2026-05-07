# Enigma PoC — Design Spec

**Datum:** 2026-05-06  
**Status:** Approved  
**Scope:** Lokaler Proof-of-Concept (Single Machine, multiple Prozesse)

---

## 1. Ziel

Dezentrales AI-Compute-Netzwerk: Ungenutzte GPU-Leistung von Gaming-PCs wird für LLM-Inference genutzt. Provider werden mit ENI-Tokens belohnt. Der PoC validiert den Kernfluss auf einer einzelnen Maschine ohne Blockchain.

---

## 2. Stack

| Komponente | Technologie |
|---|---|
| Sprache | Go |
| Kommunikation | REST/HTTP |
| Persistenz | SQLite |
| LLM-Backends | Ollama + llama.cpp |
| Build | Makefile (3 Binaries) |

---

## 3. Architektur

Drei Binaries kommunizieren über HTTP:

```
enigma-cli  →  enigma-server  ←→  enigma-node (×N)
```

### 3.1 enigma-server
Coordinator, API Gateway, Ledger. Hält keine Logik in HTTP-Handlern — alle Kernfunktionen hinter Interfaces (swappable für spätere Skalierung).

### 3.2 enigma-node
Provider-Daemon. Registriert sich beim Server, pollt Jobs, führt Inference lokal aus (Ollama oder llama.cpp), sendet Ergebnis zurück. Heartbeat alle 30 Sekunden.

### 3.3 enigma-cli
Client-Binary. Sendet Prompt, pollt Ergebnis, gibt Rating ab, zeigt ENI-Balance.

---

## 4. Interfaces (Scale Path)

Drei Interfaces isolieren die swappable Komponenten:

```go
type RegistryStore interface {
    Register(node Node) error
    Deregister(nodeID string) error
    List() ([]Node, error)
    Get(nodeID string) (Node, error)
    Heartbeat(nodeID string) error
}

type Router interface {
    SelectNode(job Job, nodes []Node) (Node, error)
}

type Ledger interface {
    Credit(nodeID string, amount float64, reason string) error
    Balance(nodeID string) (float64, error)
    History(nodeID string) ([]Transaction, error)
}
```

**PoC-Implementierungen:** `SQLiteRegistry`, `ScoredRouter`, `SQLiteLedger`  
**Scale Path:** etcd/Consul → Distributed Scheduler → Blockchain-Bridge

Zusätzlich:

```go
type LLMBackend interface {
    Infer(ctx context.Context, model string, prompt string) (string, error)
    ListModels() ([]string, error)
}
```

Implementierungen: `OllamaBackend`, `LlamaCppBackend`

---

## 5. Intelligentes Routing

`ScoredRouter` wählt den besten verfügbaren Node nach:

```
node_score = (benchmark_score × 0.4) + (avg_rating × 0.4) + (reliability × 0.2)
```

- **benchmark_score** — beim Registrieren: Server führt Standard-Prompts aus, bewertet Korrektheit + Geschwindigkeit (0.0–1.0)
- **avg_rating** — Durchschnitt aller Nutzer-Ratings für diesen Node (1–5 Sterne → normalisiert auf 0.0–1.0)
- **reliability** — `completed / (completed + failed)` der letzten 50 Jobs

**Cold Start:** Neue Nodes starten mit `benchmark_score`, `avg_rating = 0.5` (neutral). Score verbessert sich durch Nutzung.

Fallback: `RoundRobinRouter` wenn kein Node scored werden kann.

---

## 6. Job Data Flow

1. **Client** `POST /api/v1/jobs` `{prompt, model}`
2. **Server** → `Router.SelectNode()` → Job in SQLite speichern (`status: pending`)
3. **Node** pollt `GET /api/v1/nodes/me/jobs` → erhält Job
4. **Node** führt `LLMBackend.Infer()` lokal aus
5. **Node** `POST /api/v1/jobs/{id}/result` `{result, duration_ms}`
6. **Server** validiert → `Ledger.Credit(node, 1.0 ENI)` → `status: completed` (flat rate im PoC)
7. **Client** pollt `GET /api/v1/jobs/{id}` → erhält Ergebnis
8. **Client** `POST /api/v1/jobs/{id}/rate` `{score: 1–5}` → `avg_rating` wird neu berechnet

---

## 7. Node Registration Flow

1. `POST /api/v1/nodes/register` `{address, backend, models, gpu_vram_mb}`
2. Server führt Benchmark-Prompts aus (3 Standard-Fragen, Korrektheit + Antwortzeit):
   - "Was ist die Hauptstadt von Frankreich?" → erwartet "Paris"
   - "Wie viel ist 17 × 24?" → erwartet "408"
   - "Erkläre in einem Satz was HTTP ist." → bewertet nach Antwortzeit (keine Korrektheitsprüfung)
3. `benchmark_score` wird berechnet und gespeichert
4. Node beginnt Job-Polling
5. Heartbeat `PUT /api/v1/nodes/{id}/heartbeat` alle 30s
6. Ausbleibender Heartbeat nach 90s → Node `offline`, laufende Jobs re-queued

---

## 8. Fehlerbehandlung

| Fehlerfall | Verhalten |
|---|---|
| Node fällt aus (Heartbeat) | Job re-queued nach 90s ohne Heartbeat |
| Inference Timeout (5 min) | Job `failed`, kein Reward, Reliability sinkt |
| Benchmark schlägt fehl | Node wird nicht zugelassen |
| Kein Node verfügbar | Job bleibt `pending`, Client pollt weiter |
| Node liefert falsches Ergebnis | Client bewertet schlecht → Score sinkt |

---

## 9. SQLite Schema

### nodes
| Feld | Typ | Beschreibung |
|---|---|---|
| id | TEXT PK | UUID |
| address | TEXT | host:port |
| backend | TEXT | ollama \| llamacpp |
| models | JSON | Liste verfügbarer Modelle |
| gpu_vram_mb | INTEGER | VRAM in MB |
| gpu_model | TEXT | GPU-Modell (z.B. "RTX 4090") |
| benchmark_score | REAL | 0.0–1.0 |
| avg_rating | REAL | 0.0–1.0 (normalisiert) |
| reliability | REAL | 0.0–1.0 |
| status | TEXT | online \| offline |
| last_heartbeat | DATETIME | |

### jobs
| Feld | Typ | Beschreibung |
|---|---|---|
| id | TEXT PK | UUID |
| prompt | TEXT | |
| model | TEXT | |
| status | TEXT | pending \| running \| done \| failed |
| assigned_node | TEXT FK | nodes.id |
| result | TEXT | |
| duration_ms | INTEGER | |
| created_at | DATETIME | |
| completed_at | DATETIME | |

### ledger
| Feld | Typ | Beschreibung |
|---|---|---|
| id | INTEGER PK | AUTOINCREMENT |
| node_id | TEXT FK | nodes.id |
| amount | REAL | ENI-Betrag |
| reason | TEXT | job_complete etc. |
| created_at | DATETIME | |

### ratings
| Feld | Typ | Beschreibung |
|---|---|---|
| id | INTEGER PK | AUTOINCREMENT |
| job_id | TEXT FK | jobs.id |
| node_id | TEXT FK | nodes.id |
| score | INTEGER | 1–5 |
| created_at | DATETIME | |

---

## 10. API Endpoints

| Method | Path | Handler | Beschreibung |
|---|---|---|---|
| POST | /api/v1/nodes/register | nodes | Node registrieren + Benchmark |
| PUT | /api/v1/nodes/{id}/heartbeat | nodes | Heartbeat |
| DELETE | /api/v1/nodes/{id} | nodes | Node abmelden |
| GET | /api/v1/nodes/me/jobs | nodes | Nächsten Job holen (Long-Poll, 30s Timeout) |
| POST | /api/v1/jobs | jobs | Job einreichen |
| GET | /api/v1/jobs/{id} | jobs | Job-Status abrufen |
| POST | /api/v1/jobs/{id}/result | jobs | Ergebnis melden |
| POST | /api/v1/jobs/{id}/rate | ratings | Bewertung abgeben |
| GET | /api/v1/nodes/{id}/balance | ledger | ENI-Balance abrufen |

---

## 11. Go Projektstruktur

```
enigma/
├── cmd/
│   ├── server/main.go      ← enigma-server binary
│   ├── node/main.go        ← enigma-node binary
│   └── cli/main.go         ← enigma-cli binary
├── internal/
│   ├── registry/
│   │   ├── registry.go     // RegistryStore interface
│   │   └── sqlite.go       // SQLiteRegistry
│   ├── router/
│   │   ├── router.go       // Router interface
│   │   ├── scored.go       // ScoredRouter
│   │   └── roundrobin.go   // Fallback
│   ├── ledger/
│   │   ├── ledger.go       // Ledger interface
│   │   └── sqlite.go       // SQLiteLedger
│   ├── llm/
│   │   ├── backend.go      // LLMBackend interface
│   │   ├── ollama.go       // OllamaBackend
│   │   └── llamacpp.go     // LlamaCppBackend
│   ├── benchmark/
│   │   └── runner.go       // Benchmark-Prompts, Score 0.0–1.0
│   ├── api/
│   │   ├── jobs.go
│   │   ├── nodes.go
│   │   └── ratings.go
│   └── db/
│       └── migrate.go
├── go.mod
├── go.sum
└── Makefile
```

---

## 12. Testing

- **Unit Tests** — `Router` und `Ledger` mit In-Memory-Mocks, kein SQLite
- **Integration Tests** — `enigma-server` + echtes SQLite + lokales Ollama
- **Simulation** — `make sim`: 5 Nodes starten, 20 Jobs senden, Score-Verteilung verifizieren
- **Benchmark-Verifikation** — `ScoredRouter` bevorzugt tatsächlich höher gescorete Nodes

---

## 13. Scale Path (nicht im PoC)

| Komponente | PoC | Skalierbar |
|---|---|---|
| RegistryStore | SQLite | etcd / Consul / On-Chain |
| Router | ScoredRouter (local) | Distributed Scheduler |
| Ledger | SQLite | Blockchain (ENI Token) |
| Validation | Rating + Benchmark | Validator Nodes (Redundant Execution, Spot Checking, Output Hashing) |
| Transport | REST | REST + Load Balancer |
| Node Discovery | Server-URL hardcoded | Service Mesh / DHT (libp2p) |
| Reward Model | Flat 1.0 ENI/Job | Pay-per-token-output oder Pay-per-second GPU |

Provider- und Client-Binaries bleiben unverändert — nur Server-Internals werden ausgetauscht.

---

## 14. Out of Scope (PoC)

- Echte Blockchain / On-Chain Token
- Validator Nodes (Redundant Execution, Spot Checking, Output Hashing)
- Node-zu-Node-Kommunikation (P2P, Gossip, libp2p)
- Web-Dashboard
- Authentication / API Keys
- Multi-Machine Deployment
- Streaming von LLM-Output (kommt nach PoC)
- Pay-per-token / Pay-per-second Reward-Modell
