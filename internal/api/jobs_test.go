package api

import (
	"bytes"
	"context"
	"encoding/json"
	"enigma/internal/ledger"
	"enigma/internal/registry"
	"enigma/internal/router"
	"enigma/internal/types"
	"net/http"
	"net/http/httptest"
	"testing"
)

func setupJobsHandler(t *testing.T) (*jobsHandler, *registry.PostgresRegistry) {
	t.Helper()
	sqldb := testDB(t)
	reg := registry.NewPostgresRegistry(sqldb)
	return &jobsHandler{
		jobs:     newJobStore(sqldb),
		registry: reg,
		router:   router.NewScoredRouter(router.NewRoundRobinRouter()),
		ledger:   ledger.NewPostgresLedger(sqldb),
	}, reg
}

func TestSubmitJob(t *testing.T) {
	h, reg := setupJobsHandler(t)
	ctx := context.Background()

	// Register a node first
	reg.Register(ctx, types.Node{ID: "node-1", Address: "localhost:9001", Backend: types.BackendOllama, Models: []string{"gemma3:4b"}})

	body, _ := json.Marshal(map[string]string{"prompt": "hello", "model": "gemma3:4b"})
	req := httptest.NewRequest("POST", "/api/v1/jobs", bytes.NewReader(body))
	w := httptest.NewRecorder()
	h.submit(w, req)

	if w.Code != http.StatusCreated {
		t.Errorf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var resp map[string]string
	json.NewDecoder(w.Body).Decode(&resp)
	if resp["job_id"] == "" {
		t.Error("expected job_id in response")
	}
}

func TestSubmitNoNodes(t *testing.T) {
	h, _ := setupJobsHandler(t)
	body, _ := json.Marshal(map[string]string{"prompt": "hello"})
	req := httptest.NewRequest("POST", "/api/v1/jobs", bytes.NewReader(body))
	w := httptest.NewRecorder()
	h.submit(w, req)

	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("expected 503, got %d", w.Code)
	}
}
