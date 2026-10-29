import type { Plan, Pt, Shop } from './plan'
import { pointAt, type Route } from './route'
import { drawLogo, LOGOS, type Logo } from './logos'

export interface Frame {
  particles: { x: Float64Array; y: Float64Array }
  estimate: Pt & { accuracy: number }
  /** Cap dans le repère du plan (radians), null si inconnu */
  heading: number | null
  /** Vraie position (mode démo uniquement) */
  truth: Pt | null
  route: Route | null
  /** Distance déjà parcourue sur l'itinéraire */
  along: number
  destination: { pt: Pt; shop?: Shop } | null
  /** Vue d'ensemble du plan, sinon caméra centrée sur le point de position */
  overview: boolean
}

// Identité InMap (mêmes valeurs que style.css) : papier, encre chaude, cobalt, tomate
const SAND = '#e8e2d6'
const CORRIDOR = '#faf7f1'
const SHOP = '#ffffff'
const SHOP_EDGE = '#d6cdbd'
const INK = '#1d1b16'
const LABEL = '#3a352c'
const COBALT = '#2a45e0'
const TOMATO = '#f0532a'
const DONE = '#bdb5a6'
const FONT = '"Bricolage Grotesque", system-ui, sans-serif'

const FOLLOW_SCALE = 5.5 // px par mètre en mode suivi
// Zone utile entre le bandeau du haut et le panneau du bas
const TOP = 110, BOTTOM = 230, PAD = 16

const rgba = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

const fallbackLogo = (shop: Shop): Logo => ({
  bg: INK, fg: '#fff', shape: 'circle',
  text: shop.name.split(/\s+/).filter(w => /^[A-ZÀ-Ý0-9]/.test(w)).map(w => w[0]).join('').slice(0, 2),
})

export class Renderer {
  private ctx: CanvasRenderingContext2D
  private w = 0
  private h = 0
  private cam = { x: 0, y: 0, s: 1 }
  private ready = false

  constructor(private canvas: HTMLCanvasElement, private plan: Plan) {
    this.ctx = canvas.getContext('2d')!
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
    const k = 0.08
    this.cam.x += (target.x - this.cam.x) * k
    this.cam.y += (target.y - this.cam.y) * k
    this.cam.s += (target.s - this.cam.s) * k
  }

  draw(f: Frame) {
    this.updateCamera(f)
    const { ctx } = this
    const s = this.cam.s
    const d = this.plan.data
    ctx.fillStyle = SAND
    ctx.fillRect(0, 0, this.w, this.h)

    // Couloirs
    ctx.strokeStyle = CORRIDOR
    ctx.lineWidth = d.halfWidth * 2 * s
    ctx.lineCap = 'square'
    for (const line of d.corridors) {
      ctx.beginPath()
      line.forEach((p, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, this.sx(p.x), this.sy(p.y)))
      ctx.stroke()
    }

    // Boutiques : bloc blanc, logo de l'enseigne et nom
    const dest = f.destination
    const fontSize = Math.max(9, Math.min(13, s * 2.3))
    for (const shop of d.shops) this.drawShop(shop, dest?.shop === shop, fontSize)

    // Points de recalage QR / NFC
    for (const a of Object.values(d.anchors)) {
      const x = this.sx(a.x), y = this.sy(a.y)
      ctx.fillStyle = INK
      ctx.fillRect(x - 6, y - 6, 12, 12)
      ctx.fillStyle = CORRIDOR
      ctx.fillRect(x - 3, y - 3, 6, 6)
    }

    // Itinéraire : partie restante en cobalt (liseré blanc façon signalétique), partie parcourue en gris
    if (f.route && f.route.pts.length > 1) {
      const split = pointAt(f.route, f.along)
      const done = [...f.route.pts.slice(0, split.i), split.pt]
      const todo = [split.pt, ...f.route.pts.slice(split.i)]
      const width = Math.max(5, s * 1.3)
      this.polyline(done, DONE, width)
      this.polyline(todo, '#fff', width + 4)
      this.polyline(todo, COBALT, width)
    }

    // Repère de destination
    if (dest) {
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
    if (f.truth) {
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
    ctx.strokeStyle = isDest ? TOMATO : SHOP_EDGE
    ctx.lineWidth = isDest ? 3 : 1
    ctx.strokeRect(x, y, w, h)

    const logo = LOGOS[shop.name] ?? fallbackLogo(shop)
    const size = Math.max(14, Math.min(46, Math.min(w, h) * 0.42))
    const withLabel = w > 40 && h > size + fontSize + 12
    if (w < size + 4 || h < size + 4) return
    const cx = x + w / 2
    const cy = withLabel ? y + h / 2 - fontSize * 0.75 : y + h / 2
    drawLogo(ctx, logo, cx, cy, size)
    if (withLabel) {
      ctx.fillStyle = isDest ? TOMATO : LABEL
      ctx.font = `${isDest ? 800 : 600} ${fontSize}px ${FONT}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillText(shop.name, cx, cy + size / 2 + 5, w - 8)
    }
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
