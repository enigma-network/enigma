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
