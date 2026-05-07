import { auth } from '@/lib/auth'
import { fetchJobs } from '@/lib/enigma'
import { NextResponse } from 'next/server'

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const limit = Math.min(200, Number(new URL(req.url).searchParams.get('limit') ?? '50'))
  try {
    return NextResponse.json(await fetchJobs(limit))
  } catch {
    return NextResponse.json({ error: 'enigma-server unavailable' }, { status: 503 })
  }
}
