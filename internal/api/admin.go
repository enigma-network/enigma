package api

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
)

type adminHandler struct {
	db *sql.DB
}

func (h *adminHandler) stats(w http.ResponseWriter, r *http.Request) {
	var stats struct {
		NodesOnline  int     `json:"nodes_online"`
		JobsTotal    int     `json:"jobs_total"`
		ENITotal     float64 `json:"eni_total"`
		JobsLastHour int     `json:"jobs_last_hour"`
	}
	if err := h.db.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM nodes WHERE status='online'`).Scan(&stats.NodesOnline); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if err := h.db.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM jobs`).Scan(&stats.JobsTotal); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if err := h.db.QueryRowContext(r.Context(), `SELECT COALESCE(SUM(amount),0) FROM ledger`).Scan(&stats.ENITotal); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if err := h.db.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM jobs WHERE created_at > NOW() - INTERVAL '1 hour'`).Scan(&stats.JobsLastHour); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(stats)
}

func (h *adminHandler) nodes(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.QueryContext(r.Context(),
		`SELECT id, address, backend, models, gpu_model, benchmark_score, avg_rating, reliability, status, last_heartbeat
		 FROM nodes ORDER BY benchmark_score DESC`)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type Node struct {
		ID             string  `json:"id"`
		Address        string  `json:"address"`
		Backend        string  `json:"backend"`
		Models         string  `json:"models"`
		GPUModel       string  `json:"gpu_model"`
		BenchmarkScore float64 `json:"benchmark_score"`
		AvgRating      float64 `json:"avg_rating"`
		Reliability    float64 `json:"reliability"`
		Status         string  `json:"status"`
		LastHeartbeat  string  `json:"last_heartbeat"`
	}

	nodes := []Node{}
	for rows.Next() {
		var n Node
		if err := rows.Scan(&n.ID, &n.Address, &n.Backend, &n.Models, &n.GPUModel,
			&n.BenchmarkScore, &n.AvgRating, &n.Reliability, &n.Status, &n.LastHeartbeat); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		nodes = append(nodes, n)
	}
	if err := rows.Err(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(nodes)
}

func (h *adminHandler) jobs(w http.ResponseWriter, r *http.Request) {
	limit := 50
	if l := r.URL.Query().Get("limit"); l != "" {
		if v, err := strconv.Atoi(l); err == nil && v > 0 && v <= 200 {
			limit = v
		}
	}

	rows, err := h.db.QueryContext(r.Context(),
		`SELECT id, prompt, model, status, COALESCE(assigned_node,''), COALESCE(result,''),
		 COALESCE(duration_ms,0), created_at, COALESCE(completed_at,'')
		 FROM jobs ORDER BY created_at DESC LIMIT ?`, limit)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type Job struct {
		ID           string `json:"id"`
		Prompt       string `json:"prompt"`
		Model        string `json:"model"`
		Status       string `json:"status"`
		AssignedNode string `json:"assigned_node"`
		Result       string `json:"result"`
		DurationMs   int64  `json:"duration_ms"`
		CreatedAt    string `json:"created_at"`
		CompletedAt  string `json:"completed_at"`
	}

	jobs := []Job{}
	for rows.Next() {
		var j Job
		if err := rows.Scan(&j.ID, &j.Prompt, &j.Model, &j.Status, &j.AssignedNode,
			&j.Result, &j.DurationMs, &j.CreatedAt, &j.CompletedAt); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		jobs = append(jobs, j)
	}
	if err := rows.Err(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(jobs)
}

func (h *adminHandler) ledger(w http.ResponseWriter, r *http.Request) {
	limit := 50
	if l := r.URL.Query().Get("limit"); l != "" {
		if v, err := strconv.Atoi(l); err == nil && v > 0 && v <= 200 {
			limit = v
		}
	}

	rows, err := h.db.QueryContext(r.Context(),
		`SELECT id, node_id, amount, reason, created_at FROM ledger ORDER BY created_at DESC LIMIT ?`, limit)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type Entry struct {
		ID        int64   `json:"id"`
		NodeID    string  `json:"node_id"`
		Amount    float64 `json:"amount"`
		Reason    string  `json:"reason"`
		CreatedAt string  `json:"created_at"`
	}

	entries := []Entry{}
	for rows.Next() {
		var e Entry
		if err := rows.Scan(&e.ID, &e.NodeID, &e.Amount, &e.Reason, &e.CreatedAt); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		entries = append(entries, e)
	}
	if err := rows.Err(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(entries)
}
