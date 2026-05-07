# Enigma Web — Phase 1+2 Design Spec

**Datum:** 2026-05-07
**Status:** Approved
**Scope:** Phase 1 (Auth + Accounts) + Phase 2 (Admin Dashboard)

---

## 1. Ziel

Web-Interface für das Enigma-Netzwerk mit zwei Rollen:
- **User** — registriert sich, erhält ENI-Startguthaben, kann das Netzwerk nutzen
- **Provider** — registriert sich, konfiguriert seinen LLM-Node, verdient ENI

Phase 1+2 deckt Auth, Account-Management, ENI-Wallet und Admin-Dashboard (Nodes, Jobs, Ledger, Logs).

---

## 2. Stack

| Komponente | Technologie |
|---|---|
| Framework | Next.js 15 + React 19 |
| Auth | NextAuth.js v5 (OAuth: Google + GitHub) |
| Datenbank | SQLite via Prisma 7 (`web.db`) |
| Styling | Tailwind CSS v4 |
| Layout | Dark Sidebar (VS Code-Style) |
| Sprache | TypeScript |

---

## 3. Architektur

Zwei separate Prozesse:

```
Browser → Next.js (:3000) → enigma-server (:8080)
                ↓
            web.db (SQLite)
```

**Next.js** übernimmt:
- OAuth-Auth via NextAuth.js
- User/Wallet-Verwaltung (Prisma → web.db)
- Dashboard-UI (Dark Sidebar)
- API Routes als Proxy zu enigma-server

**enigma-server** bleibt unverändert, bekommt 4 neue Read-only Admin-Endpoints.

**web.db** ist von `enigma.db` getrennt — kein Write-Konflikt.

---

## 4. Registrierung + Rollen

Separate Registrierungs-URLs für jede Rolle:

| URL | Rolle | Nach Login |
|---|---|---|
| `/join/user` | USER | → `/dashboard` |
| `/join/provider` | PROVIDER | → `/setup` (Phase 4) |
| `/login` | beide | → `/dashboard` |

**OAuth-Flow:**
1. User öffnet `/join/user` oder `/join/provider`
2. Klickt "Mit Google/GitHub anmelden"
3. OAuth-Redirect → Callback
4. NextAuth.js erstellt `users`-Eintrag mit korrekter Rolle
5. Redirect zur jeweiligen Zielseite

**Rollen:**
- `USER` — kann Jobs einreichen (Phase 3), ENI ausgeben, Balance sehen
- `PROVIDER` — kann Node konfigurieren (Phase 4), ENI verdienen, Balance sehen
- `ADMIN` — Zugriff auf vollständiges Dashboard

---

## 5. web.db Schema (Prisma)

```prisma
model User {
  id           String               @id @default(cuid())
  email        String               @unique
  name         String?
  image        String?
  role         Role                 @default(USER)
  eniBalance   Float                @default(10.0)
  nodeId       String?              // enigma-server Node-ID (nur Provider)
  createdAt    DateTime             @default(now())
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
  amount    Float                   // negativ = Abbuchung, positiv = Gutschrift
  reason    String                  // "start_bonus", "job_payment", "topup"
  jobId     String?                 // enigma-server job_id (optional)
  createdAt DateTime @default(now())
  user      User     @relation(fields: [userId], references: [id])
}
```

**Startguthaben:** Neue USER erhalten automatisch 10.0 ENI via `WalletTransaction` (reason: "start_bonus").

---

## 6. Neue enigma-server Admin-Endpoints (Go)

4 neue Read-only Endpoints in `internal/api/admin.go`:

| Method | Path | Beschreibung |
|---|---|---|
| GET | /api/v1/admin/stats | Nodes online, Jobs total, ENI total, Jobs/h |
| GET | /api/v1/admin/nodes | Alle Nodes (online + offline) mit Scores |
| GET | /api/v1/admin/jobs?limit=50 | Letzte N Jobs mit Status + Ergebnis |
| GET | /api/v1/admin/ledger?limit=50 | Letzte N ENI-Transaktionen |

Logs: enigma-server schreibt strukturierte JSON-Logs in `enigma.log`. Next.js API Route liest die letzten N Zeilen per `tail`.

---

## 7. Dashboard (Phase 2)

**Layout:** Dark Sidebar (VS Code-Style) mit folgenden Seiten:

### /dashboard — Overview
- 4 Stat-Cards: Nodes online, Jobs heute, ENI vergeben gesamt, aktive User (Jobs in letzten 24h)
- Provider-Nodes Tabelle (live, alle 10s refresh)
- Letzte 5 Jobs

### /dashboard/nodes
- Tabelle aller Nodes: ID, Adresse, Backend, Modelle, Benchmark-Score, Avg-Rating, Reliability, Status, Last Heartbeat
- Status-Badge: grün (online) / rot (offline)
- Sort nach Score

### /dashboard/jobs
- Tabelle: Job-ID, Prompt (gekürzt), Modell, Status, Node, Dauer, Zeitstempel
- Filter: all / pending / running / done / failed
- Auto-refresh alle 5s

### /dashboard/ledger
- Tabelle: Node-ID, Betrag, Grund, Zeitstempel
- Aggregiert: Total ENI pro Node

### /dashboard/logs
- Live-Log-Stream (letzte 100 Zeilen aus `enigma.log`)
- Auto-refresh alle 3s
- Monospace-Font, farbige Log-Level (INFO/WARN/ERROR)

---

## 8. Projektstruktur

```
enigma/web/
├── app/
│   ├── (auth)/
│   │   ├── join/user/page.tsx
│   │   ├── join/provider/page.tsx
│   │   └── login/page.tsx
│   ├── dashboard/
│   │   ├── layout.tsx              ← Sidebar-Layout
│   │   ├── page.tsx                ← Overview
│   │   ├── nodes/page.tsx
│   │   ├── jobs/page.tsx
│   │   ├── ledger/page.tsx
│   │   └── logs/page.tsx
│   ├── profile/page.tsx
│   ├── api/
│   │   ├── auth/[...nextauth]/route.ts
│   │   ├── admin/stats/route.ts    ← proxy → enigma-server
│   │   ├── admin/nodes/route.ts
│   │   ├── admin/jobs/route.ts
│   │   ├── admin/ledger/route.ts
│   │   └── admin/logs/route.ts     ← liest enigma.log
│   └── layout.tsx
├── components/
│   ├── Sidebar.tsx
│   ├── StatCard.tsx
│   ├── NodeTable.tsx
│   ├── JobTable.tsx
│   └── LogViewer.tsx
├── lib/
│   ├── auth.ts                     ← NextAuth.js config
│   ├── prisma.ts                   ← Prisma client singleton
│   └── enigma.ts                   ← enigma-server API client
├── prisma/
│   └── schema.prisma
├── middleware.ts                   ← Routen-Schutz
├── next.config.ts
├── package.json
└── .env.local                      ← NEXTAUTH_SECRET, OAuth credentials
```

---

## 9. Middleware (Routen-Schutz)

```typescript
// middleware.ts
export const config = {
  matcher: ['/dashboard/:path*', '/profile', '/setup/:path*']
}
// Nicht eingeloggt → /login
// /setup/** → nur PROVIDER und ADMIN
```

---

## 10. Umgebungsvariablen (.env.local)

```bash
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=<random-secret>
AUTH_GOOGLE_ID=<google-client-id>
AUTH_GOOGLE_SECRET=<google-client-secret>
AUTH_GITHUB_ID=<github-client-id>
AUTH_GITHUB_SECRET=<github-client-secret>
DATABASE_URL=file:./web.db
ENIGMA_SERVER_URL=http://localhost:8080
ENIGMA_LOG_PATH=../enigma.log
```

---

## 11. enigma-server Logging

enigma-server bekommt strukturiertes JSON-Logging in eine Datei:

```go
// cmd/server/main.go — zusätzlich zu log.Printf
// Schreibt in enigma.log:
// {"level":"INFO","ts":"2026-05-07T14:00:00Z","msg":"job completed","job_id":"...","node_id":"...","duration_ms":1200}
```

Next.js API Route `/api/admin/logs` liest die letzten 100 Zeilen per `fs.readFileSync` oder shell `tail -100`.

---

## 12. Out of Scope (Phase 1+2)

- Chat-UI (kommt Phase 3)
- Provider Node-Setup via Web (kommt Phase 4)
- ENI-Kauf / Top-up (kommt später)
- Email-Notifications
- 2FA
- Rate Limiting auf Web-Endpoints
