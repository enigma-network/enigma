package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
)

type LlamaCppBackend struct {
	baseURL string
	client  *http.Client
}

func NewLlamaCppBackend(baseURL string) *LlamaCppBackend {
	return &LlamaCppBackend{baseURL: baseURL, client: &http.Client{}}
}

func (l *LlamaCppBackend) Infer(ctx context.Context, _ string, prompt string) (string, error) {
	body, _ := json.Marshal(map[string]any{
		"prompt":    prompt,
		"n_predict": 512,
		"stream":    false,
	})
	req, err := http.NewRequestWithContext(ctx, "POST", l.baseURL+"/completion", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := l.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("llamacpp: %w", err)
	}
	defer resp.Body.Close()

	var result struct {
		Content string `json:"content"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", err
	}
	return result.Content, nil
}

func (l *LlamaCppBackend) ListModels(ctx context.Context) ([]string, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", l.baseURL+"/v1/models", nil)
	if err != nil {
		return nil, err
	}
	resp, err := l.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("llamacpp: %w", err)
	}
	defer resp.Body.Close()

	var result struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}
	ids := make([]string, len(result.Data))
	for i, m := range result.Data {
		ids[i] = m.ID
	}
	return ids, nil
}
