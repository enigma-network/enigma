'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { NodeActions } from '@/components/NodeActions'

const PAGE_SIZE = 25
const MAX_PAGES = 50  // stop at page 50, then "Mehr laden" shifts the window

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
  const [page, setPage] = useState(0)          // page within current window
  const [windowStart, setWindowStart] = useState(0)  // absolute offset of page 0
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingSearch = useRef('')

  const loadPage = useCallback(async (pageIdx: number, winStart: number, searchVal: string) => {
    setLoading(true)
    setError('')
    try {
      const offset = winStart + pageIdx * PAGE_SIZE
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
      })
      if (searchVal) params.set('search', searchVal)
      const res = await fetch(`/api/admin/nodes?${params}`)
      if (!res.ok) { setError(`Fehler ${res.status}`); return }
      const data = await res.json()
      setNodes(data.nodes ?? [])
      setTotal(data.total ?? 0)
    } catch {
      setError('Server nicht erreichbar')
    } finally {
      setLoading(false)
    }
  }, [])

  // initial load
  useEffect(() => { loadPage(0, 0, '') }, [loadPage])

  function handleSearchChange(val: string) {
    setSearch(val)
    pendingSearch.current = val
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => {
      setPage(0)
      setWindowStart(0)
      loadPage(0, 0, pendingSearch.current)
    }, 300)
  }

  function goToPage(newPage: number) {
    setPage(newPage)
    loadPage(newPage, windowStart, search)
  }

  function loadMore() {
    const newWinStart = windowStart + MAX_PAGES * PAGE_SIZE
    setWindowStart(newWinStart)
    setPage(0)
    loadPage(0, newWinStart, search)
  }

  const absolutePage = windowStart / PAGE_SIZE + page
  const totalPages = Math.ceil(total / PAGE_SIZE)
  const windowPage = page  // 0..MAX_PAGES-1
  const isLastWindowPage = windowPage >= MAX_PAGES - 1
  const hasMoreBeyondWindow = absolutePage < totalPages - 1 && isLastWindowPage
  const canPrev = absolutePage > 0
  const canNext = absolutePage < totalPages - 1 && !isLastWindowPage

  return (
    <div>
      {/* Header: search + count */}
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

      {/* Pagination — always visible above the table */}
      <div className="flex items-center justify-between mb-3 gap-2">
        <button
          onClick={() => goToPage(page - 1)}
          disabled={!canPrev || loading}
          className="px-3 py-1.5 text-sm rounded-lg bg-slate-700 text-slate-300 disabled:opacity-40 hover:bg-slate-600 disabled:cursor-not-allowed"
        >
          ← Zurück
        </button>

        <span className="text-slate-400 text-sm">
          {loading ? '…' : (
            total === 0 ? 'Keine Ergebnisse' :
            `Seite ${absolutePage + 1} / ${totalPages}`
          )}
        </span>

        {hasMoreBeyondWindow ? (
          <button
            onClick={loadMore}
            disabled={loading}
            className="px-3 py-1.5 text-sm rounded-lg bg-blue-700 text-white hover:bg-blue-600 disabled:opacity-40"
          >
            {loading ? '…' : 'Mehr laden →'}
          </button>
        ) : (
          <button
            onClick={() => goToPage(page + 1)}
            disabled={!canNext || loading}
            className="px-3 py-1.5 text-sm rounded-lg bg-slate-700 text-slate-300 disabled:opacity-40 hover:bg-slate-600 disabled:cursor-not-allowed"
          >
            Weiter →
          </button>
        )}
      </div>

      {error && (
        <div className="mb-3 px-4 py-2 bg-red-900/40 border border-red-700 rounded-lg text-red-300 text-sm">{error}</div>
      )}

      {/* Table */}
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
            {!loading && nodes.length === 0 && (
              <tr><td colSpan={canDelete ? 10 : 9} className="px-4 py-8 text-center text-slate-500 text-sm">Keine Nodes</td></tr>
            )}
            {!loading && nodes.map((node) => (
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
    </div>
  )
}
