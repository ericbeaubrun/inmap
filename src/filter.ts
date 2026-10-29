import type { Pt } from './plan'

/** Zone marchable d'un niveau (implémentée par `Floor`) */
export interface Walkable {
  walkable(x: number, y: number): boolean
  snap(p: Pt): Pt
}

export const randn = () => {
  const u = 1 - Math.random(), v = Math.random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

const DEG = Math.PI / 180

/**
 * Filtre à particules contraint par le plan.
 * Chaque particule = une hypothèse de position + un biais de cap (erreur boussole)
 * + un facteur de longueur de pas. Les hypothèses qui traversent un mur disparaissent :
 * les survivantes convergent vers la vraie position, le vrai biais et la vraie foulée.
 */
export class ParticleFilter {
  private x: Float64Array
  private y: Float64Array
  private bias: Float64Array
  private scale: Float64Array
  private w: Float64Array
  private last: Pt = { x: 0, y: 0 }

  constructor(private area: Walkable, readonly n = 600) {
    this.x = new Float64Array(n)
    this.y = new Float64Array(n)
    this.bias = new Float64Array(n)
    this.scale = new Float64Array(n)
    this.w = new Float64Array(n)
  }

  /** Changement de niveau : les hypothèses seront contraintes par les couloirs du nouveau niveau */
  setArea(area: Walkable) {
    this.area = area
  }

  init(center: Pt, sigma: number, keepBias = false) {
    const c = this.area.snap(center)
    for (let i = 0; i < this.n; i++) {
      let x = c.x, y = c.y
      for (let tries = 0; tries < 20; tries++) {
        const tx = c.x + randn() * sigma, ty = c.y + randn() * sigma
        if (this.area.walkable(tx, ty)) { x = tx; y = ty; break }
      }
      this.x[i] = x
      this.y[i] = y
      if (!keepBias) {
        this.bias[i] = randn() * 15 * DEG
        this.scale[i] = 1 + randn() * 0.1
      }
      this.w[i] = 1 / this.n
    }
    this.last = c
  }

  /** Un pas détecté : cap dans le repère du plan (radians, 0 = haut, sens horaire) */
  step(heading: number, length: number) {
    let sum = 0
    for (let i = 0; i < this.n; i++) {
      const h = heading + this.bias[i] + randn() * 6 * DEG
      const l = length * this.scale[i] * (1 + randn() * 0.05)
      const nx = this.x[i] + Math.sin(h) * l
      const ny = this.y[i] - Math.cos(h) * l
      if (this.area.walkable(nx, ny) && this.area.walkable((this.x[i] + nx) / 2, (this.y[i] + ny) / 2)) {
        this.x[i] = nx
        this.y[i] = ny
      } else {
        this.w[i] = 0
      }
      this.bias[i] += randn() * 0.3 * DEG
      sum += this.w[i]
    }

    if (sum === 0) {
      // Toutes les hypothèses sont mortes : on repart autour de la dernière estimation.
      this.init(this.last, 2, true)
      return
    }
    for (let i = 0; i < this.n; i++) this.w[i] /= sum
    this.resample()
    this.last = this.estimate()
  }

  /** Rééchantillonnage systématique + légère agitation pour garder de la diversité */
  private resample() {
    const { n } = this
    const x = new Float64Array(n), y = new Float64Array(n)
    const bias = new Float64Array(n), scale = new Float64Array(n)
    let c = this.w[0], j = 0
    const r = Math.random() / n
    for (let i = 0; i < n; i++) {
      const u = r + i / n
      while (u > c && j < n - 1) c += this.w[++j]
      const jx = this.x[j] + randn() * 0.05, jy = this.y[j] + randn() * 0.05
      const ok = this.area.walkable(jx, jy)
      x[i] = ok ? jx : this.x[j]
      y[i] = ok ? jy : this.y[j]
      bias[i] = this.bias[j] + randn() * 0.5 * DEG
      scale[i] = this.scale[j] + randn() * 0.005
    }
    this.x = x; this.y = y; this.bias = bias; this.scale = scale
    this.w.fill(1 / n)
  }

  /** Position estimée (ramenée dans un couloir), précision (m), biais de cap moyen */
  estimate(): Pt & { accuracy: number; bias: number } {
    let mx = 0, my = 0, sb = 0, cb = 0
    for (let i = 0; i < this.n; i++) {
      mx += this.w[i] * this.x[i]
      my += this.w[i] * this.y[i]
      sb += this.w[i] * Math.sin(this.bias[i])
      cb += this.w[i] * Math.cos(this.bias[i])
    }
    let v = 0
    for (let i = 0; i < this.n; i++) v += this.w[i] * ((this.x[i] - mx) ** 2 + (this.y[i] - my) ** 2)
    const p = this.area.snap({ x: mx, y: my })
    return { ...p, accuracy: Math.sqrt(v), bias: Math.atan2(sb, cb) }
  }

  particles(): { x: Float64Array; y: Float64Array } {
    return { x: this.x, y: this.y }
  }
}
