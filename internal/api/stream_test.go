package api

import (
	"context"
	"testing"
)

func TestStreamHub_SendDelivers(t *testing.T) {
	hub := newStreamHub(nil)
	ch := hub.connect(context.Background(), "node-1")
	defer hub.disconnect("node-1")

	job := streamJob{ID: "job-1", Prompt: "hello", Model: "phi3:mini"}
	hub.send("node-1", job)

	select {
	case received := <-ch:
		if received.ID != "job-1" {
			t.Errorf("expected job-1, got %s", received.ID)
		}
	default:
		t.Error("expected job on channel, got nothing")
	}
}

func TestStreamHub_SendUnknownNode(t *testing.T) {
	hub := newStreamHub(nil)
	// Should not panic for unknown node
	hub.send("unknown", streamJob{ID: "x"})
}
