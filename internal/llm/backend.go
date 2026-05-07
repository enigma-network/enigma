package llm

import "context"

type LLMBackend interface {
	Infer(ctx context.Context, model string, prompt string) (string, error)
	ListModels(ctx context.Context) ([]string, error)
}
