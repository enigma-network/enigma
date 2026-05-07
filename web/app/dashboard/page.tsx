import { StatCard } from '@/components/StatCard'
import { fetchStats, fetchNodes, fetchJobs, EnigmaNode, EnigmaJob } from '@/lib/enigma'

export const revalidate = 0

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
  const [stats, nodes, jobs] = await Promise.all([
    fetchStats().catch(() => null),
    fetchNodes().catch((): EnigmaNode[] => []),
    fetchJobs(5).catch((): EnigmaJob[] => []),
  ])

  const statusColors: Record<string, string> = {
    done: 'bg-green-900 text-green-300',
    running: 'bg-blue-900 text-blue-300',
    failed: 'bg-red-900 text-red-300',
    pending: 'bg-slate-700 text-slate-300',
  }

  return (
    <div>
      <h1 className="text-xl font-bold text-white mb-6">Overview</h1>

      <div className="grid grid-cols-4 gap-4 mb-8">
        <StatCard label="Nodes Online" value={stats?.nodes_online ?? '–'} color="text-green-400" />
        <StatCard label="Jobs gesamt" value={stats?.jobs_total ?? '–'} color="text-blue-400" />
        <StatCard label="ENI vergeben" value={stats ? stats.eni_total.toFixed(1) : '–'} color="text-yellow-400" />
        <StatCard label="Jobs/Stunde" value={stats?.jobs_last_hour ?? '–'} color="text-purple-400" />
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

      <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
        <h2 className="text-white font-semibold mb-4">Letzte Jobs</h2>
        {jobs.length === 0 ? (
          <p className="text-slate-500 text-sm">Noch keine Jobs</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-400 text-xs border-b border-slate-700">
                <th className="text-left pb-2">Prompt</th>
                <th className="text-left pb-2">Modell</th>
                <th className="text-left pb-2">Dauer</th>
                <th className="text-left pb-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id} className="border-b border-slate-700/50">
                  <td className="py-2 text-slate-300 text-xs max-w-xs truncate">{job.prompt}</td>
                  <td className="py-2 text-slate-400 text-xs">{job.model || '–'}</td>
                  <td className="py-2 text-slate-400 text-xs">{job.duration_ms ? `${job.duration_ms}ms` : '–'}</td>
                  <td className="py-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${statusColors[job.status] ?? statusColors.pending}`}>
                      {job.status}
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
