import { auth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'

export async function GET() {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const logPath = resolve(process.env.ENIGMA_LOG_PATH ?? '../enigma.log')

  if (!existsSync(logPath)) {
    return NextResponse.json({ lines: [] })
  }

  try {
    const content = readFileSync(logPath, 'utf-8')
    const lines = content.trim().split('\n').slice(-100).filter(Boolean)
    return NextResponse.json({ lines })
  } catch {
    return NextResponse.json({ lines: [] })
  }
}
