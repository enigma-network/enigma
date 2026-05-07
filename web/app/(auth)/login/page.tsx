import { signIn } from '@/lib/auth'

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#0f172a' }}>
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-8 w-full max-w-sm">
        <h1 className="text-2xl font-bold text-white mb-2">Enigma Network</h1>
        <p className="text-slate-400 text-sm mb-8">Melde dich an um fortzufahren</p>

        <form action={async () => {
          'use server'
          await signIn('google', { redirectTo: '/dashboard' })
        }}>
          <button type="submit"
            className="w-full bg-white text-slate-900 font-medium py-2.5 px-4 rounded-lg hover:bg-slate-100 transition mb-3">
            Mit Google anmelden
          </button>
        </form>

        <form action={async () => {
          'use server'
          await signIn('github', { redirectTo: '/dashboard' })
        }}>
          <button type="submit"
            className="w-full bg-slate-700 text-white font-medium py-2.5 px-4 rounded-lg hover:bg-slate-600 transition">
            Mit GitHub anmelden
          </button>
        </form>

        <p className="text-slate-500 text-xs text-center mt-6">
          Noch kein Konto?{' '}
          <a href="/join/user" className="text-green-400 hover:underline">Als User registrieren</a>
          {' · '}
          <a href="/join/provider" className="text-green-400 hover:underline">Als Provider</a>
        </p>
      </div>
    </div>
  )
}
