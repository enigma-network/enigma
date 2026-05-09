import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'

export default async function OnboardPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>
}) {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')

  const params = await searchParams
  const requestedRole = params.role === 'PROVIDER' ? 'PROVIDER' : 'USER'

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { transactions: { where: { reason: 'start_bonus' } } },
  })

  if (!user) redirect('/login')

  if (user.role !== 'ADMIN' && user.role !== requestedRole) {
    await prisma.user.update({
      where: { id: user.id },
      data: { role: requestedRole },
    })
  }

  if (user.transactions.length === 0) {
    await prisma.walletTransaction.create({
      data: { userId: user.id, amount: 10.0, reason: 'start_bonus' },
    })
  }

  redirect(requestedRole === 'PROVIDER' ? '/setup' : '/dashboard')
}
