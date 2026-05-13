import Link from 'next/link'

export default function ProviderGuidePage() {
  return (
    <div className="max-w-3xl">
      <div className="mb-8">
        <h1 className="text-xl font-bold text-white">Provider werden</h1>
        <p className="text-slate-400 text-sm mt-1">
          Stelle deine GPU dem Enigma-Netzwerk zur Verfügung und verdiene ENI-Token für jede beantwortete Anfrage.
        </p>
      </div>

      {/* Requirements */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 mb-6">
        <h2 className="text-white font-semibold mb-4">Voraussetzungen</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-slate-400 text-xs font-medium mb-2">Minimum</p>
            <ul className="space-y-1 text-slate-300 text-sm">
              <li>• 8 GB RAM</li>
              <li>• Docker Desktop installiert</li>
              <li>• Stabile Internetverbindung</li>
              <li>• Linux, macOS oder Windows</li>
            </ul>
          </div>
          <div>
            <p className="text-slate-400 text-xs font-medium mb-2">Empfohlen</p>
            <ul className="space-y-1 text-slate-300 text-sm">
              <li>• 16+ GB RAM</li>
              <li>• NVIDIA GPU (6+ GB VRAM)</li>
              <li>• SSD mit 20+ GB frei</li>
              <li>• 100 Mbit/s Leitung</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Options overview */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 mb-6">
        <h2 className="text-white font-semibold mb-4">Welche Option passt zu mir?</h2>
        <div className="space-y-3">
          {[
            {
              title: 'Ollama (Docker)',
              badge: 'Empfohlen',
              badgeColor: 'bg-green-900 text-green-300',
              desc: 'Alles automatisch — Docker startet Ollama und den Node. Ideal für Einsteiger.',
              for: 'Kein Ollama installiert, möchte schnell starten',
            },
            {
              title: 'Ollama (nativ)',
              badge: 'Für erfahrene Nutzer',
              badgeColor: 'bg-blue-900 text-blue-300',
              desc: 'Ollama läuft bereits auf deinem PC. Nur der Node startet als Docker-Container.',
              for: 'Ollama bereits installiert, Apple Silicon Mac (GPU-Beschleunigung)',
            },
            {
              title: 'vLLM',
              badge: 'Hochperformant',
              badgeColor: 'bg-purple-900 text-purple-300',
              desc: 'Maximale Performance auf NVIDIA-GPUs. Erfordert Python-Setup.',
              for: 'Erfahrene Nutzer mit NVIDIA GPU und hohem Durchsatz',
            },
            {
              title: 'LM Studio / Jan.ai',
              badge: 'Desktop App',
              badgeColor: 'bg-slate-700 text-slate-300',
              desc: 'GUI-Apps die bereits laufen. Node verbindet sich mit ihrer API.',
              for: 'Nutzer die LM Studio oder Jan.ai bereits verwenden',
            },
          ].map(opt => (
            <div key={opt.title} className="flex gap-4 bg-slate-900 rounded-lg p-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-white text-sm font-medium">{opt.title}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${opt.badgeColor}`}>{opt.badge}</span>
                </div>
                <p className="text-slate-300 text-xs mb-1">{opt.desc}</p>
                <p className="text-slate-500 text-xs">Für: {opt.for}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Step-by-step: Ollama Docker */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <h2 className="text-white font-semibold">Option 1: Ollama (Docker)</h2>
          <span className="text-xs bg-green-900 text-green-300 px-2 py-0.5 rounded-full">Empfohlen</span>
        </div>
        <ol className="space-y-4">
          {[
            {
              step: '1',
              title: 'Docker installieren',
              content: (
                <div className="text-slate-300 text-xs space-y-1">
                  <p><span className="text-slate-400">Linux:</span> <code className="bg-slate-950 px-1 rounded">curl -fsSL https://get.docker.com | sh</code></p>
                  <p><span className="text-slate-400">Mac/Windows:</span> Docker Desktop von <span className="text-green-400">docker.com/products/docker-desktop</span></p>
                </div>
              ),
            },
            {
              step: '2',
              title: 'Im Dashboard Setup konfigurieren',
              content: <p className="text-slate-300 text-xs">GPU auswählen → OS wählen → Backend: <span className="text-green-400">Ollama (Docker)</span> → Modelle nach VRAM</p>,
            },
            {
              step: '3',
              title: 'install.sh herunterladen und ausführen',
              content: (
                <div className="text-slate-300 text-xs space-y-1">
                  <p><span className="text-slate-400">Linux/Mac:</span></p>
                  <code className="block bg-slate-950 px-3 py-2 rounded font-mono">chmod +x install.sh && ./install.sh</code>
                  <p className="mt-2"><span className="text-slate-400">Windows:</span></p>
                  <code className="block bg-slate-950 px-3 py-2 rounded font-mono">powershell -ExecutionPolicy Bypass -File install.ps1</code>
                </div>
              ),
            },
            {
              step: '4',
              title: 'Node erscheint im Dashboard',
              content: <p className="text-slate-300 text-xs">Nach ~2-5 Min (Modell-Download) erscheint der Node in der Übersicht. ENI werden automatisch gutgeschrieben.</p>,
            },
          ].map(({ step, title, content }) => (
            <li key={step} className="flex gap-4">
              <div className="w-7 h-7 rounded-full bg-green-900 text-green-300 text-xs flex items-center justify-center font-bold shrink-0 mt-0.5">{step}</div>
              <div>
                <p className="text-white text-sm font-medium mb-1">{title}</p>
                {content}
              </div>
            </li>
          ))}
        </ol>
      </div>

      {/* Step-by-step: Ollama native */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <h2 className="text-white font-semibold">Option 2: Ollama (nativ)</h2>
          <span className="text-xs bg-blue-900 text-blue-300 px-2 py-0.5 rounded-full">Ollama bereits installiert</span>
        </div>
        <ol className="space-y-4">
          {[
            {
              step: '1',
              title: 'Sicherstellen dass Ollama läuft',
              content: (
                <div className="text-xs space-y-1">
                  <code className="block bg-slate-950 px-3 py-2 rounded font-mono text-slate-300">ollama list</code>
                  <p className="text-slate-400">Zeigt installierte Modelle. Wenn leer: <code className="bg-slate-950 px-1 rounded">ollama pull phi3:mini</code></p>
                </div>
              ),
            },
            {
              step: '2',
              title: 'Im Dashboard: Backend "Ollama (nativ)" wählen',
              content: <p className="text-slate-300 text-xs">Port auf <span className="text-green-400">11434</span> lassen (Standard). Nur ändern wenn Ollama auf anderem Port läuft.</p>,
            },
            {
              step: '3',
              title: 'install.sh ausführen',
              content: <p className="text-slate-300 text-xs">Script startet nur den enigma-node Container. Verbindet sich automatisch mit deiner lokalen Ollama-Installation.</p>,
            },
          ].map(({ step, title, content }) => (
            <li key={step} className="flex gap-4">
              <div className="w-7 h-7 rounded-full bg-blue-900 text-blue-300 text-xs flex items-center justify-center font-bold shrink-0 mt-0.5">{step}</div>
              <div>
                <p className="text-white text-sm font-medium mb-1">{title}</p>
                {content}
              </div>
            </li>
          ))}
        </ol>
      </div>

      {/* Node management */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 mb-6">
        <h2 className="text-white font-semibold mb-4">Node verwalten</h2>
        <div className="space-y-3">
          {[
            { label: 'Status prüfen', cmd: 'docker compose ps' },
            { label: 'Logs anzeigen', cmd: 'docker compose logs -f' },
            { label: 'Stoppen', cmd: 'docker compose stop' },
            { label: 'Neu starten', cmd: 'docker compose start' },
            { label: 'Update auf neue Version', cmd: 'docker compose pull && docker compose up -d' },
            { label: 'Komplett entfernen (Modelle weg)', cmd: 'docker compose down -v --rmi all' },
          ].map(({ label, cmd }) => (
            <div key={label} className="flex items-center justify-between gap-4">
              <span className="text-slate-400 text-xs w-44 shrink-0">{label}</span>
              <code className="flex-1 bg-slate-900 text-green-400 text-xs px-3 py-1.5 rounded font-mono">{cmd}</code>
            </div>
          ))}
        </div>
      </div>

      {/* Troubleshooting */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 mb-6">
        <h2 className="text-white font-semibold mb-4">Häufige Probleme</h2>
        <div className="space-y-4">
          {[
            {
              problem: 'Node erscheint mit models: [] im Dashboard',
              solution: 'Modell lädt noch. Warte bis der Download abgeschlossen ist — Node aktualisiert sich automatisch alle 30 Sekunden.',
            },
            {
              problem: 'NVIDIA Runtime Fehler',
              solution: 'Script mit CPU-Option erneut herunterladen, oder NVIDIA Container Toolkit installieren: nvidia.github.io/libnvidia-container',
            },
            {
              problem: 'Node verbindet sich nicht mit Server',
              solution: 'SERVER_URL in docker-compose.yml prüfen. Muss https://server.enigmanet.org sein.',
            },
            {
              problem: 'Wenig Speicherplatz',
              solution: 'Docker volumes auf eine andere Festplatte verschieben: Docker Desktop → Settings → Resources → Disk image location',
            },
          ].map(({ problem, solution }) => (
            <div key={problem} className="border-l-2 border-yellow-700 pl-4">
              <p className="text-yellow-400 text-xs font-medium mb-1">{problem}</p>
              <p className="text-slate-400 text-xs">{solution}</p>
            </div>
          ))}
        </div>
      </div>

      {/* CTA */}
      <div className="flex gap-3">
        <Link
          href="/dashboard/setup"
          className="flex-1 bg-green-700 hover:bg-green-600 text-white font-medium py-3 rounded-xl text-center text-sm transition-colors"
        >
          ⚡ Zum Setup → Script herunterladen
        </Link>
        <a
          href="https://github.com/enigma-network/enigma/wiki/Provider-Setup"
          target="_blank"
          rel="noopener noreferrer"
          className="px-6 bg-slate-700 hover:bg-slate-600 text-slate-300 font-medium py-3 rounded-xl text-sm transition-colors"
        >
          Wiki
        </a>
      </div>
    </div>
  )
}
