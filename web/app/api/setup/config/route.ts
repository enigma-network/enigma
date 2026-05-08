import { auth } from '@/lib/auth'
import { NextResponse } from 'next/server'

export async function GET() {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  return NextResponse.json({
    nodeServerUrl: process.env.ENIGMA_NODE_SERVER_URL ?? 'http://localhost:8080',
  })
}
