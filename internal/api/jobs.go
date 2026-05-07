package api

import (
	"encoding/json"
	"enigma/internal/ledger"
	"enigma/internal/registry"
	"enigma/internal/router"
	"enigma/internal/types"
	"net/http"

	"github.com/google/uuid"
)

type jobsHandler struct {
	jobs     *jobStore
	registry registry.RegistryStore
	router   router.Router
	ledger   ledger.Ledger
}

func (h *jobsHandler) submit(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Prompt string `json:"prompt"`
		Model  string `json:"model"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	if req.Prompt == "" {
		http.Error(w, "prompt required", http.StatusBadRequest)
		return
	}

	nodes, err := h.registry.List(r.Context())
	if err != nil || len(nodes) == 0 {
		http.Error(w, "no nodes available", http.StatusServiceUnavailable)
		return
	}

	job := types.Job{ID: uuid.NewString(), Prompt: req.Prompt, Model: req.Model}
	selected, err := h.router.SelectNode(r.Context(), job, nodes)
	if err != nil {
		http.Error(w, "routing failed", http.StatusServiceUnavailable)
		return
	}
	job.AssignedNode = selected.ID

	if err := h.jobs.create(r.Context(), job); err != nil {
		http.Error(w, "failed to create job", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]string{"job_id": job.ID})
}

func (h *jobsHandler) status(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	job, err := h.jobs.get(r.Context(), id)
	if err != nil {
		http.Error(w, "job not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(job)
}

func (h *jobsHandler) result(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var req struct {
		Result     string `json:"result"`
		DurationMs int64  `json:"duration_ms"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}

	job, err := h.jobs.get(r.Context(), id)
	if err != nil {
		http.Error(w, "job not found", http.StatusNotFound)
		return
	}

	if err := h.jobs.complete(r.Context(), id, req.Result, req.DurationMs); err != nil {
		http.Error(w, "failed to complete job", http.StatusInternalServerError)
		return
	}

	h.ledger.Credit(r.Context(), job.AssignedNode, 1.0, "job_complete")

	w.WriteHeader(http.StatusNoContent)
}
