package api

import (
	"bytes"
	"context"
	"encoding/json"
	"enigma/internal/ledger"
	"enigma/internal/llm"
	"enigma/internal/registry"
	"enigma/internal/types"
	"net/http"
	"net/http/httptest"
	"testing"
)

type mockLLMBackend struct{}

func (m *mockLLMBackend) Infer(_ context.Context, _, _ string) (string, error) {
	return "Paris. 408. HTTP ist ein Protokoll.", nil
}
func (m *mockLLMBackend) ListModels(_ context.Context) ([]string, error) { return nil, nil }

func setupNodesHandler(t *testing.T) *nodesHandler {
	t.Helper()
	sqldb := testDB(t)
	return &nodesHandler{
		registry: registry.NewPostgresRegistry(sqldb),
		ledger:   ledger.NewPostgresLedger(sqldb),
		jobs:     newJobStore(sqldb),
		newBackend: func(_ types.Backend, _ string) llm.LLMBackend {
			return &mockLLMBackend{}
		},
	}
}

func TestRegisterNode(t *testing.T) {
	h := setupNodesHandler(t)

	body, _ := json.Marshal(map[string]any{
		"address": "localhost:11434",
		"backend": "ollama",
		"models":  []string{"gemma3:4b"},
	})
	req := httptest.NewRequest("POST", "/api/v1/nodes/register", bytes.NewReader(body))
	w := httptest.NewRecorder()
	h.register(w, req)

	if w.Code != http.StatusCreated {
		t.Errorf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var resp map[string]string
	json.NewDecoder(w.Body).Decode(&resp)
	if resp["node_id"] == "" {
		t.Error("expected node_id in response")
	}
}
