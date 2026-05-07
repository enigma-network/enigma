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
