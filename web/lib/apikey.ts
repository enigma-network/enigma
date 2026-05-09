import { prisma } from './prisma'
import { randomBytes } from 'crypto'

export function generateKey(): string {
  return 'enk_' + randomBytes(24).toString('hex')
}

export async function resolveApiKey(authHeader: string | null): Promise<{
  userId: string
  keyId: string
} | null> {
  if (!authHeader?.startsWith('Bearer ')) return null
  const key = authHeader.slice(7).trim()
  if (!key.startsWith('enk_')) return null

  const record = await prisma.apiKey.findUnique({ where: { key } })
  if (!record) return null

  await prisma.apiKey.update({
    where: { id: record.id },
    data: { lastUsedAt: new Date() },
  })

  return { userId: record.userId, keyId: record.id }
}

export async function getUserBalance(userId: string): Promise<number> {
  const txs = await prisma.walletTransaction.findMany({ where: { userId } })
  return txs.reduce((s, t) => s + t.amount, 0)
}
