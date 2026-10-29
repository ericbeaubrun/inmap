import type { Pt } from './plan'
import { randn } from './filter'

const DEG = Math.PI / 180

/**
 * Marcheur simulé pour le mode démo. Il suit l'itinéraire, mais ses « capteurs »
 * mentent comme ceux d'un vrai téléphone : boussole décalée de 12° + bruit,
 * foulée annoncée 0,70 m alors qu'il fait ~0,76 m.
 */
export class Walker {
  pos: Pt
  private path: Pt[] = []
  private i = 0

  constructor(start: Pt, private compassBias = 12 * DEG) {
    this.pos = { ...start }
  }

  setPath(path: Pt[]) {
    this.path = path
    this.i = 0
  }

  get done() {
    return this.i >= this.path.length - 1
  }

  step(): { heading: number; length: number } | null {
    if (this.done) return null
    let remaining = 0.76 + randn() * 0.04
    let heading = 0
    while (remaining > 0 && !this.done) {
      const target = this.path[this.i + 1]
      const dx = target.x - this.pos.x, dy = target.y - this.pos.y
      const d = Math.hypot(dx, dy)
      if (d > 0) heading = Math.atan2(dx, -dy)
      if (d <= remaining) {
        this.pos = { ...target }
        this.i++
        remaining -= d
      } else {
        this.pos = { x: this.pos.x + dx / d * remaining, y: this.pos.y + dy / d * remaining }
        remaining = 0
      }
    }
    return { heading: heading + this.compassBias + randn() * 5 * DEG, length: 0.7 }
  }
}
