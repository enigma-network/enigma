'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const links = [
  { href: '/dashboard', label: 'Overview', icon: '📊' },
  { href: '/chat', label: 'Chat', icon: '💬' },
  { href: '/dashboard/setup', label: 'Setup', icon: '⚙️' },
  { href: '/dashboard/nodes', label: 'Nodes', icon: '🖥️' },
  { href: '/dashboard/jobs', label: 'Jobs', icon: '⚡' },
  { href: '/dashboard/ledger', label: 'Ledger', icon: '💰' },
  { href: '/dashboard/logs', label: 'Logs', icon: '📄' },
]

export function Sidebar({ userEmail }: { userEmail?: string | null }) {
  const pathname = usePathname()

  return (
    <aside
      style={{ width: '220px', minHeight: '100vh', background: '#0f172a', borderRight: '1px solid #1e293b', flexShrink: 0 }}
      className="flex flex-col"
    >
      <div className="p-4 border-b border-slate-800">
        <span className="text-green-400 font-bold text-sm tracking-wider">ENIGMA</span>
      </div>

      <nav className="flex-1 p-2">
        {links.map((link) => {
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

      <div className="p-4 border-t border-slate-800 space-y-1">
        <Link href="/profile" className="text-slate-500 hover:text-slate-300 text-xs truncate block">
          {userEmail ?? 'Account'}
        </Link>
      </div>
    </aside>
  )
}
