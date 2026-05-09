import { prisma } from './prisma'

const ENIGMA = process.env.ENIGMA_SERVER_URL ?? 'http://localhost:8080'
const ADMIN_TOKEN = process.env.ENIGMA_ADMIN_TOKEN ?? ''
export const ENI_RATE = 0.01
export const ENI_MIN = 0.001

export function enigmaHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (ADMIN_TOKEN) h['X-Admin-Token'] = ADMIN_TOKEN
  return h
}

function nodeScore(n: { benchmark_score: number; avg_rating: number; reliability: number }) {
  return n.benchmark_score * 0.4 + n.avg_rating * 0.4 + n.reliability * 0.2
}

async function fetchJobCost(assignedNodeId: string): Promise<number> {
  try {
    const headers: Record<string, string> = ADMIN_TOKEN ? { 'X-Admin-Token': ADMIN_TOKEN } : {}
    const res = await fetch(`${ENIGMA}/api/v1/admin/nodes`, { headers })
    if (!res.ok) return ENI_MIN
    const nodes = await res.json()
    const node = nodes.find((n: { id: string }) => n.id === assignedNodeId)
    return node ? Math.max(ENI_MIN, ENI_RATE * nodeScore(node)) : ENI_MIN
  } catch { return ENI_MIN }
}

export async function getUserBalance(userId: string): Promise<number> {
  const txs = await prisma.walletTransaction.findMany({ where: { userId } })
  return txs.reduce((s, t) => s + t.amount, 0)
}

export type JobResult = {
  result: string
  job_id: string
  duration_ms: number
  eni_cost: number
}

export type JobError =
  | { code: 'unauthorized' }
  | { code: 'insufficient_eni'; balance: number }
  | { code: 'no_provider' }
  | { code: 'job_failed' }
  | { code: 'timeout' }

export async function runJob(
  userId: string,
  prompt: string,
  model: string,
  reason = 'job_payment'
): Promise<JobResult | JobError> {
  const balance = await getUserBalance(userId)
  if (balance < ENI_MIN) return { code: 'insufficient_eni', balance }

  const submitRes = await fetch(`${ENIGMA}/api/v1/jobs`, {
    method: 'POST',
    headers: enigmaHeaders(),
    body: JSON.stringify({ prompt, model: model || '' }),
  }).catch(() => null)

  if (!submitRes?.ok) return { code: 'no_provider' }

  const { job_id } = await submitRes.json()

  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 2000))
    const statusRes = await fetch(`${ENIGMA}/api/v1/jobs/${job_id}`).catch(() => null)
    if (!statusRes?.ok) continue

    const job = await statusRes.json()
    if (job.Status === 'done') {
      const cost = await fetchJobCost(job.AssignedNode)
      await prisma.walletTransaction.create({
        data: { userId, amount: -cost, reason, jobId: job_id },
      })
      return { result: job.Result, job_id, duration_ms: job.DurationMs, eni_cost: cost }
    }
    if (job.Status === 'failed') return { code: 'job_failed' }
  }
  return { code: 'timeout' }
}
