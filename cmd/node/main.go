package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"enigma/internal/llm"
	"enigma/internal/types"
)

func main() {
	serverURL := flag.String("server", "http://localhost:8080", "enigma-server URL")
	backendStr := flag.String("backend", "ollama", "LLM backend: ollama, llamacpp, vllm, lmstudio, localai, janai")
	backendAddr := flag.String("backend-addr", "localhost:11434", "Backend host:port")
	flag.Parse()

	backend := types.Backend(*backendStr)

	var llmBackend llm.LLMBackend
	switch backend {
	case types.BackendLlamaCpp:
		llmBackend = llm.NewLlamaCppBackend("http://" + *backendAddr)
	case types.BackendVLLM, types.BackendLMStudio, types.BackendLocalAI, types.BackendJanAI:
		llmBackend = llm.NewOpenAICompatBackend("http://"+*backendAddr, "")
	default:
		llmBackend = llm.NewOllamaBackend("http://" + *backendAddr)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	models, err := llmBackend.ListModels(ctx)
	if err != nil {
		log.Printf("warning: could not list models: %v", err)
		models = []string{}
	}

	// Register with server
	regBody, _ := json.Marshal(map[string]any{
		"address": *backendAddr, "backend": string(backend),
		"models": models, "gpu_vram_mb": 0, "gpu_model": "",
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

	defer func() {
		req, _ := http.NewRequest("DELETE", *serverURL+"/api/v1/nodes/"+nodeID, nil)
		http.DefaultClient.Do(req)
	}()

	// Periodically refresh model list and re-register if changed
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		current := models
		client := &http.Client{Timeout: 10 * time.Second}
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				updated, err := llmBackend.ListModels(ctx)
				if err != nil || len(updated) == len(current) {
					continue
				}
				current = updated
				body, _ := json.Marshal(map[string]any{
					"address": *backendAddr, "backend": string(backend),
					"models": updated, "gpu_vram_mb": 0, "gpu_model": "",
				})
				req, _ := http.NewRequestWithContext(ctx, "POST",
					*serverURL+"/api/v1/nodes/register", bytes.NewReader(body))
				req.Header.Set("Content-Type", "application/json")
				client.Do(req)
				log.Printf("model list updated: %v", updated)
			}
		}
	}()

	// SSE job stream with exponential backoff reconnect
	backoff := time.Second
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}
		err := runSSELoop(ctx, *serverURL, nodeID, llmBackend)
		if err == nil || ctx.Err() != nil {
			return
		}
		log.Printf("SSE disconnected: %v — reconnecting in %s", err, backoff)
		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}
		if backoff < 30*time.Second {
			backoff *= 2
		}
	}
}

func runSSELoop(ctx context.Context, serverURL, nodeID string, backend llm.LLMBackend) error {
	req, err := http.NewRequestWithContext(ctx, "GET",
		fmt.Sprintf("%s/api/v1/nodes/%s/stream", serverURL, nodeID), nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "text/event-stream")
	req.Header.Set("Cache-Control", "no-cache")

	client := &http.Client{Timeout: 0}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("stream status %d", resp.StatusCode)
	}

	// Heartbeat goroutine
	hbCtx, cancelHB := context.WithCancel(ctx)
	defer cancelHB()
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		hbClient := &http.Client{Timeout: 5 * time.Second}
		for {
			select {
			case <-hbCtx.Done():
				return
			case <-ticker.C:
				req, _ := http.NewRequestWithContext(hbCtx, "PUT",
					fmt.Sprintf("%s/api/v1/nodes/%s/heartbeat", serverURL, nodeID), nil)
				hbClient.Do(req)
			}
		}
	}()

	scanner := bufio.NewScanner(resp.Body)
	var eventType, dataLine string
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			if eventType == "job" && dataLine != "" {
				var job struct {
					ID     string `json:"job_id"`
					Prompt string `json:"prompt"`
					Model  string `json:"model"`
				}
				if json.Unmarshal([]byte(dataLine), &job) == nil && job.ID != "" {
					go processJob(ctx, serverURL, job.ID, job.Prompt, job.Model, backend)
				}
			}
			eventType, dataLine = "", ""
			continue
		}
		if strings.HasPrefix(line, "event:") {
			eventType = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
		} else if strings.HasPrefix(line, "data:") {
			dataLine = strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		}
	}
	return scanner.Err()
}

func processJob(ctx context.Context, serverURL, jobID, prompt, model string, backend llm.LLMBackend) {
	log.Printf("running job %s (model: %s)", jobID, model)
	start := time.Now()
	inferCtx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	result, err := backend.Infer(inferCtx, model, prompt)
	cancel()
	elapsed := time.Since(start).Milliseconds()

	var body []byte
	if err != nil {
		log.Printf("inference failed for job %s: %v", jobID, err)
		body, _ = json.Marshal(map[string]any{"result": "", "duration_ms": elapsed})
	} else {
		body, _ = json.Marshal(map[string]any{"result": result, "duration_ms": elapsed})
		log.Printf("job %s done in %dms", jobID, elapsed)
	}

	postResp, _ := http.Post(serverURL+"/api/v1/jobs/"+jobID+"/result",
		"application/json", bytes.NewReader(body))
	if postResp != nil {
		io.Copy(io.Discard, postResp.Body)
		postResp.Body.Close()
	}
}
