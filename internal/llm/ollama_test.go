package llm

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestOllamaInfer(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/generate" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		json.NewEncoder(w).Encode(map[string]string{"response": "pong"})
	}))
	defer srv.Close()

	b := NewOllamaBackend(srv.URL)
	result, err := b.Infer(context.Background(), "test-model", "ping")
	if err != nil {
		t.Fatal(err)
	}
	if result != "pong" {
		t.Errorf("expected 'pong', got %q", result)
	}
}

func TestOllamaListModels(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{
			"models": []map[string]string{{"name": "gemma3:4b"}, {"name": "phi3:mini"}},
		})
	}))
	defer srv.Close()

	b := NewOllamaBackend(srv.URL)
	models, err := b.ListModels(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(models) != 2 || models[0] != "gemma3:4b" {
		t.Errorf("unexpected models: %v", models)
	}
}
