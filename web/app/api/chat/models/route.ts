import { NextResponse } from 'next/server'

const BASE = (process.env.ENIGMA_SERVER_URL ?? 'http://localhost:8080').replace(/\/$/, '')

export async function GET() {
  try {
    // Public nodes endpoint returns only online nodes
    const res = await fetch(`${BASE}/api/v1/nodes`, { cache: 'no-store' })
    if (!res.ok) return NextResponse.json({ models: [] })
    const nodes: { models: string[] }[] = await res.json()
    const modelSet = new Set<string>()
    for (const node of nodes) {
      if (Array.isArray(node.models)) node.models.forEach(m => modelSet.add(m))
    }
    return NextResponse.json({ models: Array.from(modelSet).sort() })
  } catch {
    return NextResponse.json({ models: [] })
  }
}
