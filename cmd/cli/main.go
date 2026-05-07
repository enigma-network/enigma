package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"time"
)

func main() {
	serverURL := flag.String("server", "http://localhost:8080", "enigma-server URL")
	flag.Parse()

	if flag.NArg() == 0 {
		fmt.Println("Usage: enigma-cli -server <url> <command> [args]")
		fmt.Println("Commands: submit, status, rate, balance, stats")
		os.Exit(1)
	}

	switch flag.Arg(0) {
	case "submit":
		submitCmd(*serverURL)
	case "status":
		statusCmd(*serverURL)
	case "rate":
		rateCmd(*serverURL)
	case "balance":
		balanceCmd(*serverURL)
	case "stats":
		statsCmd(*serverURL)
	default:
		log.Fatalf("unknown command: %s", flag.Arg(0))
	}
}

func submitCmd(server string) {
	fs := flag.NewFlagSet("submit", flag.ExitOnError)
	model := fs.String("model", "", "Model name")
	prompt := fs.String("prompt", "", "Prompt text")
	wait := fs.Bool("wait", true, "Wait for result")
	fs.Parse(flag.Args()[1:])

	if *prompt == "" {
		log.Fatal("--prompt required")
	}

	body, _ := json.Marshal(map[string]string{"prompt": *prompt, "model": *model})
	resp, err := http.Post(server+"/api/v1/jobs", "application/json", bytes.NewReader(body))
	if err != nil {
		log.Fatalf("submit failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated {
		b, _ := io.ReadAll(resp.Body)
		log.Fatalf("submit error %d: %s", resp.StatusCode, b)
	}

	var result map[string]string
	json.NewDecoder(resp.Body).Decode(&result)
	jobID := result["job_id"]
	fmt.Printf("job_id: %s\n", jobID)

	if !*wait {
		return
	}

	// Poll for result
	for i := 0; i < 120; i++ {
		time.Sleep(2 * time.Second)
		resp, err := http.Get(server + "/api/v1/jobs/" + jobID)
		if err != nil || resp == nil {
			continue
		}
		var job map[string]any
		json.NewDecoder(resp.Body).Decode(&job)
		resp.Body.Close()

		status, _ := job["Status"].(string)
		if status == "done" {
			fmt.Printf("\nResult: %v\n", job["Result"])
			return
		}
		if status == "failed" {
			fmt.Println("\nJob failed.")
			return
		}
		fmt.Print(".")
	}
	fmt.Println("\ntimeout waiting for result")
}

func statusCmd(server string) {
	if flag.NArg() < 2 {
		log.Fatal("usage: status <job_id>")
	}
	resp, err := http.Get(server + "/api/v1/jobs/" + flag.Arg(1))
	if err != nil {
		log.Fatal(err)
	}
	defer resp.Body.Close()
	io.Copy(os.Stdout, resp.Body)
	fmt.Println()
}

func rateCmd(server string) {
	fs := flag.NewFlagSet("rate", flag.ExitOnError)
	score := fs.Int("score", 0, "Rating 1–5")
	fs.Parse(flag.Args()[1:])
	if fs.NArg() < 1 || *score < 1 || *score > 5 {
		log.Fatal("usage: rate --score 1-5 <job_id>")
	}
	body, _ := json.Marshal(map[string]int{"score": *score})
	resp, err := http.Post(server+"/api/v1/jobs/"+fs.Arg(0)+"/rate", "application/json", bytes.NewReader(body))
	if err != nil {
		log.Fatalf("rate failed: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode == http.StatusNoContent {
		fmt.Println("rated.")
	} else {
		fmt.Printf("rate failed: HTTP %d\n", resp.StatusCode)
	}
}

func balanceCmd(server string) {
	if flag.NArg() < 2 {
		log.Fatal("usage: balance <node_id>")
	}
	resp, err := http.Get(server + "/api/v1/nodes/" + flag.Arg(1) + "/balance")
	if err != nil {
		log.Fatal(err)
	}
	defer resp.Body.Close()
	io.Copy(os.Stdout, resp.Body)
	fmt.Println()
}

func statsCmd(server string) {
	fmt.Println("Node stats — query the database directly:")
	fmt.Printf("  sqlite3 enigma.db 'SELECT id, benchmark_score, avg_rating, reliability FROM nodes'\n")
	fmt.Printf("  sqlite3 enigma.db 'SELECT node_id, SUM(amount) as eni FROM ledger GROUP BY node_id'\n")
}
