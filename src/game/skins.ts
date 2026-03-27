export type SkinId =
  | 'default'
  | 'coral'
  | 'mint'
  | 'sunset'
  | 'violet'
  | 'gold'
  | 'rose'
  | 'safezone'

export type SkinDef = {
  id: SkinId
  name: string
  /** 0 = free starter */
  price: number
  headColor: number
  headEmissive: number
  headEmissiveIntensity: number
  ringColor: number
  ringEmissive: number
  ringEmissiveIntensity: number
}

const COINS_KEY = 'pacmanscrabble_coins_v1'
const OWNED_KEY = 'pacmanscrabble_owned_skins_v1'
const EQUIPPED_KEY = 'pacmanscrabble_equipped_skin_v1'

export const SKINS: SkinDef[] = [
  {
    id: 'default',
    name: 'Neon Blue',
    price: 0,
    headColor: 0x33a1ff,
    headEmissive: 0x33a1ff,
    headEmissiveIntensity: 0.6,
    ringColor: 0x1a66cc,
    ringEmissive: 0x1144aa,
    ringEmissiveIntensity: 0.35,
  },
  {
    id: 'coral',
    name: 'Coral',
    price: 40,
    headColor: 0xff6b6b,
    headEmissive: 0xff4444,
    headEmissiveIntensity: 0.58,
    ringColor: 0xcc3344,
    ringEmissive: 0xaa2233,
    ringEmissiveIntensity: 0.34,
  },
  {
    id: 'mint',
    name: 'Mint',
    price: 40,
    headColor: 0x3ee8a8,
    headEmissive: 0x22cc88,
    headEmissiveIntensity: 0.55,
    ringColor: 0x1a9970,
    ringEmissive: 0x116650,
    ringEmissiveIntensity: 0.33,
  },
  {
    id: 'sunset',
    name: 'Sunset',
    price: 55,
    headColor: 0xff9933,
    headEmissive: 0xff6622,
    headEmissiveIntensity: 0.62,
    ringColor: 0xcc6620,
    ringEmissive: 0xaa4418,
    ringEmissiveIntensity: 0.36,
  },
  {
    id: 'violet',
    name: 'Violet',
    price: 55,
    headColor: 0xb366ff,
    headEmissive: 0x8844ee,
    headEmissiveIntensity: 0.6,
    ringColor: 0x6633aa,
    ringEmissive: 0x442288,
    ringEmissiveIntensity: 0.35,
  },
  {
    id: 'gold',
    name: 'Gold',
    price: 120,
    headColor: 0xffdd44,
    headEmissive: 0xffaa00,
    headEmissiveIntensity: 0.72,
    ringColor: 0xcc9900,
    ringEmissive: 0xaa7700,
    ringEmissiveIntensity: 0.4,
  },
  {
    id: 'rose',
    name: 'Rose',
    price: 70,
    headColor: 0xff66aa,
    headEmissive: 0xff4488,
    headEmissiveIntensity: 0.58,
    ringColor: 0xcc4488,
    ringEmissive: 0xaa3366,
    ringEmissiveIntensity: 0.34,
  },
  /** Matches idle safe-zone panel: deep violet fill + cool blue wash + rainbow-edge feel. */
  {
    id: 'safezone',
    name: 'Safe Zone',
    price: 75,
    headColor: 0x181028,
    headEmissive: 0x6a78f0,
    headEmissiveIntensity: 0.62,
    ringColor: 0x0a0618,
    ringEmissive: 0x4c58c8,
    ringEmissiveIntensity: 0.42,
  },
]

export function skinById(id: string): SkinDef | undefined {
  return SKINS.find((s) => s.id === id)
}

export function loadCoins(): number {
  try {
    const v = localStorage.getItem(COINS_KEY)
    if (v == null) return 0
    const n = parseInt(v, 10)
    return Number.isFinite(n) ? Math.max(0, n) : 0
  } catch {
    return 0
  }
}

export function saveCoins(n: number): void {
  try {
    localStorage.setItem(COINS_KEY, String(Math.max(0, Math.floor(n))))
  } catch {
    /* ignore */
  }
}

export function loadOwnedSkins(): Set<SkinId> {
  const set = new Set<SkinId>(['default'])
  try {
    const raw = localStorage.getItem(OWNED_KEY)
    if (!raw) return set
    const arr = JSON.parse(raw) as unknown
    if (!Array.isArray(arr)) return set
    for (const x of arr) {
      if (typeof x === 'string' && SKINS.some((s) => s.id === x)) set.add(x as SkinId)
    }
  } catch {
    /* ignore */
  }
  return set
}

export function saveOwnedSkins(owned: Set<SkinId>): void {
  try {
    localStorage.setItem(OWNED_KEY, JSON.stringify([...owned]))
  } catch {
    /* ignore */
  }
}

export function loadEquippedSkinId(): SkinId {
  try {
    const v = localStorage.getItem(EQUIPPED_KEY)
    if (v && SKINS.some((s) => s.id === v)) return v as SkinId
  } catch {
    /* ignore */
  }
  return 'default'
}

export function saveEquippedSkinId(id: SkinId): void {
  try {
    localStorage.setItem(EQUIPPED_KEY, id)
  } catch {
    /* ignore */
  }
}
