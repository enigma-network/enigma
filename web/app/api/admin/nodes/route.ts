import { auth } from '@/lib/auth'
import { fetchNodes } from '@/lib/enigma'
import { NextResponse } from 'next/server'

const ENIGMA = process.env.ENIGMA_SERVER_URL ?? 'http://localhost:8080'
const ADMIN_TOKEN = process.env.ENIGMA_ADMIN_TOKEN ?? ''

export async function GET() {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    return NextResponse.json(await fetchNodes())
  } catch {
    return NextResponse.json({ error: 'enigma-server unavailable' }, { status: 503 })
  }
}

export async function DELETE(req: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { nodeId } = await req.json().catch(() => ({}))
  if (!nodeId) return NextResponse.json({ error: 'nodeId required' }, { status: 400 })

  const isAdmin = session.user.role === 'ADMIN'
  const isProvider = session.user.role === 'PROVIDER'
  if (!isAdmin && !isProvider) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Providers can only delete offline nodes
  if (isProvider && !isAdmin) {
    const nodes = await fetchNodes().catch(() => [])
    const node = nodes.find(n => n.id === nodeId)
    if (!node) return NextResponse.json({ error: 'Node not found' }, { status: 404 })
    if (node.status === 'online') {
      return NextResponse.json({ error: 'Cannot delete an online node' }, { status: 403 })
    }
  }

  const headers: Record<string, string> = {}
  if (ADMIN_TOKEN) headers['X-Admin-Token'] = ADMIN_TOKEN

  const res = await fetch(`${ENIGMA}/api/v1/nodes/${nodeId}`, {
    method: 'DELETE',
    headers,
  }).catch(() => null)

  if (!res?.ok && res?.status !== 404) {
    return NextResponse.json({ error: 'Failed to delete node' }, { status: 500 })
  }

  return new Response(null, { status: 204 })
}
