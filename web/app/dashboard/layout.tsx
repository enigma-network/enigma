import { auth } from '@/lib/auth'
import { Sidebar } from '@/components/Sidebar'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#0f172a' }}>
      <Sidebar userEmail={session?.user?.email} userRole={session?.user?.role} />
      <main className="flex-1 p-6 overflow-auto">{children}</main>
    </div>
  )
}
