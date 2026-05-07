package benchmark

import (
	"context"
	"testing"
)

type mockBackend struct {
	response string
	err      error
}

func (m *mockBackend) Infer(_ context.Context, _, _ string) (string, error) {
	return m.response, m.err
}

func (m *mockBackend) ListModels(_ context.Context) ([]string, error) {
	return nil, nil
}

func TestRunPerfectScore(t *testing.T) {
	// Answers both factual questions correctly and quickly
	b := &mockBackend{response: "Paris ist die Hauptstadt. 408 ist korrekt. HTTP ist ein Protokoll."}
	result := Run(context.Background(), b, "test-model")
	if result.Error != nil {
		t.Fatal(result.Error)
	}
	if result.Score <= 0.5 {
		t.Errorf("expected high score for correct answers, got %.2f", result.Score)
	}
}

func TestRunWrongAnswers(t *testing.T) {
	b := &mockBackend{response: "Ich weiß es nicht."}
	result := Run(context.Background(), b, "test-model")
	if result.Error != nil {
		t.Fatal(result.Error)
	}
	// Only the time-only question (3rd) scores — expect low score
	if result.Score > 0.5 {
		t.Errorf("expected low score for wrong answers, got %.2f", result.Score)
	}
}
