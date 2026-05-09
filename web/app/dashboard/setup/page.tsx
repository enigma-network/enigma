'use client'
import { useState, useMemo, useEffect } from 'react'
import { GPU_TIERS, MODELS, getModel, totalVram, formatModelList } from '@/lib/gpu-tiers'

export default function SetupPage() {
  const [gpuId, setGpuId] = useState('rtx3060')
  const [mode, setMode] = useState<'depth' | 'breadth'>('depth')
  const [selectedModels, setSelectedModels] = useState<string[]>(['gemma3:12b'])
  const [serverUrl, setServerUrl] = useState('http://localhost:8080')
  const [os, setOs] = useState<'linux' | 'mac' | 'windows'>('linux')
  const [backend, setBackend] = useState<'ollama' | 'vllm' | 'lmstudio' | 'localai' | 'janai'>('ollama')
  const [downloading, setDownloading] = useState(false)
  const [nodes, setNodes] = useState<{ id: string; address: string; status: string; models: string }[]>([])
  const [nodesLoading, setNodesLoading] = useState(true)

  const gpu = GPU_TIERS.find(g => g.id === gpuId) ?? GPU_TIERS[0]
  const usedVram = totalVram(selectedModels)
  const vramOk = gpu.vram === 0 || usedVram <= gpu.vram

  // Fetch server URL from runtime config on mount
  useEffect(() => {
    fetch('/api/setup/config')
      .then(r => r.json())
      .then(data => { if (data.nodeServerUrl) setServerUrl(data.nodeServerUrl) })
      .catch(() => {})
  }, [])

  // Fetch node status on mount
  useEffect(() => {
    fetch('/api/admin/nodes')
      .then(r => r.json())
      .then(data => {
        setNodes(Array.isArray(data) ? data : [])
        setNodesLoading(false)
      })
      .catch(() => setNodesLoading(false))
  }, [])

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
    os,
    backend,
  }).toString(), [gpuId, selectedModels, serverUrl, os, backend])

  async function download(type: 'script' | 'install') {
    setDownloading(true)
    try {
      const res = await fetch(`/api/setup/${type}?${params}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Fehler' }))
        alert(err.error ?? 'Download fehlgeschlagen')
        return
      }
      const blob = await res.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      const installName = os === 'windows' ? 'install.ps1' : 'install.sh'
      a.download = type === 'script' ? 'docker-compose.yml' : installName
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(a.href)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="max-w-3xl">
        <div className="mb-8">
          <h1 className="text-xl font-bold text-white">Node Setup</h1>
          <p className="text-slate-400 text-sm mt-1">Konfiguriere deinen Provider-Node und lade das Setup-Script herunter</p>
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

        {/* Step 2: OS */}
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 mb-4">
          <h2 className="text-white font-semibold mb-4">2. Betriebssystem</h2>
          <div className="grid grid-cols-3 gap-3">
            {([
              { id: 'linux',   label: 'Linux',   icon: '🐧', note: 'Ubuntu / Debian / Fedora' },
              { id: 'mac',     label: 'macOS',   icon: '🍎', note: 'Apple Silicon / Intel (kein NVIDIA)' },
              { id: 'windows', label: 'Windows', icon: '🪟', note: 'PowerShell + Docker Desktop' },
            ] as const).map(({ id, label, icon, note }) => (
              <button key={id} onClick={() => setOs(id)}
                className={`p-4 rounded-lg border text-left transition-colors ${
                  os === id ? 'border-green-500 bg-green-900/20 text-white' : 'border-slate-600 text-slate-400 hover:border-slate-500'
                }`}>
                <p className="text-lg mb-1">{icon}</p>
                <p className="font-medium text-sm">{label}</p>
                <p className="text-xs text-slate-500 mt-1">{note}</p>
              </button>
            ))}
          </div>
          {os === 'mac' && (
            <p className="text-yellow-400 text-xs mt-3">⚠️ macOS: GPU-Beschleunigung nur nativ über Ollama.app — nicht in Docker. Modelle laufen im CPU-Modus.</p>
          )}
          {os === 'windows' && (
            <p className="text-blue-400 text-xs mt-3">💡 Windows: Script läuft als PowerShell (.ps1). NVIDIA GPU über WSL2-Backend in Docker Desktop.</p>
          )}
        </div>

        {/* Step 2b: Backend */}
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 mb-4">
          <h2 className="text-white font-semibold mb-3">2b. Inference Backend</h2>
          <p className="text-slate-400 text-xs mb-3">Welche Software läuft auf deinem Provider-PC?</p>
          <select
            value={backend}
            onChange={e => setBackend(e.target.value as typeof backend)}
            className="w-full bg-slate-900 border border-slate-600 text-slate-200 rounded-lg px-3 py-2 text-sm"
          >
            <option value="ollama">Ollama (empfohlen — einfachste Installation)</option>
            <option value="vllm">vLLM (NVIDIA — höchste Performance)</option>
            <option value="lmstudio">LM Studio (Desktop App — Windows/Mac)</option>
            <option value="localai">LocalAI (Docker — OpenAI-kompatibel)</option>
            <option value="janai">Jan.ai (Desktop App — Open Source)</option>
          </select>
          {backend !== 'ollama' && (
            <p className="text-yellow-400 text-xs mt-2">
              ⚠️ {backend === 'vllm' && 'vLLM benötigt NVIDIA GPU und Python-Setup. Standard-Port: 8000.'}
              {backend === 'lmstudio' && 'LM Studio muss laufen und Server-Modus aktiviert sein. Standard-Port: 1234.'}
              {backend === 'localai' && 'LocalAI läuft als Docker Container. Standard-Port: 8080.'}
              {backend === 'janai' && 'Jan.ai muss laufen und API-Server aktiviert sein. Standard-Port: 1337.'}
            </p>
          )}
        </div>

        {/* Step 3: Mode */}
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 mb-4">
          <h2 className="text-white font-semibold mb-4">3. Strategie</h2>
          <div className="grid grid-cols-2 gap-3">
            {(['depth', 'breadth'] as const).map(m => (
              <button
                key={m}
                onClick={() => onModeChange(m)}
                className={`p-4 rounded-lg border text-left transition-colors ${
                  mode === m
                    ? m === 'depth' ? 'border-green-500 bg-green-900/20 text-white' : 'border-blue-500 bg-blue-900/20 text-white'
                    : 'border-slate-600 text-slate-400 hover:border-slate-500'
                }`}
              >
                <p className="font-medium text-sm">{m === 'depth' ? 'Tiefe' : 'Breite'}</p>
                <p className="text-xs mt-1 text-slate-400">
                  {m === 'depth' ? 'Ein großes Modell — beste Qualität' : 'Mehrere kleine Modelle — mehr parallele Jobs'}
                </p>
                <p className={`text-xs mt-2 ${m === 'depth' ? 'text-green-400' : 'text-blue-400'}`}>
                  {gpu.presets[m].label}
                </p>
              </button>
            ))}
          </div>
        </div>

        {/* Step 3: Models + VRAM */}
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 mb-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-white font-semibold">4. Modelle anpassen</h2>
            <span className={`text-sm font-medium ${vramOk ? 'text-green-400' : 'text-red-400'}`}>
              {gpu.vram === 0
                ? `RAM: ~${usedVram * 2}GB benötigt`
                : `VRAM: ${usedVram}GB / ${gpu.vram}GB ${vramOk ? '✅' : '⚠️'}`}
            </span>
          </div>

          <div className="space-y-2 mb-4">
            {selectedModels.map((modelId, i) => {
              const m = getModel(modelId)
              return (
                <div key={i} className="flex items-center justify-between bg-slate-900 rounded-lg px-3 py-2">
                  <div>
                    <span className="text-slate-200 text-sm">{m.label}</span>
                    <span className="text-slate-500 text-xs ml-2">{m.vram}GB · {'⭐'.repeat(m.quality)}</span>
                  </div>
                  <button
                    onClick={() => removeModel(i)}
                    disabled={selectedModels.length <= 1}
                    className="text-red-400 hover:text-red-300 text-xs px-2 py-1 disabled:opacity-30"
                  >
                    ✕
                  </button>
                </div>
              )
            })}
          </div>

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
          <h2 className="text-white font-semibold mb-3">5. Enigma-Server URL</h2>
          <p className="text-slate-400 text-xs mb-3">URL unter der dein enigma-server vom Provider-PC erreichbar ist</p>
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
          <h2 className="text-white font-semibold mb-2">6. Script herunterladen</h2>
          <p className="text-slate-400 text-xs mb-4">
            Lade beide Dateien in dasselbe Verzeichnis auf deinem Provider-PC. Dann:{' '}
            <code className="bg-slate-900 px-1 rounded text-green-400 text-xs">chmod +x install.sh && ./install.sh</code>
          </p>

          <div className="flex gap-3 mb-4">
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
              {downloading ? '⏳' : '⚡'} install.sh herunterladen
            </button>
          </div>

          {!vramOk && (
            <p className="text-red-400 text-xs mb-3">⚠️ VRAM-Limit überschritten — entferne Modelle</p>
          )}

          <div className="bg-slate-900 rounded-lg p-3 text-xs font-mono text-slate-400">
            <p className="text-slate-500 mb-1"># Konfiguration:</p>
            <p>GPU: {gpu.label}</p>
            <p>Modelle: {formatModelList(selectedModels)}</p>
            <p>VRAM: {usedVram}GB · Nodes: {selectedModels.length}×</p>
            <p>Server: {serverUrl}</p>
          </div>
        </div>

        {/* Node Status */}
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
          <h2 className="text-white font-semibold mb-4">Registrierte Nodes</h2>
          {nodesLoading ? (
            <p className="text-slate-500 text-sm">Lädt...</p>
          ) : nodes.length === 0 ? (
            <p className="text-slate-500 text-sm">Keine Nodes registriert. Führe install.sh aus um zu starten.</p>
          ) : (
            <div className="space-y-2">
              {nodes.map(node => (
                <div key={node.id} className="flex items-center justify-between bg-slate-900 rounded-lg px-3 py-2">
                  <div>
                    <p className="text-slate-300 text-sm font-mono">{node.address}</p>
                    <p className="text-slate-500 text-xs">{(() => {
                      try { return JSON.parse(node.models).join(', ') } catch { return node.models }
                    })()}</p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    node.status === 'online' ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'
                  }`}>● {node.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>
    </div>
  )
}
