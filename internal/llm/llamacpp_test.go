package llm

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestLlamaCppInfer(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/completion" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		json.NewEncoder(w).Encode(map[string]string{"content": "hello"})
	}))
	defer srv.Close()

	b := NewLlamaCppBackend(srv.URL)
	result, err := b.Infer(context.Background(), "any-model", "hi")
	if err != nil {
		t.Fatal(err)
	}
	if result != "hello" {
		t.Errorf("expected 'hello', got %q", result)
	}
}
