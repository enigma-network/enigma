import { auth } from '@/lib/auth'
import { resolveApiKey, getUserBalance } from '@/lib/apikey'
import { runJob, ENI_MIN } from '@/lib/run-job'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  // Ollama format: has messages array + API key
  const authHeader = req.headers.get('authorization')
  if (authHeader?.startsWith('Bearer enk_')) {
    const apiAuth = await resolveApiKey(authHeader)
    if (!apiAuth) return NextResponse.json({ error: 'Invalid API key' }, { status: 401 })

    const messages: { role: string; content: string }[] = body.messages ?? []
    const model: string = body.model ?? ''
    const prompt = messages.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n') + '\nAssistant:'

    const r = await runJob(apiAuth.userId, prompt, model, 'api_job')
    if ('code' in r) return ollamaError(r.code)

    return NextResponse.json({
      model,
      created_at: new Date().toISOString(),
      message: { role: 'assistant', content: r.result },
      done: true,
      total_duration: r.duration_ms * 1_000_000,
    })
  }

  // Internal format: session auth, prompt string
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { prompt, model } = body
  if (!prompt?.trim()) return NextResponse.json({ error: 'Prompt erforderlich' }, { status: 400 })

  const r = await runJob(session.user.id, prompt, model ?? '', 'job_payment')
  if ('code' in r) return internalError(r.code, 'code' in r && r.code === 'insufficient_eni' ? (r as { balance: number }).balance : undefined)

  return NextResponse.json({ result: r.result, job_id: r.job_id, duration_ms: r.duration_ms, eni_cost: r.eni_cost })
}

function ollamaError(code: string) {
  const map: Record<string, [number, string]> = {
    insufficient_eni: [429, 'Insufficient ENI balance'],
    no_provider: [503, 'No provider available'],
    job_failed: [500, 'Job failed'],
    timeout: [504, 'Timeout'],
  }
  const [status, msg] = map[code] ?? [500, 'Unknown error']
  return NextResponse.json({ error: msg }, { status })
}

function internalError(code: string, balance?: number) {
  if (code === 'insufficient_eni') return NextResponse.json({ error: `Nicht genug ENI (${balance?.toFixed(3)} verfügbar)` }, { status: 402 })
  if (code === 'no_provider') return NextResponse.json({ error: 'Kein Provider verfügbar' }, { status: 503 })
  if (code === 'job_failed') return NextResponse.json({ error: 'Job fehlgeschlagen' }, { status: 500 })
  return NextResponse.json({ error: 'Timeout — kein Ergebnis nach 120s' }, { status: 504 })
}
