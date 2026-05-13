'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function NodeActions({ nodeId, status }: { nodeId: string; status: string }) {
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function action(act: 'suspend' | 'resume' | 'delete') {
    if (act === 'delete' && !confirm('Node löschen?')) return
    setLoading(true)

    let res: Response
    if (act === 'delete') {
      res = await fetch('/api/admin/nodes', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId }),
      })
    } else {
      res = await fetch(`/api/admin/nodes/${nodeId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: act }),
      })
    }

    setLoading(false)
    if (res.ok) {
      router.refresh()
    } else {
      const data = await res.json().catch(() => ({}))
      alert(data.error ?? 'Fehler')
    }
  }

  return (
    <div className="flex items-center gap-1">
      {status === 'online' && (
        <button
          onClick={() => action('suspend')}
          disabled={loading}
          className="text-yellow-400 hover:text-yellow-300 text-xs px-2 py-1 disabled:opacity-50"
          title="Suspendieren"
        >
          ⏸
        </button>
      )}
      {status === 'suspended' && (
        <button
          onClick={() => action('resume')}
          disabled={loading}
          className="text-green-400 hover:text-green-300 text-xs px-2 py-1 disabled:opacity-50"
          title="Reaktivieren"
        >
          ▶
        </button>
      )}
      {status !== 'online' && (
        <button
          onClick={() => action('delete')}
          disabled={loading}
          className="text-red-400 hover:text-red-300 text-xs px-2 py-1 disabled:opacity-50"
          title="Löschen"
        >
          ✕
        </button>
      )}
    </div>
  )
}
