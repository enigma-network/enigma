import { auth, signOut } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { ClaimButton } from '@/components/ClaimButton'
import { Logo } from '@/components/Logo'

export default async function ProfilePage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: {
      transactions: { orderBy: { createdAt: 'desc' }, take: 10 },
    },
  })

  if (!user) redirect('/login')

  const balance = user.transactions.reduce((sum, t) => sum + t.amount, 0)

  return (
    <div className="min-h-screen p-8" style={{ background: '#0f172a' }}>
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <Logo className="text-2xl" />
          <div className="flex gap-4">
            <a href="/dashboard" className="text-slate-400 hover:text-white text-sm">← Dashboard</a>
            <form action={async () => {
              'use server'
              await signOut({ redirectTo: '/login' })
            }}>
              <button type="submit" className="text-red-400 hover:text-red-300 text-sm">Abmelden</button>
            </form>
          </div>
        </div>

        <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 mb-6">
          <div className="flex items-center gap-4 mb-4">
            {user.image && <img src={user.image} alt="" className="w-12 h-12 rounded-full" />}
            <div>
              <p className="text-white font-medium">{user.name ?? 'Unbekannt'}</p>
              <p className="text-slate-400 text-sm">{user.email}</p>
            </div>
            <span className={`ml-auto text-xs px-2 py-1 rounded-full font-medium ${
              user.role === 'PROVIDER' ? 'bg-green-900 text-green-300' :
              user.role === 'ADMIN' ? 'bg-purple-900 text-purple-300' :
              'bg-blue-900 text-blue-300'
            }`}>{user.role}</span>
          </div>
          <div className="bg-slate-900 rounded-lg p-4 flex items-center justify-between">
            <span className="text-slate-400 text-sm">ENI-Balance</span>
            <div className="flex items-center gap-3">
              <span className="text-yellow-400 font-bold text-xl">{balance.toFixed(3)} ENI</span>
              <ClaimButton />
            </div>
          </div>
        </div>

        <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
          <h2 className="text-white font-semibold mb-4">Letzte Transaktionen</h2>
          {user.transactions.length === 0 ? (
            <p className="text-slate-500 text-sm">Keine Transaktionen</p>
          ) : (
            <div className="space-y-2">
              {user.transactions.map((tx) => (
                <div key={tx.id} className="flex items-center justify-between py-2 border-b border-slate-700 last:border-0">
                  <div>
                    <p className="text-slate-300 text-sm">{tx.reason}</p>
                    <p className="text-slate-500 text-xs">{new Date(tx.createdAt).toLocaleString('de-DE')}</p>
                  </div>
                  <span className={`font-medium text-sm ${tx.amount >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {tx.amount >= 0 ? '+' : ''}{tx.amount.toFixed(2)} ENI
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
