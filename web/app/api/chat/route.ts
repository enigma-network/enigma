import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { NextResponse } from 'next/server'

const ENIGMA = process.env.ENIGMA_SERVER_URL ?? 'http://localhost:8080'
const ADMIN_TOKEN = process.env.ENIGMA_ADMIN_TOKEN ?? ''
const ENI_COST = 1.0

function enigmaHeaders(): HeadersInit {
  return ADMIN_TOKEN ? { 'Content-Type': 'application/json', 'X-Admin-Token': ADMIN_TOKEN } : { 'Content-Type': 'application/json' }
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { prompt, model } = await req.json()
  if (!prompt?.trim()) return NextResponse.json({ error: 'Prompt erforderlich' }, { status: 400 })

  // Check ENI balance
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { transactions: true },
  })
  const balance = user?.transactions.reduce((s, t) => s + t.amount, 0) ?? 0
  if (balance < ENI_COST) {
    return NextResponse.json({ error: `Nicht genug ENI (${balance.toFixed(2)} / ${ENI_COST} benötigt)` }, { status: 402 })
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
      // Deduct ENI
      await prisma.walletTransaction.create({
        data: { userId: session.user.id, amount: -ENI_COST, reason: 'job_payment', jobId: job_id },
      })
      return NextResponse.json({ result: job.Result, job_id, duration_ms: job.DurationMs })
    }
    if (job.Status === 'failed') {
      return NextResponse.json({ error: 'Job fehlgeschlagen' }, { status: 500 })
    }
  }

  return NextResponse.json({ error: 'Timeout — kein Ergebnis nach 120s' }, { status: 504 })
}
