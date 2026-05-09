package api

import (
	"context"
	"encoding/json"
	"enigma/internal/benchmark"
	"enigma/internal/ledger"
	"enigma/internal/llm"
	"enigma/internal/registry"
	"enigma/internal/types"
	"net/http"
	"time"

	"github.com/google/uuid"
)

type nodesHandler struct {
	registry   registry.RegistryStore
	ledger     ledger.Ledger
	jobs       *jobStore
	newBackend func(backend types.Backend, address string) llm.LLMBackend
}

func defaultNewBackend(backend types.Backend, address string) llm.LLMBackend {
	switch backend {
	case types.BackendLlamaCpp:
		return llm.NewLlamaCppBackend("http://" + address)
	case types.BackendVLLM, types.BackendLMStudio, types.BackendLocalAI, types.BackendJanAI:
		return llm.NewOpenAICompatBackend("http://"+address, "")
	default:
		return llm.NewOllamaBackend("http://" + address)
	}
}

func (h *nodesHandler) register(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Address   string        `json:"address"`
		Backend   types.Backend `json:"backend"`
		Models    []string      `json:"models"`
		GPUVRAMMb int           `json:"gpu_vram_mb"`
		GPUModel  string        `json:"gpu_model"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Address == "" {
		http.Error(w, "invalid request: address required", http.StatusBadRequest)
		return
	}

	node := types.Node{
		ID:          uuid.NewString(),
		Address:     req.Address,
		Backend:     req.Backend,
		Models:      req.Models,
		GPUVRAMMb:   req.GPUVRAMMb,
		GPUModel:    req.GPUModel,
		AvgRating:   0.5,
		Reliability: 1.0,
	}

	// Run benchmark
	backend := h.newBackend(req.Backend, req.Address)
	model := ""
	if len(req.Models) > 0 {
		model = req.Models[0]
	}
	ctx, cancel := context.WithTimeout(r.Context(), 120*time.Second)
	defer cancel()
	bResult := benchmark.Run(ctx, backend, model)
	node.BenchmarkScore = bResult.Score

	if err := h.registry.Register(r.Context(), node); err != nil {
		http.Error(w, "failed to register", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]string{"node_id": node.ID})
}

func (h *nodesHandler) heartbeat(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := h.registry.Heartbeat(r.Context(), id); err != nil {
		http.Error(w, "node not found", http.StatusNotFound)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *nodesHandler) deregister(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	h.registry.Deregister(r.Context(), id)
	w.WriteHeader(http.StatusNoContent)
}

func (h *nodesHandler) pollJob(w http.ResponseWriter, r *http.Request) {
	nodeID := r.PathValue("id")

	// Long-poll: check every 500ms for up to 30s
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()

	for {
		job, err := h.jobs.nextForNode(ctx, nodeID)
		if err == nil {
			h.jobs.setRunning(ctx, job.ID)
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(job)
			return
		}
		select {
		case <-ctx.Done():
			w.WriteHeader(http.StatusNoContent)
			return
		case <-time.After(500 * time.Millisecond):
		}
	}
}

func (h *nodesHandler) balance(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	bal, err := h.ledger.Balance(r.Context(), id)
	if err != nil {
		http.Error(w, "failed to get balance", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]float64{"balance": bal})
}
