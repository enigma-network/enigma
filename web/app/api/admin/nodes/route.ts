import { auth } from '@/lib/auth'
import { NextResponse } from 'next/server'

const ENIGMA = process.env.ENIGMA_SERVER_URL ?? 'http://localhost:8080'
const ADMIN_TOKEN = process.env.ENIGMA_ADMIN_TOKEN ?? ''

function enigmaHeaders(): Record<string, string> {
  return ADMIN_TOKEN ? { 'X-Admin-Token': ADMIN_TOKEN } : {}
}

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const limit = searchParams.get('limit') ?? '1250'
  const offset = searchParams.get('offset') ?? '0'
  const search = searchParams.get('search') ?? ''

  const url = new URL(`${ENIGMA}/api/v1/admin/nodes`)
  url.searchParams.set('limit', limit)
  url.searchParams.set('offset', offset)
  if (search) url.searchParams.set('search', search)

  try {
    const res = await fetch(url.toString(), { cache: 'no-store', headers: enigmaHeaders() })
    if (!res.ok) throw new Error(`upstream ${res.status}`)
    return NextResponse.json(await res.json())
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

  if (isProvider && !isAdmin) {
    const res = await fetch(`${ENIGMA}/api/v1/admin/nodes?limit=1&search=${nodeId}`, {
      cache: 'no-store', headers: enigmaHeaders(),
    }).catch(() => null)
    if (res?.ok) {
      const data = await res.json()
      const node = (data.nodes ?? []).find((n: { id: string; status: string }) => n.id === nodeId)
      if (node?.status === 'online') {
        return NextResponse.json({ error: 'Cannot delete an online node' }, { status: 403 })
      }
    }
  }

  const delRes = await fetch(`${ENIGMA}/api/v1/nodes/${nodeId}`, {
    method: 'DELETE',
    headers: enigmaHeaders(),
  }).catch(() => null)

  if (!delRes?.ok && delRes?.status !== 404) {
    return NextResponse.json({ error: 'Failed to delete node' }, { status: 500 })
  }

  return new Response(null, { status: 204 })
}
