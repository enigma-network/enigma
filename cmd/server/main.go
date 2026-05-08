package main

import (
	"context"
	"enigma/internal/api"
	"enigma/internal/db"
	"flag"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
)

func main() {
	dbPath := flag.String("db", "enigma.db", "SQLite database path")
	addr := flag.String("addr", "", "Listen address (default :8080, overridden by PORT env var)")
	logPath := flag.String("log", "enigma.log", "JSON log file path")
	flag.Parse()

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

	sqldb, err := db.Open(*dbPath)
	if err != nil {
		slog.Error("failed to open database", "error", err)
		os.Exit(1)
	}
	defer sqldb.Close()

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	api.StartMonitor(ctx, sqldb)

	srv := api.NewServer(sqldb)
	httpSrv := &http.Server{Addr: *addr, Handler: srv.Handler()}

	go func() {
		<-ctx.Done()
		httpSrv.Shutdown(context.Background())
	}()

	slog.Info("enigma-server starting", "addr", *addr, "db", *dbPath, "log", *logPath)
	if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		slog.Error("server error", "error", err)
		os.Exit(1)
	}
}
