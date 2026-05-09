import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { NextResponse } from 'next/server'

const ENIGMA = process.env.ENIGMA_SERVER_URL ?? 'http://localhost:8080'
const ADMIN_TOKEN = process.env.ENIGMA_ADMIN_TOKEN ?? ''

export async function POST() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'PROVIDER' && session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Provider only' }, { status: 403 })
  }

  const user = await prisma.user.findUnique({ where: { id: session.user.id } })
  if (!user?.nodeId) return NextResponse.json({ error: 'No node registered' }, { status: 400 })

  // Fetch node balance from enigma-server
  const headers: Record<string, string> = ADMIN_TOKEN ? { 'X-Admin-Token': ADMIN_TOKEN } : {}
  const res = await fetch(`${ENIGMA}/api/v1/nodes/${user.nodeId}/balance`, { headers }).catch(() => null)
  if (!res?.ok) return NextResponse.json({ error: 'Could not fetch node balance' }, { status: 503 })

  const { balance: serverBalance } = await res.json()
  if (!serverBalance || serverBalance <= 0) {
    return NextResponse.json({ synced: 0, message: 'No earnings to sync' })
  }

  // Check already synced amount
  const alreadySynced = await prisma.walletTransaction.aggregate({
    where: { userId: session.user.id, reason: 'node_earnings' },
    _sum: { amount: true },
  })
  const syncedSoFar = alreadySynced._sum.amount ?? 0
  const toSync = serverBalance - syncedSoFar

  if (toSync <= 0) {
    return NextResponse.json({ synced: 0, message: 'Already up to date' })
  }

  await prisma.walletTransaction.create({
    data: { userId: session.user.id, amount: toSync, reason: 'node_earnings' },
  })

  return NextResponse.json({ synced: toSync, message: `+${toSync.toFixed(3)} ENI synced from node earnings` })
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = await prisma.user.findUnique({ where: { id: session.user.id } })
  if (!user?.nodeId) return NextResponse.json({ nodeBalance: 0, syncedBalance: 0 })

  const headers: Record<string, string> = ADMIN_TOKEN ? { 'X-Admin-Token': ADMIN_TOKEN } : {}
  const res = await fetch(`${ENIGMA}/api/v1/nodes/${user.nodeId}/balance`, { headers }).catch(() => null)
  const nodeBalance = res?.ok ? (await res.json()).balance ?? 0 : 0

  const synced = await prisma.walletTransaction.aggregate({
    where: { userId: session.user.id, reason: 'node_earnings' },
    _sum: { amount: true },
  })

  return NextResponse.json({ nodeBalance, syncedBalance: synced._sum.amount ?? 0 })
}
