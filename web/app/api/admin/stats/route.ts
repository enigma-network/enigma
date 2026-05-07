import { auth } from '@/lib/auth'
import { fetchStats } from '@/lib/enigma'
import { NextResponse } from 'next/server'

export async function GET() {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    return NextResponse.json(await fetchStats())
  } catch (e) {
    return NextResponse.json({ error: 'enigma-server unavailable' }, { status: 503 })
  }
}
