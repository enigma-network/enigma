'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

export function EarningsSync() {
  const [info, setInfo] = useState<{ nodeBalance: number; syncedBalance: number } | null>(null)
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const router = useRouter()

  useEffect(() => {
    fetch('/api/earnings').then(r => r.json()).then(setInfo).catch(() => {})
  }, [])

  const pending = info ? Math.max(0, info.nodeBalance - info.syncedBalance) : 0

  async function sync() {
    setLoading(true)
    setMsg(null)
    const res = await fetch('/api/earnings', { method: 'POST' })
    const data = await res.json()
    setMsg({ text: data.message, ok: res.ok })
    if (res.ok && data.synced > 0) {
      router.refresh()
      fetch('/api/earnings').then(r => r.json()).then(setInfo).catch(() => {})
    }
    setLoading(false)
  }

  return (
    <div className="bg-slate-900 rounded-lg p-4 mt-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-slate-400 text-sm">Node-Einnahmen</p>
          <p className="text-xs text-slate-500 mt-0.5">
            {info ? `${info.nodeBalance.toFixed(3)} ENI verdient · ${info.syncedBalance.toFixed(3)} ENI übertragen` : 'Lädt...'}
          </p>
        </div>
        <button
          onClick={sync}
          disabled={loading || pending <= 0}
          className="text-xs bg-green-800 hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-lg"
        >
          {loading ? '...' : pending > 0 ? `+${pending.toFixed(3)} ENI übertragen` : 'Aktuell ✓'}
        </button>
      </div>
      {msg && <p className={`text-xs mt-2 ${msg.ok ? 'text-green-400' : 'text-red-400'}`}>{msg.text}</p>}
    </div>
  )
}
