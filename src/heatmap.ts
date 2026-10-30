import type { HeatSpot, Plan } from './plan'

/**
 * Onglet Fréquentation : carte de chaleur simulée d'un samedi, par niveau et par heure.
 * Intensité = flux de fond dans les couloirs + points chauds (entrées, escalators, restauration…)
 * modulés par un profil horaire. Données fictives pour la démo (vue foncière).
 */

export const HOUR_MIN = 9, HOUR_MAX = 21
const CELL = 1 // m par pixel de la carte
const SATURATION = 1.5 // intensité affichée comme « saturé »

// Profils horaires de 9 h à 21 h (1 valeur par heure, 0–1)
const PROFILES: Record<HeatSpot['profile'], number[]> = {
  flux: [0.2, 0.35, 0.55, 0.75, 0.7, 0.8, 0.95, 1, 0.9, 0.75, 0.6, 0.45, 0.3],
  courses: [0.4, 0.6, 0.8, 0.7, 0.6, 0.7, 0.85, 1, 0.95, 0.8, 0.6, 0.4, 0.2],
  repas: [0.05, 0.1, 0.3, 1, 0.85, 0.35, 0.3, 0.35, 0.45, 0.6, 0.85, 0.6, 0.3],
  soir: [0, 0.05, 0.1, 0.2, 0.3, 0.45, 0.5, 0.55, 0.6, 0.75, 0.95, 1, 0.8],
  navette: [1, 0.7, 0.5, 0.55, 0.6, 0.5, 0.55, 0.65, 0.8, 1, 0.75, 0.5, 0.35],
}

const at = (profile: HeatSpot['profile'], hour: number) => {
  const v = PROFILES[profile]
  const t = Math.max(0, Math.min(v.length - 1, hour - HOUR_MIN))
  const i = Math.min(v.length - 2, Math.floor(t))
  return v[i] + (v[i + 1] - v[i]) * (t - i)
}

// Dégradé : lavande transparente → indigo → tomate → jaune
const RAMP: [number, number, number, number, number][] = [
  [0, 122, 110, 235, 0],
  [0.12, 122, 110, 235, 0.4],
  [0.4, 90, 47, 208, 0.7],
  [0.7, 240, 83, 42, 0.85],
  [1, 255, 210, 63, 0.95],
]
const LUT = new Uint8ClampedArray(256 * 4)
for (let i = 0; i < 256; i++) {
  const v = i / 255
  const k = RAMP.findIndex(s => s[0] >= v)
  const b = RAMP[Math.max(1, k)], a = RAMP[Math.max(0, k - 1)]
  const t = b[0] === a[0] ? 0 : (v - a[0]) / (b[0] - a[0])
  for (let c = 0; c < 4; c++) LUT[i * 4 + c] = (a[c + 1] + (b[c + 1] - a[c + 1]) * t) * (c === 3 ? 255 : 1)
}

export interface HeatStats {
  /** Visiteurs par heure sur le niveau */
  visitors: number
  /** Taux d'occupation des allées (%) */
  occupancy: number
  /** Temps de présence moyen (min) */
  dwell: number
  /** Enseignes devant lesquelles il y a le plus de monde */
  top: string[]
}

export class HeatMap {
  readonly canvas = document.createElement('canvas')
  readonly cell = CELL
  private w: number
  private h: number
  private masks: Uint8Array[]
  private grain: Float32Array
  private value: Float32Array
  private key = ''

  constructor(private plan: Plan) {
    this.w = Math.ceil(plan.data.width / CELL)
    this.h = Math.ceil(plan.data.height / CELL)
    this.canvas.width = this.w
    this.canvas.height = this.h
    this.value = new Float32Array(this.w * this.h)
    // Zone marchable de chaque niveau, calculée une fois
    this.masks = plan.floors.map(f => {
      const m = new Uint8Array(this.w * this.h)
      for (let j = 0; j < this.h; j++) for (let i = 0; i < this.w; i++) m[j * this.w + i] = f.walkable((i + 0.5) * CELL, (j + 0.5) * CELL) ? 1 : 0
      return m
    })
    // Grain irrégulier pour un rendu « données réelles »
    this.grain = new Float32Array(this.w * this.h)
    for (let j = 0; j < this.h; j++) for (let i = 0; i < this.w; i++) {
      this.grain[j * this.w + i] = 0.85 + 0.15 * Math.sin(i * 0.37 + Math.sin(j * 0.21) * 2) * Math.cos(j * 0.29 + i * 0.05)
    }
  }

  /** Recalcule la carte du niveau à l'heure donnée (ne fait rien si rien n'a changé) */
  update(floor: number, hour: number) {
    const key = `${floor}|${hour.toFixed(2)}`
    if (key === this.key) return
    this.key = key
    const { w, h, value } = this
    const mask = this.masks[floor]
    const spots = this.plan.data.heatSpots.filter(s => s.floor === floor)
    const base = 0.18 * at('flux', hour)
    const img = new ImageData(w, h)
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const k = j * w + i
        if (!mask[k]) { value[k] = 0; continue }
        const x = (i + 0.5) * CELL, y = (j + 0.5) * CELL
        let v = base
        for (const s of spots) {
          const d2 = (x - s.x) ** 2 + (y - s.y) ** 2
          if (d2 < 9 * s.r * s.r) v += s.w * at(s.profile, hour) * Math.exp(-d2 / (2 * s.r * s.r))
        }
        v *= this.grain[k]
        value[k] = v
        const l = Math.round(Math.min(1, v / SATURATION) * 255) * 4
        img.data.set(LUT.subarray(l, l + 4), k * 4)
      }
    }
    this.canvas.getContext('2d')!.putImageData(img, 0, 0)
  }

  /** Indicateurs du niveau affiché (après `update`) */
  stats(floor: number, hour: number): HeatStats {
    const mask = this.masks[floor]
    let sum = 0, cells = 0, busy = 0
    for (let k = 0; k < mask.length; k++) {
      if (!mask[k]) continue
      cells++
      sum += this.value[k]
      if (this.value[k] > SATURATION * 0.4) busy++
    }
    const level = cells ? sum / cells : 0
    const sample = (x: number, y: number) =>
      this.value[Math.min(this.h - 1, Math.floor(y / CELL)) * this.w + Math.min(this.w - 1, Math.floor(x / CELL))]
    const f = this.plan.floors[floor]
    const top = f.data.shops
      .map(s => {
        const door = f.nearestOnAxis({ x: s.x + s.w / 2, y: s.y + s.h / 2 }).pt
        return { name: s.name, v: sample(door.x, door.y) }
      })
      .sort((a, b) => b.v - a.v)
      .slice(0, 3)
      .map(s => s.name)
    return {
      visitors: Math.round((cells * level * 2.5) / 50) * 50,
      occupancy: cells ? Math.round((busy / cells) * 100) : 0,
      dwell: Math.round(55 + 40 * at('soir', hour) + 15 * at('repas', hour)),
      top,
    }
  }
}
