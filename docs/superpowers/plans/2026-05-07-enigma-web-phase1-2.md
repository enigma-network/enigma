# Enigma Web Phase 1+2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Next.js 15 web interface for the Enigma network with OAuth auth (Google/GitHub), role-based accounts (USER/PROVIDER), ENI wallet, and an admin dashboard showing nodes, jobs, ledger, and live logs.

**Architecture:** Next.js runs on :3000 as a BFF — handles auth via NextAuth.js v5 + Prisma (web.db), and proxies dashboard data from enigma-server (:8080) which gets 4 new read-only admin endpoints. enigma.db stays untouched. Role is assigned via `/onboard?role=USER|PROVIDER` redirect after OAuth.

**Tech Stack:** Next.js 15, React 19, NextAuth.js v5, Prisma 7, SQLite (web.db), Tailwind CSS v4, TypeScript, Go (enigma-server additions)

---

## File Map

| File | Responsibility |
|---|---|
| `web/package.json` | Dependencies |
| `web/next.config.ts` | Next.js config (ENIGMA_SERVER_URL proxying) |
| `web/middleware.ts` | Protect /dashboard/**, /profile, /setup/** |
| `web/prisma/schema.prisma` | User, Account, WalletTransaction models |
| `web/lib/auth.ts` | NextAuth.js v5 config + PrismaAdapter |
| `web/lib/prisma.ts` | Prisma client singleton |
| `web/lib/enigma.ts` | enigma-server API client functions |
| `web/app/layout.tsx` | Root layout (fonts, metadata) |
| `web/app/(auth)/login/page.tsx` | Login page (OAuth buttons) |
| `web/app/(auth)/join/user/page.tsx` | Register as User |
| `web/app/(auth)/join/provider/page.tsx` | Register as Provider |
| `web/app/onboard/page.tsx` | Post-OAuth role assignment + start bonus |
| `web/app/profile/page.tsx` | Account info + ENI balance + transactions |
| `web/app/api/auth/[...nextauth]/route.ts` | NextAuth route handler |
| `web/app/api/admin/stats/route.ts` | Proxy: GET enigma-server /admin/stats |
| `web/app/api/admin/nodes/route.ts` | Proxy: GET enigma-server /admin/nodes |
| `web/app/api/admin/jobs/route.ts` | Proxy: GET enigma-server /admin/jobs |
| `web/app/api/admin/ledger/route.ts` | Proxy: GET enigma-server /admin/ledger |
| `web/app/api/admin/logs/route.ts` | Read last 100 lines from enigma.log |
| `web/app/dashboard/layout.tsx` | Dark sidebar layout |
| `web/app/dashboard/page.tsx` | Overview: stat cards + nodes + recent jobs |
| `web/app/dashboard/nodes/page.tsx` | All nodes table |
| `web/app/dashboard/jobs/page.tsx` | Jobs table with filter |
| `web/app/dashboard/ledger/page.tsx` | Ledger transactions |
| `web/app/dashboard/logs/page.tsx` | Live log viewer |
| `web/components/Sidebar.tsx` | Dark sidebar nav component |
| `web/components/StatCard.tsx` | Metric card component |
| `web/components/NodeTable.tsx` | Nodes data table |
| `web/components/JobTable.tsx` | Jobs data table with status badges |
| `web/components/LogViewer.tsx` | Auto-refreshing log display |
| `internal/api/admin.go` | New Go: stats, nodes, jobs, ledger endpoints |
| `internal/api/server.go` | Modified: add admin routes |
| `cmd/server/main.go` | Modified: add slog JSON file logging |

---

## Phase 0 — Go Admin Endpoints + Logging

### Task 1: enigma-server admin endpoints

**Files:**
- Create: `internal/api/admin.go`
- Modify: `internal/api/server.go`

- [ ] **Step 1: Write admin.go**

`internal/api/admin.go`:
```go
package api

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
)

type adminHandler struct {
	db *sql.DB
}

func (h *adminHandler) stats(w http.ResponseWriter, r *http.Request) {
	var stats struct {
		NodesOnline int     `json:"nodes_online"`
		JobsTotal   int     `json:"jobs_total"`
		ENITotal    float64 `json:"eni_total"`
		JobsLastHour int    `json:"jobs_last_hour"`
	}

	h.db.QueryRowContext(r.Context(),
		`SELECT COUNT(*) FROM nodes WHERE status='online'`).Scan(&stats.NodesOnline)
	h.db.QueryRowContext(r.Context(),
		`SELECT COUNT(*) FROM jobs`).Scan(&stats.JobsTotal)
	h.db.QueryRowContext(r.Context(),
		`SELECT COALESCE(SUM(amount),0) FROM ledger`).Scan(&stats.ENITotal)
	h.db.QueryRowContext(r.Context(),
		`SELECT COUNT(*) FROM jobs WHERE created_at > datetime('now','-1 hour')`).Scan(&stats.JobsLastHour)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(stats)
}

func (h *adminHandler) nodes(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.QueryContext(r.Context(),
		`SELECT id, address, backend, models, gpu_model, benchmark_score, avg_rating, reliability, status, last_heartbeat
		 FROM nodes ORDER BY benchmark_score DESC`)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type Node struct {
		ID             string  `json:"id"`
		Address        string  `json:"address"`
		Backend        string  `json:"backend"`
		Models         string  `json:"models"`
		GPUModel       string  `json:"gpu_model"`
		BenchmarkScore float64 `json:"benchmark_score"`
		AvgRating      float64 `json:"avg_rating"`
		Reliability    float64 `json:"reliability"`
		Status         string  `json:"status"`
		LastHeartbeat  string  `json:"last_heartbeat"`
	}

	var nodes []Node
	for rows.Next() {
		var n Node
		rows.Scan(&n.ID, &n.Address, &n.Backend, &n.Models, &n.GPUModel,
			&n.BenchmarkScore, &n.AvgRating, &n.Reliability, &n.Status, &n.LastHeartbeat)
		nodes = append(nodes, n)
	}
	if nodes == nil {
		nodes = []Node{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(nodes)
}

func (h *adminHandler) jobs(w http.ResponseWriter, r *http.Request) {
	limit := 50
	if l := r.URL.Query().Get("limit"); l != "" {
		if v, err := strconv.Atoi(l); err == nil && v > 0 && v <= 200 {
			limit = v
		}
	}

	rows, err := h.db.QueryContext(r.Context(),
		`SELECT id, prompt, model, status, COALESCE(assigned_node,''), COALESCE(result,''),
		 COALESCE(duration_ms,0), created_at, COALESCE(completed_at,'')
		 FROM jobs ORDER BY created_at DESC LIMIT ?`, limit)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type Job struct {
		ID           string `json:"id"`
		Prompt       string `json:"prompt"`
		Model        string `json:"model"`
		Status       string `json:"status"`
		AssignedNode string `json:"assigned_node"`
		Result       string `json:"result"`
		DurationMs   int64  `json:"duration_ms"`
		CreatedAt    string `json:"created_at"`
		CompletedAt  string `json:"completed_at"`
	}

	var jobs []Job
	for rows.Next() {
		var j Job
		rows.Scan(&j.ID, &j.Prompt, &j.Model, &j.Status, &j.AssignedNode,
			&j.Result, &j.DurationMs, &j.CreatedAt, &j.CompletedAt)
		jobs = append(jobs, j)
	}
	if jobs == nil {
		jobs = []Job{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(jobs)
}

func (h *adminHandler) ledger(w http.ResponseWriter, r *http.Request) {
	limit := 50
	if l := r.URL.Query().Get("limit"); l != "" {
		if v, err := strconv.Atoi(l); err == nil && v > 0 && v <= 200 {
			limit = v
		}
	}

	rows, err := h.db.QueryContext(r.Context(),
		`SELECT id, node_id, amount, reason, created_at FROM ledger ORDER BY created_at DESC LIMIT ?`, limit)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type Entry struct {
		ID        int64   `json:"id"`
		NodeID    string  `json:"node_id"`
		Amount    float64 `json:"amount"`
		Reason    string  `json:"reason"`
		CreatedAt string  `json:"created_at"`
	}

	var entries []Entry
	for rows.Next() {
		var e Entry
		rows.Scan(&e.ID, &e.NodeID, &e.Amount, &e.Reason, &e.CreatedAt)
		entries = append(entries, e)
	}
	if entries == nil {
		entries = []Entry{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(entries)
}
```

- [ ] **Step 2: Wire admin routes in server.go**

Add to `NewServer()` in `internal/api/server.go`, after the existing route registrations:

```go
adminH := &adminHandler{db: db}
mux.HandleFunc("GET /api/v1/admin/stats", adminH.stats)
mux.HandleFunc("GET /api/v1/admin/nodes", adminH.nodes)
mux.HandleFunc("GET /api/v1/admin/jobs", adminH.jobs)
mux.HandleFunc("GET /api/v1/admin/ledger", adminH.ledger)
```

- [ ] **Step 3: Build + smoke test**

```bash
cd /media/volker/6CBA2E09BA2DCFFE/claude.code.work/claude.code.work/enigma
/home/volker/go/bin/go build -o bin/enigma-server ./cmd/server
./bin/enigma-server -db enigma.db &
sleep 1
# Test admin endpoints (requires enigma.db from previous session)
curl -s http://localhost:8080/api/v1/admin/stats
# Expected: {"nodes_online":0,"jobs_total":N,"eni_total":N,"jobs_last_hour":0}
curl -s http://localhost:8080/api/v1/admin/nodes | head -c 100
# Expected: JSON array
pkill enigma-server
```

- [ ] **Step 4: Add JSON file logging to enigma-server**

Modify `cmd/server/main.go` — replace the existing content with:

```go
package main

import (
	"context"
	"enigma/internal/api"
	"enigma/internal/db"
	"flag"
	"log"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
)

func main() {
	dbPath := flag.String("db", "enigma.db", "SQLite database path")
	addr := flag.String("addr", ":8080", "Listen address")
	logPath := flag.String("log", "enigma.log", "JSON log file path")
	flag.Parse()

	// JSON structured logging to file + stderr
	logFile, err := os.OpenFile(*logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
	if err != nil {
		log.Fatalf("failed to open log file: %v", err)
	}
	defer logFile.Close()

	logger := slog.New(slog.NewJSONHandler(logFile, nil))
	slog.SetDefault(logger)

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
```

- [ ] **Step 5: Build and verify**

```bash
/home/volker/go/bin/go build -o bin/enigma-server ./cmd/server
./bin/enigma-server -db enigma.db -log enigma.log &
sleep 1
cat enigma.log
# Expected: {"time":"...","level":"INFO","msg":"enigma-server starting","addr":":8080",...}
pkill enigma-server
```

- [ ] **Step 6: Commit**

```bash
git add internal/api/admin.go internal/api/server.go cmd/server/main.go
git commit -m "feat(enigma): admin endpoints (stats/nodes/jobs/ledger) + slog JSON file logging"
```

---

## Phase 1 — Next.js Setup

### Task 2: Next.js project scaffold

**Files:**
- Create: `web/package.json`
- Create: `web/next.config.ts`
- Create: `web/tsconfig.json`
- Create: `web/.env.local.example`

- [ ] **Step 1: Create web directory and package.json**

```bash
cd /media/volker/6CBA2E09BA2DCFFE/claude.code.work/claude.code.work/enigma
mkdir -p web
```

`web/package.json`:
```json
{
  "name": "enigma-web",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev --port 3000",
    "build": "next build",
    "start": "next start --port 3000",
    "db:generate": "prisma generate",
    "db:migrate": "prisma migrate dev"
  },
  "dependencies": {
    "next": "15.3.2",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "next-auth": "^5.0.0-beta.25",
    "@auth/prisma-adapter": "^2.9.1",
    "@prisma/client": "^6.8.2",
    "prisma": "^6.8.2"
  },
  "devDependencies": {
    "@types/node": "^22",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "typescript": "^5",
    "@tailwindcss/postcss": "^4",
    "tailwindcss": "^4"
  }
}
```

- [ ] **Step 2: Create next.config.ts**

`web/next.config.ts`:
```typescript
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  env: {
    ENIGMA_SERVER_URL: process.env.ENIGMA_SERVER_URL ?? 'http://localhost:8080',
  },
}

export default nextConfig
```

- [ ] **Step 3: Create tsconfig.json**

`web/tsconfig.json`:
```json
{
  "compilerOptions": {
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4: Create Tailwind CSS config**

`web/postcss.config.mjs`:
```js
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
}
export default config
```

`web/app/globals.css`:
```css
@import "tailwindcss";

:root {
  --sidebar-bg: #0f172a;
  --sidebar-width: 220px;
}

body {
  background: #0f172a;
  color: #e2e8f0;
}
```

- [ ] **Step 5: Create .env.local.example**

`web/.env.local.example`:
```bash
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=run-openssl-rand-base64-32
AUTH_GOOGLE_ID=your-google-client-id
AUTH_GOOGLE_SECRET=your-google-client-secret
AUTH_GITHUB_ID=your-github-client-id
AUTH_GITHUB_SECRET=your-github-client-secret
DATABASE_URL=file:./web.db
ENIGMA_SERVER_URL=http://localhost:8080
ENIGMA_LOG_PATH=../enigma.log
```

Copy to `.env.local` and fill in real values before running.

- [ ] **Step 6: Add web/ to Makefile**

In `Makefile`, add after the existing targets:

```makefile
web-install:
	cd web && npm install

web-dev: web-install
	cd web && npm run dev

web-db:
	cd web && npx prisma migrate dev --name init
```

- [ ] **Step 7: Install dependencies**

```bash
cd /media/volker/6CBA2E09BA2DCFFE/claude.code.work/claude.code.work/enigma/web
. /home/volker/.nvm/nvm.sh && npm install
```

Expected: `node_modules/` created, no errors.

- [ ] **Step 8: Commit**

```bash
cd /media/volker/6CBA2E09BA2DCFFE/claude.code.work/claude.code.work/enigma
echo "web/node_modules/" >> .gitignore
echo "web/.next/" >> .gitignore
echo "web/web.db" >> .gitignore
echo "web/.env.local" >> .gitignore
git add web/ .gitignore Makefile
git commit -m "chore(web): scaffold Next.js 15 project with Tailwind + NextAuth + Prisma"
```

---

### Task 3: Prisma schema + database

**Files:**
- Create: `web/prisma/schema.prisma`
- Create: `web/lib/prisma.ts`

- [ ] **Step 1: Write Prisma schema**

`web/prisma/schema.prisma`:
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

model User {
  id           String              @id @default(cuid())
  email        String              @unique
  name         String?
  image        String?
  role         Role                @default(USER)
  eniBalance   Float               @default(10.0)
  nodeId       String?
  createdAt    DateTime            @default(now())
  accounts     Account[]
  transactions WalletTransaction[]
}

enum Role {
  USER
  PROVIDER
  ADMIN
}

model Account {
  id                String  @id @default(cuid())
  userId            String
  provider          String
  providerAccountId String
  type              String
  access_token      String?
  refresh_token     String?
  expires_at        Int?
  user              User    @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId])
}

model WalletTransaction {
  id        Int      @id @default(autoincrement())
  userId    String
  amount    Float
  reason    String
  jobId     String?
  createdAt DateTime @default(now())
  user      User     @relation(fields: [userId], references: [id])
}
```

- [ ] **Step 2: Write Prisma client singleton**

`web/lib/prisma.ts`:
```typescript
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({ log: ['error'] })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
```

- [ ] **Step 3: Generate Prisma client + create database**

```bash
cd /media/volker/6CBA2E09BA2DCFFE/claude.code.work/claude.code.work/enigma/web
. /home/volker/.nvm/nvm.sh
# Copy .env.local.example if .env.local doesn't exist yet
cp .env.local.example .env.local
# Generate client
npx prisma generate
# Create database
npx prisma migrate dev --name init
```

Expected output: `Your database is now in sync with your schema.`

- [ ] **Step 4: Commit**

```bash
cd ..
git add web/prisma/ web/lib/prisma.ts
git commit -m "feat(web): Prisma schema — User, Account, WalletTransaction"
```

---

### Task 4: NextAuth.js v5 config + auth pages

**Files:**
- Create: `web/lib/auth.ts`
- Create: `web/app/api/auth/[...nextauth]/route.ts`
- Create: `web/app/(auth)/login/page.tsx`
- Create: `web/app/(auth)/join/user/page.tsx`
- Create: `web/app/(auth)/join/provider/page.tsx`
- Create: `web/app/onboard/page.tsx`
- Create: `web/app/layout.tsx`

- [ ] **Step 1: Write NextAuth config**

`web/lib/auth.ts`:
```typescript
import NextAuth from 'next-auth'
import Google from 'next-auth/providers/google'
import GitHub from 'next-auth/providers/github'
import { PrismaAdapter } from '@auth/prisma-adapter'
import { prisma } from './prisma'

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [Google, GitHub],
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/login',
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as { role?: string }).role ?? 'USER'
        token.id = user.id
      }
      return token
    },
    async session({ session, token }) {
      session.user.role = token.role as string
      session.user.id = token.id as string
      return session
    },
  },
})
```

`web/lib/auth.ts` also needs a type augmentation — add to `web/types/next-auth.d.ts`:

`web/types/next-auth.d.ts`:
```typescript
import type { DefaultSession } from 'next-auth'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      role: string
    } & DefaultSession['user']
  }
}
```

- [ ] **Step 2: Write NextAuth route handler**

`web/app/api/auth/[...nextauth]/route.ts`:
```typescript
import { handlers } from '@/lib/auth'
export const { GET, POST } = handlers
```

- [ ] **Step 3: Write root layout**

`web/app/layout.tsx`:
```typescript
import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Enigma Network',
  description: 'Decentralized AI Compute Network',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  )
}
```

- [ ] **Step 4: Write login page**

`web/app/(auth)/login/page.tsx`:
```typescript
import { signIn } from '@/lib/auth'

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#0f172a' }}>
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-8 w-full max-w-sm">
        <h1 className="text-2xl font-bold text-white mb-2">Enigma Network</h1>
        <p className="text-slate-400 text-sm mb-8">Melde dich an um fortzufahren</p>

        <form action={async () => {
          'use server'
          await signIn('google', { redirectTo: '/dashboard' })
        }}>
          <button type="submit"
            className="w-full bg-white text-slate-900 font-medium py-2.5 px-4 rounded-lg hover:bg-slate-100 transition mb-3 flex items-center justify-center gap-2">
            <span>Mit Google anmelden</span>
          </button>
        </form>

        <form action={async () => {
          'use server'
          await signIn('github', { redirectTo: '/dashboard' })
        }}>
          <button type="submit"
            className="w-full bg-slate-700 text-white font-medium py-2.5 px-4 rounded-lg hover:bg-slate-600 transition flex items-center justify-center gap-2">
            <span>Mit GitHub anmelden</span>
          </button>
        </form>

        <p className="text-slate-500 text-xs text-center mt-6">
          Noch kein Konto?{' '}
          <a href="/join/user" className="text-green-400 hover:underline">Als User registrieren</a>
          {' · '}
          <a href="/join/provider" className="text-green-400 hover:underline">Als Provider</a>
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Write join/user page**

`web/app/(auth)/join/user/page.tsx`:
```typescript
import { signIn } from '@/lib/auth'

export default function JoinUserPage() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#0f172a' }}>
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-8 w-full max-w-sm">
        <div className="bg-blue-900/30 border border-blue-700 rounded-lg px-4 py-3 mb-6">
          <p className="text-blue-300 text-sm font-medium">👤 User-Account</p>
          <p className="text-blue-400 text-xs mt-1">Du erhältst 10 ENI Startguthaben und kannst sofort AI-Anfragen stellen.</p>
        </div>

        <h1 className="text-xl font-bold text-white mb-6">Als User registrieren</h1>

        <form action={async () => {
          'use server'
          await signIn('google', { redirectTo: '/onboard?role=USER' })
        }}>
          <button type="submit"
            className="w-full bg-white text-slate-900 font-medium py-2.5 px-4 rounded-lg hover:bg-slate-100 transition mb-3">
            Mit Google registrieren
          </button>
        </form>

        <form action={async () => {
          'use server'
          await signIn('github', { redirectTo: '/onboard?role=USER' })
        }}>
          <button type="submit"
            className="w-full bg-slate-700 text-white font-medium py-2.5 px-4 rounded-lg hover:bg-slate-600 transition">
            Mit GitHub registrieren
          </button>
        </form>

        <p className="text-slate-500 text-xs text-center mt-6">
          <a href="/join/provider" className="text-green-400 hover:underline">Ich bin Provider</a>
          {' · '}
          <a href="/login" className="text-slate-400 hover:underline">Einloggen</a>
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Write join/provider page**

`web/app/(auth)/join/provider/page.tsx`:
```typescript
import { signIn } from '@/lib/auth'

export default function JoinProviderPage() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#0f172a' }}>
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-8 w-full max-w-sm">
        <div className="bg-green-900/30 border border-green-700 rounded-lg px-4 py-3 mb-6">
          <p className="text-green-300 text-sm font-medium">🖥️ Provider-Account</p>
          <p className="text-green-400 text-xs mt-1">Stelle deinen LLM bereit und verdiene ENI-Token für jede Anfrage.</p>
        </div>

        <h1 className="text-xl font-bold text-white mb-6">Als Provider registrieren</h1>

        <form action={async () => {
          'use server'
          await signIn('google', { redirectTo: '/onboard?role=PROVIDER' })
        }}>
          <button type="submit"
            className="w-full bg-white text-slate-900 font-medium py-2.5 px-4 rounded-lg hover:bg-slate-100 transition mb-3">
            Mit Google registrieren
          </button>
        </form>

        <form action={async () => {
          'use server'
          await signIn('github', { redirectTo: '/onboard?role=PROVIDER' })
        }}>
          <button type="submit"
            className="w-full bg-slate-700 text-white font-medium py-2.5 px-4 rounded-lg hover:bg-slate-600 transition">
            Mit GitHub registrieren
          </button>
        </form>

        <p className="text-slate-500 text-xs text-center mt-6">
          <a href="/join/user" className="text-blue-400 hover:underline">Ich bin User</a>
          {' · '}
          <a href="/login" className="text-slate-400 hover:underline">Einloggen</a>
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 7: Write onboard route (role assignment)**

`web/app/onboard/page.tsx`:
```typescript
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'

export default async function OnboardPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>
}) {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')

  const params = await searchParams
  const requestedRole = params.role === 'PROVIDER' ? 'PROVIDER' : 'USER'

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { transactions: { where: { reason: 'start_bonus' } } },
  })

  if (!user) redirect('/login')

  // Set role if different from default (only upgrade, don't downgrade ADMIN)
  if (user.role !== 'ADMIN' && user.role !== requestedRole) {
    await prisma.user.update({
      where: { id: user.id },
      data: { role: requestedRole },
    })
  }

  // Grant start bonus to new USERs only (once)
  if (requestedRole === 'USER' && user.transactions.length === 0) {
    await prisma.walletTransaction.create({
      data: {
        userId: user.id,
        amount: 10.0,
        reason: 'start_bonus',
      },
    })
  }

  redirect(requestedRole === 'PROVIDER' ? '/setup' : '/dashboard')
}
```

- [ ] **Step 8: Write middleware**

`web/middleware.ts`:
```typescript
import { auth } from '@/lib/auth'
import { NextResponse } from 'next/server'

export default auth((req) => {
  const { nextUrl, auth: session } = req

  const isLoggedIn = !!session?.user
  const isProtected =
    nextUrl.pathname.startsWith('/dashboard') ||
    nextUrl.pathname.startsWith('/profile') ||
    nextUrl.pathname.startsWith('/setup') ||
    nextUrl.pathname === '/onboard'

  if (isProtected && !isLoggedIn) {
    return NextResponse.redirect(new URL('/login', nextUrl))
  }

  if (
    nextUrl.pathname.startsWith('/setup') &&
    session?.user?.role !== 'PROVIDER' &&
    session?.user?.role !== 'ADMIN'
  ) {
    return NextResponse.redirect(new URL('/dashboard', nextUrl))
  }

  return NextResponse.next()
})

export const config = {
  matcher: ['/dashboard/:path*', '/profile', '/setup/:path*', '/onboard'],
}
```

- [ ] **Step 9: Verify it builds**

```bash
cd /media/volker/6CBA2E09BA2DCFFE/claude.code.work/claude.code.work/enigma/web
. /home/volker/.nvm/nvm.sh
npm run build 2>&1 | tail -20
```

Expected: Build completes (may have warnings about missing Google/GitHub env vars — that's fine).

- [ ] **Step 10: Commit**

```bash
cd ..
git add web/lib/auth.ts web/types/ web/app/ web/middleware.ts
git commit -m "feat(web): NextAuth.js v5 — OAuth login, join/user, join/provider, onboard, middleware"
```

---

### Task 5: Profile page

**Files:**
- Create: `web/app/profile/page.tsx`

- [ ] **Step 1: Write profile page**

`web/app/profile/page.tsx`:
```typescript
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { signOut } from '@/lib/auth'

export default async function ProfilePage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: {
      transactions: {
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
    },
  })

  if (!user) redirect('/login')

  const balance = user.transactions.reduce((sum, t) => sum + t.amount, 0)

  return (
    <div className="min-h-screen p-8" style={{ background: '#0f172a' }}>
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold text-white">Mein Account</h1>
          <div className="flex gap-3">
            <a href="/dashboard" className="text-slate-400 hover:text-white text-sm">← Dashboard</a>
            <form action={async () => {
              'use server'
              await signOut({ redirectTo: '/login' })
            }}>
              <button type="submit" className="text-red-400 hover:text-red-300 text-sm">
                Abmelden
              </button>
            </form>
          </div>
        </div>

        {/* Account Info */}
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 mb-6">
          <div className="flex items-center gap-4 mb-4">
            {user.image && (
              <img src={user.image} alt="" className="w-12 h-12 rounded-full" />
            )}
            <div>
              <p className="text-white font-medium">{user.name ?? 'Unbekannt'}</p>
              <p className="text-slate-400 text-sm">{user.email}</p>
            </div>
            <span className={`ml-auto text-xs px-2 py-1 rounded-full font-medium ${
              user.role === 'PROVIDER' ? 'bg-green-900 text-green-300' :
              user.role === 'ADMIN' ? 'bg-purple-900 text-purple-300' :
              'bg-blue-900 text-blue-300'
            }`}>
              {user.role}
            </span>
          </div>
          <div className="bg-slate-900 rounded-lg p-4 flex items-center justify-between">
            <span className="text-slate-400 text-sm">ENI-Balance</span>
            <span className="text-yellow-400 font-bold text-xl">{balance.toFixed(2)} ENI</span>
          </div>
        </div>

        {/* Transaction History */}
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
          <h2 className="text-white font-semibold mb-4">Letzte Transaktionen</h2>
          {user.transactions.length === 0 ? (
            <p className="text-slate-500 text-sm">Keine Transaktionen</p>
          ) : (
            <div className="space-y-2">
              {user.transactions.map((tx) => (
                <div key={tx.id} className="flex items-center justify-between py-2 border-b border-slate-700 last:border-0">
                  <div>
                    <p className="text-slate-300 text-sm">{tx.reason}</p>
                    <p className="text-slate-500 text-xs">
                      {new Date(tx.createdAt).toLocaleString('de-DE')}
                    </p>
                  </div>
                  <span className={`font-medium text-sm ${tx.amount >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {tx.amount >= 0 ? '+' : ''}{tx.amount.toFixed(2)} ENI
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
cd /media/volker/6CBA2E09BA2DCFFE/claude.code.work/claude.code.work/enigma
git add web/app/profile/
git commit -m "feat(web): profile page — account info, ENI balance, transaction history"
```

---

## Phase 2 — Dashboard

### Task 6: enigma-server API client + admin proxy routes

**Files:**
- Create: `web/lib/enigma.ts`
- Create: `web/app/api/admin/stats/route.ts`
- Create: `web/app/api/admin/nodes/route.ts`
- Create: `web/app/api/admin/jobs/route.ts`
- Create: `web/app/api/admin/ledger/route.ts`
- Create: `web/app/api/admin/logs/route.ts`

- [ ] **Step 1: Write enigma API client**

`web/lib/enigma.ts`:
```typescript
const BASE = process.env.ENIGMA_SERVER_URL ?? 'http://localhost:8080'

export async function fetchStats() {
  const res = await fetch(`${BASE}/api/v1/admin/stats`, { next: { revalidate: 0 } })
  if (!res.ok) throw new Error('enigma-server unreachable')
  return res.json() as Promise<{
    nodes_online: number
    jobs_total: number
    eni_total: number
    jobs_last_hour: number
  }>
}

export async function fetchNodes() {
  const res = await fetch(`${BASE}/api/v1/admin/nodes`, { next: { revalidate: 0 } })
  if (!res.ok) throw new Error('enigma-server unreachable')
  return res.json() as Promise<EnigmaNode[]>
}

export async function fetchJobs(limit = 50) {
  const res = await fetch(`${BASE}/api/v1/admin/jobs?limit=${limit}`, { next: { revalidate: 0 } })
  if (!res.ok) throw new Error('enigma-server unreachable')
  return res.json() as Promise<EnigmaJob[]>
}

export async function fetchLedger(limit = 50) {
  const res = await fetch(`${BASE}/api/v1/admin/ledger?limit=${limit}`, { next: { revalidate: 0 } })
  if (!res.ok) throw new Error('enigma-server unreachable')
  return res.json() as Promise<EnigmaLedgerEntry[]>
}

export interface EnigmaNode {
  id: string
  address: string
  backend: string
  models: string
  gpu_model: string
  benchmark_score: number
  avg_rating: number
  reliability: number
  status: string
  last_heartbeat: string
}

export interface EnigmaJob {
  id: string
  prompt: string
  model: string
  status: string
  assigned_node: string
  result: string
  duration_ms: number
  created_at: string
  completed_at: string
}

export interface EnigmaLedgerEntry {
  id: number
  node_id: string
  amount: number
  reason: string
  created_at: string
}
```

- [ ] **Step 2: Write admin proxy API routes**

`web/app/api/admin/stats/route.ts`:
```typescript
import { auth } from '@/lib/auth'
import { fetchStats } from '@/lib/enigma'
import { NextResponse } from 'next/server'

export async function GET() {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    return NextResponse.json(await fetchStats())
  } catch {
    return NextResponse.json({ error: 'enigma-server unavailable' }, { status: 503 })
  }
}
```

`web/app/api/admin/nodes/route.ts`:
```typescript
import { auth } from '@/lib/auth'
import { fetchNodes } from '@/lib/enigma'
import { NextResponse } from 'next/server'

export async function GET() {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    return NextResponse.json(await fetchNodes())
  } catch {
    return NextResponse.json({ error: 'enigma-server unavailable' }, { status: 503 })
  }
}
```

`web/app/api/admin/jobs/route.ts`:
```typescript
import { auth } from '@/lib/auth'
import { fetchJobs } from '@/lib/enigma'
import { NextResponse } from 'next/server'

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const limit = Number(new URL(req.url).searchParams.get('limit') ?? '50')
  try {
    return NextResponse.json(await fetchJobs(limit))
  } catch {
    return NextResponse.json({ error: 'enigma-server unavailable' }, { status: 503 })
  }
}
```

`web/app/api/admin/ledger/route.ts`:
```typescript
import { auth } from '@/lib/auth'
import { fetchLedger } from '@/lib/enigma'
import { NextResponse } from 'next/server'

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const limit = Number(new URL(req.url).searchParams.get('limit') ?? '50')
  try {
    return NextResponse.json(await fetchLedger(limit))
  } catch {
    return NextResponse.json({ error: 'enigma-server unavailable' }, { status: 503 })
  }
}
```

`web/app/api/admin/logs/route.ts`:
```typescript
import { auth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'

export async function GET() {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const logPath = resolve(process.env.ENIGMA_LOG_PATH ?? '../enigma.log')

  if (!existsSync(logPath)) {
    return NextResponse.json({ lines: [] })
  }

  try {
    const content = readFileSync(logPath, 'utf-8')
    const lines = content.trim().split('\n').slice(-100).filter(Boolean)
    return NextResponse.json({ lines })
  } catch {
    return NextResponse.json({ lines: [] })
  }
}
```

- [ ] **Step 3: Commit**

```bash
cd /media/volker/6CBA2E09BA2DCFFE/claude.code.work/claude.code.work/enigma
git add web/lib/enigma.ts web/app/api/admin/
git commit -m "feat(web): enigma API client + admin proxy routes (stats/nodes/jobs/ledger/logs)"
```

---

### Task 7: Sidebar + shared components

**Files:**
- Create: `web/components/Sidebar.tsx`
- Create: `web/components/StatCard.tsx`
- Create: `web/app/dashboard/layout.tsx`

- [ ] **Step 1: Write Sidebar component**

`web/components/Sidebar.tsx`:
```typescript
'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const links = [
  { href: '/dashboard', label: 'Overview', icon: '📊' },
  { href: '/dashboard/nodes', label: 'Nodes', icon: '🖥️' },
  { href: '/dashboard/jobs', label: 'Jobs', icon: '⚡' },
  { href: '/dashboard/ledger', label: 'Ledger', icon: '💰' },
  { href: '/dashboard/logs', label: 'Logs', icon: '📄' },
]

export function Sidebar({ userEmail }: { userEmail?: string | null }) {
  const pathname = usePathname()

  return (
    <aside style={{ width: '220px', minHeight: '100vh', background: '#0f172a', borderRight: '1px solid #1e293b', flexShrink: 0 }}
      className="flex flex-col">
      <div className="p-4 border-b border-slate-800">
        <span className="text-green-400 font-bold text-sm tracking-wider">ENIGMA</span>
      </div>

      <nav className="flex-1 p-2">
        {links.map((link) => {
          const isActive = pathname === link.href ||
            (link.href !== '/dashboard' && pathname.startsWith(link.href))
          return (
            <Link key={link.href} href={link.href}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg mb-1 text-sm transition-colors ${
                isActive
                  ? 'bg-slate-700 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}>
              <span>{link.icon}</span>
              <span>{link.label}</span>
            </Link>
          )
        })}
      </nav>

      <div className="p-4 border-t border-slate-800">
        <Link href="/profile" className="text-slate-500 hover:text-slate-300 text-xs truncate block">
          {userEmail ?? 'Account'}
        </Link>
      </div>
    </aside>
  )
}
```

- [ ] **Step 2: Write StatCard component**

`web/components/StatCard.tsx`:
```typescript
export function StatCard({
  label, value, color = 'text-white'
}: {
  label: string
  value: string | number
  color?: string
}) {
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 text-center">
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <p className="text-slate-400 text-xs mt-1">{label}</p>
    </div>
  )
}
```

- [ ] **Step 3: Write dashboard layout**

`web/app/dashboard/layout.tsx`:
```typescript
import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { Sidebar } from '@/components/Sidebar'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.user) redirect('/login')

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#0f172a' }}>
      <Sidebar userEmail={session.user.email} />
      <main className="flex-1 p-6 overflow-auto">
        {children}
      </main>
    </div>
  )
}
```

- [ ] **Step 4: Commit**

```bash
cd /media/volker/6CBA2E09BA2DCFFE/claude.code.work/claude.code.work/enigma
git add web/components/Sidebar.tsx web/components/StatCard.tsx web/app/dashboard/layout.tsx
git commit -m "feat(web): Sidebar + StatCard components + dashboard layout"
```

---

### Task 8: Dashboard overview page

**Files:**
- Create: `web/app/dashboard/page.tsx`

- [ ] **Step 1: Write overview page**

`web/app/dashboard/page.tsx`:
```typescript
import { StatCard } from '@/components/StatCard'

// Server component — fetch directly from enigma-server (no auth loop)
import { fetchStats, fetchNodes, fetchJobs, EnigmaNode, EnigmaJob } from '@/lib/enigma'

export default async function DashboardPage() {
  const [stats, nodes, jobs] = await Promise.all([
    fetchStats().catch(() => null),
    fetchNodes().catch(() => []),
    fetchJobs(5).catch(() => []),
  ])

  return (
    <div>
      <h1 className="text-xl font-bold text-white mb-6">Overview</h1>

      {/* Stat Cards */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <StatCard label="Nodes Online" value={stats?.nodes_online ?? '–'} color="text-green-400" />
        <StatCard label="Jobs gesamt" value={stats?.jobs_total ?? '–'} color="text-blue-400" />
        <StatCard label="ENI vergeben" value={stats ? stats.eni_total.toFixed(1) : '–'} color="text-yellow-400" />
        <StatCard label="Jobs/Stunde" value={stats?.jobs_last_hour ?? '–'} color="text-purple-400" />
      </div>

      {/* Nodes */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 mb-6">
        <h2 className="text-white font-semibold mb-4">Provider Nodes</h2>
        {(nodes as EnigmaNode[]).length === 0 ? (
          <p className="text-slate-500 text-sm">Keine Nodes registriert</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-400 text-xs border-b border-slate-700">
                <th className="text-left pb-2">Adresse</th>
                <th className="text-left pb-2">Modell</th>
                <th className="text-left pb-2">Score</th>
                <th className="text-left pb-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {(nodes as EnigmaNode[]).map((node) => (
                <tr key={node.id} className="border-b border-slate-700/50">
                  <td className="py-2 text-slate-300 font-mono text-xs">{node.address}</td>
                  <td className="py-2 text-slate-300 text-xs">{JSON.parse(node.models || '[]')[0] ?? '–'}</td>
                  <td className="py-2 text-slate-300 text-xs">{(
                    node.benchmark_score * 0.4 + node.avg_rating * 0.4 + node.reliability * 0.2
                  ).toFixed(2)}</td>
                  <td className="py-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      node.status === 'online' ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'
                    }`}>
                      {node.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Recent Jobs */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
        <h2 className="text-white font-semibold mb-4">Letzte Jobs</h2>
        {(jobs as EnigmaJob[]).length === 0 ? (
          <p className="text-slate-500 text-sm">Noch keine Jobs</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-400 text-xs border-b border-slate-700">
                <th className="text-left pb-2">Prompt</th>
                <th className="text-left pb-2">Modell</th>
                <th className="text-left pb-2">Dauer</th>
                <th className="text-left pb-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {(jobs as EnigmaJob[]).map((job) => (
                <tr key={job.id} className="border-b border-slate-700/50">
                  <td className="py-2 text-slate-300 text-xs max-w-xs truncate">{job.prompt}</td>
                  <td className="py-2 text-slate-400 text-xs">{job.model || '–'}</td>
                  <td className="py-2 text-slate-400 text-xs">{job.duration_ms ? `${job.duration_ms}ms` : '–'}</td>
                  <td className="py-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      job.status === 'done' ? 'bg-green-900 text-green-300' :
                      job.status === 'running' ? 'bg-blue-900 text-blue-300' :
                      job.status === 'failed' ? 'bg-red-900 text-red-300' :
                      'bg-slate-700 text-slate-300'
                    }`}>
                      {job.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
cd /media/volker/6CBA2E09BA2DCFFE/claude.code.work/claude.code.work/enigma
git add web/app/dashboard/page.tsx
git commit -m "feat(web): dashboard overview — stat cards, nodes table, recent jobs"
```

---

### Task 9: Nodes, Jobs, Ledger, Logs pages

**Files:**
- Create: `web/app/dashboard/nodes/page.tsx`
- Create: `web/app/dashboard/jobs/page.tsx`
- Create: `web/app/dashboard/ledger/page.tsx`
- Create: `web/app/dashboard/logs/page.tsx`

- [ ] **Step 1: Write nodes page**

`web/app/dashboard/nodes/page.tsx`:
```typescript
import { fetchNodes, EnigmaNode } from '@/lib/enigma'

export const revalidate = 10

export default async function NodesPage() {
  const nodes = await fetchNodes().catch(() => [] as EnigmaNode[])

  return (
    <div>
      <h1 className="text-xl font-bold text-white mb-6">Provider Nodes</h1>
      <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-900">
            <tr className="text-slate-400 text-xs">
              <th className="text-left px-4 py-3">Adresse</th>
              <th className="text-left px-4 py-3">Backend</th>
              <th className="text-left px-4 py-3">Modelle</th>
              <th className="text-left px-4 py-3">GPU</th>
              <th className="text-left px-4 py-3">Benchmark</th>
              <th className="text-left px-4 py-3">Rating</th>
              <th className="text-left px-4 py-3">Score</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-left px-4 py-3">Heartbeat</th>
            </tr>
          </thead>
          <tbody>
            {nodes.map((node) => {
              const score = node.benchmark_score * 0.4 + node.avg_rating * 0.4 + node.reliability * 0.2
              const models = (() => { try { return JSON.parse(node.models).join(', ') } catch { return node.models } })()
              return (
                <tr key={node.id} className="border-t border-slate-700/50 hover:bg-slate-700/20">
                  <td className="px-4 py-3 text-slate-300 font-mono text-xs">{node.address}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{node.backend}</td>
                  <td className="px-4 py-3 text-slate-300 text-xs max-w-xs truncate">{models}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{node.gpu_model || '–'}</td>
                  <td className="px-4 py-3 text-slate-300 text-xs">{node.benchmark_score.toFixed(2)}</td>
                  <td className="px-4 py-3 text-slate-300 text-xs">{node.avg_rating.toFixed(2)}</td>
                  <td className="px-4 py-3 font-medium text-xs text-white">{score.toFixed(2)}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      node.status === 'online' ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'
                    }`}>● {node.status}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs">
                    {node.last_heartbeat ? new Date(node.last_heartbeat).toLocaleTimeString('de-DE') : '–'}
                  </td>
                </tr>
              )
            })}
            {nodes.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-500 text-sm">Keine Nodes</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Write jobs page**

`web/app/dashboard/jobs/page.tsx`:
```typescript
import { fetchJobs, EnigmaJob } from '@/lib/enigma'

export const revalidate = 5

const STATUS_COLORS: Record<string, string> = {
  done: 'bg-green-900 text-green-300',
  running: 'bg-blue-900 text-blue-300',
  failed: 'bg-red-900 text-red-300',
  pending: 'bg-slate-700 text-slate-300',
}

export default async function JobsPage() {
  const jobs = await fetchJobs(100).catch(() => [] as EnigmaJob[])

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-white">Jobs</h1>
        <span className="text-slate-400 text-sm">{jobs.length} Einträge</span>
      </div>

      <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-900">
            <tr className="text-slate-400 text-xs">
              <th className="text-left px-4 py-3">Prompt</th>
              <th className="text-left px-4 py-3">Modell</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-left px-4 py-3">Node</th>
              <th className="text-left px-4 py-3">Dauer</th>
              <th className="text-left px-4 py-3">Zeit</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id} className="border-t border-slate-700/50 hover:bg-slate-700/20">
                <td className="px-4 py-3 text-slate-300 text-xs max-w-xs">
                  <span title={job.prompt} className="block truncate">{job.prompt}</span>
                </td>
                <td className="px-4 py-3 text-slate-400 text-xs">{job.model || '–'}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[job.status] ?? STATUS_COLORS.pending}`}>
                    {job.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-500 font-mono text-xs">
                  {job.assigned_node ? job.assigned_node.slice(0, 8) + '…' : '–'}
                </td>
                <td className="px-4 py-3 text-slate-400 text-xs">
                  {job.duration_ms ? `${job.duration_ms}ms` : '–'}
                </td>
                <td className="px-4 py-3 text-slate-500 text-xs">
                  {new Date(job.created_at).toLocaleString('de-DE')}
                </td>
              </tr>
            ))}
            {jobs.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">Keine Jobs</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Write ledger page**

`web/app/dashboard/ledger/page.tsx`:
```typescript
import { fetchLedger, EnigmaLedgerEntry } from '@/lib/enigma'

export const revalidate = 10

export default async function LedgerPage() {
  const entries = await fetchLedger(100).catch(() => [] as EnigmaLedgerEntry[])

  const total = entries.reduce((sum, e) => sum + e.amount, 0)

  const byNode: Record<string, number> = {}
  entries.forEach((e) => {
    byNode[e.node_id] = (byNode[e.node_id] ?? 0) + e.amount
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-white">Ledger</h1>
        <span className="text-yellow-400 font-bold">{total.toFixed(2)} ENI gesamt</span>
      </div>

      {/* Per-node summary */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {Object.entries(byNode).slice(0, 6).map(([nodeId, eni]) => (
          <div key={nodeId} className="bg-slate-800 border border-slate-700 rounded-lg px-4 py-3">
            <p className="text-slate-500 font-mono text-xs truncate">{nodeId.slice(0, 12)}…</p>
            <p className="text-yellow-400 font-bold mt-1">{eni.toFixed(2)} ENI</p>
          </div>
        ))}
      </div>

      <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-900">
            <tr className="text-slate-400 text-xs">
              <th className="text-left px-4 py-3">Node</th>
              <th className="text-left px-4 py-3">Betrag</th>
              <th className="text-left px-4 py-3">Grund</th>
              <th className="text-left px-4 py-3">Zeit</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-t border-slate-700/50">
                <td className="px-4 py-3 text-slate-500 font-mono text-xs">{e.node_id.slice(0, 12)}…</td>
                <td className="px-4 py-3 text-yellow-400 font-medium text-sm">+{e.amount.toFixed(2)} ENI</td>
                <td className="px-4 py-3 text-slate-400 text-xs">{e.reason}</td>
                <td className="px-4 py-3 text-slate-500 text-xs">
                  {new Date(e.created_at).toLocaleString('de-DE')}
                </td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-500">Keine Transaktionen</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Write logs page (client component for auto-refresh)**

`web/app/dashboard/logs/page.tsx`:
```typescript
'use client'
import { useEffect, useState } from 'react'

function parseLevel(line: string): string {
  try {
    const obj = JSON.parse(line)
    return obj.level ?? 'INFO'
  } catch {
    return 'INFO'
  }
}

function formatLine(line: string): string {
  try {
    const obj = JSON.parse(line)
    const time = obj.time ? new Date(obj.time).toLocaleTimeString('de-DE') : ''
    const msg = obj.msg ?? ''
    const rest = Object.entries(obj)
      .filter(([k]) => !['time', 'level', 'msg'].includes(k))
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(' ')
    return `[${time}] ${msg}${rest ? ' ' + rest : ''}`
  } catch {
    return line
  }
}

const LEVEL_COLORS: Record<string, string> = {
  ERROR: 'text-red-400',
  WARN: 'text-yellow-400',
  INFO: 'text-green-400',
  DEBUG: 'text-slate-400',
}

export default function LogsPage() {
  const [lines, setLines] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchLogs() {
      try {
        const res = await fetch('/api/admin/logs')
        if (!res.ok) { setError('Fehler beim Laden der Logs'); return }
        const data = await res.json()
        setLines(data.lines ?? [])
        setError(null)
      } catch {
        setError('enigma-server nicht erreichbar')
      }
    }

    fetchLogs()
    const interval = setInterval(fetchLogs, 3000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-white">Logs</h1>
        <span className="text-slate-500 text-xs">Auto-refresh 3s · {lines.length} Zeilen</span>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-700 rounded-lg px-4 py-3 mb-4 text-red-300 text-sm">
          {error}
        </div>
      )}

      <div className="bg-slate-900 border border-slate-700 rounded-xl p-4 font-mono text-xs overflow-auto"
        style={{ maxHeight: '70vh' }}>
        {lines.length === 0 ? (
          <p className="text-slate-600">Keine Logs vorhanden. Warte auf enigma-server Aktivität...</p>
        ) : (
          lines.map((line, i) => {
            const level = parseLevel(line)
            return (
              <div key={i} className={`leading-6 ${LEVEL_COLORS[level] ?? 'text-slate-400'}`}>
                <span className="text-slate-600 mr-2">{i + 1}</span>
                {formatLine(line)}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Build and verify**

```bash
cd /media/volker/6CBA2E09BA2DCFFE/claude.code.work/claude.code.work/enigma/web
. /home/volker/.nvm/nvm.sh
npm run build 2>&1 | grep -E "error|Error|✓|○|●" | head -30
```

Expected: Build succeeds with route summary. No TypeScript errors.

- [ ] **Step 6: Commit**

```bash
cd ..
git add web/app/dashboard/
git commit -m "feat(web): dashboard pages — nodes, jobs, ledger, live logs"
```

---

## Phase 3 — Final wiring + test run

### Task 10: End-to-end smoke test

- [ ] **Step 1: Set up .env.local with real OAuth credentials**

Copy `web/.env.local.example` to `web/.env.local` and fill in:
- `NEXTAUTH_SECRET`: run `openssl rand -base64 32`
- `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`: from Google Cloud Console → APIs → Credentials
  - Authorized redirect URIs: `http://localhost:3000/api/auth/callback/google`
- `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET`: from GitHub → Settings → Developer settings → OAuth Apps
  - Authorization callback URL: `http://localhost:3000/api/auth/callback/github`
- `DATABASE_URL=file:./web.db`
- `ENIGMA_SERVER_URL=http://localhost:8080`
- `ENIGMA_LOG_PATH=../enigma.log`

- [ ] **Step 2: Run database migration**

```bash
cd /media/volker/6CBA2E09BA2DCFFE/claude.code.work/claude.code.work/enigma/web
. /home/volker/.nvm/nvm.sh
npx prisma migrate dev --name init
npx prisma generate
```

Expected: `web.db` created with all tables.

- [ ] **Step 3: Start enigma-server**

Terminal 1:
```bash
cd /media/volker/6CBA2E09BA2DCFFE/claude.code.work/claude.code.work/enigma
./bin/enigma-server -db enigma.db -log enigma.log
```

Expected: `{"level":"INFO","msg":"enigma-server starting",...}`

- [ ] **Step 4: Start Next.js**

Terminal 2:
```bash
cd /media/volker/6CBA2E09BA2DCFFE/claude.code.work/claude.code.work/enigma/web
. /home/volker/.nvm/nvm.sh
npm run dev
```

Expected: `▲ Next.js 15.x.x` + `Local: http://localhost:3000`

- [ ] **Step 5: Test auth flow**

1. Open `http://localhost:3000/join/user` → OAuth with Google/GitHub
2. Verify redirect to `/dashboard` after login
3. Check `/profile` shows 10.0 ENI balance
4. Open `http://localhost:3000/join/provider` in incognito → OAuth
5. Verify redirect to `/setup` (shows 404 for now — that's Phase 4)

- [ ] **Step 6: Test dashboard**

1. `http://localhost:3000/dashboard` — stat cards show data from enigma-server
2. `http://localhost:3000/dashboard/nodes` — nodes table
3. `http://localhost:3000/dashboard/jobs` — jobs table
4. `http://localhost:3000/dashboard/ledger` — ENI transactions
5. `http://localhost:3000/dashboard/logs` — log lines from enigma.log auto-refresh

- [ ] **Step 7: Final commit**

```bash
cd /media/volker/6CBA2E09BA2DCFFE/claude.code.work/claude.code.work/enigma
git add web/ enigma.log .gitignore
git commit -m "feat(web): Phase 1+2 complete — auth, dashboard, admin proxy, live logs"
```
