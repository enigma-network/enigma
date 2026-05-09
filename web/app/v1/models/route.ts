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
      } catch { /* skip */ }
    }
    const models = Array.from(modelSet).sort().map(id => ({
      id,
      object: 'model',
      created: Math.floor(Date.now() / 1000),
      owned_by: 'enigma-network',
    }))
    return NextResponse.json({ object: 'list', data: models })
  } catch {
    return NextResponse.json({ object: 'list', data: [] })
  }
}
