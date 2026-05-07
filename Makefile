.PHONY: build test sim sim-stop clean run-server run-node run-cli

build:
	go build -o bin/enigma-server ./cmd/server
	go build -o bin/enigma-node   ./cmd/node
	go build -o bin/enigma-cli    ./cmd/cli

test:
	go test ./...

sim: build
	@echo "Starting simulation: 3 nodes, 10 jobs..."
	@echo "Requires: Ollama running on localhost:11434"
	./bin/enigma-server -db /tmp/enigma-sim.db &
	sleep 1
	./bin/enigma-node -server http://localhost:8080 -backend ollama &
	./bin/enigma-node -server http://localhost:8080 -backend ollama &
	./bin/enigma-node -server http://localhost:8080 -backend ollama &
	sleep 2
	for i in $$(seq 1 10); do \
		./bin/enigma-cli -server http://localhost:8080 submit -model gemma3:4b -prompt "Was ist $$i × $$i?"; \
	done
	sleep 30
	./bin/enigma-cli -server http://localhost:8080 stats

sim-stop:
	@pkill -f enigma-server || true
	@pkill -f enigma-node || true
	@rm -f /tmp/enigma-sim.db

clean: sim-stop
	rm -rf bin/

run-server:
	./bin/enigma-server -db ./enigma.db

run-node:
	./bin/enigma-node -server http://localhost:8080 -backend ollama

run-cli:
	./bin/enigma-cli -server http://localhost:8080

web-install:
	cd web && npm install

web-dev: web-install
	cd web && npm run dev

web-db:
	cd web && npx prisma migrate dev --name init
