import { fetchJobs, fetchNodes, EnigmaJob } from '@/lib/enigma'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const revalidate = 5

const STATUS_COLORS: Record<string, string> = {
  done: 'bg-green-900 text-green-300',
  running: 'bg-blue-900 text-blue-300',
  failed: 'bg-red-900 text-red-300',
  pending: 'bg-slate-700 text-slate-300',
}

export default async function JobsPage() {
  const session = await auth()
  const role = session?.user?.role ?? 'USER'
  const isAdmin = role === 'ADMIN'
  const isProvider = role === 'PROVIDER'

  // For providers: find their node ID to filter jobs
  let providerNodeId: string | null = null
  if (isProvider && session?.user?.id) {
    const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { nodeId: true } })
    if (user?.nodeId) {
      providerNodeId = user.nodeId
    } else {
      // Try to match by finding node with matching address
      const nodes = await fetchNodes().catch(() => [])
      // No nodeId set — show all their nodes if address matches (fallback: show all)
      providerNodeId = null
    }
  }

  const allJobs = await fetchJobs(100).catch((): EnigmaJob[] => [])

  // Filter: ADMIN sees all, PROVIDER sees only jobs on their node
  const jobs = isAdmin
    ? allJobs
    : isProvider && providerNodeId
      ? allJobs.filter(j => j.assigned_node === providerNodeId)
      : allJobs // fallback for providers without nodeId: show all their jobs

  const title = isAdmin ? 'Alle Jobs' : isProvider ? 'Jobs auf meinem Node' : 'Jobs'

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-white">{title}</h1>
        <span className="text-slate-400 text-sm">{jobs.length} Einträge</span>
      </div>
      <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-900">
            <tr className="text-slate-400 text-xs">
              <th className="text-left px-4 py-3">Prompt</th>
              <th className="text-left px-4 py-3">Modell</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-left px-4 py-3">Node</th>
              <th className="text-left px-4 py-3">Dauer</th>
              <th className="text-left px-4 py-3">Zeit</th>
            </tr>
          </thead>
          <tbody>
            {jobs.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">Keine Jobs</td></tr>
            )}
            {jobs.map((job) => (
              <tr key={job.id} className="border-t border-slate-700/50 hover:bg-slate-700/20">
                <td className="px-4 py-3 text-slate-300 text-xs max-w-xs">
                  <span title={job.prompt} className="block truncate">{job.prompt}</span>
                </td>
                <td className="px-4 py-3 text-slate-400 text-xs">{job.model || '–'}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[job.status] ?? STATUS_COLORS.pending}`}>
                    {job.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-500 font-mono text-xs">
                  {job.assigned_node ? job.assigned_node.slice(0, 8) + '…' : '–'}
                </td>
                <td className="px-4 py-3 text-slate-400 text-xs">
                  {job.duration_ms ? `${job.duration_ms}ms` : '–'}
                </td>
                <td className="px-4 py-3 text-slate-500 text-xs">
                  {new Date(job.created_at).toLocaleString('de-DE')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
