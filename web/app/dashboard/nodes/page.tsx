import { fetchNodes, EnigmaNode } from '@/lib/enigma'

export const revalidate = 10

function parseModels(models: string): string {
  try {
    const arr = JSON.parse(models)
    return Array.isArray(arr) ? arr.join(', ') : models
  } catch { return models || '–' }
}

function nodeScore(node: EnigmaNode): number {
  return node.benchmark_score * 0.4 + node.avg_rating * 0.4 + node.reliability * 0.2
}

export default async function NodesPage() {
  const nodes = await fetchNodes().catch((): EnigmaNode[] => [])

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-white">Provider Nodes</h1>
        <span className="text-slate-400 text-sm">{nodes.length} Nodes</span>
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
            </tr>
          </thead>
          <tbody>
            {nodes.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-500 text-sm">Keine Nodes</td></tr>
            )}
            {nodes.map((node) => (
              <tr key={node.id} className="border-t border-slate-700/50 hover:bg-slate-700/20">
                <td className="px-4 py-3 text-slate-300 font-mono text-xs">{node.address}</td>
                <td className="px-4 py-3 text-slate-400 text-xs">{node.backend}</td>
                <td className="px-4 py-3 text-slate-300 text-xs max-w-xs truncate">{parseModels(node.models)}</td>
                <td className="px-4 py-3 text-slate-400 text-xs">{node.gpu_model || '–'}</td>
                <td className="px-4 py-3 text-slate-300 text-xs">{node.benchmark_score.toFixed(2)}</td>
                <td className="px-4 py-3 text-slate-300 text-xs">{node.avg_rating.toFixed(2)}</td>
                <td className="px-4 py-3 font-medium text-xs text-white">{nodeScore(node).toFixed(2)}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${node.status === 'online' ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'}`}>
                    ● {node.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-500 text-xs">
                  {node.last_heartbeat ? new Date(node.last_heartbeat).toLocaleTimeString('de-DE') : '–'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
