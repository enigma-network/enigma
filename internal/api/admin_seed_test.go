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

	var count int
	if err := sqldb.QueryRow(`SELECT COUNT(*) FROM nodes WHERE address LIKE 'ghost-%'`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 5 {
		t.Errorf("expected 5 ghost nodes in DB, got %d", count)
	}

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
