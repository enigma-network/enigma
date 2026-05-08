'use client'
import { useState, useEffect } from 'react'

interface Message {
  role: 'user' | 'assistant'
  content: string
  duration_ms?: number
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [model, setModel] = useState('')
  const [models, setModels] = useState<string[]>([])
  const [modelsLoading, setModelsLoading] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/chat/models')
      .then(r => r.json())
      .then(data => {
        const list: string[] = data.models ?? []
        setModels(list)
        if (list.length > 0) setModel(list[0])
      })
      .catch(() => {})
      .finally(() => setModelsLoading(false))
  }, [])

  async function send() {
    if (!input.trim() || loading) return
    const prompt = input.trim()
    setInput('')
    setError(null)
    setMessages(m => [...m, { role: 'user', content: prompt }])
    setLoading(true)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, model }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Unbekannter Fehler')
      } else {
        setMessages(m => [...m, { role: 'assistant', content: data.result, duration_ms: data.duration_ms }])
      }
    } catch {
      setError('Verbindungsfehler')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#0f172a', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ borderBottom: '1px solid #1e293b', padding: '12px 24px', display: 'flex', alignItems: 'center', gap: '16px' }}>
        <a href="/dashboard" className="text-slate-400 hover:text-white text-sm">← Dashboard</a>
        <span className="text-green-400 font-bold text-sm">ENIGMA Chat</span>
        <select
          value={model}
          onChange={e => setModel(e.target.value)}
          disabled={modelsLoading || models.length === 0}
          className="ml-auto bg-slate-800 border border-slate-700 text-slate-300 text-xs rounded px-2 py-1 disabled:opacity-50"
        >
          {modelsLoading && <option>Lade Modelle...</option>}
          {!modelsLoading && models.length === 0 && <option value="">Keine Modelle verfügbar</option>}
          {models.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <a href="/profile" className="text-slate-500 hover:text-slate-300 text-xs">Balance</a>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-auto p-6 max-w-3xl mx-auto w-full">
        {messages.length === 0 && (
          <div className="text-center text-slate-600 mt-16">
            <p className="text-4xl mb-4">🤖</p>
            {!modelsLoading && models.length === 0 ? (
              <p className="text-sm text-red-400">Keine Nodes online — kein Modell verfügbar</p>
            ) : (
              <p className="text-sm">Stelle eine Frage an das Enigma-Netzwerk</p>
            )}
            <p className="text-xs mt-2 text-slate-700">Kosten: 1.0 ENI pro Anfrage</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`mb-4 ${msg.role === 'user' ? 'text-right' : 'text-left'}`}>
            <div className={`inline-block max-w-2xl rounded-xl px-4 py-3 text-sm ${
              msg.role === 'user'
                ? 'bg-blue-800 text-white'
                : 'bg-slate-800 border border-slate-700 text-slate-200'
            }`}>
              <p className="whitespace-pre-wrap">{msg.content}</p>
              {msg.duration_ms && (
                <p className="text-xs text-slate-500 mt-2">{msg.duration_ms}ms · -1.0 ENI</p>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="text-left mb-4">
            <div className="inline-block bg-slate-800 border border-slate-700 rounded-xl px-4 py-3">
              <div className="flex gap-1">
                <span className="w-2 h-2 bg-green-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 bg-green-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 bg-green-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
        {error && (
          <div className="bg-red-900/30 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm mb-4">
            {error}
          </div>
        )}
      </div>

      {/* Input */}
      <div style={{ borderTop: '1px solid #1e293b', padding: '16px 24px' }} className="max-w-3xl mx-auto w-full">
        <div className="flex gap-3">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
            placeholder="Frage stellen... (Enter zum Senden, Shift+Enter für neue Zeile)"
            disabled={loading}
            rows={2}
            className="flex-1 bg-slate-800 border border-slate-700 text-slate-200 rounded-xl px-4 py-3 text-sm resize-none focus:outline-none focus:border-green-500 disabled:opacity-50"
          />
          <button
            onClick={send}
            disabled={loading || !input.trim() || models.length === 0}
            className="bg-green-600 hover:bg-green-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium px-5 rounded-xl transition-colors"
          >
            {loading ? '⏳' : '→'}
          </button>
        </div>
      </div>
    </div>
  )
}
