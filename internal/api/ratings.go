package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"enigma/internal/registry"
	"net/http"
	"time"
)

type ratingsHandler struct {
	db       *sql.DB
	jobs     *jobStore
	registry registry.RegistryStore
}

func (h *ratingsHandler) rate(w http.ResponseWriter, r *http.Request) {
	jobID := r.PathValue("id")
	var req struct {
		Score int `json:"score"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Score < 1 || req.Score > 5 {
		http.Error(w, "score must be 1–5", http.StatusBadRequest)
		return
	}

	job, err := h.jobs.get(r.Context(), jobID)
	if err != nil {
		http.Error(w, "job not found", http.StatusNotFound)
		return
	}

	_, err = h.db.ExecContext(r.Context(),
		`INSERT INTO ratings (job_id, node_id, score, created_at) VALUES (?, ?, ?, ?)`,
		jobID, job.AssignedNode, req.Score, time.Now().UTC().Format(time.RFC3339),
	)
	if err != nil {
		http.Error(w, "failed to save rating", http.StatusInternalServerError)
		return
	}

	// Recalculate avg_rating for the node
	h.recalcRating(r.Context(), job.AssignedNode)

	w.WriteHeader(http.StatusNoContent)
}

func (h *ratingsHandler) recalcRating(ctx context.Context, nodeID string) {
	var avg sql.NullFloat64
	h.db.QueryRowContext(ctx,
		`SELECT AVG(CAST(score AS REAL) / 5.0) FROM ratings WHERE node_id=?`, nodeID,
	).Scan(&avg)
	if avg.Valid {
		h.db.ExecContext(ctx, `UPDATE nodes SET avg_rating=? WHERE id=?`, avg.Float64, nodeID)
	}
}
