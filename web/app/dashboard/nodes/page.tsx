import { auth } from '@/lib/auth'
import { NodesTable } from '@/components/NodesTable'

export const revalidate = 0

export default async function NodesPage() {
  const session = await auth()
  const canDelete = session?.user?.role === 'PROVIDER' || session?.user?.role === 'ADMIN'
  return <NodesTable canDelete={canDelete} />
}
