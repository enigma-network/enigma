import { signIn } from '@/lib/auth'

export default function JoinProviderPage() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#0f172a' }}>
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-8 w-full max-w-sm">
        <div className="bg-green-900/30 border border-green-700 rounded-lg px-4 py-3 mb-6">
          <p className="text-green-300 text-sm font-medium">🖥️ Provider-Account</p>
          <p className="text-green-400 text-xs mt-1">Stelle deinen LLM bereit und verdiene ENI-Token für jede Anfrage.</p>
        </div>
        <h1 className="text-xl font-bold text-white mb-6">Als Provider registrieren</h1>
        <form action={async () => {
          'use server'
          await signIn('google', { redirectTo: '/onboard?role=PROVIDER' })
        }}>
          <button type="submit"
            className="w-full bg-white text-slate-900 font-medium py-2.5 px-4 rounded-lg hover:bg-slate-100 transition mb-3">
            Mit Google registrieren
          </button>
        </form>
        <form action={async () => {
          'use server'
          await signIn('github', { redirectTo: '/onboard?role=PROVIDER' })
        }}>
          <button type="submit"
            className="w-full bg-slate-700 text-white font-medium py-2.5 px-4 rounded-lg hover:bg-slate-600 transition">
            Mit GitHub registrieren
          </button>
        </form>
        <p className="text-slate-500 text-xs text-center mt-6">
          <a href="/join/user" className="text-blue-400 hover:underline">Ich bin User</a>
          {' · '}
          <a href="/login" className="text-slate-400 hover:underline">Einloggen</a>
        </p>
      </div>
    </div>
  )
}
