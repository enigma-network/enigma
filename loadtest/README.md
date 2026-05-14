# Enigma Load Test

Simuliert 13.027 User und 16.761 Nodes (3% offline) gegen Prod-Enigma.
Misst p50/p95/p99 Latenz und Server-Verteilung über beide Server-Replicas.

## Voraussetzungen

- Docker + Docker Compose
- k6: `curl -s https://dl.k6.io/key.gpg | sudo gpg --dearmor -o /usr/share/keyrings/k6-archive-keyring.gpg && echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list && sudo apt update && sudo apt install k6`
- SSH-Zugang zum Prod-VPS
- `ENIGMA_ADMIN_TOKEN` aus Prod-Deployment

> **Wichtig:** Stelle sicher dass `ENIGMA_ADMIN_TOKEN` auf dem Prod-Server gesetzt ist (env var in docker-compose.production.yml), sonst ist der Seed-Endpoint ungeschützt öffentlich erreichbar.

## Ablauf

### 1. Enigma-Server mit Seed-Endpoint deployen

```bash
cd enigma
docker build -f Dockerfile.server -t ghcr.io/enigma-network/enigma-server:loadtest .
# Auf VPS: neues Image laden + server replicas neustarten
```

### 2. Nginx-Patch aktivieren (nginx.conf bereits gepacht)

```bash
# nginx.conf enthält bereits X-Enigma-Server Header
cd enigma && docker compose -f docker-compose.production.yml up -d nginx
```

### 3. Load-Test-Komponenten starten

```bash
cd enigma
export ENIGMA_ADMIN_TOKEN=dein-admin-token
export ENIGMA_SERVER_URL=http://40.113.111.66:8080

docker compose -f loadtest/docker-compose.loadtest.yml up -d
```

Logs beobachten:
```bash
docker logs -f enigma-lt-ghost
```

Ghost Manager gibt alle 60s aus:
```
METRICS heartbeats=16258(+16258) hb_errs=0 polls=16258(+16258) poll_errs=0 ...
```

### 4. Warten bis Seeding abgeschlossen (~35s)

```bash
docker logs enigma-lt-ghost 2>&1 | grep "All.*goroutines running"
```

### 5. k6 Load Test starten

```bash
ENIGMA_SERVER_URL=http://40.113.111.66:8080 \
  k6 run loadtest/k6/load-test.js
```

Dauer: ~17 Minuten (5m Ramp + 10m Sustain + 2m Ramp-down).
Ergebnisse: `loadtest/k6/results.json`

### 6. Ergebnisse auswerten

k6 Summary am Ende:
```
=== Enigma Load Test Summary ===
Errors:          0.12%
p50 job done:    3240ms
p95 job done:    8920ms
p99 job done:    14200ms
HTTP req failed: 0.08%
Total requests:  2847391
```

Server-Verteilung über `server_hits` Counter mit `server`-Tag (X-Enigma-Server Header).

### 7. Cleanup

```bash
# Ghost Nodes löschen
go run ./tools/seed-cleanup/ -server=http://40.113.111.66:8080 -token=$ENIGMA_ADMIN_TOKEN

# Container stoppen
docker compose -f loadtest/docker-compose.loadtest.yml down

# Nginx-Patch entfernen: X-Enigma-Server Zeile aus nginx.conf löschen, neu deployen
```

## Konfiguration

| Variable | Default | Bedeutung |
|---|---|---|
| `ENIGMA_SERVER_URL` | `http://40.113.111.66:8080` | Prod-Server URL |
| `ENIGMA_ADMIN_TOKEN` | — | Admin-Token (required) |
| `GHOST_NODES` | `16761` | Anzahl Ghost-Nodes |
| `GHOST_OFFLINE_PCT` | `0.03` | Anteil offline (3%) |
| `MODEL` | `qwen2.5:0.5b` | LLM-Modell für k6-Requests |

Für vorsichtigen Start: `GHOST_NODES=1000 docker compose ... up -d`

## Erwartete Last auf Prod-VPS

| Traffic-Art | Rate |
|---|---|
| Ghost-Heartbeats | ~542 req/s |
| Ghost-Job-Polls | ~542 req/s |
| k6 Chat-Jobs + Polling | variabel |
| **Peak gesamt** | **~1.300 req/s** |

## Erfolgskriterien

| Kriterium | Ziel |
|---|---|
| Server-Distribution | 45–55% pro Replica (±10%) |
| p95 Job-Completion | < 8s |
| p99 Job-Completion | < 30s |
| Heartbeat-Erfolgsrate | > 98% |
| HTTP-5xx-Rate | < 1% |
