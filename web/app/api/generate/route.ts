import { resolveApiKey } from '@/lib/apikey'
import { runJob } from '@/lib/run-job'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const apiAuth = await resolveApiKey(req.headers.get('authorization'))
  if (!apiAuth) return NextResponse.json({ error: 'Invalid API key. Use Authorization: Bearer enk_...' }, { status: 401 })

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  if (body.stream) return NextResponse.json({ error: 'Streaming not yet supported' }, { status: 400 })

  const prompt: string = body.prompt ?? ''
  const model: string = body.model ?? ''
  if (!prompt.trim()) return NextResponse.json({ error: 'prompt required' }, { status: 400 })

  const r = await runJob(apiAuth.userId, prompt, model, 'api_job')
  if ('code' in r) {
    const map: Record<string, number> = { insufficient_eni: 429, no_provider: 503, job_failed: 500, timeout: 504 }
    return NextResponse.json({ error: r.code }, { status: map[r.code] ?? 500 })
  }

  return NextResponse.json({
    model,
    created_at: new Date().toISOString(),
    response: r.result,
    done: true,
    total_duration: r.duration_ms * 1_000_000,
    eval_count: 0,
  })
}
