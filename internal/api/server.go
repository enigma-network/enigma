package api

import (
	"database/sql"
	"enigma/internal/ledger"
	"enigma/internal/llm"
	"enigma/internal/registry"
	"enigma/internal/router"
	"enigma/internal/types"
	"net/http"
	"os"
)

type Server struct {
	mux *http.ServeMux
	db  *sql.DB
}

func NewServer(db *sql.DB) *Server {
	reg := registry.NewSQLiteRegistry(db)
	led := ledger.NewSQLiteLedger(db)
	jobs := newJobStore(db)
	rtr := router.NewScoredRouter(router.NewRoundRobinRouter())

	jobsH := &jobsHandler{jobs: jobs, registry: reg, router: rtr, ledger: led}
	nodesH := &nodesHandler{
		registry: reg, ledger: led, jobs: jobs,
		newBackend: func(backend types.Backend, address string) llm.LLMBackend {
			return defaultNewBackend(backend, address)
		},
	}
	ratingsH := &ratingsHandler{db: db, jobs: jobs, registry: reg}

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

	adminH := &adminHandler{db: db}
	mux.HandleFunc("GET /api/v1/admin/stats", adminAuth(adminH.stats))
	mux.HandleFunc("GET /api/v1/admin/nodes", adminAuth(adminH.nodes))
	mux.HandleFunc("GET /api/v1/admin/jobs", adminAuth(adminH.jobs))
	mux.HandleFunc("GET /api/v1/admin/ledger", adminAuth(adminH.ledger))

	return &Server{mux: mux, db: db}
}

func (s *Server) Handler() http.Handler { return s.mux }

// adminAuth wraps a handler requiring X-Admin-Token header to match ENIGMA_ADMIN_TOKEN env var.
// If ENIGMA_ADMIN_TOKEN is not set, the endpoint is open (PoC mode).
func adminAuth(next http.HandlerFunc) http.HandlerFunc {
	token := os.Getenv("ENIGMA_ADMIN_TOKEN")
	return func(w http.ResponseWriter, r *http.Request) {
		if token != "" && r.Header.Get("X-Admin-Token") != token {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		next(w, r)
	}
}
