'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { NodeActions } from '@/components/NodeActions'

const PAGE_SIZE = 25
const BATCH_SIZE = PAGE_SIZE * 50 // 1250 nodes = 50 pages per batch

interface Node {
  id: string
  address: string
  backend: string
  models: string
  gpu_model: string
  benchmark_score: number
  avg_rating: number
  reliability: number
  status: string
  last_heartbeat: string
}

function parseModels(models: string): string {
  try {
    const arr = JSON.parse(models)
    return Array.isArray(arr) ? arr.join(', ') : models
  } catch { return models || '–' }
}

function nodeScore(node: Node): number {
  return node.benchmark_score * 0.4 + node.avg_rating * 0.4 + node.reliability * 0.2
}

export function NodesTable({ canDelete }: { canDelete: boolean }) {
  const [nodes, setNodes] = useState<Node[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingSearch = useRef('')

  const fetchBatch = useCallback(async (offset: number, searchVal: string, replace: boolean) => {
    if (replace) setLoading(true); else setLoadingMore(true)
    try {
      const params = new URLSearchParams({ limit: String(BATCH_SIZE), offset: String(offset) })
      if (searchVal) params.set('search', searchVal)
      const res = await fetch(`/api/admin/nodes?${params}`)
      if (!res.ok) return
      const data = await res.json()
      const fetched: Node[] = data.nodes ?? []
      setTotal(data.total ?? 0)
      if (replace) {
        setNodes(fetched)
        setPage(0)
      } else {
        setNodes(prev => [...prev, ...fetched])
      }
    } finally {
      if (replace) setLoading(false); else setLoadingMore(false)
    }
  }, [])

  // initial load
  useEffect(() => { fetchBatch(0, '', true) }, [fetchBatch])

  function handleSearchChange(val: string) {
    setSearch(val)
    pendingSearch.current = val
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => {
      fetchBatch(0, pendingSearch.current, true)
    }, 300)
  }

  function loadMore() {
    fetchBatch(nodes.length, search, false)
  }

  const totalPages = Math.ceil(nodes.length / PAGE_SIZE)
  const pageNodes = nodes.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const hasMore = nodes.length < total
  const isLastPage = page >= totalPages - 1

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-4">
        <h1 className="text-xl font-bold text-white shrink-0">Provider Nodes</h1>
        <input
          type="search"
          value={search}
          onChange={e => handleSearchChange(e.target.value)}
          placeholder="Suchen nach Adresse, GPU, Backend…"
          className="flex-1 max-w-sm bg-slate-800 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-slate-400"
        />
        <span className="text-slate-400 text-sm shrink-0">
          {loading ? '…' : `${total.toLocaleString()} Nodes`}
        </span>
      </div>

      <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-900">
            <tr className="text-slate-400 text-xs">
              <th className="text-left px-4 py-3">Adresse</th>
              <th className="text-left px-4 py-3">Backend</th>
              <th className="text-left px-4 py-3">Modelle</th>
              <th className="text-left px-4 py-3">GPU</th>
              <th className="text-left px-4 py-3">Benchmark</th>
              <th className="text-left px-4 py-3">Rating</th>
              <th className="text-left px-4 py-3">Score</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-left px-4 py-3">Heartbeat</th>
              {canDelete && <th className="px-4 py-3"></th>}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={canDelete ? 10 : 9} className="px-4 py-8 text-center text-slate-500 text-sm">Lade…</td></tr>
            )}
            {!loading && pageNodes.length === 0 && (
              <tr><td colSpan={canDelete ? 10 : 9} className="px-4 py-8 text-center text-slate-500 text-sm">Keine Nodes</td></tr>
            )}
            {!loading && pageNodes.map((node) => (
              <tr key={node.id} className="border-t border-slate-700/50 hover:bg-slate-700/20">
                <td className="px-4 py-3 text-slate-300 font-mono text-xs">{node.address}</td>
                <td className="px-4 py-3 text-slate-400 text-xs">{node.backend}</td>
                <td className="px-4 py-3 text-slate-300 text-xs max-w-xs truncate">{parseModels(node.models)}</td>
                <td className="px-4 py-3 text-slate-400 text-xs">{node.gpu_model || '–'}</td>
                <td className="px-4 py-3 text-slate-300 text-xs">{node.benchmark_score.toFixed(2)}</td>
                <td className="px-4 py-3 text-slate-300 text-xs">{node.avg_rating.toFixed(2)}</td>
                <td className="px-4 py-3 font-medium text-xs text-white">{nodeScore(node).toFixed(2)}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    node.status === 'online' ? 'bg-green-900 text-green-300' :
                    node.status === 'suspended' ? 'bg-yellow-900 text-yellow-300' :
                    'bg-red-900 text-red-300'
                  }`}>
                    ● {node.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-500 text-xs">
                  {node.last_heartbeat ? new Date(node.last_heartbeat).toLocaleTimeString('de-DE') : '–'}
                </td>
                {canDelete && (
                  <td className="px-2 py-3">
                    <NodeActions nodeId={node.id} status={node.status} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!loading && totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 gap-2">
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-3 py-1.5 text-sm rounded-lg bg-slate-700 text-slate-300 disabled:opacity-40 hover:bg-slate-600 disabled:cursor-not-allowed"
          >
            ← Zurück
          </button>

          <span className="text-slate-400 text-sm">
            Seite {page + 1} / {totalPages}
            {total > nodes.length && <span className="text-slate-500"> ({nodes.length.toLocaleString()} geladen von {total.toLocaleString()})</span>}
          </span>

          {isLastPage && hasMore ? (
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="px-3 py-1.5 text-sm rounded-lg bg-blue-700 text-white hover:bg-blue-600 disabled:opacity-40"
            >
              {loadingMore ? 'Lade…' : 'Mehr laden →'}
            </button>
          ) : (
            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={isLastPage}
              className="px-3 py-1.5 text-sm rounded-lg bg-slate-700 text-slate-300 disabled:opacity-40 hover:bg-slate-600 disabled:cursor-not-allowed"
            >
              Weiter →
            </button>
          )}
        </div>
      )}
    </div>
  )
}
