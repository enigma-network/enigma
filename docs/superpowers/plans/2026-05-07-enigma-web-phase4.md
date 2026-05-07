# Enigma Web Phase 4 — Provider Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Provider Setup UI at `/setup` — GPU selection, model recommendation (Tiefe/Breite), Docker Compose + install.sh generator, and a Dockerfile for enigma-node.

**Architecture:** New page `web/app/setup/page.tsx` reads GPU tier from `web/lib/gpu-tiers.ts` and lets providers select models with live VRAM tracking. Two API routes generate downloadable `docker-compose.yml` and `install.sh`. `enigma/Dockerfile` packages enigma-node as a container. No changes to enigma-server needed.

**Tech Stack:** Next.js 15, TypeScript, Tailwind CSS v4, Docker (generated config only — not executed by the server), Go multi-stage Docker build

---

## File Map

| File | Responsibility |
|---|---|
| `enigma/Dockerfile` | Multi-stage Go build — enigma-node container image |
| `web/lib/gpu-tiers.ts` | GPU tier definitions, model VRAM requirements, preset combinations |
| `web/app/api/setup/script/route.ts` | GET → returns `docker-compose.yml` as download |
| `web/app/api/setup/install/route.ts` | GET → returns `install.sh` as download |
| `web/app/setup/page.tsx` | Client component — GPU select, model checkboxes, VRAM meter, downloads, node status |
| `web/components/Sidebar.tsx` | Modified — add Setup link for PROVIDER role |
| `web/middleware.ts` | Already protects `/setup/**` for PROVIDER/ADMIN |

---

## Task 1: enigma-node Dockerfile

**Files:**
- Create: `enigma/Dockerfile`
- Create: `enigma/.dockerignore`

- [ ] **Step 1: Write Dockerfile**

`enigma/Dockerfile`:
```dockerfile
FROM golang:1.25-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o enigma-node ./cmd/node

FROM alpine:3.19
RUN apk add --no-cache ca-certificates
COPY --from=builder /app/enigma-node /usr/local/bin/enigma-node
ENTRYPOINT ["enigma-node"]
```

- [ ] **Step 2: Write .dockerignore**

`enigma/.dockerignore`:
```
web/
bin/
*.db
*.log
.git/
docs/
enigma/.superpowers/
```

- [ ] **Step 3: Build the image to verify**

```bash
cd /media/volker/6CBA2E09BA2DCFFE/claude.code.work/claude.code.work/enigma
docker build -t enigma/node:latest .
```

Expected: Image builds successfully. Check with:
```bash
docker run --rm enigma/node:latest --help
```
Expected output contains: `-server`, `-backend`, `-backend-addr` flags.

- [ ] **Step 4: Commit**

```bash
git add enigma/Dockerfile enigma/.dockerignore
git commit -m "feat(enigma): Dockerfile for enigma-node container image"
```

---

## Task 2: GPU tier definitions

**Files:**
- Create: `web/lib/gpu-tiers.ts`

- [ ] **Step 1: Write gpu-tiers.ts**

`web/lib/gpu-tiers.ts`:
```typescript
export interface Model {
  id: string          // e.g. "gemma3:12b"
  label: string       // display name
  vram: number        // GB required (4-bit quantized)
  quality: number     // 1-5 stars
}

export interface GpuPreset {
  models: string[]    // model IDs
  label: string       // e.g. "Tiefe" or "Breite"
}

export interface GpuTier {
  id: string
  label: string
  vram: number        // total available VRAM in GB (0 = CPU only)
  hasNvidia: boolean
  presets: {
    depth: GpuPreset    // one large model
    breadth: GpuPreset  // multiple small models
  }
}

export const MODELS: Model[] = [
  { id: 'phi3:mini',    label: 'Phi-3 Mini',    vram: 2,  quality: 2 },
  { id: 'gemma3:4b',   label: 'Gemma 3 4B',    vram: 3,  quality: 3 },
  { id: 'gemma3:12b',  label: 'Gemma 3 12B',   vram: 7,  quality: 4 },
  { id: 'gemma3:27b',  label: 'Gemma 3 27B',   vram: 15, quality: 5 },
]

export const GPU_TIERS: GpuTier[] = [
  {
    id: 'cpu',
    label: 'CPU only (kein GPU)',
    vram: 0,
    hasNvidia: false,
    presets: {
      depth:   { models: ['phi3:mini'], label: 'phi3:mini ×1' },
      breadth: { models: ['phi3:mini'], label: 'phi3:mini ×1' },
    },
  },
  {
    id: 'gtx1060',
    label: 'GTX 1060 / RTX 2060 (6GB)',
    vram: 6,
    hasNvidia: true,
    presets: {
      depth:   { models: ['phi3:mini'], label: 'phi3:mini ×1' },
      breadth: { models: ['phi3:mini'], label: 'phi3:mini ×1' },
    },
  },
  {
    id: 'rtx3070',
    label: 'RTX 3070 (8GB)',
    vram: 8,
    hasNvidia: true,
    presets: {
      depth:   { models: ['gemma3:4b'],              label: 'gemma3:4b ×1' },
      breadth: { models: ['phi3:mini', 'phi3:mini'], label: 'phi3:mini ×2' },
    },
  },
  {
    id: 'rtx3060',
    label: 'RTX 3060 (12GB)',
    vram: 12,
    hasNvidia: true,
    presets: {
      depth:   { models: ['gemma3:12b'],                             label: 'gemma3:12b ×1' },
      breadth: { models: ['gemma3:4b', 'gemma3:4b'],                label: 'gemma3:4b ×2' },
    },
  },
  {
    id: 'rtx3080',
    label: 'RTX 3080 (16GB)',
    vram: 16,
    hasNvidia: true,
    presets: {
      depth:   { models: ['gemma3:12b'],                                        label: 'gemma3:12b ×1' },
      breadth: { models: ['gemma3:4b', 'gemma3:4b', 'gemma3:4b'],             label: 'gemma3:4b ×3' },
    },
  },
  {
    id: 'rtx4070',
    label: 'RTX 4070 (12GB)',
    vram: 12,
    hasNvidia: true,
    presets: {
      depth:   { models: ['gemma3:12b'],              label: 'gemma3:12b ×1' },
      breadth: { models: ['gemma3:4b', 'gemma3:4b'], label: 'gemma3:4b ×2' },
    },
  },
  {
    id: 'rtx4080',
    label: 'RTX 4080 (16GB)',
    vram: 16,
    hasNvidia: true,
    presets: {
      depth:   { models: ['gemma3:12b'],                                        label: 'gemma3:12b ×1' },
      breadth: { models: ['gemma3:4b', 'gemma3:4b', 'gemma3:4b'],             label: 'gemma3:4b ×3' },
    },
  },
  {
    id: 'rtx4090',
    label: 'RTX 4090 (24GB)',
    vram: 24,
    hasNvidia: true,
    presets: {
      depth:   { models: ['gemma3:27b'],                              label: 'gemma3:27b ×1' },
      breadth: { models: ['gemma3:12b', 'gemma3:12b'],               label: 'gemma3:12b ×2' },
    },
  },
  {
    id: 'dual4090',
    label: '2× RTX 4090 (48GB)',
    vram: 48,
    hasNvidia: true,
    presets: {
      depth:   { models: ['gemma3:12b', 'gemma3:12b', 'gemma3:12b', 'gemma3:12b'], label: 'gemma3:12b ×4' },
      breadth: { models: ['gemma3:4b', 'gemma3:4b', 'gemma3:4b', 'gemma3:4b',
                           'gemma3:4b', 'gemma3:4b', 'gemma3:4b', 'gemma3:4b'], label: 'gemma3:4b ×8' },
    },
  },
]

export function getModel(id: string): Model {
  return MODELS.find(m => m.id === id) ?? { id, label: id, vram: 4, quality: 3 }
}

export function totalVram(modelIds: string[]): number {
  return modelIds.reduce((sum, id) => sum + getModel(id).vram, 0)
}

// Deduplicate for display: ["gemma3:4b","gemma3:4b","gemma3:4b"] → "gemma3:4b ×3"
export function formatModelList(modelIds: string[]): string {
  const counts: Record<string, number> = {}
  modelIds.forEach(id => { counts[id] = (counts[id] ?? 0) + 1 })
  return Object.entries(counts).map(([id, n]) => `${id}${n > 1 ? ` ×${n}` : ''}`).join(', ')
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd /media/volker/6CBA2E09BA2DCFFE/claude.code.work/claude.code.work/enigma/web
. /home/volker/.nvm/nvm.sh
npx tsc --noEmit 2>&1 | grep "gpu-tiers" | head -5
```

Expected: no errors for gpu-tiers.ts

- [ ] **Step 3: Commit**

```bash
cd /media/volker/6CBA2E09BA2DCFFE/claude.code.work/claude.code.work/enigma
git add web/lib/gpu-tiers.ts
git commit -m "feat(web): GPU tier definitions and model VRAM calculator"
```

---

## Task 3: docker-compose.yml generator API route

**Files:**
- Create: `web/app/api/setup/script/route.ts`

- [ ] **Step 1: Write the generator**

`web/app/api/setup/script/route.ts`:
```typescript
import { auth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { getModel } from '@/lib/gpu-tiers'

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'PROVIDER' && session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Provider only' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const modelsParam = searchParams.get('models') ?? 'phi3:mini'
  const serverUrl = searchParams.get('server') ?? 'http://localhost:8080'
  const gpu = searchParams.get('gpu') ?? 'cpu'
  const hasNvidia = gpu !== 'cpu' && gpu !== 'gtx1060'

  const modelIds = modelsParam.split(',').filter(Boolean)
  if (modelIds.length === 0 || modelIds.length > 8) {
    return NextResponse.json({ error: 'Invalid model count (1-8)' }, { status: 400 })
  }

  const lines: string[] = []
  lines.push('# Generated by Enigma Network')
  lines.push(`# Provider: ${session.user.email}`)
  lines.push(`# GPU: ${gpu}`)
  lines.push(`# Models: ${modelIds.join(', ')}`)
  lines.push('')
  lines.push('version: "3.8"')
  lines.push('')
  lines.push('services:')

  const volumes: string[] = []
  let port = 11434

  // Track duplicate model IDs to give them unique service names
  const seen: Record<string, number> = {}

  for (const modelId of modelIds) {
    seen[modelId] = (seen[modelId] ?? 0) + 1
    const count = seen[modelId]
    const safeName = modelId.replace(/[^a-z0-9]/g, '-')
    const suffix = count > 1 ? `-${count}` : ''
    const ollamaService = `ollama-${safeName}${suffix}`
    const nodeService = `enigma-node-${safeName}${suffix}`
    const volName = `${ollamaService}-data`
    volumes.push(volName)

    lines.push(`  ${ollamaService}:`)
    lines.push(`    image: ollama/ollama`)
    if (hasNvidia) {
      lines.push(`    runtime: nvidia`)
      lines.push(`    environment:`)
      lines.push(`      - NVIDIA_VISIBLE_DEVICES=all`)
    }
    lines.push(`    ports:`)
    lines.push(`      - "${port}:11434"`)
    lines.push(`    volumes:`)
    lines.push(`      - ${volName}:/root/.ollama`)
    lines.push(`    restart: unless-stopped`)
    lines.push(``)

    lines.push(`  ${nodeService}:`)
    lines.push(`    image: enigma/node:latest`)
    lines.push(`    command:`)
    lines.push(`      - "-server"`)
    lines.push(`      - "${serverUrl}"`)
    lines.push(`      - "-backend"`)
    lines.push(`      - "ollama"`)
    lines.push(`      - "-backend-addr"`)
    lines.push(`      - "${ollamaService}:11434"`)
    lines.push(`    depends_on:`)
    lines.push(`      - ${ollamaService}`)
    lines.push(`    restart: unless-stopped`)
    lines.push(``)

    port++
  }

  lines.push('volumes:')
  volumes.forEach(v => lines.push(`  ${v}:`))
  lines.push('')

  const yaml = lines.join('\n')

  return new Response(yaml, {
    headers: {
      'Content-Type': 'text/yaml',
      'Content-Disposition': 'attachment; filename="docker-compose.yml"',
    },
  })
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd /media/volker/6CBA2E09BA2DCFFE/claude.code.work/claude.code.work/enigma/web
. /home/volker/.nvm/nvm.sh && npm run build 2>&1 | grep -E "error|Error" | grep -v "node_modules" | head -10
```

Expected: No TypeScript errors.

- [ ] **Step 3: Commit**

```bash
cd /media/volker/6CBA2E09BA2DCFFE/claude.code.work/claude.code.work/enigma
git add web/app/api/setup/
git commit -m "feat(web): docker-compose.yml generator API route"
```

---

## Task 4: install.sh generator API route

**Files:**
- Create: `web/app/api/setup/install/route.ts`

- [ ] **Step 1: Write the generator**

`web/app/api/setup/install/route.ts`:
```typescript
import { auth } from '@/lib/auth'

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user) return new Response('Unauthorized', { status: 401 })
  if (session.user.role !== 'PROVIDER' && session.user.role !== 'ADMIN') {
    return new Response('Provider only', { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const modelsParam = searchParams.get('models') ?? 'phi3:mini'
  const serverUrl = searchParams.get('server') ?? 'http://localhost:8080'
  const gpu = searchParams.get('gpu') ?? 'cpu'
  const hasNvidia = gpu !== 'cpu' && gpu !== 'gtx1060'

  const modelIds = modelsParam.split(',').filter(Boolean)

  // Build unique list for ollama pull commands
  const uniqueModels = [...new Set(modelIds)]

  // Build service names matching docker-compose.yml logic
  const seen: Record<string, number> = {}
  const ollamaServices: string[] = []
  for (const modelId of modelIds) {
    seen[modelId] = (seen[modelId] ?? 0) + 1
    const count = seen[modelId]
    const safeName = modelId.replace(/[^a-z0-9]/g, '-')
    const suffix = count > 1 ? `-${count}` : ''
    ollamaServices.push(`ollama-${safeName}${suffix}`)
  }

  const script = `#!/bin/bash
set -e

echo "=== Enigma Node Installer ==="
echo "GPU: ${gpu}"
echo "Models: ${modelIds.join(', ')}"
echo "Server: ${serverUrl}"
echo ""

# ─── Docker installieren (wenn nicht vorhanden) ───────────────────────
if ! command -v docker &>/dev/null; then
  echo "[1/4] Docker wird installiert..."
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker $USER
  echo "Docker installiert. Bitte neu einloggen wenn Fehler auftreten."
else
  echo "[1/4] Docker bereits installiert ✓"
fi

# ─── NVIDIA Container Toolkit (nur wenn GPU vorhanden) ────────────────
${hasNvidia ? `if command -v nvidia-smi &>/dev/null; then
  echo "[2/4] NVIDIA Container Toolkit wird installiert..."
  curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
  curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \\
    sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \\
    sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
  sudo apt-get update -qq && sudo apt-get install -y nvidia-container-toolkit
  sudo nvidia-ctk runtime configure --runtime=docker
  sudo systemctl restart docker
  echo "NVIDIA Container Toolkit installiert ✓"
else
  echo "[2/4] Kein NVIDIA GPU gefunden — überspringe NVIDIA Toolkit"
fi` : 'echo "[2/4] CPU-Modus — kein NVIDIA Toolkit benötigt ✓"'}

# ─── enigma-node Image bauen ──────────────────────────────────────────
echo "[3/4] enigma-node Image wird gebaut..."
if [ -f "Dockerfile" ]; then
  docker build -t enigma/node:latest .
  echo "Image gebaut ✓"
else
  echo "Warnung: Dockerfile nicht gefunden — verwende vorhandenes Image falls vorhanden"
fi

# ─── Docker Compose starten ───────────────────────────────────────────
echo "[4/4] Container werden gestartet..."
docker compose pull ollama-* 2>/dev/null || true
docker compose up -d

# ─── Modelle laden ────────────────────────────────────────────────────
echo ""
echo "Warte auf Ollama-Start (15s)..."
sleep 15

${ollamaServices.map((svc, i) => `echo "Lade Modell: ${modelIds[i]}..."
docker compose exec -T ${svc} ollama pull ${modelIds[i]} || echo "Warnung: Modell konnte nicht geladen werden"`).join('\n')}

echo ""
echo "=== Setup abgeschlossen! ==="
echo "Deine Nodes registrieren sich jetzt bei: ${serverUrl}"
echo "Status prüfen: docker compose ps"
echo "Logs anzeigen: docker compose logs -f"
`

  return new Response(script, {
    headers: {
      'Content-Type': 'text/plain',
      'Content-Disposition': 'attachment; filename="install.sh"',
    },
  })
}
```

- [ ] **Step 2: Commit**

```bash
cd /media/volker/6CBA2E09BA2DCFFE/claude.code.work/claude.code.work/enigma
git add web/app/api/setup/install/
git commit -m "feat(web): install.sh generator API route (Docker + NVIDIA + model pull)"
```

---

## Task 5: Provider Setup page

**Files:**
- Create: `web/app/setup/page.tsx`

- [ ] **Step 1: Write the setup page**

`web/app/setup/page.tsx`:
```typescript
'use client'
import { useState, useMemo, useEffect } from 'react'
import { GPU_TIERS, MODELS, getModel, totalVram, formatModelList } from '@/lib/gpu-tiers'

const ENIGMA_SERVER = process.env.NEXT_PUBLIC_ENIGMA_SERVER_URL ?? 'http://localhost:8080'

export default function SetupPage() {
  const [gpuId, setGpuId] = useState('rtx3060')
  const [mode, setMode] = useState<'depth' | 'breadth'>('depth')
  const [selectedModels, setSelectedModels] = useState<string[]>(['gemma3:12b'])
  const [serverUrl, setServerUrl] = useState(ENIGMA_SERVER)
  const [downloading, setDownloading] = useState(false)

  const gpu = GPU_TIERS.find(g => g.id === gpuId) ?? GPU_TIERS[0]
  const usedVram = totalVram(selectedModels)
  const vramOk = gpu.vram === 0 || usedVram <= gpu.vram

  // When GPU or mode changes, reset to preset
  function applyPreset(newGpuId: string, newMode: 'depth' | 'breadth') {
    const g = GPU_TIERS.find(t => t.id === newGpuId) ?? GPU_TIERS[0]
    setSelectedModels(g.presets[newMode].models)
  }

  function onGpuChange(id: string) {
    setGpuId(id)
    applyPreset(id, mode)
  }

  function onModeChange(m: 'depth' | 'breadth') {
    setMode(m)
    applyPreset(gpuId, m)
  }

  function addModel(modelId: string) {
    setSelectedModels(prev => [...prev, modelId])
  }

  function removeModel(index: number) {
    setSelectedModels(prev => prev.filter((_, i) => i !== index))
  }

  const params = useMemo(() => new URLSearchParams({
    gpu: gpuId,
    models: selectedModels.join(','),
    server: serverUrl,
  }).toString(), [gpuId, selectedModels, serverUrl])

  async function download(type: 'script' | 'install') {
    setDownloading(true)
    try {
      const url = `/api/setup/${type}?${params}`
      const res = await fetch(url)
      const blob = await res.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = type === 'script' ? 'docker-compose.yml' : 'install.sh'
      a.click()
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="min-h-screen p-8" style={{ background: '#0f172a' }}>
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">Node Setup</h1>
            <p className="text-slate-400 text-sm mt-1">Konfiguriere deinen Provider-Node und lade das Setup-Script herunter</p>
          </div>
          <a href="/dashboard" className="text-slate-400 hover:text-white text-sm">← Dashboard</a>
        </div>

        {/* Step 1: GPU */}
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 mb-4">
          <h2 className="text-white font-semibold mb-4">1. GPU auswählen</h2>
          <select
            value={gpuId}
            onChange={e => onGpuChange(e.target.value)}
            className="w-full bg-slate-900 border border-slate-600 text-slate-200 rounded-lg px-3 py-2 text-sm"
          >
            {GPU_TIERS.map(g => (
              <option key={g.id} value={g.id}>{g.label}</option>
            ))}
          </select>
        </div>

        {/* Step 2: Mode */}
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 mb-4">
          <h2 className="text-white font-semibold mb-4">2. Strategie</h2>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => onModeChange('depth')}
              className={`p-4 rounded-lg border text-left transition-colors ${
                mode === 'depth'
                  ? 'border-green-500 bg-green-900/20 text-white'
                  : 'border-slate-600 text-slate-400 hover:border-slate-500'
              }`}
            >
              <p className="font-medium text-sm">Tiefe</p>
              <p className="text-xs mt-1 text-slate-400">Ein großes Modell — beste Qualität</p>
              <p className="text-xs text-green-400 mt-2">{gpu.presets.depth.label}</p>
            </button>
            <button
              onClick={() => onModeChange('breadth')}
              className={`p-4 rounded-lg border text-left transition-colors ${
                mode === 'breadth'
                  ? 'border-blue-500 bg-blue-900/20 text-white'
                  : 'border-slate-600 text-slate-400 hover:border-slate-500'
              }`}
            >
              <p className="font-medium text-sm">Breite</p>
              <p className="text-xs mt-1 text-slate-400">Mehrere kleine Modelle — mehr parallele Jobs</p>
              <p className="text-xs text-blue-400 mt-2">{gpu.presets.breadth.label}</p>
            </button>
          </div>
        </div>

        {/* Step 3: Model selection + VRAM meter */}
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 mb-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-white font-semibold">3. Modelle anpassen</h2>
            <div className={`text-sm font-medium ${vramOk ? 'text-green-400' : 'text-red-400'}`}>
              {gpu.vram === 0
                ? `RAM: ${usedVram * 2}GB benötigt`
                : `VRAM: ${usedVram}GB / ${gpu.vram}GB ${vramOk ? '✅' : '⚠️ Limit überschritten'}`
              }
            </div>
          </div>

          {/* Selected models */}
          <div className="space-y-2 mb-4">
            {selectedModels.map((modelId, i) => {
              const m = getModel(modelId)
              return (
                <div key={i} className="flex items-center justify-between bg-slate-900 rounded-lg px-3 py-2">
                  <div>
                    <span className="text-slate-200 text-sm">{m.label}</span>
                    <span className="text-slate-500 text-xs ml-2">{m.vram}GB VRAM · {'⭐'.repeat(m.quality)}</span>
                  </div>
                  <button
                    onClick={() => removeModel(i)}
                    className="text-red-400 hover:text-red-300 text-xs px-2 py-1"
                    disabled={selectedModels.length <= 1}
                  >
                    ✕
                  </button>
                </div>
              )
            })}
          </div>

          {/* Add model */}
          <div className="border-t border-slate-700 pt-3">
            <p className="text-slate-500 text-xs mb-2">Modell hinzufügen:</p>
            <div className="flex gap-2 flex-wrap">
              {MODELS.map(m => (
                <button
                  key={m.id}
                  onClick={() => addModel(m.id)}
                  className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 px-3 py-1.5 rounded-lg transition-colors"
                >
                  + {m.label} ({m.vram}GB)
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Step 4: Server URL */}
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 mb-4">
          <h2 className="text-white font-semibold mb-3">4. Enigma-Server URL</h2>
          <p className="text-slate-400 text-xs mb-3">Die URL unter der dein enigma-server vom Provider-PC aus erreichbar ist</p>
          <input
            type="text"
            value={serverUrl}
            onChange={e => setServerUrl(e.target.value)}
            placeholder="http://192.168.0.100:8080"
            className="w-full bg-slate-900 border border-slate-600 text-slate-200 rounded-lg px-3 py-2 text-sm font-mono"
          />
        </div>

        {/* Download */}
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 mb-6">
          <h2 className="text-white font-semibold mb-2">5. Script herunterladen</h2>
          <p className="text-slate-400 text-xs mb-4">
            Lade beide Dateien in dasselbe Verzeichnis auf deinem Provider-PC.
            Dann: <code className="bg-slate-900 px-1 rounded text-green-400">chmod +x install.sh && ./install.sh</code>
          </p>

          <div className="flex gap-3">
            <button
              onClick={() => download('script')}
              disabled={downloading || !vramOk || selectedModels.length === 0}
              className="flex-1 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium py-2.5 rounded-lg transition-colors text-sm"
            >
              📄 docker-compose.yml
            </button>
            <button
              onClick={() => download('install')}
              disabled={downloading || !vramOk || selectedModels.length === 0}
              className="flex-1 bg-green-700 hover:bg-green-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium py-2.5 rounded-lg transition-colors text-sm"
            >
              {downloading ? '⏳ Wird geladen...' : '⚡ install.sh herunterladen'}
            </button>
          </div>

          {!vramOk && (
            <p className="text-red-400 text-xs mt-3">
              ⚠️ VRAM-Limit überschritten — entferne Modelle bevor du downloadest
            </p>
          )}

          <div className="mt-4 bg-slate-900 rounded-lg p-3 text-xs font-mono text-slate-400">
            <p className="text-slate-500 mb-1"># Konfiguration:</p>
            <p>GPU: {gpu.label}</p>
            <p>Modelle: {formatModelList(selectedModels)}</p>
            <p>VRAM: {usedVram}GB</p>
            <p>Nodes: {selectedModels.length}×</p>
            <p>Server: {serverUrl}</p>
          </div>
        </div>

        {/* Node status */}
        <NodeStatus />
      </div>
    </div>
  )
}

function NodeStatus() {
  const [nodes, setNodes] = useState<{ id: string; address: string; status: string; models: string }[]>([])
  const [loading, setLoading] = useState(true)

  // Fetch on mount
  useEffect(() => {
    fetch('/api/admin/nodes')
      .then(r => r.json())
      .then(data => {
        setNodes(Array.isArray(data) ? data : [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
      <h2 className="text-white font-semibold mb-4">Registrierte Nodes (alle)</h2>
      {loading ? (
        <p className="text-slate-500 text-sm">Lädt...</p>
      ) : nodes.length === 0 ? (
        <p className="text-slate-500 text-sm">Keine Nodes registriert. Führe install.sh aus um zu starten.</p>
      ) : (
        <div className="space-y-2">
          {nodes.map(node => (
            <div key={node.id} className="flex items-center justify-between bg-slate-900 rounded-lg px-3 py-2">
              <div>
                <p className="text-slate-300 text-sm font-mono">{node.address}</p>
                <p className="text-slate-500 text-xs">{node.models}</p>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full ${
                node.status === 'online' ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'
              }`}>● {node.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Add NEXT_PUBLIC_ENIGMA_SERVER_URL to .env.local**

In `web/.env.local`, add:
```
NEXT_PUBLIC_ENIGMA_SERVER_URL=http://localhost:8080
```

- [ ] **Step 3: Build check**

```bash
cd /media/volker/6CBA2E09BA2DCFFE/claude.code.work/claude.code.work/enigma/web
. /home/volker/.nvm/nvm.sh && npm run build 2>&1 | grep -E "error|Error|Route" | grep -v "node_modules" | head -15
```

Expected: No errors. `/setup` appears in route list.

- [ ] **Step 4: Commit**

```bash
cd /media/volker/6CBA2E09BA2DCFFE/claude.code.work/claude.code.work/enigma
git add web/app/setup/ web/.env.local
git commit -m "feat(web): Provider Setup page — GPU selection, model picker, VRAM meter, script download"
```

---

## Task 6: Sidebar + env update

**Files:**
- Modify: `web/components/Sidebar.tsx`

- [ ] **Step 1: Add Setup link (Provider only)**

In `web/components/Sidebar.tsx`, add Setup link. The sidebar already has all links visible to all users — for the PoC, show Setup for all (it's already middleware-protected). Add it after Chat:

```typescript
const links = [
  { href: '/dashboard', label: 'Overview', icon: '📊' },
  { href: '/chat', label: 'Chat', icon: '💬' },
  { href: '/setup', label: 'Setup', icon: '⚙️' },   // ← add this line
  { href: '/dashboard/nodes', label: 'Nodes', icon: '🖥️' },
  { href: '/dashboard/jobs', label: 'Jobs', icon: '⚡' },
  { href: '/dashboard/ledger', label: 'Ledger', icon: '💰' },
  { href: '/dashboard/logs', label: 'Logs', icon: '📄' },
]
```

- [ ] **Step 2: Build check**

```bash
cd /media/volker/6CBA2E09BA2DCFFE/claude.code.work/claude.code.work/enigma/web
. /home/volker/.nvm/nvm.sh && npm run build 2>&1 | tail -5
```

Expected: Build succeeds.

- [ ] **Step 3: Restart dev server and verify**

```bash
# Kill existing process on port 3000 and restart
fuser -k 3000/tcp 2>/dev/null || true
sleep 1
. /home/volker/.nvm/nvm.sh && npm run dev > /tmp/nextjs.log 2>&1 &
sleep 5
grep "Ready" /tmp/nextjs.log
```

Open http://localhost:3000/setup — page should render with GPU dropdown and model selection.

- [ ] **Step 4: Test download buttons**

1. Select "RTX 4090" in GPU dropdown
2. Click "Breite" tab → shows gemma3:12b ×2
3. Click "📄 docker-compose.yml" → file downloads
4. Verify downloaded file contains two Ollama services (ollama-gemma3-12b and ollama-gemma3-12b-2)
5. Click "⚡ install.sh herunterladen" → file downloads
6. Verify install.sh contains `ollama pull gemma3:12b` twice

- [ ] **Step 5: Commit**

```bash
cd /media/volker/6CBA2E09BA2DCFFE/claude.code.work/claude.code.work/enigma
git add web/components/Sidebar.tsx
git commit -m "feat(web): add Setup link to sidebar"
```
