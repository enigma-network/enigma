package types

import "time"

type NodeStatus string
type Backend string
type JobStatus string

const (
	NodeStatusOnline     NodeStatus = "online"
	NodeStatusOffline    NodeStatus = "offline"
	NodeStatusSuspended  NodeStatus = "suspended"

	BackendOllama   Backend = "ollama"
	BackendLlamaCpp Backend = "llamacpp"
	BackendVLLM     Backend = "vllm"     // OpenAI-compatible, NVIDIA-optimised
	BackendLMStudio Backend = "lmstudio" // OpenAI-compatible, desktop app
	BackendLocalAI  Backend = "localai"  // OpenAI-compatible, Docker-based
	BackendJanAI    Backend = "janai"    // OpenAI-compatible, desktop app

	JobStatusPending JobStatus = "pending"
	JobStatusRunning JobStatus = "running"
	JobStatusDone    JobStatus = "done"
	JobStatusFailed  JobStatus = "failed"
)

type Node struct {
	ID             string
	Address        string
	Backend        Backend
	Models         []string
	GPUVRAMMb      int
	GPUModel       string
	BenchmarkScore float64
	AvgRating      float64
	Reliability    float64
	Status         NodeStatus
	LastHeartbeat  time.Time
}

type Job struct {
	ID           string
	Prompt       string
	Model        string
	Status       JobStatus
	AssignedNode string
	Result       string
	DurationMs   int64
	CreatedAt    time.Time
	CompletedAt  *time.Time
}

type Transaction struct {
	ID        int64
	NodeID    string
	Amount    float64
	Reason    string
	CreatedAt time.Time
}
