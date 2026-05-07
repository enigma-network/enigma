import { fetchLedger, EnigmaLedgerEntry } from '@/lib/enigma'

export const revalidate = 10

export default async function LedgerPage() {
  const entries = await fetchLedger(100).catch((): EnigmaLedgerEntry[] => [])

  const total = entries.reduce((sum, e) => sum + e.amount, 0)

  const byNode: Record<string, number> = {}
  entries.forEach((e) => {
    byNode[e.node_id] = (byNode[e.node_id] ?? 0) + e.amount
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-white">Ledger</h1>
        <span className="text-yellow-400 font-bold">{total.toFixed(2)} ENI gesamt</span>
      </div>

      {Object.keys(byNode).length > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-6">
          {Object.entries(byNode).slice(0, 6).map(([nodeId, eni]) => (
            <div key={nodeId} className="bg-slate-800 border border-slate-700 rounded-lg px-4 py-3">
              <p className="text-slate-500 font-mono text-xs truncate">{nodeId.slice(0, 12)}…</p>
              <p className="text-yellow-400 font-bold mt-1">{eni.toFixed(2)} ENI</p>
            </div>
          ))}
        </div>
      )}

      <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-900">
            <tr className="text-slate-400 text-xs">
              <th className="text-left px-4 py-3">Node</th>
              <th className="text-left px-4 py-3">Betrag</th>
              <th className="text-left px-4 py-3">Grund</th>
              <th className="text-left px-4 py-3">Zeit</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-500">Keine Transaktionen</td></tr>
            )}
            {entries.map((e) => (
              <tr key={e.id} className="border-t border-slate-700/50">
                <td className="px-4 py-3 text-slate-500 font-mono text-xs">{e.node_id.slice(0, 12)}…</td>
                <td className="px-4 py-3 text-yellow-400 font-medium text-sm">+{e.amount.toFixed(2)} ENI</td>
                <td className="px-4 py-3 text-slate-400 text-xs">{e.reason}</td>
                <td className="px-4 py-3 text-slate-500 text-xs">
                  {new Date(e.created_at).toLocaleString('de-DE')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
