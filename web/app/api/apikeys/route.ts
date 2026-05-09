import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { generateKey } from '@/lib/apikey'
import { NextResponse } from 'next/server'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const keys = await prisma.apiKey.findMany({
    where: { userId: session.user.id },
    select: { id: true, name: true, createdAt: true, lastUsedAt: true },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json(keys)
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { name } = await req.json().catch(() => ({}))

  const existing = await prisma.apiKey.count({ where: { userId: session.user.id } })
  if (existing >= 5) {
    return NextResponse.json({ error: 'Maximum 5 API keys per user' }, { status: 400 })
  }

  const key = generateKey()
  const record = await prisma.apiKey.create({
    data: { key, name: name || 'Default', userId: session.user.id },
  })

  return NextResponse.json({ id: record.id, name: record.name, key, createdAt: record.createdAt })
}
