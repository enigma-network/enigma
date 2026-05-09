package api

import (
	"context"
	"encoding/json"
	"enigma/internal/pubsub"
	"fmt"
	"net/http"
	"sync"
)

type streamJob struct {
	ID     string `json:"job_id"`
	Prompt string `json:"prompt"`
	Model  string `json:"model"`
}

type streamHub struct {
	mu    sync.RWMutex
	chans map[string]chan streamJob
	ps    pubsub.PubSub
}

func newStreamHub(ps pubsub.PubSub) *streamHub {
	return &streamHub{chans: make(map[string]chan streamJob), ps: ps}
}

func (h *streamHub) connect(ctx context.Context, nodeID string) <-chan streamJob {
	h.mu.Lock()
	ch := make(chan streamJob, 8)
	h.chans[nodeID] = ch
	h.mu.Unlock()

	if h.ps != nil {
		redisCh, err := h.ps.Subscribe(ctx, "node:"+nodeID+":job")
		if err == nil {
			go func() {
				for payload := range redisCh {
					var job streamJob
					if json.Unmarshal([]byte(payload), &job) == nil {
						h.mu.RLock()
						localCh, ok := h.chans[nodeID]
						h.mu.RUnlock()
						if ok {
							select {
							case localCh <- job:
							default:
							}
						}
					}
				}
			}()
		}
	}
	return ch
}

func (h *streamHub) disconnect(nodeID string) {
	h.mu.Lock()
	if ch, ok := h.chans[nodeID]; ok {
		close(ch)
		delete(h.chans, nodeID)
	}
	h.mu.Unlock()
	if h.ps != nil {
		h.ps.Unsubscribe("node:" + nodeID + ":job")
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
		h.ps.Publish(context.Background(), "node:"+nodeID+":job", string(data))
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

	jobs := h.connect(r.Context(), nodeID)
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
