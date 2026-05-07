package types

import "time"

type NodeStatus string
type Backend string
type JobStatus string

const (
	NodeStatusOnline  NodeStatus = "online"
	NodeStatusOffline NodeStatus = "offline"

	BackendOllama   Backend = "ollama"
	BackendLlamaCpp Backend = "llamacpp"

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
