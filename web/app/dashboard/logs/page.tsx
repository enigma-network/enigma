'use client'
import { useEffect, useState } from 'react'

function parseLevel(line: string): string {
  try { return (JSON.parse(line) as { level?: string }).level ?? 'INFO' }
  catch { return 'INFO' }
}

function formatLine(line: string): string {
  try {
    const obj = JSON.parse(line) as Record<string, unknown>
    const time = obj.time ? new Date(obj.time as string).toLocaleTimeString('de-DE') : ''
    const msg = (obj.msg as string) ?? ''
    const rest = Object.entries(obj)
      .filter(([k]) => !['time', 'level', 'msg'].includes(k))
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(' ')
    return `[${time}] ${msg}${rest ? ' ' + rest : ''}`
  } catch { return line }
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
        if (!res.ok) { setError('Fehler beim Laden'); return }
        const data = await res.json() as { lines: string[] }
        setLines(data.lines ?? [])
        setError(null)
      } catch { setError('enigma-server nicht erreichbar') }
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
        <div className="bg-red-900/30 border border-red-700 rounded-lg px-4 py-3 mb-4 text-red-300 text-sm">{error}</div>
      )}
      <div className="bg-slate-900 border border-slate-700 rounded-xl p-4 font-mono text-xs overflow-auto" style={{ maxHeight: '70vh' }}>
        {lines.length === 0 ? (
          <p className="text-slate-600">Keine Logs vorhanden. Warte auf enigma-server Aktivität...</p>
        ) : (
          lines.map((line, i) => {
            const level = parseLevel(line)
            return (
              <div key={i} className={`leading-6 ${LEVEL_COLORS[level] ?? 'text-slate-400'}`}>
                <span className="text-slate-600 mr-2 select-none">{i + 1}</span>
                {formatLine(line)}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
