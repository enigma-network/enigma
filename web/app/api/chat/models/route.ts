import { fetchNodes } from '@/lib/enigma'
import { NextResponse } from 'next/server'

export async function GET() {
  try {
    const nodes = await fetchNodes()
    const online = nodes.filter(n => n.status === 'online')
    const modelSet = new Set<string>()
    for (const node of online) {
      try {
        const models: string[] = JSON.parse(node.models)
        models.forEach(m => modelSet.add(m))
      } catch { /* ignore parse errors */ }
    }
    return NextResponse.json({ models: Array.from(modelSet).sort() })
  } catch {
    return NextResponse.json({ models: [] })
  }
}
