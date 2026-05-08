# Contributing to Enigma

Thank you for your interest in contributing to the Enigma Network — a decentralized AI inference platform where providers share GPU resources and users pay with ENI tokens.

## Architecture Overview

```
enigma/
├── cmd/
│   ├── server/     # enigma-server — Go HTTP API, job routing, node registry
│   ├── node/       # enigma-node   — provider daemon, connects to server
│   └── cli/        # enigma-cli    — command-line client for testing
├── internal/
│   ├── api/        # HTTP handlers (nodes, jobs, admin, ratings)
│   ├── router/     # Job routing: ScoredRouter + RoundRobin fallback
│   ├── registry/   # Node registry (SQLite)
│   ├── ledger/     # ENI token accounting
│   └── llm/        # LLM backend adapters (Ollama, …)
└── web/            # Next.js 14 frontend (dashboard, chat, setup)
    ├── app/        # App Router pages & API routes
    ├── components/ # Shared UI components
    └── lib/        # Auth, Prisma, enigma-server client
```

**Job flow:** User submits job → enigma-server routes to best online node (score = benchmark×0.4 + rating×0.4 + reliability×0.2) → node runs inference via Ollama → result returned → ENI tokens transferred.

## Getting Started

**Prerequisites:** Go 1.23+, Node.js 20+, Docker, Ollama (for local testing)

```bash
git clone https://github.com/enigma-network/enigma.git
cd enigma

# Build & test the Go server/node/cli
make build
make test

# Run a local simulation (3 nodes, 10 jobs)
make sim
make sim-stop

# Run the web frontend
make web-install
make web-dev   # http://localhost:3000
```

**Web environment** — create `web/.env.local`:
```env
DATABASE_URL=file:./dev.db
NEXTAUTH_SECRET=dev-secret-change-me
NEXTAUTH_URL=http://localhost:3000
AUTH_GITHUB_ID=your-github-oauth-app-id
AUTH_GITHUB_SECRET=your-github-oauth-app-secret
ENIGMA_SERVER_URL=http://localhost:8080
ENIGMA_ADMIN_TOKEN=
```

```bash
cd web
npx prisma migrate dev --name init
npm run dev
```

## How to Contribute

1. **Fork** the repository and create a branch: `git checkout -b feat/your-feature`
2. **Make changes** — keep PRs focused on one thing
3. **Run tests**: `make test` (Go) and `cd web && npm run build` (Next.js)
4. **Open a Pull Request** against `main` with a clear description

## Areas Where Help is Needed

| Area | Description |
|------|-------------|
| **LLM Backends** | Add support for backends beyond Ollama (vLLM, llama.cpp, etc.) |
| **Benchmarking** | Improve node benchmark scoring accuracy |
| **Token Economy** | ENI pricing models, wallet UX |
| **Streaming** | Stream inference results in real-time |
| **Node Auth** | Secure node registration with cryptographic identity |
| **Frontend** | Improve chat UX, provider dashboard, mobile layout |
| **Tests** | Integration tests for the web API routes |

## Code Style

- **Go**: standard `gofmt`, no external linter required
- **TypeScript/React**: no comments unless the why is non-obvious; prefer server components; keep API routes thin
- **Commits**: conventional commits (`feat:`, `fix:`, `refactor:` etc.)

## Questions?

Open an issue or start a discussion on GitHub. We're happy to help you find a good first contribution.
