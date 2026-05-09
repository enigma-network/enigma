'use client'
import { useState, useEffect } from 'react'

interface ApiKey {
  id: string
  name: string
  createdAt: string
  lastUsedAt: string | null
}

export function ApiKeyManager() {
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [newKey, setNewKey] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => { loadKeys() }, [])

  async function loadKeys() {
    const res = await fetch('/api/apikeys')
    if (res.ok) setKeys(await res.json())
  }

  async function create() {
    setLoading(true)
    const res = await fetch('/api/apikeys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name || 'Default' }),
    })
    const data = await res.json()
    if (res.ok) {
      setNewKey(data.key)
      setName('')
      loadKeys()
    }
    setLoading(false)
  }

  async function revoke(id: string) {
    await fetch(`/api/apikeys/${id}`, { method: 'DELETE' })
    setKeys(k => k.filter(x => x.id !== id))
    if (newKey) setNewKey(null)
  }

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 mt-6">
      <h2 className="text-white font-semibold mb-1">API Keys</h2>
      <p className="text-slate-400 text-xs mb-4">
        Für Automation-Tools (Cline, LangChain, n8n…) — kompatibel mit OpenAI API Format
      </p>

      <div className="bg-slate-900 rounded-lg p-3 text-xs font-mono text-slate-400 mb-4">
        <p className="text-slate-500 mb-1"># Konfiguration in deinem Tool:</p>
        <p>Base URL: <span className="text-green-400">https://www.enigmanet.org</span></p>
        <p>API Key:  <span className="text-green-400">enk_...</span></p>
      </div>

      {newKey && (
        <div className="bg-green-900/30 border border-green-700 rounded-lg p-3 mb-4">
          <p className="text-green-300 text-xs mb-1 font-medium">Neuer API Key — nur einmal sichtbar:</p>
          <p className="font-mono text-green-400 text-xs break-all select-all">{newKey}</p>
        </div>
      )}

      <div className="space-y-2 mb-4">
        {keys.length === 0 && <p className="text-slate-500 text-sm">Keine API Keys</p>}
        {keys.map(k => (
          <div key={k.id} className="flex items-center justify-between bg-slate-900 rounded-lg px-3 py-2">
            <div>
              <p className="text-slate-300 text-sm">{k.name}</p>
              <p className="text-slate-500 text-xs">
                Erstellt: {new Date(k.createdAt).toLocaleDateString('de-DE')}
                {k.lastUsedAt && ` · Zuletzt: ${new Date(k.lastUsedAt).toLocaleDateString('de-DE')}`}
              </p>
            </div>
            <button
              onClick={() => revoke(k.id)}
              className="text-red-400 hover:text-red-300 text-xs px-2 py-1"
            >
              Widerrufen
            </button>
          </div>
        ))}
      </div>

      {keys.length < 5 && (
        <div className="flex gap-2">
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Name (optional)"
            className="flex-1 bg-slate-900 border border-slate-600 text-slate-200 rounded-lg px-3 py-1.5 text-xs"
          />
          <button
            onClick={create}
            disabled={loading}
            className="bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-xs px-4 py-1.5 rounded-lg"
          >
            {loading ? '...' : '+ Erstellen'}
          </button>
        </div>
      )}
    </div>
  )
}
