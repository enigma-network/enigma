package api

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"enigma/internal/db"
	"enigma/internal/ledger"
	"enigma/internal/llm"
	"enigma/internal/registry"
	"enigma/internal/router"
	"enigma/internal/types"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

type fastMockBackend struct{}

func (f *fastMockBackend) Infer(_ context.Context, _, prompt string) (string, error) {
	return "Paris. 408. HTTP ist ein Protokoll fuer Webanfragen.", nil
}
func (f *fastMockBackend) ListModels(_ context.Context) ([]string, error) {
	return []string{"gemma3:4b"}, nil
}

func newTestServer(t *testing.T) (*httptest.Server, *sql.DB) {
	t.Helper()
	sqldb, err := db.Open(t.TempDir() + "/test.db")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sqldb.Close() })

	reg := registry.NewSQLiteRegistry(sqldb)
	led := ledger.NewSQLiteLedger(sqldb)
	jobs := newJobStore(sqldb)
	rtr := router.NewScoredRouter(router.NewRoundRobinRouter())

	jobsH := &jobsHandler{jobs: jobs, registry: reg, router: rtr, ledger: led}
	nodesH := &nodesHandler{
		registry: reg, ledger: led, jobs: jobs,
		newBackend: func(_ types.Backend, _ string) llm.LLMBackend {
			return &fastMockBackend{}
		},
	}
	ratingsH := &ratingsHandler{db: sqldb, jobs: jobs, registry: reg}

	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/v1/nodes/register", nodesH.register)
	mux.HandleFunc("PUT /api/v1/nodes/{id}/heartbeat", nodesH.heartbeat)
	mux.HandleFunc("DELETE /api/v1/nodes/{id}", nodesH.deregister)
	mux.HandleFunc("GET /api/v1/nodes/{id}/jobs", nodesH.pollJob)
	mux.HandleFunc("GET /api/v1/nodes/{id}/balance", nodesH.balance)
	mux.HandleFunc("POST /api/v1/jobs", jobsH.submit)
	mux.HandleFunc("GET /api/v1/jobs/{id}", jobsH.status)
	mux.HandleFunc("POST /api/v1/jobs/{id}/result", jobsH.result)
	mux.HandleFunc("POST /api/v1/jobs/{id}/rate", ratingsH.rate)

	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv, sqldb
}

func TestFullJobFlow(t *testing.T) {
	srv, _ := newTestServer(t)

	// 1. Register node
	regBody, _ := json.Marshal(map[string]any{
		"address": "localhost:11434", "backend": "ollama", "models": []string{"gemma3:4b"},
	})
	resp, err := http.Post(srv.URL+"/api/v1/nodes/register", "application/json", bytes.NewReader(regBody))
	if err != nil {
		t.Fatal(err)
	}
	var regResp map[string]string
	json.NewDecoder(resp.Body).Decode(&regResp)
	resp.Body.Close()
	nodeID := regResp["node_id"]
	if nodeID == "" {
		t.Fatal("no node_id returned from register")
	}

	// 2. Submit job
	jobBody, _ := json.Marshal(map[string]string{"prompt": "Was ist die Hauptstadt von Frankreich?", "model": "gemma3:4b"})
	resp, err = http.Post(srv.URL+"/api/v1/jobs", "application/json", bytes.NewReader(jobBody))
	if err != nil {
		t.Fatal(err)
	}
	var jobResp map[string]string
	json.NewDecoder(resp.Body).Decode(&jobResp)
	resp.Body.Close()
	jobID := jobResp["job_id"]
	if jobID == "" {
		t.Fatal("no job_id returned from submit")
	}

	// 3. Node polls and gets job (simulate node behavior in goroutine)
	done := make(chan struct{})
	go func() {
		defer close(done)
		time.Sleep(100 * time.Millisecond)
		pollResp, err := http.Get(srv.URL + "/api/v1/nodes/" + nodeID + "/jobs")
		if err != nil || pollResp.StatusCode != http.StatusOK {
			return
		}
		var job map[string]string
		json.NewDecoder(pollResp.Body).Decode(&job)
		pollResp.Body.Close()

		polledJobID := job["ID"]
		if polledJobID == "" {
			return
		}

		// Report result
		resultBody, _ := json.Marshal(map[string]any{"result": "Paris", "duration_ms": int64(500)})
		postResp, _ := http.Post(srv.URL+"/api/v1/jobs/"+polledJobID+"/result", "application/json", bytes.NewReader(resultBody))
		if postResp != nil {
			postResp.Body.Close()
		}
	}()

	// 4. Wait for goroutine, then poll job status
	<-done
	time.Sleep(200 * time.Millisecond)

	resp, err = http.Get(srv.URL + "/api/v1/jobs/" + jobID)
	if err != nil {
		t.Fatal(err)
	}
	var jobStatus map[string]any
	json.NewDecoder(resp.Body).Decode(&jobStatus)
	resp.Body.Close()

	if jobStatus["Status"] != "done" {
		t.Errorf("expected job status 'done', got %v", jobStatus["Status"])
	}
	if jobStatus["Result"] != "Paris" {
		t.Errorf("expected result 'Paris', got %v", jobStatus["Result"])
	}

	// 5. Check ENI balance
	resp, err = http.Get(srv.URL + "/api/v1/nodes/" + nodeID + "/balance")
	if err != nil {
		t.Fatal(err)
	}
	var bal map[string]float64
	json.NewDecoder(resp.Body).Decode(&bal)
	resp.Body.Close()

	if bal["balance"] != 1.0 {
		t.Errorf("expected ENI balance 1.0, got %f", bal["balance"])
	}

	// 6. Rate the job
	rateBody, _ := json.Marshal(map[string]int{"score": 5})
	resp, err = http.Post(srv.URL+"/api/v1/jobs/"+jobID+"/rate", "application/json", bytes.NewReader(rateBody))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Errorf("expected 204 from rate, got %d", resp.StatusCode)
	}
}
