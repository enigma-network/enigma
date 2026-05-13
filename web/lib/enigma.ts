function normalizeBase(url: string): string {
  if (!url.startsWith('http://') && !url.startsWith('https://')) return 'https://' + url
  return url
}
const BASE = normalizeBase(process.env.ENIGMA_SERVER_URL ?? 'http://localhost:8080')
const ADMIN_TOKEN = process.env.ENIGMA_ADMIN_TOKEN ?? ''

function headers(): HeadersInit {
  return ADMIN_TOKEN ? { 'X-Admin-Token': ADMIN_TOKEN } : {}
}

export interface EnigmaNode {
  id: string
  address: string
  backend: string
  models: string
  gpu_model: string
  benchmark_score: number
  avg_rating: number
  reliability: number
  status: string
  last_heartbeat: string
}

export interface EnigmaJob {
  id: string
  prompt: string
  model: string
  status: string
  assigned_node: string
  result: string
  duration_ms: number
  created_at: string
  completed_at: string
}

export interface EnigmaLedgerEntry {
  id: number
  node_id: string
  amount: number
  reason: string
  created_at: string
}

export interface EnigmaStats {
  nodes_online: number
  jobs_total: number
  eni_total: number
  jobs_last_hour: number
}

export async function fetchStats(): Promise<EnigmaStats> {
  const res = await fetch(`${BASE}/api/v1/admin/stats`, { next: { revalidate: 0 }, headers: headers() })
  if (!res.ok) throw new Error(`enigma stats failed: ${res.status}`)
  return res.json()
}

export async function fetchNodes(): Promise<EnigmaNode[]> {
  const res = await fetch(`${BASE}/api/v1/admin/nodes`, { next: { revalidate: 0 }, headers: headers() })
  if (!res.ok) throw new Error(`enigma nodes failed: ${res.status}`)
  return res.json()
}

export async function fetchJobs(limit = 50): Promise<EnigmaJob[]> {
  const res = await fetch(`${BASE}/api/v1/admin/jobs?limit=${limit}`, { next: { revalidate: 0 }, headers: headers() })
  if (!res.ok) throw new Error(`enigma jobs failed: ${res.status}`)
  return res.json()
}

export async function fetchLedger(limit = 50): Promise<EnigmaLedgerEntry[]> {
  const res = await fetch(`${BASE}/api/v1/admin/ledger?limit=${limit}`, { next: { revalidate: 0 }, headers: headers() })
  if (!res.ok) throw new Error(`enigma ledger failed: ${res.status}`)
  return res.json()
}

export interface ServerInstances {
  count: number
  instances: string[]
}

export async function fetchInstances(): Promise<ServerInstances> {
  const res = await fetch(`${BASE}/api/v1/admin/instances`, { next: { revalidate: 0 }, headers: headers() })
  if (!res.ok) return { count: 0, instances: [] }
  return res.json()
}
