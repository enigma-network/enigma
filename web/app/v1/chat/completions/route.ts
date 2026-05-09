import { resolveApiKey } from '@/lib/apikey'
import { runJob, ENI_MIN } from '@/lib/run-job'
import { NextResponse } from 'next/server'

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

  const r = await runJob(auth.userId, prompt, model, 'api_job')
  if ('code' in r) {
    const errMap: Record<string, [number, string, string]> = {
      insufficient_eni: [429, `Insufficient ENI balance. Daily claim: https://www.enigmanet.org/profile`, 'insufficient_quota'],
      no_provider: [503, 'No provider available', 'service_unavailable'],
      job_failed: [500, 'Job failed', 'server_error'],
      timeout: [504, 'Timeout after 120s', 'timeout'],
    }
    const [status, message, type] = errMap[r.code] ?? [500, 'Unknown error', 'server_error']
    return NextResponse.json({ error: { message, type } }, { status })
  }

  return NextResponse.json({
    id: `chatcmpl-${r.job_id}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message: { role: 'assistant', content: r.result }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    enigma: { job_id: r.job_id, duration_ms: r.duration_ms, eni_cost: r.eni_cost },
  })
}
