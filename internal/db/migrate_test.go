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
