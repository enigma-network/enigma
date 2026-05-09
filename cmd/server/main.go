package main

import (
	"context"
	"enigma/internal/api"
	"enigma/internal/db"
	"enigma/internal/ledger"
	"enigma/internal/pubsub"
	"enigma/internal/registry"
	"flag"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
)

func main() {
	dbURL := flag.String("db", "", "PostgreSQL connection string (overrides DATABASE_URL env)")
	addr := flag.String("addr", "", "Listen address (overrides PORT env, default :8080)")
	logPath := flag.String("log", "enigma.log", "JSON log file path")
	flag.Parse()

	connStr := *dbURL
	if connStr == "" {
		connStr = os.Getenv("DATABASE_URL")
	}
	if connStr == "" {
		connStr = "postgres://enigma:enigma@localhost:5432/enigma?sslmode=disable"
	}

	if *addr == "" {
		if p := os.Getenv("PORT"); p != "" {
			*addr = ":" + p
		} else {
			*addr = ":8080"
		}
	}

	logFile, err := os.OpenFile(*logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
	if err != nil {
		slog.Error("failed to open log file", "error", err)
		os.Exit(1)
	}
	defer logFile.Close()
	slog.SetDefault(slog.New(slog.NewJSONHandler(logFile, nil)))

	sqldb, err := db.Open(connStr)
	if err != nil {
		slog.Error("failed to open database", "error", err)
		os.Exit(1)
	}
	defer sqldb.Close()

	reg := registry.NewPostgresRegistry(sqldb)
	led := ledger.NewPostgresLedger(sqldb)

	var ps pubsub.PubSub
	if redisURL := os.Getenv("REDIS_URL"); redisURL != "" {
		rps, err := pubsub.NewRedis(redisURL)
		if err != nil {
			slog.Warn("redis unavailable — running single-instance mode", "error", err)
		} else {
			ps = rps
			defer rps.Close()
			slog.Info("redis connected", "url", redisURL)
		}
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	api.StartMonitor(ctx, sqldb)

	srv := api.NewServer(sqldb, reg, led, ps)
	httpSrv := &http.Server{Addr: *addr, Handler: srv.Handler()}

	go func() {
		<-ctx.Done()
		httpSrv.Shutdown(context.Background())
	}()

	slog.Info("enigma-server starting", "addr", *addr, "db", connStr)
	if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		slog.Error("server error", "error", err)
		os.Exit(1)
	}
}
