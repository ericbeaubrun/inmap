import type { Pt } from './plan'
import type { RoutePt } from './route'
import { randn } from './filter'

const DEG = Math.PI / 180

/**
 * Marcheur simulé pour le mode démo. Il suit l'itinéraire, mais ses « capteurs »
 * mentent comme ceux d'un vrai téléphone : boussole décalée de 12° + bruit,
 * foulée annoncée 0,70 m alors qu'il fait ~0,76 m.
 * Sur un escalator ou dans l'ascenseur il reste immobile (aucun pas) le temps du trajet.
 */
export class Walker {
  pos: Pt
  private path: RoutePt[] = []
  private i = 0
  private ride = 0

  constructor(start: Pt, public floor: number, private compassBias = 12 * DEG) {
    this.pos = { x: start.x, y: start.y }
  }

  setPath(path: RoutePt[]) {
    this.path = path
    this.i = 0
    this.ride = 0
  }

  get done() {
    return this.i >= this.path.length - 1
  }

  step(): { heading: number; length: number } | null {
    if (this.done) return null

    const next = this.path[this.i + 1]
    if (next.floor !== this.floor) {
      // Changement de niveau : quelques ticks immobile, puis arrivée à l'étage
      if (this.ride === 0) this.ride = 10 + 5 * Math.abs(next.floor - this.floor)
      if (--this.ride === 0) {
        this.pos = { x: next.x, y: next.y }
        this.floor = next.floor
        this.i++
      }
      return null
    }

    let remaining = 0.76 + randn() * 0.04
    let heading = 0
    while (remaining > 0 && !this.done) {
      const target = this.path[this.i + 1]
      if (target.floor !== this.floor) break
      const dx = target.x - this.pos.x, dy = target.y - this.pos.y
      const d = Math.hypot(dx, dy)
      if (d > 0) heading = Math.atan2(dx, -dy)
      if (d <= remaining) {
        this.pos = { x: target.x, y: target.y }
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
