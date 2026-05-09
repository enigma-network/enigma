import { fetchNodes } from '@/lib/enigma'
import { NextResponse } from 'next/server'

export async function GET() {
  try {
    const nodes = await fetchNodes()
    const online = nodes.filter(n => n.status === 'online')
    const modelSet = new Set<string>()
    for (const node of online) {
      try { JSON.parse(node.models).forEach((m: string) => modelSet.add(m)) } catch { /* skip */ }
    }
    const models = Array.from(modelSet).sort().map(name => ({
      name,
      model: name,
      modified_at: new Date().toISOString(),
      size: 0,
      digest: '',
      details: { format: 'gguf', family: name.split(':')[0], parameter_size: '', quantization_level: '' },
    }))
    return NextResponse.json({ models })
  } catch {
    return NextResponse.json({ models: [] })
  }
}
