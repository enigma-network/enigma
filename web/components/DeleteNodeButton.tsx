'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function DeleteNodeButton({ nodeId, status }: { nodeId: string; status: string }) {
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleDelete() {
    if (!confirm('Node löschen?')) return
    setLoading(true)
    const res = await fetch('/api/admin/nodes', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeId }),
    })
    setLoading(false)
    if (res.ok) {
      router.refresh()
    } else {
      const data = await res.json().catch(() => ({}))
      alert(data.error ?? 'Fehler beim Löschen')
    }
  }

  if (status === 'online') return null

  return (
    <button
      onClick={handleDelete}
      disabled={loading}
      className="text-red-400 hover:text-red-300 text-xs px-2 py-1 disabled:opacity-50"
      title="Node löschen"
    >
      {loading ? '…' : '✕'}
    </button>
  )
}
