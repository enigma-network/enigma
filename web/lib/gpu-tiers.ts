export interface Model {
  id: string
  label: string
  vram: number
  quality: number
}

export interface GpuPreset {
  models: string[]
  label: string
}

export interface GpuTier {
  id: string
  label: string
  vram: number
  hasNvidia: boolean
  presets: {
    depth: GpuPreset
    breadth: GpuPreset
  }
}

export const MODELS: Model[] = [
  { id: 'phi3:mini',   label: 'Phi-3 Mini',  vram: 2,  quality: 2 },
  { id: 'gemma3:4b',  label: 'Gemma 3 4B',  vram: 3,  quality: 3 },
  { id: 'gemma3:12b', label: 'Gemma 3 12B', vram: 7,  quality: 4 },
  { id: 'gemma3:27b', label: 'Gemma 3 27B', vram: 15, quality: 5 },
]

export const GPU_TIERS: GpuTier[] = [
  {
    id: 'cpu', label: 'CPU only (kein GPU)', vram: 0, hasNvidia: false,
    presets: {
      depth:   { models: ['phi3:mini'], label: 'phi3:mini ×1' },
      breadth: { models: ['phi3:mini'], label: 'phi3:mini ×1' },
    },
  },
  {
    id: 'gtx1060', label: 'GTX 1060 / RTX 2060 (6GB)', vram: 6, hasNvidia: true,
    presets: {
      depth:   { models: ['phi3:mini'], label: 'phi3:mini ×1' },
      breadth: { models: ['phi3:mini'], label: 'phi3:mini ×1' },
    },
  },
  {
    id: 'rtx3070', label: 'RTX 3070 (8GB)', vram: 8, hasNvidia: true,
    presets: {
      depth:   { models: ['gemma3:4b'],              label: 'gemma3:4b ×1' },
      breadth: { models: ['phi3:mini', 'phi3:mini'], label: 'phi3:mini ×2' },
    },
  },
  {
    id: 'rtx3060', label: 'RTX 3060 (12GB)', vram: 12, hasNvidia: true,
    presets: {
      depth:   { models: ['gemma3:12b'],              label: 'gemma3:12b ×1' },
      breadth: { models: ['gemma3:4b', 'gemma3:4b'], label: 'gemma3:4b ×2' },
    },
  },
  {
    id: 'rtx3080', label: 'RTX 3080 (16GB)', vram: 16, hasNvidia: true,
    presets: {
      depth:   { models: ['gemma3:12b'],                              label: 'gemma3:12b ×1' },
      breadth: { models: ['gemma3:4b', 'gemma3:4b', 'gemma3:4b'],  label: 'gemma3:4b ×3' },
    },
  },
  {
    id: 'rtx4070', label: 'RTX 4070 (12GB)', vram: 12, hasNvidia: true,
    presets: {
      depth:   { models: ['gemma3:12b'],              label: 'gemma3:12b ×1' },
      breadth: { models: ['gemma3:4b', 'gemma3:4b'], label: 'gemma3:4b ×2' },
    },
  },
  {
    id: 'rtx4080', label: 'RTX 4080 (16GB)', vram: 16, hasNvidia: true,
    presets: {
      depth:   { models: ['gemma3:12b'],                              label: 'gemma3:12b ×1' },
      breadth: { models: ['gemma3:4b', 'gemma3:4b', 'gemma3:4b'],  label: 'gemma3:4b ×3' },
    },
  },
  {
    id: 'rtx4090', label: 'RTX 4090 (24GB)', vram: 24, hasNvidia: true,
    presets: {
      depth:   { models: ['gemma3:27b'],               label: 'gemma3:27b ×1' },
      breadth: { models: ['gemma3:12b', 'gemma3:12b'], label: 'gemma3:12b ×2' },
    },
  },
  {
    id: 'dual4090', label: '2× RTX 4090 (48GB)', vram: 48, hasNvidia: true,
    presets: {
      depth:   { models: ['gemma3:12b', 'gemma3:12b', 'gemma3:12b', 'gemma3:12b'], label: 'gemma3:12b ×4' },
      breadth: { models: ['gemma3:4b', 'gemma3:4b', 'gemma3:4b', 'gemma3:4b',
                           'gemma3:4b', 'gemma3:4b', 'gemma3:4b', 'gemma3:4b'],   label: 'gemma3:4b ×8' },
    },
  },
]

export function getModel(id: string): Model {
  return MODELS.find(m => m.id === id) ?? { id, label: id, vram: 4, quality: 3 }
}

export function totalVram(modelIds: string[]): number {
  return modelIds.reduce((sum, id) => sum + getModel(id).vram, 0)
}

export function formatModelList(modelIds: string[]): string {
  const counts: Record<string, number> = {}
  modelIds.forEach(id => { counts[id] = (counts[id] ?? 0) + 1 })
  return Object.entries(counts).map(([id, n]) => `${id}${n > 1 ? ` ×${n}` : ''}`).join(', ')
}
