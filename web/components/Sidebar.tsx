'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'

const links = [
  { href: '/dashboard', label: 'Overview', icon: '📊', roles: null },
  { href: '/chat', label: 'Chat', icon: '💬', roles: null },
  { href: '/dashboard/setup', label: 'Setup', icon: '⚙️', roles: ['PROVIDER', 'ADMIN'] },
  { href: '/dashboard/nodes', label: 'Nodes', icon: '🖥️', roles: null },
  { href: '/dashboard/jobs', label: 'Jobs', icon: '⚡', roles: null },
  { href: '/dashboard/ledger', label: 'Ledger', icon: '💰', roles: null },
  { href: '/dashboard/logs', label: 'Logs', icon: '📄', roles: null },
]

const ROLE_COLORS: Record<string, string> = {
  ADMIN:    'bg-purple-900 text-purple-300',
  PROVIDER: 'bg-green-900 text-green-300',
  USER:     'bg-blue-900 text-blue-300',
}

export function Sidebar({ userEmail, userRole }: { userEmail?: string | null; userRole?: string | null }) {
  const pathname = usePathname()
  const router = useRouter()
  const role = userRole ?? 'USER'
  const isLoggedIn = !!userEmail

  const visibleLinks = links.filter(link =>
    link.roles === null || link.roles.includes(role)
  )

  return (
    <aside
      style={{ width: '220px', minHeight: '100vh', background: '#0f172a', borderRight: '1px solid #1e293b', flexShrink: 0 }}
      className="flex flex-col"
    >
      <div className="p-4 border-b border-slate-800">
        <span className="text-green-400 font-bold text-sm tracking-wider">ENIGMA</span>
      </div>

      <nav className="flex-1 p-2">
        {visibleLinks.map((link) => {
          const isActive =
            pathname === link.href ||
            (link.href !== '/dashboard' && pathname.startsWith(link.href))
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg mb-1 text-sm transition-colors ${
                isActive
                  ? 'bg-slate-700 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              <span>{link.icon}</span>
              <span>{link.label}</span>
            </Link>
          )
        })}
      </nav>

      <div className="p-4 border-t border-slate-800 space-y-2">
        {isLoggedIn ? (
          <>
            <span className={`text-xs px-2 py-1 rounded-full font-medium ${ROLE_COLORS[role] ?? ROLE_COLORS.USER}`}>
              {role}
            </span>
            <Link href="/profile" className="text-slate-500 hover:text-slate-300 text-xs truncate block">
              {userEmail}
            </Link>
            <button
              onClick={async () => {
                await fetch('/api/auth/signout', { method: 'POST' })
                router.push('/login')
                router.refresh()
              }}
              className="text-red-400 hover:text-red-300 text-xs w-full text-left"
            >
              Abmelden
            </button>
          </>
        ) : (
          <Link href="/login" className="text-green-400 hover:text-green-300 text-xs font-medium">
            Anmelden →
          </Link>
        )}
      </div>
    </aside>
  )
}
