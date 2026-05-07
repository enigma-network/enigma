package main

import (
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os/signal"
	"syscall"
	"time"

	"enigma/internal/llm"
	"enigma/internal/types"
)

func main() {
	serverURL := flag.String("server", "http://localhost:8080", "enigma-server URL")
	backendStr := flag.String("backend", "ollama", "LLM backend: ollama or llamacpp")
	backendAddr := flag.String("backend-addr", "localhost:11434", "Backend host:port")
	flag.Parse()

	backend := types.BackendOllama
	if *backendStr == "llamacpp" {
		backend = types.BackendLlamaCpp
	}

	var llmBackend llm.LLMBackend
	switch backend {
	case types.BackendLlamaCpp:
		llmBackend = llm.NewLlamaCppBackend("http://" + *backendAddr)
	default:
		llmBackend = llm.NewOllamaBackend("http://" + *backendAddr)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	// List available models
	models, err := llmBackend.ListModels(ctx)
	if err != nil {
		log.Printf("warning: could not list models: %v", err)
		models = []string{}
	}

	// Register with server
	regBody, _ := json.Marshal(map[string]any{
		"address":     *backendAddr,
		"backend":     string(backend),
		"models":      models,
		"gpu_vram_mb": 0,
		"gpu_model":   "",
	})
	resp, err := http.Post(*serverURL+"/api/v1/nodes/register", "application/json", bytes.NewReader(regBody))
	if err != nil {
		log.Fatalf("failed to register: %v", err)
	}
	var regResp map[string]string
	json.NewDecoder(resp.Body).Decode(&regResp)
	resp.Body.Close()
	nodeID := regResp["node_id"]
	if nodeID == "" {
		log.Fatal("no node_id in register response")
	}
	log.Printf("registered as node %s", nodeID)

	// Deregister on shutdown
	defer func() {
		req, _ := http.NewRequest("DELETE", *serverURL+"/api/v1/nodes/"+nodeID, nil)
		http.DefaultClient.Do(req)
	}()

	// Heartbeat loop
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		client := &http.Client{}
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				req, _ := http.NewRequestWithContext(ctx, "PUT", *serverURL+"/api/v1/nodes/"+nodeID+"/heartbeat", nil)
				client.Do(req)
			}
		}
	}()

	// Job poll loop
	client := &http.Client{Timeout: 35 * time.Second}
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		req, _ := http.NewRequestWithContext(ctx, "GET", fmt.Sprintf("%s/api/v1/nodes/%s/jobs", *serverURL, nodeID), nil)
		resp, err := client.Do(req)
		if err != nil {
			time.Sleep(2 * time.Second)
			continue
		}
		if resp.StatusCode == http.StatusNoContent {
			resp.Body.Close()
			continue
		}

		var job struct {
			ID     string `json:"ID"`
			Prompt string `json:"Prompt"`
			Model  string `json:"Model"`
		}
		json.NewDecoder(resp.Body).Decode(&job)
		resp.Body.Close()

		if job.ID == "" {
			continue
		}

		log.Printf("running job %s (model: %s)", job.ID, job.Model)
		start := time.Now()
		inferCtx, cancel := context.WithTimeout(ctx, 5*time.Minute)
		result, err := llmBackend.Infer(inferCtx, job.Model, job.Prompt)
		cancel()
		elapsed := time.Since(start).Milliseconds()

		body, _ := json.Marshal(map[string]any{"result": result, "duration_ms": elapsed})
		if err != nil {
			body, _ = json.Marshal(map[string]any{"result": "", "duration_ms": elapsed})
			log.Printf("inference failed for job %s: %v", job.ID, err)
		}

		postResp, _ := http.Post(*serverURL+"/api/v1/jobs/"+job.ID+"/result", "application/json", bytes.NewReader(body))
		if postResp != nil {
			io.Copy(io.Discard, postResp.Body)
			postResp.Body.Close()
		}
		if err == nil {
			log.Printf("job %s done in %dms", job.ID, elapsed)
		}
	}
}
