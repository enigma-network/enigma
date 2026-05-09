package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
)

type streamJob struct {
	ID     string `json:"job_id"`
	Prompt string `json:"prompt"`
	Model  string `json:"model"`
}

type pubSubber interface {
	Publish(channel, message string) error
}

type streamHub struct {
	mu    sync.RWMutex
	chans map[string]chan streamJob
	ps    pubSubber
}

func newStreamHub(ps pubSubber) *streamHub {
	return &streamHub{chans: make(map[string]chan streamJob), ps: ps}
}

func (h *streamHub) connect(nodeID string) <-chan streamJob {
	h.mu.Lock()
	defer h.mu.Unlock()
	ch := make(chan streamJob, 8)
	h.chans[nodeID] = ch
	return ch
}

func (h *streamHub) disconnect(nodeID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if ch, ok := h.chans[nodeID]; ok {
		close(ch)
		delete(h.chans, nodeID)
	}
}

func (h *streamHub) send(nodeID string, job streamJob) {
	h.mu.RLock()
	ch, ok := h.chans[nodeID]
	h.mu.RUnlock()
	if ok {
		select {
		case ch <- job:
		default:
		}
		return
	}
	if h.ps != nil {
		data, _ := json.Marshal(job)
		h.ps.Publish("node:"+nodeID+":job", string(data))
	}
}

func (h *streamHub) serveStream(w http.ResponseWriter, r *http.Request) {
	nodeID := r.PathValue("id")

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	jobs := h.connect(nodeID)
	defer h.disconnect(nodeID)

	fmt.Fprintf(w, "event: connected\ndata: {\"node_id\":%q}\n\n", nodeID)
	flusher.Flush()

	for {
		select {
		case <-r.Context().Done():
			return
		case job, ok := <-jobs:
			if !ok {
				return
			}
			data, _ := json.Marshal(job)
			fmt.Fprintf(w, "event: job\ndata: %s\n\n", data)
			flusher.Flush()
		}
	}
}
