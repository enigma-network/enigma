import { StatCard } from '@/components/StatCard'
import { fetchStats, fetchNodes, EnigmaNode } from '@/lib/enigma'
import { prisma } from '@/lib/prisma'

export const revalidate = 0

const APP_VERSION = process.env.APP_VERSION ?? '?'
const SERVER_URL = process.env.ENIGMA_SERVER_URL ?? 'http://localhost:8080'

function parseModels(models: string): string {
  try {
    const arr = JSON.parse(models)
    return Array.isArray(arr) ? arr[0] ?? '–' : models
  } catch {
    return models || '–'
  }
}

function nodeScore(node: EnigmaNode): number {
  return node.benchmark_score * 0.4 + node.avg_rating * 0.4 + node.reliability * 0.2
}

export default async function DashboardPage() {
  let statsError: string | null = null
  const [stats, nodes, userCounts] = await Promise.all([
    fetchStats().catch((e: Error) => { statsError = e.message; return null }),
    fetchNodes().catch((): EnigmaNode[] => []),
    prisma.user.groupBy({ by: ['role'], _count: true }).catch(() => []),
  ])

  const countByRole = (role: string) =>
    (userCounts as { role: string; _count: number }[]).find(r => r.role === role)?._count ?? 0

  const serverOnline = stats !== null

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-white">Overview</h1>
        <span className="text-slate-500 text-xs">v{APP_VERSION}</span>
      </div>

      {/* Server Status */}
      <div className={`rounded-xl border px-4 py-3 mb-6 flex items-center justify-between ${
        serverOnline ? 'bg-green-900/20 border-green-800' : 'bg-red-900/20 border-red-800'
      }`}>
        <div className="flex items-center gap-3">
          <span className={`text-xs font-medium ${serverOnline ? 'text-green-400' : 'text-red-400'}`}>
            ● enigma-server {serverOnline ? 'online' : 'offline'}
          </span>
          <span className="text-slate-500 text-xs font-mono">{SERVER_URL}</span>
        </div>
        {statsError && (
          <span className="text-red-400 text-xs">{statsError}</span>
        )}
      </div>

      {/* Network stats */}
      <div className="grid grid-cols-4 gap-4 mb-4">
        <StatCard label="Nodes Online" value={stats?.nodes_online ?? '–'} color="text-green-400" />
        <StatCard label="Jobs gesamt" value={stats?.jobs_total ?? '–'} color="text-blue-400" />
        <StatCard label="ENI vergeben" value={stats ? stats.eni_total.toFixed(1) : '–'} color="text-yellow-400" />
        <StatCard label="Jobs/Stunde" value={stats?.jobs_last_hour ?? '–'} color="text-purple-400" />
      </div>

      {/* User stats */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <StatCard label="User" value={countByRole('USER')} color="text-blue-300" />
        <StatCard label="Provider" value={countByRole('PROVIDER')} color="text-green-300" />
        <StatCard label="Admins" value={countByRole('ADMIN')} color="text-purple-300" />
      </div>

      <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 mb-6">
        <h2 className="text-white font-semibold mb-4">Provider Nodes</h2>
        {nodes.length === 0 ? (
          <p className="text-slate-500 text-sm">Keine Nodes registriert</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-400 text-xs border-b border-slate-700">
                <th className="text-left pb-2">Adresse</th>
                <th className="text-left pb-2">Modell</th>
                <th className="text-left pb-2">Score</th>
                <th className="text-left pb-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {nodes.map((node) => (
                <tr key={node.id} className="border-b border-slate-700/50">
                  <td className="py-2 text-slate-300 font-mono text-xs">{node.address}</td>
                  <td className="py-2 text-slate-300 text-xs">{parseModels(node.models)}</td>
                  <td className="py-2 text-slate-300 text-xs">{nodeScore(node).toFixed(2)}</td>
                  <td className="py-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      node.status === 'online' ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'
                    }`}>
                      {node.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
