# Enigma Server — Multi-Instance Scaling Design

**Date:** 2026-05-09  
**Status:** Approved  
**Goal:** Support 5000+ concurrent provider nodes with high availability and automatic failover across multiple server instances.

---

## 1. Problem Statement

The current enigma-server has two critical bottlenecks:

- **SQLite + single connection** (`SetMaxOpenConns(1)`) — all requests serialize on one DB thread. Safe limit: ~10 nodes.
- **Long-polling** (`GET /api/v1/nodes/{id}/jobs`, 500ms interval, 30s timeout) — each node holds a DB connection for up to 30s. At 20+ nodes the queue saturates.

Additionally, the server is a single instance with no failover. Any crash takes down all node connections and all user requests.

---

## 2. Target Architecture

```
┌─────────────────────────────────────────────────────┐
│              Load Balancer (nginx / Azure LB)        │
└──────────┬──────────────────┬───────────────────────┘
           │                  │
    ┌──────▼──────┐    ┌──────▼──────┐    ┌───────────┐
    │  Server #1  │    │  Server #2  │    │ Server #N │
    │  SSE conns  │    │  SSE conns  │    │           │
    └──────┬──────┘    └──────┬──────┘    └─────┬─────┘
           └──────────────────┼────────────────┘
                              │
                    ┌─────────▼─────────┐
                    │       Redis        │
                    │  Pub/Sub + Cache   │
                    └─────────┬─────────┘
                              │
                    ┌─────────▼─────────┐
                    │    PostgreSQL      │
                    │  (shared state)    │
                    └───────────────────┘
```

**Key properties:**
- Any server instance can accept any job or node connection
- Jobs are routed cross-instance via Redis Pub/Sub
- PostgreSQL holds all persistent state — instances are stateless
- nginx distributes connections with `least_conn` — no sticky sessions required

---

## 3. SSE Connection Layer (replaces long-polling)

**Old endpoint:** `GET /api/v1/nodes/{id}/jobs` — polls every 500ms, holds DB connection up to 30s  
**New endpoint:** `GET /api/v1/nodes/{id}/stream` — persistent SSE connection, zero DB polling

**SSE protocol:**
```
Node → GET /api/v1/nodes/{id}/stream

Server → 200 OK
         Content-Type: text/event-stream

         event: connected
         data: {"node_id": "..."}

         # when a job arrives:
         event: job
         data: {"job_id": "...", "prompt": "...", "model": "phi3:mini"}

         # keepalive every 15s:
         : ping
```

**Server-side Go implementation:**
- One goroutine + one `chan Job` per SSE connection
- Per-instance in-memory map: `nodeID → chan Job`
- One Redis subscriber per instance listening on `node:*:job`
- On disconnect: close channel, clean up map entry, update node status in PostgreSQL

**Node reconnect (enigma-node client):**
```go
backoff := 1 * time.Second
for {
    err := connectSSE(serverURL + "/api/v1/nodes/" + id + "/stream")
    if err == nil {
        backoff = 1 * time.Second
        processJobs() // blocks until disconnect
    }
    time.Sleep(backoff)
    backoff = min(backoff*2, 30*time.Second)
}
```
- Sends `Last-Event-ID` on reconnect so server can replay missed jobs from PostgreSQL
- Node ID persists across reconnects — no re-registration needed
- Load balancer routes reconnect to any healthy instance

---

## 4. Redis Pub/Sub — Channel Structure

| Channel | Publisher | Subscriber | Payload |
|---------|-----------|------------|---------|
| `node:{id}:job` | Any instance (on job assignment) | Instance holding the node's SSE connection | Job JSON |
| `job:{id}:done` | Instance that receives result | Instance waiting on HTTP response | Result + duration |
| `enigma:nodes:changed` | Any instance (on register / heartbeat timeout) | All instances | Node status update |

**Complete job flow:**
```
1. User POST /api/v1/jobs → Instance 2
2. Instance 2: write job to PostgreSQL (status: pending)
3. Instance 2: route → assign to Node X (connected to Instance 1)
4. Instance 2: PUBLISH node:{X}:job → Redis
5. Instance 2: SUBSCRIBE job:{jobId}:done (waits up to 120s)

6. Instance 1 receives node:{X}:job from Redis
7. Instance 1: push job via SSE channel to Node X

8. Node X completes inference
9. Node X: POST /api/v1/jobs/{id}/result → any instance
10. Receiving instance: UPDATE PostgreSQL (status: done)
11. Receiving instance: PUBLISH job:{jobId}:done → Redis

12. Instance 2 receives job:{jobId}:done
13. Instance 2: return HTTP 200 to user
```

**Timeout:** If `job:{jobId}:done` not received within 120s → HTTP 504, mark job `failed` in PostgreSQL.

**Node list cache:** Redis caches the active node list (TTL 5s) to avoid PostgreSQL reads on every routing decision.

---

## 5. PostgreSQL Schema

```sql
CREATE TABLE nodes (
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
CREATE INDEX idx_nodes_status ON nodes(status);

CREATE TABLE jobs (
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
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_assigned_node ON jobs(assigned_node);

CREATE TABLE ledger (
    id         BIGSERIAL PRIMARY KEY,
    node_id    TEXT NOT NULL,
    amount     FLOAT NOT NULL,
    reason     TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_ledger_node_id ON ledger(node_id);
```

**Driver:** `pgx/v5` (connection pooling built-in, faster than `lib/pq`)  
**Pool:** `SetMaxOpenConns(25)` per instance — 3 instances = 75 total PG connections  
**Config:** `DATABASE_URL=postgres://user:pass@host:5432/enigma`  
**Migrations:** SQL files in `db/migrations/`, applied on server startup

---

## 6. Load Balancer (nginx)

```nginx
upstream enigma_server {
    least_conn;
    server server1:8080;
    server server2:8080;
    server server3:8080;
}

location / {
    proxy_pass http://enigma_server;
    proxy_read_timeout 3600s;   # SSE connections stay open
    proxy_buffering off;         # required for SSE
    proxy_set_header Connection '';
    proxy_http_version 1.1;
}
```

**Instance failure handling:**
1. nginx health-checks detect failure → stops routing to that instance
2. Connected nodes lose SSE → reconnect to next available instance
3. In-flight jobs: timeout after 120s → marked `failed` → client retries

---

## 7. Deployment — Docker Compose

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: enigma
      POSTGRES_USER: enigma
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - postgres-data:/var/lib/postgresql/data
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes
    volumes:
      - redis-data:/data
    restart: unless-stopped

  server:
    image: ghcr.io/enigma-network/enigma-server:latest
    deploy:
      replicas: 3
    environment:
      DATABASE_URL: postgres://enigma:${POSTGRES_PASSWORD}@postgres:5432/enigma
      REDIS_URL: redis://redis:6379
      PORT: 8080
    depends_on: [postgres, redis]
    restart: unless-stopped

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
    depends_on: [server]
    restart: unless-stopped

volumes:
  postgres-data:
  redis-data:
```

**Azure:** Azure Database for PostgreSQL Flexible Server + Azure Cache for Redis — identical env vars, different hostnames.  
**VPS/Server Farm:** Same docker-compose, self-hosted PostgreSQL + Redis.

---

## 8. Capacity Estimates

| Config | Nodes | Jobs/min | Notes |
|--------|-------|----------|-------|
| Current (SQLite + polling) | ~10 | ~30 | Single connection bottleneck |
| After migration (1 instance) | ~500 | ~1500 | SSE + PG connection pool |
| 3 instances + Redis + PG | ~5000 | ~15000 | Target architecture |
| 10 instances | ~15000+ | ~50000+ | Linear horizontal scaling |

---

## 9. Implementation Phases

| Phase | Scope | Risk |
|-------|-------|------|
| 1 | SQLite → PostgreSQL (schema + driver swap) | Low — same logic, different DB |
| 2 | Long-polling → SSE (server + node client) | Medium — protocol change |
| 3 | Redis Pub/Sub (cross-instance routing) | Medium — new dependency |
| 4 | Multi-instance Docker Compose + nginx | Low — infrastructure only |

Each phase is independently deployable and backwards-compatible with the previous.
