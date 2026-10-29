// Plans en mètres, repère écran : x vers la droite, y vers le bas, « haut du plan » = y décroissant.

export interface Pt { x: number; y: number }

export type Category = 'mode' | 'resto' | 'loisirs' | 'maison' | 'beaute' | 'services' | 'alimentaire'

export interface Shop { name: string; cat: Category; x: number; y: number; w: number; h: number }

export interface PlanData {
  name: string
  width: number
  height: number
  /** Demi-largeur des couloirs (m) */
  halfWidth: number
  /** Axes des couloirs : chaque polyligne est une suite de points */
  corridors: Pt[][]
  shops: Shop[]
  /** Points de recalage (QR / NFC), appelés via ?anchor=<id> ; le premier est le départ par défaut */
  anchors: Record<string, Pt & { label: string }>
  /** Trajets enchaînés par la démo : noms de boutiques ou id de points de recalage */
  demoTrips: string[]
}

export interface Seg { a: Pt; b: Pt }

export class Plan {
  readonly segs: Seg[]

  constructor(readonly data: PlanData) {
    this.segs = data.corridors.flatMap(line => line.slice(1).map((b, i) => ({ a: line[i], b })))
  }

  /** Point le plus proche sur l'axe d'un couloir */
  nearestOnAxis(p: Pt): { pt: Pt; dist: number; seg: number; t: number } {
    let best = { pt: p, dist: Infinity, seg: 0, t: 0 }
    this.segs.forEach(({ a, b }, i) => {
      const dx = b.x - a.x, dy = b.y - a.y
      const len2 = dx * dx + dy * dy
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
      const q = { x: a.x + t * dx, y: a.y + t * dy }
      const d = Math.hypot(p.x - q.x, p.y - q.y)
      if (d < best.dist) best = { pt: q, dist: d, seg: i, t }
    })
    return best
  }

  walkable(x: number, y: number): boolean {
    return this.nearestOnAxis({ x, y }).dist <= this.data.halfWidth
  }

  /** Ramène un point dans la zone marchable */
  snap(p: Pt): Pt {
    const { pt, dist } = this.nearestOnAxis(p)
    if (dist <= this.data.halfWidth) return p
    const k = (this.data.halfWidth * 0.9) / dist
    return { x: pt.x + (p.x - pt.x) * k, y: pt.y + (p.y - pt.y) * k }
  }

  shopAt(p: Pt): Shop | undefined {
    return this.data.shops.find(s => p.x >= s.x && p.x <= s.x + s.w && p.y >= s.y && p.y <= s.y + s.h)
  }

  /** Destination nommée (boutique ou point de recalage) → point d'arrivée dans un couloir */
  destination(id: string): { label: string; pt: Pt; shop?: Shop } | undefined {
    const anchor = this.data.anchors[id]
    if (anchor) return { label: anchor.label, pt: anchor }
    const shop = this.data.shops.find(s => s.name === id)
    if (shop) return { label: shop.name, pt: this.nearestOnAxis({ x: shop.x + shop.w / 2, y: shop.y + shop.h / 2 }).pt, shop }
  }
}

// ─── Grand centre commercial fictif : 140 m × 244 m, 3 allées nord-sud, 5 allées est-ouest ───

const ROWS_Y = [30, 80, 130, 180, 220]
const BLOCK_COLS: [number, number][] = [[4, 21], [29, 66], [74, 111], [119, 136]]
const BLOCK_ROWS: [number, number][] = [[34, 76], [84, 126], [134, 176], [184, 216]]

// Grandes surfaces occupant un îlot entier : clé « colonne,rangée »
const ANCHOR_STORES: Record<string, [string, Category]> = {
  '1,0': ['Hyper Marché Central', 'alimentaire'],
  '2,0': ['Maison & Déco XXL', 'maison'],
  '2,2': ['Cinéma Le Grand Écran', 'loisirs'],
  '1,3': ['Espace Restauration', 'resto'],
}

const NAMES: [string, Category][] = [
  ['Mode & Co', 'mode'], ['Café Lumière', 'resto'], ['Pharmacie', 'services'], ['Librairie Page', 'loisirs'],
  ['Beauté+', 'beaute'], ['Urban Style', 'mode'], ['Sushi Zen', 'resto'], ['Tech Store', 'services'],
  ['Maison Nature', 'maison'], ['Jouets & Cie', 'loisirs'], ['Denim Lab', 'mode'], ['Optique Vue', 'beaute'],
  ['Burger Factory', 'resto'], ['Téléphonie Mobile', 'services'], ['Cuisine & Art', 'maison'], ['Game Zone', 'loisirs'],
  ['Petit Prince Kids', 'mode'], ['Parfums d’Ailleurs', 'beaute'], ['Boulangerie Dorée', 'resto'], ['Pressing Express', 'services'],
  ['Musique Plus', 'loisirs'], ['Chaussures 21', 'mode'], ['Lumière Déco', 'maison'], ['Coiffure Studio', 'beaute'],
  ['Glacier Polaire', 'resto'], ['Banque Proxi', 'services'], ['Lingerie Douce', 'mode'], ['Fleurs du Jour', 'loisirs'],
  ['Bijoux Éclat', 'beaute'], ['Thé & Toi', 'resto'], ['Clés Minute', 'services'], ['Sport Max', 'mode'],
  ['Literie Confort', 'maison'], ['Animalerie Câline', 'loisirs'], ['Atelier Cuir', 'mode'], ['Point Relais', 'services'],
]

function buildMallShops(): Shop[] {
  const shops: Shop[] = []
  let k = 0
  const next = (x: number, y: number, w: number, h: number) => {
    const [name, cat] = NAMES[k++ % NAMES.length]
    shops.push({ name, cat, x, y, w, h })
  }
  // Îlots entre les allées : grande surface, ou deux boutiques (une sur chaque allée)
  BLOCK_ROWS.forEach(([y0, y1], r) => BLOCK_COLS.forEach(([x0, x1], c) => {
    const big = ANCHOR_STORES[`${c},${r}`]
    if (big) return shops.push({ name: big[0], cat: big[1], x: x0, y: y0, w: x1 - x0, h: y1 - y0 })
    const mid = (y0 + y1) / 2
    next(x0, y0, x1 - x0, mid - y0)
    next(x0, mid, x1 - x0, y1 - mid)
  }))
  // Rangées nord et sud : trois boutiques de chaque côté de l'allée centrale
  for (const [y0, y1] of [[6, 26], [224, 240]]) {
    for (const [x0, x1] of [[8, 66], [74, 132]]) {
      const w = (x1 - x0) / 3
      for (let i = 0; i < 3; i++) next(x0 + i * w, y0, w, y1 - y0)
    }
  }
  return shops
}

const mall: PlanData = {
  name: 'Grand centre commercial (fictif)',
  width: 140,
  height: 244,
  halfWidth: 3.5,
  corridors: [
    [{ x: 70, y: 4 }, { x: 70, y: 240 }],
    [{ x: 25, y: 30 }, { x: 25, y: 220 }],
    [{ x: 115, y: 30 }, { x: 115, y: 220 }],
    ...ROWS_Y.map(y => [{ x: 4, y }, { x: 136, y }]),
  ],
  shops: buildMallShops(),
  anchors: {
    'parking': { x: 136, y: 220, label: 'Parking P2' },
    'entree-nord': { x: 70, y: 4, label: 'Entrée Nord' },
    'entree-sud': { x: 70, y: 240, label: 'Entrée Sud' },
    'entree-ouest': { x: 4, y: 130, label: 'Entrée Ouest' },
    'entree-est': { x: 136, y: 80, label: 'Entrée Est' },
  },
  demoTrips: ['Cinéma Le Grand Écran', 'Sushi Zen', 'Pharmacie', 'Hyper Marché Central', 'parking'],
}

// Plan de test à adapter à votre couloir / appartement (?plan=test).
// Mesurez votre trajet en mètres et remplacez les points ci-dessous.
const test: PlanData = {
  name: 'Plan de test',
  width: 12,
  height: 16,
  halfWidth: 0.8,
  corridors: [
    [{ x: 2, y: 2 }, { x: 2, y: 13 }, { x: 10, y: 13 }],
  ],
  shops: [],
  anchors: {
    'depart': { x: 2, y: 2, label: 'Départ' },
    'fin': { x: 10, y: 13, label: 'Fin du couloir' },
  },
  demoTrips: ['fin', 'depart'],
}

export const PLANS: Record<string, PlanData> = { mall, test }
