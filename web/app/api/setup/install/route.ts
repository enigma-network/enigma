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
  const os = searchParams.get('os') ?? 'linux'
  const hasNvidia = gpu !== 'cpu'

  try {
    const parsed = new URL(serverUrl)
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return new Response('Invalid server URL scheme', { status: 400 })
    }
  } catch {
    return new Response('Invalid server URL', { status: 400 })
  }

  const modelIds = modelsParam.split(',').filter(Boolean)
  if (modelIds.length === 0 || modelIds.length > 8) {
    return new Response('Invalid model count (1-8)', { status: 400 })
  }

  const seen: Record<string, number> = {}
  const ollamaServices: string[] = []
  for (const modelId of modelIds) {
    seen[modelId] = (seen[modelId] ?? 0) + 1
    const count = seen[modelId]
    const safeName = modelId.replace(/[^a-z0-9]/g, '-')
    const suffix = count > 1 ? `-${count}` : ''
    ollamaServices.push(`ollama-${safeName}${suffix}`)
  }

  if (os === 'windows') {
    return windowsScript({ modelIds, ollamaServices, serverUrl, gpu, hasNvidia })
  }
  if (os === 'mac') {
    return macScript({ modelIds, ollamaServices, serverUrl, gpu })
  }
  return linuxScript({ modelIds, ollamaServices, serverUrl, gpu, hasNvidia })
}

// ─── Linux ────────────────────────────────────────────────────────────────────

function linuxScript({ modelIds, ollamaServices, serverUrl, gpu, hasNvidia }: {
  modelIds: string[], ollamaServices: string[], serverUrl: string, gpu: string, hasNvidia: boolean
}) {
  const nvidiaPart = hasNvidia ? `
if command -v nvidia-smi &>/dev/null; then
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
  echo "[2/4] Kein NVIDIA GPU gefunden — überspringe Toolkit"
fi` : 'echo "[2/4] CPU-Modus — kein NVIDIA Toolkit benötigt ✓"'

  const pullCmds = ollamaServices.map((svc, i) =>
    `echo "Lade Modell: ${modelIds[i]}..."\ndocker compose exec -T ${svc} ollama pull ${modelIds[i]} || echo "Warnung: konnte Modell nicht laden"`
  ).join('\n')

  const script = `#!/bin/bash
set -e
echo "=== Enigma Node Installer (Linux) ==="
echo "GPU: ${gpu} | Models: ${modelIds.join(', ')} | Server: ${serverUrl}"
echo ""

if ! command -v docker &>/dev/null; then
  echo "[1/4] Docker wird installiert..."
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker $USER
else
  echo "[1/4] Docker bereits installiert ✓"
fi
${nvidiaPart}

echo "[3/4] enigma-node Image wird geladen..."
if docker pull ghcr.io/enigma-network/enigma-node:latest 2>/dev/null; then
  echo "Image geladen ✓"
elif [ -f "Dockerfile" ]; then
  docker build -t ghcr.io/enigma-network/enigma-node:latest . && echo "Image gebaut ✓"
else
  echo "FEHLER: enigma/node:latest nicht gefunden." && exit 1
fi

echo "[4/4] Container starten..."
docker compose up -d
echo "Warte auf Ollama (15s)..."; sleep 15
${pullCmds}

echo ""
echo "=== Setup abgeschlossen! ==="
echo "Nodes registrieren sich bei: ${serverUrl}"
echo "Status: docker compose ps | Logs: docker compose logs -f"
`
  return new Response(script, {
    headers: { 'Content-Type': 'text/plain', 'Content-Disposition': 'attachment; filename="install.sh"' },
  })
}

// ─── macOS ────────────────────────────────────────────────────────────────────

function macScript({ modelIds, ollamaServices, serverUrl, gpu }: {
  modelIds: string[], ollamaServices: string[], serverUrl: string, gpu: string
}) {
  const pullCmds = ollamaServices.map((svc, i) =>
    `echo "Lade Modell: ${modelIds[i]}..."\ndocker compose exec -T ${svc} ollama pull ${modelIds[i]} || echo "Warnung: konnte Modell nicht laden"`
  ).join('\n')

  const script = `#!/bin/bash
set -e
echo "=== Enigma Node Installer (macOS) ==="
echo "GPU: ${gpu} | Models: ${modelIds.join(', ')} | Server: ${serverUrl}"
echo ""
echo "Hinweis: macOS unterstützt kein NVIDIA CUDA in Docker."
echo "Ollama läuft im CPU-Modus (Apple Silicon: Metal-Beschleunigung nur nativ)."
echo ""

# Docker Desktop prüfen
if ! command -v docker &>/dev/null; then
  echo "[1/4] Docker Desktop wird benötigt."
  echo "Bitte manuell installieren: https://www.docker.com/products/docker-desktop/"
  if command -v brew &>/dev/null; then
    echo "Oder via Homebrew: brew install --cask docker"
    read -p "Jetzt via Homebrew installieren? (j/n) " ans
    if [ "$ans" = "j" ]; then brew install --cask docker; fi
  fi
  echo "Starte Docker Desktop und führe dieses Script erneut aus."
  exit 1
else
  echo "[1/4] Docker Desktop bereits installiert ✓"
fi

# Sicherstellen dass Docker läuft
if ! docker info &>/dev/null 2>&1; then
  echo "Docker Desktop wird gestartet..."
  open -a Docker
  echo "Warte auf Docker Desktop (20s)..."; sleep 20
fi

echo "[2/4] macOS — kein NVIDIA Toolkit benötigt ✓"

echo "[3/4] enigma-node Image wird geladen..."
if docker pull ghcr.io/enigma-network/enigma-node:latest 2>/dev/null; then
  echo "Image geladen ✓"
elif [ -f "Dockerfile" ]; then
  docker build -t ghcr.io/enigma-network/enigma-node:latest . && echo "Image gebaut ✓"
else
  echo "FEHLER: enigma/node:latest nicht gefunden." && exit 1
fi

echo "[4/4] Container starten..."
docker compose up -d
echo "Warte auf Ollama (15s)..."; sleep 15
${pullCmds}

echo ""
echo "=== Setup abgeschlossen! ==="
echo "Nodes registrieren sich bei: ${serverUrl}"
echo "Status: docker compose ps | Logs: docker compose logs -f"
`
  return new Response(script, {
    headers: { 'Content-Type': 'text/plain', 'Content-Disposition': 'attachment; filename="install.sh"' },
  })
}

// ─── Windows (PowerShell) ─────────────────────────────────────────────────────

function windowsScript({ modelIds, ollamaServices, serverUrl, gpu, hasNvidia }: {
  modelIds: string[], ollamaServices: string[], serverUrl: string, gpu: string, hasNvidia: boolean
}) {
  const pullCmds = ollamaServices.map((svc, i) =>
    `Write-Host "Lade Modell: ${modelIds[i]}..."
docker compose exec ${svc} ollama pull ${modelIds[i]}`
  ).join('\n')

  const nvidiaNotes = hasNvidia
    ? `Write-Host "[2/4] NVIDIA GPU erkannt. GPU-Support via WSL2-Backend in Docker Desktop aktivieren." -ForegroundColor Yellow`
    : `Write-Host "[2/4] CPU-Modus - kein NVIDIA Toolkit benoetigt." -ForegroundColor Green`

  const script = `# Enigma Node Installer (Windows PowerShell)
# GPU: ${gpu} | Models: ${modelIds.join(', ')} | Server: ${serverUrl}
# Ausfuehren: powershell -ExecutionPolicy Bypass -File install.ps1

Write-Host "=== Enigma Node Installer (Windows) ===" -ForegroundColor Cyan
Write-Host "GPU: ${gpu}"
Write-Host "Server: ${serverUrl}"
Write-Host ""

# [1/4] Docker pruefen
Write-Host "[1/4] Docker wird geprueft..."
$d = Get-Command docker -ErrorAction SilentlyContinue
if (-not $d) {
    Write-Host "Docker nicht gefunden. Bitte installieren:" -ForegroundColor Red
    Write-Host "  https://www.docker.com/products/docker-desktop/"
    Write-Host "  oder: winget install Docker.DockerDesktop"
    exit 1
}
Write-Host "[1/4] Docker gefunden." -ForegroundColor Green

# Docker laueft?
$info = docker info 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "Docker laeuft nicht. Bitte Docker Desktop starten." -ForegroundColor Red
    exit 1
}

# [2/4] GPU Info
${nvidiaNotes}

# [3/4] Image laden
Write-Host "[3/4] enigma-node Image wird geladen..."
docker pull ghcr.io/enigma-network/enigma-node:latest
if ($LASTEXITCODE -ne 0) {
    Write-Host "FEHLER: Image konnte nicht geladen werden." -ForegroundColor Red
    exit 1
}
Write-Host "[3/4] Image bereit." -ForegroundColor Green

# [4/4] Container starten
Write-Host "[4/4] Container werden gestartet..."
docker compose up -d
if ($LASTEXITCODE -ne 0) {
    Write-Host "FEHLER: docker compose up fehlgeschlagen." -ForegroundColor Red
    exit 1
}

Write-Host "Warte auf Ollama Start (15 Sekunden)..."
Start-Sleep -Seconds 15

${pullCmds}

Write-Host ""
Write-Host "=== Setup abgeschlossen! ===" -ForegroundColor Green
Write-Host "Nodes registrieren sich bei: ${serverUrl}"
Write-Host "Status: docker compose ps"
Write-Host "Logs:   docker compose logs -f"
`
  return new Response(script, {
    headers: { 'Content-Type': 'text/plain', 'Content-Disposition': 'attachment; filename="install.ps1"' },
  })
}
