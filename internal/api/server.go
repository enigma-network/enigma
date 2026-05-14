package api

import (
	"database/sql"
	"enigma/internal/ledger"
	"enigma/internal/llm"
	"enigma/internal/pubsub"
	"enigma/internal/registry"
	"enigma/internal/router"
	"enigma/internal/types"
	"net/http"
	"os"
)

type Server struct {
	mux *http.ServeMux
	db  *sql.DB
	hub *streamHub
}

func NewServer(db *sql.DB, reg registry.RegistryStore, led ledger.Ledger, ps pubsub.PubSub) *Server {
	jobs := newJobStore(db)
	rtr := router.NewScoredRouter(router.NewRoundRobinRouter())
	hub := newStreamHub(ps)

	jobsH := &jobsHandler{jobs: jobs, registry: reg, router: rtr, ledger: led, hub: hub}
	nodesH := &nodesHandler{
		registry: reg, ledger: led, jobs: jobs,
		newBackend: func(backend types.Backend, address string) llm.LLMBackend {
			return defaultNewBackend(backend, address)
		},
	}
	ratingsH := &ratingsHandler{db: db, jobs: jobs, registry: reg}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
	mux.HandleFunc("POST /api/v1/nodes/register", nodesH.register)
	mux.HandleFunc("PUT /api/v1/nodes/{id}/heartbeat", nodesH.heartbeat)
	mux.HandleFunc("DELETE /api/v1/nodes/{id}", nodesH.deregister)
	mux.HandleFunc("GET /api/v1/nodes/{id}/stream", hub.serveStream)
	mux.HandleFunc("GET /api/v1/nodes/{id}/jobs", nodesH.pollJob)
	mux.HandleFunc("GET /api/v1/nodes/{id}/balance", nodesH.balance)
	mux.HandleFunc("POST /api/v1/jobs", jobsH.submit)
	mux.HandleFunc("GET /api/v1/jobs/{id}", jobsH.status)
	mux.HandleFunc("POST /api/v1/jobs/{id}/result", jobsH.result)
	mux.HandleFunc("POST /api/v1/jobs/{id}/rate", ratingsH.rate)

	mux.HandleFunc("PUT /api/v1/nodes/{id}/suspend", adminAuth(nodesH.suspend))
	mux.HandleFunc("PUT /api/v1/nodes/{id}/resume", adminAuth(nodesH.resume))

	adminH := &adminHandler{db: db, registry: reg}
	mux.HandleFunc("GET /api/v1/admin/stats", adminAuth(adminH.stats))
	mux.HandleFunc("GET /api/v1/admin/nodes", adminAuth(adminH.nodes))
	mux.HandleFunc("GET /api/v1/admin/jobs", adminAuth(adminH.jobs))
	mux.HandleFunc("GET /api/v1/admin/ledger", adminAuth(adminH.ledger))
	mux.HandleFunc("GET /api/v1/admin/instances", adminAuth(adminH.instances))
	mux.HandleFunc("POST /api/v1/admin/nodes/seed", adminAuth(adminH.bulkSeed))

	return &Server{mux: mux, db: db, hub: hub}
}

func (s *Server) Handler() http.Handler { return s.mux }
func (s *Server) Hub() *streamHub       { return s.hub }

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
