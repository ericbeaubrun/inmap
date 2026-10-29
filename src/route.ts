import type { Plan, Pt, Seg } from './plan'

export type Turn = 'gauche' | 'droite' | 'demi-tour'

export interface Route {
  pts: Pt[]
  /** Distance cumulée jusqu'à chaque point */
  cum: number[]
  length: number
  /** Changements de direction (index dans pts) */
  turns: { i: number; dir: Turn }[]
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y)
const lerp = (s: Seg, t: number): Pt => ({ x: s.a.x + t * (s.b.x - s.a.x), y: s.a.y + t * (s.b.y - s.a.y) })
const key = (p: Pt) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`

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

/**
 * Plus court chemin dans le réseau de couloirs (Dijkstra).
 * Le graphe est construit à la volée : nœuds = extrémités, croisements, départ et arrivée.
 */
export function findRoute(plan: Plan, from: Pt, to: Pt): Route | null {
  const segs = plan.segs
  const splits = segs.map(() => [0, 1])
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const r = intersect(segs[i], segs[j])
      if (r) { splits[i].push(r.t); splits[j].push(r.u) }
    }
  }
  const a = plan.nearestOnAxis(from), b = plan.nearestOnAxis(to)
  splits[a.seg].push(a.t)
  splits[b.seg].push(b.t)

  const nodes = new Map<string, { p: Pt; adj: { k: string; d: number }[] }>()
  const node = (p: Pt) => {
    const k = key(p)
    if (!nodes.has(k)) nodes.set(k, { p, adj: [] })
    return k
  }
  segs.forEach((s, i) => {
    let prev: { k: string; p: Pt } | null = null
    for (const t of [...new Set(splits[i])].sort((x, y) => x - y)) {
      const p = lerp(s, t), k = node(p)
      if (prev && prev.k !== k) {
        const d = dist(prev.p, p)
        nodes.get(prev.k)!.adj.push({ k, d })
        nodes.get(k)!.adj.push({ k: prev.k, d })
      }
      prev = { k, p }
    }
  })

  // Dijkstra sur les états (nœud précédent → nœud courant) pour pénaliser les virages :
  // à distance quasi égale, on préfère l'itinéraire le plus simple à suivre.
  const start = key(lerp(segs[a.seg], a.t)), goal = key(lerp(segs[b.seg], b.t))
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
  return makeRoute(keys.map(k => nodes.get(k)!.p))
}

const TURN_PENALTY = 4 // mètres « virtuels » par virage

function isTurn(a: Pt, b: Pt, c: Pt) {
  const ax = b.x - a.x, ay = b.y - a.y, bx = c.x - b.x, by = c.y - b.y
  return Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by)) > 30 * Math.PI / 180
}

function makeRoute(raw: Pt[]): Route {
  // Retire les points intermédiaires sans changement de direction
  const pts: Pt[] = []
  for (const p of raw) {
    if (pts.length && dist(pts[pts.length - 1], p) < 0.01) continue
    if (pts.length >= 2) {
      const a = pts[pts.length - 2], b = pts[pts.length - 1]
      const cross = (b.x - a.x) * (p.y - b.y) - (b.y - a.y) * (p.x - b.x)
      const dot = (b.x - a.x) * (p.x - b.x) + (b.y - a.y) * (p.y - b.y)
      if (Math.abs(cross) < 1e-6 && dot > 0) pts.pop()
    }
    pts.push(p)
  }
  const cum = [0]
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]))
  const turns: Route['turns'] = []
  for (let i = 1; i < pts.length - 1; i++) {
    const ax = pts[i].x - pts[i - 1].x, ay = pts[i].y - pts[i - 1].y
    const bx = pts[i + 1].x - pts[i].x, by = pts[i + 1].y - pts[i].y
    const angle = Math.atan2(ax * by - ay * bx, ax * bx + ay * by)
    if (Math.abs(angle) > 150 * Math.PI / 180) turns.push({ i, dir: 'demi-tour' })
    else if (Math.abs(angle) > 30 * Math.PI / 180) turns.push({ i, dir: angle > 0 ? 'droite' : 'gauche' })
  }
  return { pts, cum, length: cum[cum.length - 1], turns }
}

/** Avancement le long de l'itinéraire (m) et écart au tracé */
export function progressOn(route: Route, p: Pt): { along: number; offset: number } {
  if (route.pts.length < 2) return { along: 0, offset: dist(p, route.pts[0]) }
  let best = { along: 0, offset: Infinity }
  for (let i = 1; i < route.pts.length; i++) {
    const a = route.pts[i - 1], b = route.pts[i]
    const len = route.cum[i] - route.cum[i - 1]
    const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (len * len)))
    const d = dist(p, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) })
    if (d < best.offset) best = { along: route.cum[i - 1] + t * len, offset: d }
  }
  return best
}

/** Prochaine instruction à annoncer */
export function nextInstruction(route: Route, along: number): { dir: Turn | 'arrivee'; dist: number } {
  for (const t of route.turns) {
    if (route.cum[t.i] > along + 1) return { dir: t.dir, dist: route.cum[t.i] - along }
  }
  return { dir: 'arrivee', dist: Math.max(0, route.length - along) }
}

/** Point situé à une distance donnée le long de l'itinéraire */
export function pointAt(route: Route, along: number): { pt: Pt; i: number } {
  for (let i = 1; i < route.pts.length; i++) {
    if (route.cum[i] >= along) {
      const len = route.cum[i] - route.cum[i - 1]
      const t = len === 0 ? 0 : (along - route.cum[i - 1]) / len
      const a = route.pts[i - 1], b = route.pts[i]
      return { pt: { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) }, i }
    }
  }
  return { pt: route.pts[route.pts.length - 1], i: route.pts.length - 1 }
}
