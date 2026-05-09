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
