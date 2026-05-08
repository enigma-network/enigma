import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { NextResponse } from 'next/server'

const DAILY_AMOUNT = 10.0

export async function POST() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)

  const alreadyClaimed = await prisma.walletTransaction.findFirst({
    where: {
      userId: session.user.id,
      reason: 'daily_claim',
      createdAt: { gte: today },
    },
  })

  if (alreadyClaimed) {
    const tomorrow = new Date(today)
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
    const hoursLeft = Math.ceil((tomorrow.getTime() - Date.now()) / 3600000)
    return NextResponse.json(
      { error: `Bereits heute geclaimed. Nächster Claim in ${hoursLeft}h.` },
      { status: 429 }
    )
  }

  await prisma.walletTransaction.create({
    data: { userId: session.user.id, amount: DAILY_AMOUNT, reason: 'daily_claim' },
  })

  return NextResponse.json({ amount: DAILY_AMOUNT, message: `+${DAILY_AMOUNT} ENI gutgeschrieben` })
}
