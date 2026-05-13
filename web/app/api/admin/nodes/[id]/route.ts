import { auth } from '@/lib/auth'
import { NextResponse } from 'next/server'

const ENIGMA = process.env.ENIGMA_SERVER_URL ?? 'http://localhost:8080'
const ADMIN_TOKEN = process.env.ENIGMA_ADMIN_TOKEN ?? ''

function headers(): Record<string, string> {
  return ADMIN_TOKEN ? { 'X-Admin-Token': ADMIN_TOKEN } : {}
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'PROVIDER' && session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const { action } = await req.json().catch(() => ({}))

  if (action !== 'suspend' && action !== 'resume') {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  const res = await fetch(`${ENIGMA}/api/v1/nodes/${id}/${action}`, {
    method: 'PUT',
    headers: headers(),
  }).catch(() => null)

  if (!res?.ok) return NextResponse.json({ error: 'Failed' }, { status: 500 })
  return new Response(null, { status: 204 })
}
