import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { NextResponse } from 'next/server'

const ENIGMA = process.env.ENIGMA_SERVER_URL ?? 'http://localhost:8080'
const ADMIN_TOKEN = process.env.ENIGMA_ADMIN_TOKEN ?? ''
const ENI_RATE = 0.01
const ENI_MIN = 0.001

function enigmaHeaders(): HeadersInit {
  return ADMIN_TOKEN ? { 'Content-Type': 'application/json', 'X-Admin-Token': ADMIN_TOKEN } : { 'Content-Type': 'application/json' }
}

function nodeScore(n: { benchmark_score: number; avg_rating: number; reliability: number }): number {
  return n.benchmark_score * 0.4 + n.avg_rating * 0.4 + n.reliability * 0.2
}

async function fetchJobCost(assignedNodeId: string): Promise<number> {
  try {
    const headers = ADMIN_TOKEN ? { 'X-Admin-Token': ADMIN_TOKEN } : {}
    const res = await fetch(`${ENIGMA}/api/v1/admin/nodes`, { headers })
    if (!res.ok) return ENI_MIN
    const nodes = await res.json()
    const node = nodes.find((n: { id: string }) => n.id === assignedNodeId)
    if (!node) return ENI_MIN
    return Math.max(ENI_MIN, ENI_RATE * nodeScore(node))
  } catch {
    return ENI_MIN
  }
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { prompt, model } = await req.json()
  if (!prompt?.trim()) return NextResponse.json({ error: 'Prompt erforderlich' }, { status: 400 })

  // Check ENI balance (minimum cost)
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { transactions: true },
  })
  const balance = user?.transactions.reduce((s, t) => s + t.amount, 0) ?? 0
  if (balance < ENI_MIN) {
    return NextResponse.json({ error: `Nicht genug ENI (${balance.toFixed(3)} verfügbar)` }, { status: 402 })
  }

  // Submit job to enigma-server
  const submitRes = await fetch(`${ENIGMA}/api/v1/jobs`, {
    method: 'POST',
    headers: enigmaHeaders(),
    body: JSON.stringify({ prompt, model: model || '' }),
  }).catch(() => null)

  if (!submitRes?.ok) {
    return NextResponse.json({ error: 'Kein Provider verfügbar' }, { status: 503 })
  }

  const { job_id } = await submitRes.json()

  // Poll for result (max 120s)
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 2000))
    const statusRes = await fetch(`${ENIGMA}/api/v1/jobs/${job_id}`).catch(() => null)
    if (!statusRes?.ok) continue

    const job = await statusRes.json()
    if (job.Status === 'done') {
      const cost = await fetchJobCost(job.AssignedNode)
      await prisma.walletTransaction.create({
        data: { userId: session.user.id, amount: -cost, reason: 'job_payment', jobId: job_id },
      })
      return NextResponse.json({ result: job.Result, job_id, duration_ms: job.DurationMs, eni_cost: cost })
    }
    if (job.Status === 'failed') {
      return NextResponse.json({ error: 'Job fehlgeschlagen' }, { status: 500 })
    }
  }

  return NextResponse.json({ error: 'Timeout — kein Ergebnis nach 120s' }, { status: 504 })
}
