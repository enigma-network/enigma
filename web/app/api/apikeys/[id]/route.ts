import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { NextResponse } from 'next/server'

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const deleted = await prisma.apiKey.deleteMany({
    where: { id, userId: session.user.id },
  })

  if (deleted.count === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return new Response(null, { status: 204 })
}
