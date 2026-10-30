// Plans en mètres, repère écran : x vers la droite, y vers le bas, « haut du plan » = y décroissant.
// Plusieurs niveaux superposés partagent ce repère ; ils sont reliés par des connecteurs (escalator, ascenseur…).

export interface Pt { x: number; y: number }

export type Category = 'mode' | 'resto' | 'loisirs' | 'maison' | 'beaute' | 'services' | 'alimentaire' | 'parking'

export interface Shop { name: string; cat: Category; x: number; y: number; w: number; h: number }

export type ConnectorKind = 'escalator' | 'ascenseur' | 'escalier'

/** Liaison verticale, placée sur l'axe d'un couloir de chaque niveau desservi */
export interface Connector extends Pt { kind: ConnectorKind; floors: number[] }

export type AmenityKind = 'sortie' | 'toilettes' | 'securite' | 'accueil' | 'secours' | 'bebe' | 'dab' | 'recharge'

/** Service du centre signalé sur la carte (pictogramme) */
export interface Amenity extends Pt {
  kind: AmenityKind
  floor: number
  /** Libellé propre (sinon celui de AMENITY_INFO) */
  label?: string
  /** Lignes de RER desservies par cette sortie, affichées sur le panneau */
  rer?: string[]
}

/** Libellé et mots-clés de recherche des services */
export const AMENITY_INFO: Record<AmenityKind, { label: string; keywords: string }> = {
  sortie: { label: 'Sortie', keywords: 'sortie exit porte issue' },
  toilettes: { label: 'Toilettes', keywords: 'toilettes wc sanitaires' },
  securite: { label: 'Poste de sécurité', keywords: 'securite agent vigile objets trouves' },
  accueil: { label: 'Accueil · Information', keywords: 'accueil information renseignements' },
  secours: { label: 'Premiers secours', keywords: 'secours infirmerie urgence sante' },
  bebe: { label: 'Espace bébé', keywords: 'bebe change allaitement poussette' },
  dab: { label: 'Distributeur de billets', keywords: 'dab distributeur argent retrait banque' },
  recharge: { label: 'Borne de recharge', keywords: 'recharge voiture electrique borne' },
}

/** Point chaud de la carte de fréquentation simulée (onglet Fréquentation) */
export interface HeatSpot extends Pt {
  floor: number
  /** Intensité au pic de son profil horaire */
  w: number
  /** Rayon d'influence (m) */
  r: number
  profile: 'flux' | 'repas' | 'soir' | 'courses' | 'navette'
}

/** Bon plan d'une enseigne : étiquette courte sur la carte + texte de l'offre flash */
export interface Promo { shop: string; tag: string; offer: string }

export interface FloorData {
  name: string
  short: string
  /** Axes des couloirs : chaque polyligne est une suite de points */
  corridors: Pt[][]
  shops: Shop[]
}

export interface PlanData {
  name: string
  width: number
  height: number
  /** Demi-largeur des couloirs (m) */
  halfWidth: number
  /** Niveaux, du plus bas au plus haut (l'index sert d'identifiant) */
  floors: FloorData[]
  connectors: Connector[]
  amenities: Amenity[]
  promos: Promo[]
  /** Données de démo de l'onglet Fréquentation */
  heatSpots: HeatSpot[]
  /** Points de recalage (QR / NFC), appelés via ?anchor=<id> ; le premier est le départ par défaut */
  anchors: Record<string, Pt & { label: string; floor: number }>
  /** Trajets enchaînés par la démo : noms de boutiques ou id de points de recalage */
  demoTrips: string[]
}

export interface Seg { a: Pt; b: Pt }

export interface Destination { label: string; pt: Pt; floor: number; shop?: Shop }

/** Un niveau : géométrie des couloirs (zone marchable) */
export class Floor {
  readonly segs: Seg[]

  constructor(readonly index: number, readonly data: FloorData, readonly halfWidth: number) {
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
    return this.nearestOnAxis({ x, y }).dist <= this.halfWidth
  }

  /** Ramène un point dans la zone marchable */
  snap(p: Pt): Pt {
    const { pt, dist } = this.nearestOnAxis(p)
    if (dist <= this.halfWidth) return p
    const k = (this.halfWidth * 0.9) / dist
    return { x: pt.x + (p.x - pt.x) * k, y: pt.y + (p.y - pt.y) * k }
  }

  shopAt(p: Pt): Shop | undefined {
    return this.data.shops.find(s => p.x >= s.x && p.x <= s.x + s.w && p.y >= s.y && p.y <= s.y + s.h)
  }
}

export class Plan {
  readonly floors: Floor[]

  constructor(readonly data: PlanData) {
    this.floors = data.floors.map((f, i) => new Floor(i, f, data.halfWidth))
  }

  /** Destination nommée (boutique ou point de recalage) → point d'arrivée dans un couloir */
  destination(id: string): Destination | undefined {
    const anchor = this.data.anchors[id]
    if (anchor) return { label: anchor.label, pt: { x: anchor.x, y: anchor.y }, floor: anchor.floor }
    for (const floor of this.floors) {
      const shop = floor.data.shops.find(s => s.name === id)
      if (shop) {
        const pt = floor.nearestOnAxis({ x: shop.x + shop.w / 2, y: shop.y + shop.h / 2 }).pt
        return { label: shop.name, pt, floor: floor.index, shop }
      }
    }
  }
}

// ─── Grand centre commercial fictif : 140 m × 244 m, parking + 2 niveaux commerciaux ───

const ROWS_Y = [30, 80, 130, 180, 220]
const BLOCK_COLS: [number, number][] = [[4, 21], [29, 66], [74, 111], [119, 136]]
const BLOCK_ROWS: [number, number][] = [[34, 76], [84, 126], [134, 176], [184, 216]]

// Grille d'allées commune au parking et au rez-de-chaussée : 3 allées nord-sud, 5 allées est-ouest
const GRID: Pt[][] = [
  [{ x: 70, y: 4 }, { x: 70, y: 240 }],
  [{ x: 25, y: 30 }, { x: 25, y: 220 }],
  [{ x: 115, y: 30 }, { x: 115, y: 220 }],
  ...ROWS_Y.map(y => [{ x: 4, y }, { x: 136, y }]),
]

// Grandes surfaces du rez-de-chaussée occupant un îlot entier : clé « colonne,rangée »
const ANCHOR_STORES: Record<string, [string, Category]> = {
  '1,0': ['Hyper Marché Central', 'alimentaire'],
  '2,0': ['Maison & Déco XXL', 'maison'],
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
  ['Épicerie Fine', 'alimentaire'], ['Papeterie Plume', 'loisirs'], ['Vélo Ville', 'loisirs'], ['Montres & Temps', 'beaute'],
]

function buildGroundShops(): Shop[] {
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

/** Parking : un îlot de places par zone, lettres A → P */
function buildParkingZones(): Shop[] {
  return BLOCK_ROWS.flatMap(([y0, y1], r) => BLOCK_COLS.map(([x0, x1], c) => ({
    name: `Zone ${String.fromCharCode(65 + r * BLOCK_COLS.length + c)}`,
    cat: 'parking' as const,
    x: x0, y: y0, w: x1 - x0, h: y1 - y0,
  })))
}

/** Découpe une bande en boutiques empilées du nord au sud */
const stack = (x0: number, x1: number, y0: number, y1: number, names: [string, Category][]): Shop[] => {
  const h = (y1 - y0) / names.length
  return names.map(([name, cat], i) => ({ name, cat, x: x0, y: y0 + i * h, w: x1 - x0, h }))
}

// Étage loisirs & restauration : emprise plus petite, grands îlots
const upperShops: Shop[] = [
  { name: 'Espace Restauration', cat: 'resto', x: 29, y: 34, w: 37, h: 92 },
  { name: 'Fitness Club', cat: 'loisirs', x: 74, y: 34, w: 37, h: 92 },
  { name: 'Bowling Strike', cat: 'loisirs', x: 29, y: 134, w: 37, h: 82 },
  { name: 'Cinéma Le Grand Écran', cat: 'loisirs', x: 74, y: 134, w: 37, h: 82 },
  ...stack(4, 21, 34, 126, [['Pizza Napoli', 'resto'], ['Ramen Ichi', 'resto'], ['Crêperie Ty Breizh', 'resto']]),
  ...stack(4, 21, 134, 216, [['Énigma Escape', 'loisirs'], ['Laser Arena', 'loisirs'], ['Karaoké Box', 'loisirs']]),
  ...stack(119, 136, 34, 126, [['Salon de Thé Rose', 'resto'], ['Jus Frais', 'resto'], ['Wok Express', 'resto']]),
  ...stack(119, 136, 134, 216, [['Petits Explorateurs', 'loisirs'], ['Tacos Loco', 'resto'], ['Bar à Salades', 'resto']]),
]

const mall: PlanData = {
  name: 'Grand centre commercial (fictif)',
  width: 140,
  height: 244,
  halfWidth: 3.5,
  floors: [
    { name: 'Niveau -1 · Parking', short: 'Niv. -1', corridors: GRID, shops: buildParkingZones() },
    { name: 'Niveau 0', short: 'Niv. 0', corridors: GRID, shops: buildGroundShops() },
    {
      name: 'Niveau 1 · Loisirs',
      short: 'Niv. 1',
      corridors: [
        [{ x: 70, y: 30 }, { x: 70, y: 220 }],
        [{ x: 25, y: 30 }, { x: 25, y: 220 }],
        [{ x: 115, y: 30 }, { x: 115, y: 220 }],
        ...[30, 130, 220].map(y => [{ x: 25, y }, { x: 115, y }]),
      ],
      shops: upperShops,
    },
  ],
  connectors: [
    { kind: 'escalator', x: 70, y: 130, floors: [0, 1, 2] },
    { kind: 'escalator', x: 70, y: 30, floors: [1, 2] },
    { kind: 'ascenseur', x: 115, y: 220, floors: [0, 1, 2] },
  ],
  // Placés hors des trajets de la démo pour ne pas masquer le tracé ; les sorties en bout d'allée
  amenities: [
    // Niveau -1 · Parking
    { kind: 'sortie', x: 139.5, y: 220, floor: 0 },
    { kind: 'sortie', x: 70, y: 243.5, floor: 0 },
    { kind: 'recharge', x: 45, y: 180, floor: 0 },
    { kind: 'recharge', x: 95, y: 180, floor: 0 },
    { kind: 'securite', x: 25, y: 150, floor: 0 },
    // Niveau 0
    { kind: 'sortie', x: 70, y: 0.5, floor: 1 },
    { kind: 'sortie', x: 70, y: 243.5, floor: 1 },
    { kind: 'sortie', x: 0.5, y: 130, floor: 1 },
    { kind: 'sortie', x: 139.5, y: 80, floor: 1 },
    { kind: 'sortie', x: 0.5, y: 220, floor: 1, label: 'Sortie Gare', rer: ['A', 'E'] },
    { kind: 'accueil', x: 45, y: 130, floor: 1 },
    { kind: 'toilettes', x: 25, y: 105, floor: 1 },
    { kind: 'toilettes', x: 115, y: 165, floor: 1 },
    { kind: 'securite', x: 25, y: 200, floor: 1 },
    { kind: 'secours', x: 115, y: 195, floor: 1 },
    { kind: 'dab', x: 70, y: 205, floor: 1 },
    { kind: 'bebe', x: 95, y: 180, floor: 1 },
    // Niveau 1 · Loisirs
    { kind: 'sortie', x: 21.5, y: 30, floor: 2 },
    { kind: 'toilettes', x: 25, y: 175, floor: 2 },
    { kind: 'toilettes', x: 115, y: 80, floor: 2 },
    { kind: 'bebe', x: 95, y: 30, floor: 2 },
    { kind: 'secours', x: 115, y: 150, floor: 2 },
  ],
  promos: [
    { shop: 'Denim Lab', tag: '-30 %', offer: 'sur tous les jeans' },
    { shop: 'Jouets & Cie', tag: '2 + 1', offer: 'le 3e jouet offert' },
    { shop: 'Sushi Zen', tag: 'Menu 12 €', offer: 'plateau midi + boisson' },
    { shop: 'Hyper Marché Central', tag: '-20 %', offer: 'sur les fruits et légumes' },
    { shop: 'Beauté+', tag: '-25 %', offer: 'sur les soins visage' },
    { shop: 'Chaussures 21', tag: 'Soldes', offer: 'jusqu’à -50 % en boutique' },
    { shop: 'Bowling Strike', tag: '-50 %', offer: 'sur la 2e partie' },
    { shop: 'Pizza Napoli', tag: 'Menu 9 €', offer: 'pizza + boisson' },
    { shop: 'Karaoké Box', tag: 'Happy hour', offer: 'salle à -40 % avant 19 h' },
  ],
  anchors: {
    'parking': { x: 136, y: 220, label: 'Parking P2', floor: 0 },
    'entree-nord': { x: 70, y: 4, label: 'Entrée Nord', floor: 1 },
    'entree-sud': { x: 70, y: 240, label: 'Entrée Sud', floor: 1 },
    'entree-ouest': { x: 4, y: 130, label: 'Entrée Ouest', floor: 1 },
    'entree-est': { x: 136, y: 80, label: 'Entrée Est', floor: 1 },
    'gare-rer': { x: 4, y: 220, label: 'Sortie Gare · RER A, E', floor: 1 },
  },
  // Fréquentation simulée d'un samedi : entrées, gare, escalators, grandes surfaces, restauration, loisirs du soir
  heatSpots: [
    { floor: 0, x: 136, y: 220, w: 0.9, r: 14, profile: 'flux' },
    { floor: 0, x: 70, y: 130, w: 0.8, r: 12, profile: 'flux' },
    { floor: 0, x: 115, y: 220, w: 0.6, r: 10, profile: 'flux' },
    { floor: 0, x: 70, y: 200, w: 0.5, r: 22, profile: 'courses' },
    { floor: 1, x: 4, y: 220, w: 1.1, r: 16, profile: 'navette' },
    { floor: 1, x: 25, y: 220, w: 0.6, r: 14, profile: 'navette' },
    { floor: 1, x: 70, y: 6, w: 0.8, r: 14, profile: 'flux' },
    { floor: 1, x: 70, y: 238, w: 0.7, r: 14, profile: 'flux' },
    { floor: 1, x: 136, y: 80, w: 0.5, r: 12, profile: 'flux' },
    { floor: 1, x: 70, y: 130, w: 1.0, r: 14, profile: 'flux' },
    { floor: 1, x: 47, y: 80, w: 0.9, r: 16, profile: 'courses' },
    { floor: 1, x: 47, y: 30, w: 0.6, r: 14, profile: 'courses' },
    { floor: 1, x: 70, y: 80, w: 0.7, r: 12, profile: 'flux' },
    { floor: 1, x: 92, y: 180, w: 0.5, r: 18, profile: 'flux' },
    { floor: 1, x: 115, y: 130, w: 0.4, r: 18, profile: 'courses' },
    { floor: 2, x: 25, y: 80, w: 1.1, r: 18, profile: 'repas' },
    { floor: 2, x: 47, y: 30, w: 0.8, r: 16, profile: 'repas' },
    { floor: 2, x: 115, y: 80, w: 0.7, r: 16, profile: 'repas' },
    { floor: 2, x: 92, y: 130, w: 1.0, r: 16, profile: 'soir' },
    { floor: 2, x: 47, y: 130, w: 0.8, r: 14, profile: 'soir' },
    { floor: 2, x: 25, y: 175, w: 0.5, r: 16, profile: 'soir' },
    { floor: 2, x: 70, y: 130, w: 0.7, r: 12, profile: 'flux' },
  ],
  // Tournée de démo : ascenseur, puis escalators dans les deux sens, retour au parking
  demoTrips: [
    'Cinéma Le Grand Écran', 'Pizza Napoli', 'Jouets & Cie', 'Denim Lab',
    'Bowling Strike', 'Sushi Zen', 'Hyper Marché Central', 'gare-rer', 'parking',
  ],
}

// Plan de test à adapter à votre couloir / appartement (?plan=test).
// Mesurez votre trajet en mètres et remplacez les points ci-dessous.
const test: PlanData = {
  name: 'Plan de test',
  width: 12,
  height: 16,
  halfWidth: 0.8,
  floors: [
    { name: 'Rez-de-chaussée', short: 'RDC', corridors: [[{ x: 2, y: 2 }, { x: 2, y: 13 }, { x: 10, y: 13 }]], shops: [] },
  ],
  connectors: [],
  amenities: [],
  promos: [],
  heatSpots: [],
  anchors: {
    'depart': { x: 2, y: 2, label: 'Départ', floor: 0 },
    'fin': { x: 10, y: 13, label: 'Fin du couloir', floor: 0 },
  },
  demoTrips: ['fin', 'depart'],
}

export const PLANS: Record<string, PlanData> = { mall, test }
