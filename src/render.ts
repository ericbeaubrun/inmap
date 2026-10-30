import type { Destination, Plan, Pt, Shop } from './plan'
import { pieces, type Route } from './route'
import { a11y } from './a11y'
import { AMENITY_LOGOS, CONNECTOR_LOGOS, drawExitSign, drawLogo, drawPromoTag, logoFor } from './logos'

export interface Frame {
  /** Niveau où se trouve le visiteur (celui affiché en 2D, mis en avant en 3D) */
  floor: number
  particles: { x: Float64Array; y: Float64Array }
  estimate: Pt & { accuracy: number }
  /** Cap dans le repère du plan (radians), null si inconnu */
  heading: number | null
  /** Vraie position (mode démo uniquement) */
  truth: (Pt & { floor: number }) | null
  route: Route | null
  /** Distance déjà parcourue sur l'itinéraire */
  along: number
  destination: Destination | null
  /** Vue d'ensemble du plan, sinon caméra centrée sur le point de position */
  overview: boolean
  /** Mode PMR : itinéraires sans escalator ni escalier */
  accessible: boolean
  /** Onglet Fréquentation : carte de chaleur du niveau (1 px = `cell` m), sans trajet ni position */
  heat?: { canvas: HTMLCanvasElement; cell: number } | null
}

// Identité InMap (mêmes valeurs que style.css) : lavande, papier crème, encre violine, indigo, tomate
const SAND = '#cfcaf7'
const CORRIDOR = '#f1eae0'
const SHOP = '#fffcf7'
const INK = '#1e1b33'
const COBALT = '#3b30d0'
const TOMATO = '#f0532a'
const DONE = '#aaa3c9'
// Contraste renforcé : contours et libellés à l'encre
const shopEdge = () => (a11y.contrast ? INK : '#c4bde6')
const label = () => (a11y.contrast ? '#000' : '#3a3555')
const FONT = '"Bricolage Grotesque", system-ui, sans-serif'

const FOLLOW_SCALE = 5.5 // px par mètre en mode suivi
// Zone utile entre le bandeau du haut et le panneau du bas (partagée avec la vue 3D)
export const TOP = 110, BOTTOM = 270
const PAD = 16

const rgba = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

export class Renderer {
  private ctx: CanvasRenderingContext2D
  private w = 0
  private h = 0
  private cam = { x: 0, y: 0, s: 1 }
  private ready = false
  private promoTags: Map<string, string>
  private signWidths = new Map<string, number>()

  constructor(private canvas: HTMLCanvasElement, private plan: Plan) {
    this.ctx = canvas.getContext('2d')!
    this.promoTags = new Map(plan.data.promos.map(p => [p.shop, p.tag]))
    this.resize()
    window.addEventListener('resize', () => this.resize())
  }

  private resize() {
    const dpr = window.devicePixelRatio || 1
    this.w = window.innerWidth
    this.h = window.innerHeight
    this.canvas.width = this.w * dpr
    this.canvas.height = this.h * dpr
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  private fitScale() {
    const { width, height } = this.plan.data
    return Math.min((this.w - 2 * PAD) / width, (this.h - TOP - BOTTOM) / height)
  }

  private get cy() { return TOP + (this.h - TOP - BOTTOM) / 2 }
  private sx(x: number) { return this.w / 2 + (x - this.cam.x) * this.cam.s }
  private sy(y: number) { return this.cy + (y - this.cam.y) * this.cam.s }

  toPlan(clientX: number, clientY: number): Pt {
    return { x: (clientX - this.w / 2) / this.cam.s + this.cam.x, y: (clientY - this.cy) / this.cam.s + this.cam.y }
  }

  private updateCamera(f: Frame) {
    const fit = this.fitScale()
    const target = f.overview
      ? { x: this.plan.data.width / 2, y: this.plan.data.height / 2, s: fit }
      : { x: f.estimate.x, y: f.estimate.y, s: Math.max(fit, FOLLOW_SCALE) }
    if (!this.ready) { this.cam = target; this.ready = true; return }
    const k = a11y.reduceMotion ? 1 : 0.08
    this.cam.x += (target.x - this.cam.x) * k
    this.cam.y += (target.y - this.cam.y) * k
    this.cam.s += (target.s - this.cam.s) * k
  }

  draw(f: Frame) {
    this.updateCamera(f)
    const { ctx } = this
    const s = this.cam.s
    const d = this.plan.floors[f.floor].data
    ctx.fillStyle = SAND
    ctx.fillRect(0, 0, this.w, this.h)

    // Couloirs du niveau affiché
    ctx.strokeStyle = CORRIDOR
    ctx.lineWidth = this.plan.data.halfWidth * 2 * s
    ctx.lineCap = 'square'
    for (const line of d.corridors) {
      ctx.beginPath()
      line.forEach((p, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, this.sx(p.x), this.sy(p.y)))
      ctx.stroke()
    }

    // Boutiques : bloc blanc, logo de l'enseigne et nom
    const dest = f.destination
    if (f.heat) {
      ctx.imageSmoothingEnabled = true
      ctx.drawImage(f.heat.canvas, this.sx(0), this.sy(0), f.heat.canvas.width * f.heat.cell * s, f.heat.canvas.height * f.heat.cell * s)
    }

    const fontSize = Math.max(9, Math.min(13, s * 2.3)) * (a11y.largeText ? 1.25 : 1)
    for (const shop of d.shops) this.drawShop(shop, dest?.shop === shop && !f.heat, fontSize)

    // Points de recalage QR / NFC
    for (const a of Object.values(this.plan.data.anchors)) {
      if (a.floor !== f.floor || f.heat) continue
      const x = this.sx(a.x), y = this.sy(a.y)
      ctx.fillStyle = INK
      ctx.fillRect(x - 6, y - 6, 12, 12)
      ctx.fillStyle = CORRIDOR
      ctx.fillRect(x - 3, y - 3, 6, 6)
    }

    // Itinéraire au niveau affiché : partie restante en cobalt (liseré blanc façon signalétique), parcourue en gris
    if (f.route && !f.heat) {
      const { done, todo } = pieces(f.route, f.along, f.floor)
      const width = Math.max(5, s * 1.3) * (a11y.contrast ? 1.3 : 1)
      for (const line of done) this.polyline(line, DONE, width)
      for (const line of todo) this.polyline(line, '#fff', width + 4)
      for (const line of todo) this.polyline(line, COBALT, width)
    }

    // Escalators et ascenseurs desservant ce niveau
    const badge = Math.max(16, Math.min(26, s * 3.2))
    for (const c of this.plan.data.connectors) {
      if (!c.floors.includes(f.floor)) continue
      // Mode PMR : seuls les ascenseurs restent utilisables, cerclés de cobalt
      const usable = !f.accessible || c.kind === 'ascenseur'
      ctx.globalAlpha = usable ? 1 : 0.3
      if (f.accessible && usable) {
        ctx.strokeStyle = COBALT
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.arc(this.sx(c.x), this.sy(c.y), badge * 0.75, 0, Math.PI * 2)
        ctx.stroke()
      }
      drawLogo(ctx, CONNECTOR_LOGOS[c.kind], this.sx(c.x), this.sy(c.y), badge)
      ctx.globalAlpha = 1
    }

    // Services : sorties (panneau vert), toilettes, sécurité, accueil…
    for (const a of this.plan.data.amenities) {
      if (a.floor !== f.floor) continue
      if (a.kind === 'sortie') {
        // Sortie avec correspondance RER : panneau ancré du côté intérieur du plan pour rester lisible
        const w = a.rer ? this.signWidth(badge, a.rer) : 0
        const shift = a.rer ? (a.x < this.plan.data.width / 2 ? w / 2 : -w / 2) : 0
        drawExitSign(ctx, this.sx(a.x) + shift, this.sy(a.y), badge, a.rer)
      }
      else drawLogo(ctx, AMENITY_LOGOS[a.kind], this.sx(a.x), this.sy(a.y), badge * 0.9)
    }

    // Bons plans : étiquette jaune au coin des boutiques en promotion
    const tagH = Math.max(14, Math.min(20, s * 2.6))
    for (const shop of d.shops) {
      const tag = this.promoTags.get(shop.name)
      if (tag) drawPromoTag(ctx, tag, this.sx(shop.x + shop.w) - 2, this.sy(shop.y) + 2, tagH, 'right')
    }

    // Fréquentation : ni destination, ni particules, ni position
    if (f.heat) return

    // Repère de destination (s'il est à ce niveau)
    if (dest && dest.floor === f.floor) {
      const x = this.sx(dest.pt.x), y = this.sy(dest.pt.y)
      ctx.fillStyle = TOMATO
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.arc(x, y - 18, 10, Math.PI * 0.8, Math.PI * 2.2)
      ctx.lineTo(x, y)
      ctx.closePath()
      ctx.stroke()
      ctx.fill()
      ctx.fillStyle = '#fff'
      ctx.beginPath()
      ctx.arc(x, y - 18, 4, 0, Math.PI * 2)
      ctx.fill()
    }

    // Particules (hypothèses du filtre)
    ctx.fillStyle = rgba(COBALT, 0.22)
    const { x, y } = f.particles
    for (let i = 0; i < x.length; i++) ctx.fillRect(this.sx(x[i]) - 1, this.sy(y[i]) - 1, 2, 2)

    // Vraie position (démo)
    if (f.truth && f.truth.floor === f.floor) {
      ctx.strokeStyle = rgba(INK, 0.45)
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(this.sx(f.truth.x), this.sy(f.truth.y), 5, 0, Math.PI * 2)
      ctx.stroke()
    }

    const ex = this.sx(f.estimate.x), ey = this.sy(f.estimate.y)

    // Cercle de précision
    ctx.fillStyle = rgba(COBALT, 0.1)
    ctx.beginPath()
    ctx.arc(ex, ey, Math.max(12, f.estimate.accuracy * s), 0, Math.PI * 2)
    ctx.fill()

    // Cône d'orientation
    if (f.heading != null) {
      const a = f.heading - Math.PI / 2
      const g = ctx.createRadialGradient(ex, ey, 0, ex, ey, 46)
      g.addColorStop(0, rgba(COBALT, 0.45))
      g.addColorStop(1, rgba(COBALT, 0))
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.moveTo(ex, ey)
      ctx.arc(ex, ey, 46, a - 0.45, a + 0.45)
      ctx.closePath()
      ctx.fill()
    }

    // Point de position
    ctx.fillStyle = '#fff'
    ctx.beginPath()
    ctx.arc(ex, ey, 10.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = COBALT
    ctx.beginPath()
    ctx.arc(ex, ey, 7.5, 0, Math.PI * 2)
    ctx.fill()
  }

  private drawShop(shop: Shop, isDest: boolean, fontSize: number) {
    const { ctx } = this
    const s = this.cam.s
    const x = this.sx(shop.x) + 1, y = this.sy(shop.y) + 1, w = shop.w * s - 2, h = shop.h * s - 2
    if (x > this.w || y > this.h || x + w < 0 || y + h < 0) return

    ctx.fillStyle = isDest ? rgba(TOMATO, 0.1) : SHOP
    ctx.fillRect(x, y, w, h)
    ctx.strokeStyle = isDest ? TOMATO : shopEdge()
    ctx.lineWidth = isDest ? 3 : a11y.contrast ? 1.5 : 1
    ctx.strokeRect(x, y, w, h)

    const logo = logoFor(shop)
    const size = Math.max(14, Math.min(46, Math.min(w, h) * 0.42))
    const withLabel = w > 40 && h > size + fontSize + 12
    if (w < size + 4 || h < size + 4) return
    const cx = x + w / 2
    const cy = withLabel ? y + h / 2 - fontSize * 0.75 : y + h / 2
    drawLogo(ctx, logo, cx, cy, size)
    if (withLabel) {
      ctx.fillStyle = isDest ? TOMATO : label()
      ctx.font = `${isDest ? 800 : 600} ${fontSize}px ${FONT}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillText(shop.name, cx, cy + size / 2 + 5, w - 8)
    }
  }

  /** Largeur d'un panneau de sortie (mesurée sur un canvas hors écran) */
  private signWidth(h: number, rer: string[]) {
    const key = `${h.toFixed(1)}|${rer}`
    let w = this.signWidths.get(key)
    if (w == null) {
      const c = document.createElement('canvas').getContext('2d')!
      this.signWidths.set(key, (w = drawExitSign(c, 0, 0, h, rer)))
    }
    return w
  }

  private polyline(pts: Pt[], color: string, width: number) {
    const { ctx } = this
    ctx.strokeStyle = color
    ctx.lineWidth = width
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    pts.forEach((p, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, this.sx(p.x), this.sy(p.y)))
    ctx.stroke()
  }
}
