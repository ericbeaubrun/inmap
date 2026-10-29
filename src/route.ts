import type { ConnectorKind, Plan, Pt, Seg } from './plan'

export type Turn = 'gauche' | 'droite' | 'demi-tour'

/** Point d'itinéraire ; `via` indique le connecteur emprunté pour l'atteindre (changement de niveau) */
export interface RoutePt extends Pt { floor: number; via?: ConnectorKind }

export type ConnectorEvent = { i: number; kind: ConnectorKind; toFloor: number }
export type RouteEvent = { i: number; kind: Turn } | ConnectorEvent

export interface Route {
  pts: RoutePt[]
  /** Distance horizontale cumulée jusqu'à chaque point (les trajets verticaux comptent 0) */
  cum: number[]
  length: number
  /** Virages et changements de niveau (index dans pts) */
  events: RouteEvent[]
}

export const isConnector = (e: RouteEvent): e is ConnectorEvent => 'toFloor' in e

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y)
const same = (a: Pt, b: Pt) => Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01
const lerp = (s: Seg, t: number): Pt => ({ x: s.a.x + t * (s.b.x - s.a.x), y: s.a.y + t * (s.b.y - s.a.y) })
const key = (p: Pt, floor: number) => `${floor}:${p.x.toFixed(2)},${p.y.toFixed(2)}`

const TURN_PENALTY = 4 // mètres « virtuels » par virage
// Coût d'un changement de niveau en mètres « virtuels » (attente comprise pour l'ascenseur)
const CONNECTOR_COST: Record<ConnectorKind, (floors: number) => number> = {
  escalator: n => 15 * n,
  escalier: n => 12 * n,
  ascenseur: n => 30 + 5 * n,
}

function intersect(s1: Seg, s2: Seg): { t: number; u: number } | null {
  const rx = s1.b.x - s1.a.x, ry = s1.b.y - s1.a.y
  const qx = s2.b.x - s2.a.x, qy = s2.b.y - s2.a.y
  const den = rx * qy - ry * qx
  if (Math.abs(den) < 1e-9) return null
  const wx = s2.a.x - s1.a.x, wy = s2.a.y - s1.a.y
  const t = (wx * qy - wy * qx) / den
  const u = (wx * ry - wy * rx) / den
  const e = 1e-6
  if (t < -e || t > 1 + e || u < -e || u > 1 + e) return null
  return { t: Math.min(1, Math.max(0, t)), u: Math.min(1, Math.max(0, u)) }
}

function isTurn(a: Pt, b: Pt, c: Pt) {
  const ax = b.x - a.x, ay = b.y - a.y, bx = c.x - b.x, by = c.y - b.y
  return Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by)) > 30 * Math.PI / 180
}

/**
 * Plus court chemin dans le réseau de couloirs de tous les niveaux (Dijkstra).
 * Le graphe est construit à la volée : nœuds = extrémités, croisements, connecteurs, départ et arrivée.
 * `accessible` (mode PMR) : seuls les ascenseurs permettent de changer de niveau.
 */
export function findRoute(plan: Plan, from: Pt, fromFloor: number, to: Pt, toFloor: number, accessible = false): Route | null {
  type Edge = { k: string; d: number; via?: ConnectorKind }
  const nodes = new Map<string, { p: RoutePt; adj: Edge[] }>()
  const node = (p: Pt, floor: number) => {
    const k = key(p, floor)
    if (!nodes.has(k)) nodes.set(k, { p: { x: p.x, y: p.y, floor }, adj: [] })
    return k
  }
  const link = (a: string, b: string, d: number, via?: ConnectorKind) => {
    nodes.get(a)!.adj.push({ k: b, d, via })
    nodes.get(b)!.adj.push({ k: a, d, via })
  }

  let start = '', goal = ''
  const connectorKeys = plan.data.connectors.map(() => new Map<number, string>())

  for (const floor of plan.floors) {
    const segs = floor.segs
    const splits = segs.map(() => [0, 1])
    for (let i = 0; i < segs.length; i++) {
      for (let j = i + 1; j < segs.length; j++) {
        const r = intersect(segs[i], segs[j])
        if (r) { splits[i].push(r.t); splits[j].push(r.u) }
      }
    }
    // Insère un point dans le réseau de ce niveau et renvoie la clé de son nœud
    const insert = (p: Pt) => {
      const n = floor.nearestOnAxis(p)
      splits[n.seg].push(n.t)
      return key(lerp(segs[n.seg], n.t), floor.index)
    }
    if (floor.index === fromFloor) start = insert(from)
    if (floor.index === toFloor) goal = insert(to)
    plan.data.connectors.forEach((c, ci) => {
      if (c.floors.includes(floor.index)) connectorKeys[ci].set(floor.index, insert(c))
    })

    segs.forEach((s, i) => {
      let prev: { k: string; p: Pt } | null = null
      for (const t of [...new Set(splits[i])].sort((x, y) => x - y)) {
        const p = lerp(s, t), k = node(p, floor.index)
        if (prev && prev.k !== k) link(prev.k, k, dist(prev.p, p))
        prev = { k, p }
      }
    })
  }

  // Liaisons verticales : escalators et escaliers d'un niveau au suivant, ascenseur entre tous les niveaux
  plan.data.connectors.forEach((c, ci) => {
    if (accessible && c.kind !== 'ascenseur') return
    const floors = [...c.floors].sort((a, b) => a - b)
    const keys = connectorKeys[ci]
    for (let a = 0; a < floors.length; a++) {
      for (let b = a + 1; b < floors.length; b++) {
        if (c.kind !== 'ascenseur' && b !== a + 1) continue
        link(keys.get(floors[a])!, keys.get(floors[b])!, CONNECTOR_COST[c.kind](floors[b] - floors[a]), c.kind)
      }
    }
  })

  // Dijkstra sur les états (nœud précédent → nœud courant) pour pénaliser les virages :
  // à distance quasi égale, on préfère l'itinéraire le plus simple à suivre.
  const startState = `|${start}`
  const best = new Map([[startState, 0]]), prev = new Map<string, string>(), done = new Set<string>()
  let end: string | null = null
  for (;;) {
    let cur: string | null = null
    for (const [s, d] of best) if (!done.has(s) && (cur == null || d < best.get(cur)!)) cur = s
    if (cur == null) return null
    const [from, at] = cur.split('|')
    if (at === goal) { end = cur; break }
    done.add(cur)
    const pFrom = from ? nodes.get(from)!.p : null, pAt = nodes.get(at)!.p
    for (const { k, d } of nodes.get(at)!.adj) {
      const nd = best.get(cur)! + d + (pFrom && isTurn(pFrom, pAt, nodes.get(k)!.p) ? TURN_PENALTY : 0)
      const s = `${at}|${k}`
      if (nd < (best.get(s) ?? Infinity)) { best.set(s, nd); prev.set(s, cur) }
    }
  }
  const keys: string[] = []
  for (let s: string | undefined = end; s; s = prev.get(s)) keys.unshift(s.split('|')[1])
  const pts = keys.map((k, i) => {
    const via = i > 0 ? nodes.get(keys[i - 1])!.adj.find(e => e.k === k)?.via : undefined
    return { ...nodes.get(k)!.p, via }
  })
  return makeRoute(pts)
}

function makeRoute(raw: RoutePt[]): Route {
  const pts: RoutePt[] = []
  for (const p of raw) {
    const last = pts[pts.length - 1]
    if (last && same(last, p) && last.floor === p.floor) continue
    if (pts.length >= 2) {
      const a = pts[pts.length - 2], b = last
      if (same(a, b) && same(b, p) && a.floor !== b.floor && b.floor !== p.floor) {
        // Trajet vertical continu (escalator sur plusieurs niveaux) : on garde le départ et l'arrivée
        pts.pop()
      } else if (a.floor === b.floor && b.floor === p.floor) {
        // Retire les points intermédiaires sans changement de direction
        const cross = (b.x - a.x) * (p.y - b.y) - (b.y - a.y) * (p.x - b.x)
        const dot = (b.x - a.x) * (p.x - b.x) + (b.y - a.y) * (p.y - b.y)
        if (Math.abs(cross) < 1e-6 && dot > 0) pts.pop()
      }
    }
    pts.push(p)
  }

  const cum = [0]
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]))

  const events: RouteEvent[] = []
  for (let i = 0; i < pts.length - 1; i++) {
    if (pts[i].floor !== pts[i + 1].floor) {
      events.push({ i, kind: pts[i + 1].via ?? 'escalator', toFloor: pts[i + 1].floor })
    } else if (i >= 1 && pts[i - 1].floor === pts[i].floor) {
      const ax = pts[i].x - pts[i - 1].x, ay = pts[i].y - pts[i - 1].y
      const bx = pts[i + 1].x - pts[i].x, by = pts[i + 1].y - pts[i].y
      const angle = Math.atan2(ax * by - ay * bx, ax * bx + ay * by)
      if (Math.abs(angle) > 150 * Math.PI / 180) events.push({ i, kind: 'demi-tour' })
      else if (Math.abs(angle) > 30 * Math.PI / 180) events.push({ i, kind: angle > 0 ? 'droite' : 'gauche' })
    }
  }
  return { pts, cum, length: cum[cum.length - 1], events }
}

/** Avancement le long de l'itinéraire (m) et écart au tracé, en ne considérant que le niveau donné */
export function progressOn(route: Route, p: Pt, floor: number): { along: number; offset: number } {
  let best = { along: 0, offset: Infinity }
  route.pts.forEach((q, i) => {
    if (q.floor === floor && dist(p, q) < best.offset) best = { along: route.cum[i], offset: dist(p, q) }
  })
  for (let i = 1; i < route.pts.length; i++) {
    const a = route.pts[i - 1], b = route.pts[i]
    const len = route.cum[i] - route.cum[i - 1]
    if (a.floor !== floor || b.floor !== floor || len === 0) continue
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (len * len)))
    const d = dist(p, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) })
    if (d < best.offset) best = { along: route.cum[i - 1] + t * len, offset: d }
  }
  return best
}

/** Prochaine instruction à annoncer pour un visiteur au niveau `floor` */
export function nextInstruction(route: Route, along: number, floor: number):
  { kind: Turn | ConnectorKind | 'arrivee'; dist: number; toFloor?: number } {
  for (const e of route.events) {
    const p = route.pts[e.i]
    if (p.floor !== floor) continue
    // Un connecteur reste à prendre tant qu'on est encore à son niveau de départ
    if (isConnector(e)) return { kind: e.kind, dist: Math.max(0, route.cum[e.i] - along), toFloor: e.toFloor }
    if (route.cum[e.i] > along + 1) return { kind: e.kind, dist: route.cum[e.i] - along }
  }
  return { kind: 'arrivee', dist: Math.max(0, route.length - along) }
}

/** Tronçons verticaux de l'itinéraire, et s'ils sont déjà parcourus */
export function verticals(route: Route, along: number, floor: number) {
  return route.events.filter(isConnector).map(e => {
    const a = route.pts[e.i]
    const done = along > route.cum[e.i] + 0.5 || (floor === e.toFloor && along >= route.cum[e.i] - 0.5)
    return { x: a.x, y: a.y, from: a.floor, to: e.toFloor, kind: e.kind, done }
  })
}

/** Morceaux de l'itinéraire situés au niveau `floor`, séparés en partie parcourue / restante */
export function pieces(route: Route, along: number, floor: number): { done: Pt[][]; todo: Pt[][] } {
  const done: Pt[][] = [], todo: Pt[][] = []
  const push = (list: Pt[][], a: Pt, b: Pt) => {
    const line = list[list.length - 1]
    if (line && same(line[line.length - 1], a)) line.push(b)
    else list.push([a, b])
  }
  for (let i = 1; i < route.pts.length; i++) {
    const a = route.pts[i - 1], b = route.pts[i]
    if (a.floor !== floor || b.floor !== floor) continue
    const s0 = route.cum[i - 1], s1 = route.cum[i]
    if (s1 <= along) push(done, a, b)
    else if (s0 >= along) push(todo, a, b)
    else {
      const t = (along - s0) / (s1 - s0)
      const m = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) }
      push(done, a, m)
      push(todo, m, b)
    }
  }
  return { done, todo }
}
