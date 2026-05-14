package main

import (
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
)

var (
	serverURL    = flag.String("server", "http://40.113.111.66:8080", "Enigma server URL")
	adminToken   = flag.String("token", "", "X-Admin-Token (or set ENIGMA_ADMIN_TOKEN env)")
	totalNodes   = flag.Int("nodes", 16761, "Total ghost nodes to create")
	offlinePct   = flag.Float64("offline-pct", 0.03, "Fraction to set offline (0.03 = 3%)")
	batchSz      = flag.Int("batch", 500, "Nodes per seed API call")
	startRate    = flag.Int("start-rate", 500, "Goroutines started per second during ramp-up")
	hbInterval   = flag.Duration("heartbeat-interval", 30*time.Second, "Heartbeat interval")
	pollInterval = flag.Duration("poll-interval", 30*time.Second, "Job poll interval")
	jitter       = flag.Duration("jitter", 5*time.Second, "Random ±jitter added to intervals")
	metricsEvery = flag.Duration("metrics-interval", 60*time.Second, "Metrics report interval")
)

var backends = []string{"ollama", "vllm", "lmstudio", "localai"}
var modelSets = [][]string{
	{"gemma3:4b"},
	{"phi3:mini"},
	{"qwen2.5:7b"},
	{"llama3.2:3b"},
	{"gemma3:4b", "phi3:mini"},
}
var gpuVRAMs = []int{4096, 6144, 8192, 12288, 16384, 24576}
var gpuModels = []string{"RTX 3060", "RTX 4070", "A10G", "RTX 3090", "T4"}

type ghostNode struct {
	id     string
	online bool
}

type seedInput struct {
	Address        string   `json:"address"`
	Backend        string   `json:"backend"`
	Models         []string `json:"models"`
	GPUVRAMMb      int      `json:"gpu_vram_mb"`
	GPUModel       string   `json:"gpu_model"`
	BenchmarkScore float64  `json:"benchmark_score"`
	AvgRating      float64  `json:"avg_rating"`
	Reliability    float64  `json:"reliability"`
	Status         string   `json:"status"`
}

type seedResponse struct {
	Seeded  int      `json:"seeded"`
	NodeIDs []string `json:"node_ids"`
}

type jobResponse struct {
	ID string `json:"id"`
}

type metrics struct {
	heartbeats    atomic.Int64
	heartbeatErrs atomic.Int64
	polls         atomic.Int64
	pollErrs      atomic.Int64
	jobsReceived  atomic.Int64
	jobsCompleted atomic.Int64
}

func main() {
	flag.Parse()
	if tok := os.Getenv("ENIGMA_ADMIN_TOKEN"); tok != "" && *adminToken == "" {
		*adminToken = tok
	}

	client := &http.Client{
		Timeout: 30 * time.Second,
		Transport: &http.Transport{
			MaxIdleConns:        2000,
			MaxIdleConnsPerHost: 2000,
			IdleConnTimeout:     90 * time.Second,
		},
	}

	m := &metrics{}
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	// Phase 1: Seed
	log.Printf("Seeding %d ghost nodes (%.0f%% offline, batch=%d)...",
		*totalNodes, *offlinePct*100, *batchSz)
	nodes, err := seedNodes(ctx, client, m)
	if err != nil {
		log.Fatalf("seed failed: %v", err)
	}
	online := filterOnline(nodes)
	log.Printf("Seeded %d nodes total, %d online, %d offline",
		len(nodes), len(online), len(nodes)-len(online))

	// Phase 2: Ramp up goroutines
	log.Printf("Starting %d goroutines at %d/s...", len(online), *startRate)
	var wg sync.WaitGroup
	rateTicker := time.NewTicker(time.Second / time.Duration(*startRate))
	defer rateTicker.Stop()

	for _, node := range online {
		select {
		case <-ctx.Done():
			goto shutdown
		case <-rateTicker.C:
		}
		wg.Add(1)
		n := node
		go func() {
			defer wg.Done()
			runGhostNode(ctx, client, n, m)
		}()
	}
	log.Printf("All %d goroutines running", len(online))

	// Phase 3: Metrics reporter
	go reportMetrics(ctx, m)

	<-ctx.Done()
shutdown:
	log.Println("Shutdown signal received, waiting for goroutines...")
	wg.Wait()
	log.Println("Ghost manager stopped.")
}

func seedNodes(ctx context.Context, client *http.Client, m *metrics) ([]ghostNode, error) {
	offlineCount := int(float64(*totalNodes) * *offlinePct)
	var all []ghostNode

	for sent := 0; sent < *totalNodes; {
		end := sent + *batchSz
		if end > *totalNodes {
			end = *totalNodes
		}

		batch := make([]seedInput, end-sent)
		for i := range batch {
			idx := sent + i
			isOffline := idx < offlineCount
			status := "online"
			if isOffline {
				status = "offline"
			}
			batch[i] = seedInput{
				Address:        fmt.Sprintf("ghost-%06d.local:11434", idx),
				Backend:        backends[rand.Intn(len(backends))],
				Models:         modelSets[rand.Intn(len(modelSets))],
				GPUVRAMMb:      gpuVRAMs[rand.Intn(len(gpuVRAMs))],
				GPUModel:       gpuModels[rand.Intn(len(gpuModels))],
				BenchmarkScore: 0.10 + rand.Float64()*0.20,
				AvgRating:      0.40 + rand.Float64()*0.40,
				Reliability:    0.60 + rand.Float64()*0.35,
				Status:         status,
			}
		}

		body, _ := json.Marshal(batch)
		req, err := http.NewRequestWithContext(ctx, "POST",
			*serverURL+"/api/v1/admin/nodes/seed", bytes.NewReader(body))
		if err != nil {
			return nil, err
		}
		req.Header.Set("Content-Type", "application/json")
		if *adminToken != "" {
			req.Header.Set("X-Admin-Token", *adminToken)
		}

		resp, err := client.Do(req)
		if err != nil {
			return nil, fmt.Errorf("batch %d-%d: %w", sent, end, err)
		}
		var sr seedResponse
		json.NewDecoder(resp.Body).Decode(&sr)
		resp.Body.Close()

		for i, id := range sr.NodeIDs {
			idx := sent + i
			all = append(all, ghostNode{id: id, online: idx >= offlineCount})
		}
		sent = end
		log.Printf("  seeded %d/%d", len(all), *totalNodes)
	}
	return all, nil
}

func filterOnline(nodes []ghostNode) []ghostNode {
	out := make([]ghostNode, 0, len(nodes))
	for _, n := range nodes {
		if n.online {
			out = append(out, n)
		}
	}
	return out
}

func runGhostNode(ctx context.Context, client *http.Client, node ghostNode, m *metrics) {
	hbTimer := time.NewTimer(jitteredDur(*hbInterval, *jitter))
	pollTimer := time.NewTimer(jitteredDur(*pollInterval, *jitter))
	defer hbTimer.Stop()
	defer pollTimer.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-hbTimer.C:
			doHeartbeat(ctx, client, node.id, m)
			hbTimer.Reset(jitteredDur(*hbInterval, *jitter))
		case <-pollTimer.C:
			doPoll(ctx, client, node.id, m)
			pollTimer.Reset(jitteredDur(*pollInterval, *jitter))
		}
	}
}

func doHeartbeat(ctx context.Context, client *http.Client, nodeID string, m *metrics) {
	req, err := http.NewRequestWithContext(ctx, "PUT",
		fmt.Sprintf("%s/api/v1/nodes/%s/heartbeat", *serverURL, nodeID), nil)
	if err != nil {
		m.heartbeatErrs.Add(1)
		return
	}
	resp, err := client.Do(req)
	if err != nil {
		m.heartbeatErrs.Add(1)
		return
	}
	resp.Body.Close()
	if resp.StatusCode == http.StatusOK {
		m.heartbeats.Add(1)
	} else {
		m.heartbeatErrs.Add(1)
	}
}

func doPoll(ctx context.Context, client *http.Client, nodeID string, m *metrics) {
	req, err := http.NewRequestWithContext(ctx, "GET",
		fmt.Sprintf("%s/api/v1/nodes/%s/jobs", *serverURL, nodeID), nil)
	if err != nil {
		m.pollErrs.Add(1)
		return
	}
	resp, err := client.Do(req)
	if err != nil {
		m.pollErrs.Add(1)
		return
	}
	defer resp.Body.Close()
	m.polls.Add(1)

	if resp.StatusCode == http.StatusNoContent || resp.StatusCode == http.StatusNotFound {
		return
	}
	if resp.StatusCode != http.StatusOK {
		m.pollErrs.Add(1)
		return
	}

	var job jobResponse
	if err := json.NewDecoder(resp.Body).Decode(&job); err != nil || job.ID == "" {
		return
	}
	m.jobsReceived.Add(1)
	completeJob(ctx, client, job.ID, m)
}

func completeJob(ctx context.Context, client *http.Client, jobID string, m *metrics) {
	body, _ := json.Marshal(map[string]any{
		"result":      "mock response from ghost node",
		"duration_ms": 42,
	})
	req, err := http.NewRequestWithContext(ctx, "POST",
		fmt.Sprintf("%s/api/v1/jobs/%s/result", *serverURL, jobID),
		bytes.NewReader(body))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return
	}
	resp.Body.Close()
	m.jobsCompleted.Add(1)
}

func reportMetrics(ctx context.Context, m *metrics) {
	ticker := time.NewTicker(*metricsEvery)
	defer ticker.Stop()
	var lastHB, lastPoll, lastDone int64
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			hb := m.heartbeats.Load()
			poll := m.polls.Load()
			done := m.jobsCompleted.Load()
			log.Printf("METRICS heartbeats=%d(+%d) hb_errs=%d polls=%d(+%d) poll_errs=%d jobs_recv=%d jobs_done=%d(+%d)",
				hb, hb-lastHB, m.heartbeatErrs.Load(),
				poll, poll-lastPoll, m.pollErrs.Load(),
				m.jobsReceived.Load(), done, done-lastDone)
			lastHB, lastPoll, lastDone = hb, poll, done
		}
	}
}

func jitteredDur(base, jit time.Duration) time.Duration {
	if jit == 0 {
		return base
	}
	delta := time.Duration(rand.Int63n(int64(jit)*2)) - jit
	d := base + delta
	if d < time.Second {
		d = time.Second
	}
	return d
}
