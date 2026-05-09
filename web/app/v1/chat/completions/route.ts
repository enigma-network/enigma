import { prisma } from '@/lib/prisma'
import { resolveApiKey, getUserBalance } from '@/lib/apikey'
import { fetchNodes } from '@/lib/enigma'
import { NextResponse } from 'next/server'

const ENIGMA = process.env.ENIGMA_SERVER_URL ?? 'http://localhost:8080'
const ADMIN_TOKEN = process.env.ENIGMA_ADMIN_TOKEN ?? ''
const ENI_RATE = 0.01
const ENI_MIN = 0.001

function enigmaHeaders(): Record<string, string> {
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
  } catch {
    return ENI_MIN
  }
}

export async function POST(req: Request) {
  // Authenticate via API key
  const auth = await resolveApiKey(req.headers.get('authorization'))
  if (!auth) {
    return NextResponse.json(
      { error: { message: 'Invalid API key. Use Authorization: Bearer enk_...', type: 'invalid_request_error' } },
      { status: 401 }
    )
  }

  // Parse OpenAI-format request
  let body: { model?: string; messages?: { role: string; content: string }[]; stream?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: { message: 'Invalid JSON', type: 'invalid_request_error' } }, { status: 400 })
  }

  const model = body.model ?? ''
  const messages = body.messages ?? []
  if (messages.length === 0) {
    return NextResponse.json({ error: { message: 'messages required', type: 'invalid_request_error' } }, { status: 400 })
  }
  if (body.stream) {
    return NextResponse.json({ error: { message: 'Streaming not yet supported', type: 'invalid_request_error' } }, { status: 400 })
  }

  // Build prompt from messages
  const prompt = messages.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n') + '\nAssistant:'

  // Check ENI balance
  const balance = await getUserBalance(auth.userId)
  if (balance < ENI_MIN) {
    return NextResponse.json(
      { error: { message: `Insufficient ENI balance (${balance.toFixed(3)}). Daily claim: GET https://www.enigmanet.org/profile`, type: 'insufficient_quota' } },
      { status: 429 }
    )
  }

  // Submit job
  const submitRes = await fetch(`${ENIGMA}/api/v1/jobs`, {
    method: 'POST',
    headers: enigmaHeaders(),
    body: JSON.stringify({ prompt, model }),
  }).catch(() => null)

  if (!submitRes?.ok) {
    return NextResponse.json(
      { error: { message: 'No provider available', type: 'service_unavailable' } },
      { status: 503 }
    )
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
        data: { userId: auth.userId, amount: -cost, reason: 'api_job', jobId: job_id },
      })

      return NextResponse.json({
        id: `chatcmpl-${job_id}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{
          index: 0,
          message: { role: 'assistant', content: job.Result },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        enigma: { job_id, duration_ms: job.DurationMs, eni_cost: cost },
      })
    }
    if (job.Status === 'failed') {
      return NextResponse.json(
        { error: { message: 'Job failed', type: 'server_error' } },
        { status: 500 }
      )
    }
  }

  return NextResponse.json(
    { error: { message: 'Timeout after 120s', type: 'timeout' } },
    { status: 504 }
  )
}
