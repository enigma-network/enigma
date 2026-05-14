package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
)

var (
	serverURL  = flag.String("server", "http://40.113.111.66:8080", "Enigma server URL")
	adminToken = flag.String("token", "", "X-Admin-Token (or ENIGMA_ADMIN_TOKEN env)")
	workers    = flag.Int("workers", 50, "Concurrent delete workers")
)

func main() {
	flag.Parse()
	if tok := os.Getenv("ENIGMA_ADMIN_TOKEN"); tok != "" && *adminToken == "" {
		*adminToken = tok
	}

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	client := &http.Client{
		Timeout: 15 * time.Second,
		Transport: &http.Transport{
			MaxIdleConnsPerHost: *workers + 10,
		},
	}

	// List all nodes
	req, _ := http.NewRequestWithContext(ctx, "GET", *serverURL+"/api/v1/admin/nodes", nil)
	if *adminToken != "" {
		req.Header.Set("X-Admin-Token", *adminToken)
	}
	resp, err := client.Do(req)
	if err != nil {
		log.Fatalf("list nodes: %v", err)
	}
	var nodes []struct {
		ID      string `json:"id"`
		Address string `json:"address"`
	}
	json.NewDecoder(resp.Body).Decode(&nodes)
	resp.Body.Close()

	// Filter ghost nodes (address starts with "ghost-")
	var ghostIDs []string
	for _, n := range nodes {
		if strings.HasPrefix(n.Address, "ghost-") {
			ghostIDs = append(ghostIDs, n.ID)
		}
	}
	log.Printf("Found %d ghost nodes to delete (out of %d total)", len(ghostIDs), len(nodes))

	if len(ghostIDs) == 0 {
		log.Println("Nothing to clean up.")
		return
	}

	// Delete concurrently
	var deleted atomic.Int64
	sem := make(chan struct{}, *workers)
	var wg sync.WaitGroup

	for _, id := range ghostIDs {
		select {
		case <-ctx.Done():
			log.Println("Interrupted.")
			goto done
		case sem <- struct{}{}:
		}
		wg.Add(1)
		nodeID := id
		go func() {
			defer wg.Done()
			defer func() { <-sem }()

			req, err := http.NewRequestWithContext(ctx, "DELETE",
				fmt.Sprintf("%s/api/v1/nodes/%s", *serverURL, nodeID), nil)
			if err != nil {
				return
			}
			resp, err := client.Do(req)
			if err == nil {
				resp.Body.Close()
				deleted.Add(1)
			}
		}()
	}

done:
	wg.Wait()
	log.Printf("Deleted %d ghost nodes.", deleted.Load())
}
