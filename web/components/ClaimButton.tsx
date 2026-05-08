'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function ClaimButton() {
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const router = useRouter()

  async function claim() {
    setLoading(true)
    setMsg(null)
    try {
      const res = await fetch('/api/claim', { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        setMsg({ text: data.message, ok: true })
        router.refresh()
      } else {
        setMsg({ text: data.error, ok: false })
      }
    } catch {
      setMsg({ text: 'Verbindungsfehler', ok: false })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={claim}
        disabled={loading}
        className="text-xs bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg font-medium transition-colors"
      >
        {loading ? '...' : '+ 10 ENI claimen'}
      </button>
      {msg && (
        <span className={`text-xs ${msg.ok ? 'text-green-400' : 'text-red-400'}`}>{msg.text}</span>
      )}
    </div>
  )
}
