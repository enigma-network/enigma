package benchmark

import (
	"context"
	"enigma/internal/llm"
	"strings"
	"time"
)

type Result struct {
	Score float64
	Error error
}

type testCase struct {
	prompt   string
	expected string // empty = no correctness check, time-only
}

var testCases = []testCase{
	{"Was ist die Hauptstadt von Frankreich?", "paris"},
	{"Wie viel ist 17 mal 24? Antworte nur mit der Zahl.", "408"},
	{"Erkläre in einem Satz was HTTP ist.", ""},
}

const maxLatencyMs = 10_000 // 10s per prompt = score 0

func Run(ctx context.Context, backend llm.LLMBackend, model string) Result {
	totalScore := 0.0

	for _, tc := range testCases {
		start := time.Now()
		ctxTimeout, cancel := context.WithTimeout(ctx, 30*time.Second)
		response, err := backend.Infer(ctxTimeout, model, tc.prompt)
		cancel()
		elapsed := time.Since(start).Milliseconds()

		if err != nil {
			// Inference failure: 0 points for this case
			continue
		}

		var caseScore float64

		if tc.expected == "" {
			// Time-only scoring: 1.0 at 0ms, 0.0 at 10s
			caseScore = 1.0 - clamp(float64(elapsed)/float64(maxLatencyMs), 0, 1)
		} else {
			// Correctness check
			if strings.Contains(strings.ToLower(response), tc.expected) {
				// Correct: full point minus latency penalty (max 20%)
				latencyPenalty := 0.2 * clamp(float64(elapsed)/float64(maxLatencyMs), 0, 1)
				caseScore = 1.0 - latencyPenalty
			}
			// Wrong answer: 0 points
		}

		totalScore += caseScore
	}

	return Result{Score: clamp(totalScore/float64(len(testCases)), 0, 1)}
}

func clamp(v, min, max float64) float64 {
	if v < min {
		return min
	}
	if v > max {
		return max
	}
	return v
}
