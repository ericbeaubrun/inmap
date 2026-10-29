import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { ConnectorKind, Floor, Plan, Pt, Shop } from './plan'
import { pieces, verticals, type Route } from './route'
import { AMENITY_LOGOS, CONNECTOR_LOGOS, drawExitSign, drawLogo, drawPromoTag, logoFor, type Logo } from './logos'
import { BOTTOM, TOP, type Frame } from './render'

/**
 * Vue 3D « éclatée » : les niveaux sont empilés avec un écart volontairement exagéré
 * pour qu'on les voie tous. Le niveau du visiteur est opaque, les autres en transparence.
 * Repère : x du plan → X, y du plan → Z, niveau → Y.
 */

// Identité InMap (mêmes valeurs que style.css / render.ts)
const SAND = '#e8e2d6'
const SLAB = '#ddd4c3'
const CORRIDOR = '#faf7f1'
const INK = '#1d1b16'
const COBALT = '#2a45e0'
const TOMATO = '#f0532a'
const DONE = '#bdb5a6'
const FONT = '"Bricolage Grotesque", system-ui, sans-serif'

const GAP = 90 // écart vertical entre niveaux (m), exagéré pour la lisibilité
const SHOP_H = 2.4, BIG_H = 3.6 // hauteur des volumes : basse pour ne pas masquer le trajet
const GHOST = 0.2 // opacité des niveaux autres que celui du visiteur
const FOV = 35
const FOLLOW_DIST = 240
const PX_PER_M = 7 // résolution des textures de toit
const ESCALATOR_RUN = 60 // longueur au sol d'une rampe d'escalator en 3D (m), pente exagérée comme l'écart des niveaux
// Vue par défaut depuis l'ouest-sud-ouest, ~40° au-dessus de l'horizon
const VIEW_DIR = new THREE.Vector3(-0.72, 0.64, 0.26).normalize()

interface FloorView {
  shops: THREE.Mesh[]
  /** Matériaux du niveau, dont l'opacité suit la mise en avant */
  materials: THREE.Material[]
  opacity: number
}

const canvas2d = (w: number, h: number) => {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return { c, g: c.getContext('2d')! }
}

export class Renderer3D {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(FOV, 1, 1, 8000)
  private controls: OrbitControls
  private views: FloorView[] = []
  private cx: number
  private cz: number
  private unitBox = new THREE.BoxGeometry(1, 1, 1)
  private unitDisc = new THREE.CylinderGeometry(1, 1, 1, 20)
  private mats = {
    todo: new THREE.MeshBasicMaterial({ color: COBALT }),
    casing: new THREE.MeshBasicMaterial({ color: '#ffffff' }),
    done: new THREE.MeshBasicMaterial({ color: DONE }),
    destSide: new THREE.MeshLambertMaterial({ color: '#fbd3c5' }),
    destEdge: new THREE.LineBasicMaterial({ color: TOMATO }),
  }
  private routeGroup = new THREE.Group()
  private routeState = { route: null as Route | null, along: -1, floor: -1, width: 0 }
  private marker = new THREE.Group()
  private accuracy: THREE.Mesh
  private cone = new THREE.Group()
  private particles: THREE.Points
  private pin: THREE.Sprite
  private dest: { mesh: THREE.Mesh; material: THREE.Material[]; edge: THREE.LineSegments; edgeMaterial: THREE.Material } | null = null
  private connectorViews: { kind: ConnectorKind; shaft: THREE.MeshBasicMaterial; badge: THREE.SpriteMaterial; base: number }[] = []
  private accessible = false
  private dotY: number | null = null
  private currentFloor = 0
  private autoZoom = true
  private wasOverview: boolean | null = null
  private ready = false

  constructor(canvas: HTMLCanvasElement, private plan: Plan, onShopTap: (shop: Shop) => void) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
    this.scene.background = new THREE.Color(SAND)
    this.cx = plan.data.width / 2
    this.cz = plan.data.height / 2

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xcfc6b4, 2.4))
    const sun = new THREE.DirectionalLight(0xffffff, 1.6)
    sun.position.set(-1, 2.5, 1.5)
    this.scene.add(sun)

    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enableDamping = true
    this.controls.enablePan = false
    this.controls.minPolarAngle = 0.15
    this.controls.maxPolarAngle = 1.35
    this.controls.minDistance = 10
    this.controls.maxDistance = 4000
    // Dès que l'utilisateur zoome ou tourne, on cesse d'imposer la distance
    this.controls.addEventListener('start', () => { this.autoZoom = false })

    plan.floors.forEach(f => this.buildFloor(f))
    this.buildConnectors()
    this.scene.add(this.routeGroup)

    // Repère de position : disque de précision, cône d'orientation, point
    this.accuracy = new THREE.Mesh(
      new THREE.CircleGeometry(1, 48),
      new THREE.MeshBasicMaterial({ color: COBALT, transparent: true, opacity: 0.14, depthWrite: false }),
    )
    this.accuracy.rotation.x = -Math.PI / 2
    const coneMesh = new THREE.Mesh(
      new THREE.CircleGeometry(10, 24, Math.PI / 2 - 0.45, 0.9),
      new THREE.MeshBasicMaterial({ color: COBALT, transparent: true, opacity: 0.3, depthWrite: false }),
    )
    coneMesh.rotation.x = -Math.PI / 2
    this.cone.add(coneMesh)
    this.cone.scale.setScalar(Math.min(1, plan.data.width / 60)) // plus discret sur un petit plan
    const dot = this.sprite(this.dotTexture(), 0.019, 0.019)
    dot.renderOrder = 10
    this.marker.add(this.accuracy, this.cone, dot)
    this.scene.add(this.marker)

    // Hypothèses du filtre
    const n = 600
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3))
    this.particles = new THREE.Points(geo, new THREE.PointsMaterial({
      color: COBALT, size: 2.5, sizeAttenuation: false, transparent: true, opacity: 0.35, depthWrite: false,
    }))
    this.particles.frustumCulled = false
    this.scene.add(this.particles)

    this.pin = this.sprite(this.pinTexture(), 0.024, 0.03)
    this.pin.center.set(0.5, 0)
    this.pin.renderOrder = 11
    this.scene.add(this.pin)

    this.resize()
    window.addEventListener('resize', () => this.resize())

    // Toucher (sans glisser) une boutique = itinéraire ; le niveau du visiteur est prioritaire
    let down: { x: number; y: number; t: number } | null = null
    const raycaster = new THREE.Raycaster()
    canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now() } })
    canvas.addEventListener('pointerup', e => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8 || performance.now() - down.t > 400) return
      const rect = canvas.getBoundingClientRect()
      const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1)
      raycaster.setFromCamera(ndc, this.camera)
      const order = [this.currentFloor, ...this.views.map((_, i) => i).filter(i => i !== this.currentFloor)]
      for (const i of order) {
        const hit = raycaster.intersectObjects(this.views[i].shops, false)[0]
        if (hit) return onShopTap(hit.object.userData.shop as Shop)
      }
    })
  }

  private resize() {
    const w = window.innerWidth, h = window.innerHeight
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    // Décale l'image pour centrer la scène dans la zone utile (entre bandeau et panneau)
    const shift = h / 2 - (TOP + (h - TOP - BOTTOM) / 2)
    this.camera.setViewOffset(w, h, 0, shift, w, h)
    this.camera.updateProjectionMatrix()
  }

  private world(p: Pt, y: number) {
    return new THREE.Vector3(p.x - this.cx, y, p.y - this.cz)
  }

  private buildFloor(floor: Floor) {
    const y = floor.index * GAP
    const hw = this.plan.data.halfWidth
    const materials: THREE.Material[] = []
    const track = <M extends THREE.Material>(m: M) => {
      m.userData.base = m.opacity
      materials.push(m)
      return m
    }
    const shops: THREE.Mesh[] = []

    // Dalle : emprise des couloirs et boutiques du niveau
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
    const extend = (x: number, z: number) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z) }
    for (const line of floor.data.corridors) for (const p of line) { extend(p.x - hw, p.y - hw); extend(p.x + hw, p.y + hw) }
    for (const s of floor.data.shops) { extend(s.x, s.y); extend(s.x + s.w, s.y + s.h) }
    const slabGeo = new THREE.BoxGeometry(x1 - x0 + 6, 1.2, z1 - z0 + 6)
    const slab = new THREE.Mesh(slabGeo, track(new THREE.MeshLambertMaterial({ color: SLAB })))
    slab.position.copy(this.world({ x: (x0 + x1) / 2, y: (z0 + z1) / 2 }, y - 0.6))
    slab.add(new THREE.LineSegments(new THREE.EdgesGeometry(slabGeo), track(new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.4 }))))
    this.scene.add(slab)

    // Couloirs
    const corridorMat = track(new THREE.MeshLambertMaterial({ color: CORRIDOR }))
    for (const { a, b } of floor.segs) {
      const dx = b.x - a.x, dz = b.y - a.y
      const m = new THREE.Mesh(this.unitBox, corridorMat)
      m.scale.set(Math.hypot(dx, dz) + 2 * hw, 0.2, 2 * hw)
      m.position.copy(this.world({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, y + 0.1))
      m.rotation.y = -Math.atan2(dz, dx)
      this.scene.add(m)
    }

    // Boutiques : volumes blancs à liseré encre, logo et nom sur le toit
    const sideMat = track(new THREE.MeshLambertMaterial({ color: '#ffffff' }))
    const edgeMat = track(new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.5 }))
    for (const shop of floor.data.shops) {
      const height = shop.w * shop.h > 1500 ? BIG_H : SHOP_H
      const geo = new THREE.BoxGeometry(shop.w - 1, height, shop.h - 1)
      const top = track(new THREE.MeshBasicMaterial({ map: this.roofTexture(shop) }))
      // Faces BoxGeometry : +x, -x, +y (toit), -y, +z, -z
      const mesh = new THREE.Mesh(geo, [sideMat, sideMat, top, sideMat, sideMat, sideMat])
      mesh.position.copy(this.world({ x: shop.x + shop.w / 2, y: shop.y + shop.h / 2 }, y + height / 2))
      mesh.userData.shop = shop
      mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat))
      this.scene.add(mesh)
      shops.push(mesh)
    }

    // Nom du niveau, ancré au coin nord-ouest de la dalle (en bas à gauche dans la vue par défaut)
    const label = this.sprite(this.labelTexture(floor.data.name), 0.135, 0.018)
    label.center.set(0, 0.5)
    label.position.copy(this.world({ x: x0, y: z0 }, y + 3))
    this.scene.add(label)

    // Services (pictogrammes) et bons plans (bannières flottant au-dessus des vitrines),
    // estompés comme le reste du niveau quand le visiteur est ailleurs
    const sprite = (map: THREE.Texture, sx: number, sy: number) => {
      const s = this.sprite(map, sx, sy)
      track(s.material)
      return s
    }
    for (const a of this.plan.data.amenities) {
      if (a.floor !== floor.index) continue
      const s = a.kind === 'sortie'
        ? sprite(this.exitTexture(), 0.06, 0.017)
        : sprite(this.logoTexture(AMENITY_LOGOS[a.kind]), 0.016, 0.016)
      s.renderOrder = 7
      s.position.copy(this.world(a, y + 3))
      this.scene.add(s)
    }
    for (const promo of this.plan.data.promos) {
      const shop = floor.data.shops.find(s => s.name === promo.shop)
      if (!shop) continue
      const { map, aspect } = this.promoTexture(promo.tag)
      const s = sprite(map, 0.02 * aspect, 0.02)
      s.center.set(0.5, 0)
      s.renderOrder = 9
      s.position.copy(this.world({ x: shop.x + shop.w / 2, y: shop.y + shop.h / 2 }, y + 12))
      this.scene.add(s)
    }

    this.views.push({ shops, materials, opacity: 1 })
  }

  private buildConnectors() {
    for (const c of this.plan.data.connectors) {
      const floors = [...c.floors].sort((a, b) => a - b)
      const ys = floors.map(i => i * GAP)
      let shaftMat: THREE.MeshBasicMaterial
      if (c.kind === 'ascenseur') {
        // Ascenseur : cage verticale vitrée
        const y0 = ys[0], y1 = ys[ys.length - 1]
        shaftMat = new THREE.MeshBasicMaterial({ color: INK, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide })
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, y1 - y0, 20, 1, true), shaftMat)
        shaft.position.copy(this.world(c, (y0 + y1) / 2))
        this.scene.add(shaft)
      } else {
        // Escalator : rampe inclinée (marches + garde-corps) entre chaque paire de niveaux
        shaftMat = new THREE.MeshBasicMaterial({ color: INK, transparent: true, opacity: 0.35, depthWrite: false })
        const railMat = new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.6 })
        for (let k = 0; k < floors.length - 1; k++) {
          if (floors[k + 1] !== floors[k] + 1) continue
          const { a, b } = this.escalatorEnds(c, floors[k], 0.2)
          const ramp = this.segment(a, b, shaftMat, 5, 1.2, this.scene)
          ramp?.add(new THREE.LineSegments(new THREE.EdgesGeometry(this.unitBox), railMat))
        }
      }
      const badgeMat = new THREE.SpriteMaterial({ map: this.logoTexture(CONNECTOR_LOGOS[c.kind]), sizeAttenuation: false, depthTest: false })
      for (const y of ys) {
        const badge = new THREE.Sprite(badgeMat)
        badge.scale.set(0.017, 0.017, 1)
        badge.renderOrder = 8
        badge.position.copy(this.world(c, y + 4))
        this.scene.add(badge)
      }
      this.connectorViews.push({ kind: c.kind, shaft: shaftMat, badge: badgeMat, base: shaftMat.opacity })
    }
  }

  /** Mode PMR : escalators et escaliers estompés, ascenseur mis en avant */
  private updateAccessible(accessible: boolean) {
    if (accessible === this.accessible) return
    this.accessible = accessible
    for (const v of this.connectorViews) {
      const usable = !accessible || v.kind === 'ascenseur'
      v.badge.opacity = usable ? 1 : 0.25
      v.shaft.opacity = usable ? (accessible ? 0.3 : v.base) : 0.08
      v.shaft.color.set(accessible && usable ? COBALT : INK)
    }
  }

  // ─── Textures dessinées en 2D ───

  private texture(c: HTMLCanvasElement) {
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    t.anisotropy = this.renderer.capabilities.getMaxAnisotropy()
    return t
  }

  /** Toit d'une boutique. Le contenu est tourné de 90° pour être lisible depuis la vue par défaut (ouest). */
  private roofTexture(shop: Shop) {
    const clamp = (v: number) => Math.max(32, Math.min(512, Math.round(v * PX_PER_M)))
    const tw = clamp(shop.w), th = clamp(shop.h)
    const { c, g } = canvas2d(tw, th)
    g.fillStyle = '#ffffff'
    g.fillRect(0, 0, tw, th)
    g.translate(tw / 2, th / 2)
    g.rotate(Math.PI / 2)
    // Après rotation : largeur disponible = th, hauteur = tw
    const W = th, H = tw
    const size = Math.min(W, H) * 0.42
    const fs = Math.max(11, Math.min(34, H * 0.13))
    const withLabel = H > size + fs + 14
    const cy = withLabel ? -fs * 0.75 : 0
    drawLogo(g, logoFor(shop), 0, cy, size)
    if (withLabel) {
      g.fillStyle = '#3a352c'
      g.font = `700 ${fs}px ${FONT}`
      g.textAlign = 'center'
      g.textBaseline = 'top'
      g.fillText(shop.name, 0, cy + size / 2 + fs * 0.35, W - 10)
    }
    return this.texture(c)
  }

  private logoTexture(logo: Logo) {
    const { c, g } = canvas2d(96, 96)
    drawLogo(g, logo, 48, 48, 80)
    return this.texture(c)
  }

  private exitTexture() {
    const { c, g } = canvas2d(220, 64)
    drawExitSign(g, 110, 32, 56)
    return this.texture(c)
  }

  /** Bannière « bon plan » : étiquette jaune et petite pointe vers la vitrine */
  private promoTexture(tag: string) {
    const h = 44, tip = 14
    const { g: probe } = canvas2d(1, 1)
    probe.font = `800 ${h * 0.56}px ${FONT}`
    const w = Math.ceil(probe.measureText(tag).width + h * 0.7) + 8
    const { c, g } = canvas2d(w, h + tip + 6)
    g.fillStyle = INK
    g.beginPath()
    g.moveTo(w / 2 - 8, h)
    g.lineTo(w / 2 + 8, h)
    g.lineTo(w / 2, h + tip)
    g.closePath()
    g.fill()
    drawPromoTag(g, tag, w / 2, h / 2 + 3, h - 6)
    return { map: this.texture(c), aspect: w / (h + tip + 6) }
  }

  private labelTexture(text: string) {
    const { c, g } = canvas2d(512, 68)
    g.font = `800 40px ${FONT}`
    const w = g.measureText(text).width + 36
    g.fillStyle = INK
    g.beginPath()
    g.roundRect(0, 4, w, 60, 14)
    g.fill()
    g.fillStyle = '#ffffff'
    g.textBaseline = 'middle'
    g.fillText(text, 18, 35)
    return this.texture(c)
  }

  private dotTexture() {
    const { c, g } = canvas2d(64, 64)
    g.fillStyle = '#ffffff'
    g.beginPath(); g.arc(32, 32, 30, 0, Math.PI * 2); g.fill()
    g.fillStyle = COBALT
    g.beginPath(); g.arc(32, 32, 21, 0, Math.PI * 2); g.fill()
    return this.texture(c)
  }

  private pinTexture() {
    const { c, g } = canvas2d(64, 80)
    g.fillStyle = TOMATO
    g.strokeStyle = '#ffffff'
    g.lineWidth = 5
    g.beginPath()
    g.arc(32, 28, 24, Math.PI * 0.8, Math.PI * 2.2)
    g.lineTo(32, 77)
    g.closePath()
    g.stroke()
    g.fill()
    g.fillStyle = '#ffffff'
    g.beginPath(); g.arc(32, 28, 9, 0, Math.PI * 2); g.fill()
    return this.texture(c)
  }

  /** Sprite de taille constante à l'écran, toujours au premier plan */
  private sprite(map: THREE.Texture, sx: number, sy: number) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map, sizeAttenuation: false, depthTest: false }))
    s.scale.set(sx, sy, 1)
    return s
  }

  // ─── Mise à jour par image ───

  private fitDistance() {
    const { width, height } = this.plan.data
    const r = Math.hypot(width / 2, height / 2, (this.plan.floors.length - 1) * GAP / 2)
    const t = Math.tan(FOV * Math.PI / 360)
    const h = window.innerHeight
    return r / Math.min(t * this.camera.aspect, t * (h - TOP - BOTTOM) / h) * 0.95
  }

  /** Niveau du visiteur opaque, autres niveaux en transparence (transition progressive) */
  private updateOpacity(floor: number) {
    this.views.forEach((v, i) => {
      const target = i === floor ? 1 : GHOST
      if (v.opacity === target) return
      v.opacity += (target - v.opacity) * 0.12
      if (Math.abs(v.opacity - target) < 0.01) v.opacity = target
      for (const m of v.materials) {
        m.opacity = m.userData.base * v.opacity
        // Les sprites (pictogrammes, bannières) gardent leur transparence pour leurs bords
        const transparent = m.opacity < 0.999 || m instanceof THREE.SpriteMaterial
        if (m.transparent !== transparent) { m.transparent = transparent; m.needsUpdate = true }
        m.depthWrite = v.opacity >= 0.999
      }
    })
  }

  private updateDestination(shop: Shop | undefined) {
    if (this.dest?.mesh.userData.shop === shop) return
    if (this.dest) {
      this.dest.mesh.material = this.dest.material
      this.dest.edge.material = this.dest.edgeMaterial
      this.dest = null
    }
    const mesh = shop && this.views.flatMap(v => v.shops).find(m => m.userData.shop === shop)
    if (!mesh) return
    const material = mesh.material as THREE.Material[]
    const edge = mesh.children[0] as THREE.LineSegments
    this.dest = { mesh, material, edge, edgeMaterial: edge.material as THREE.Material }
    mesh.material = material.map((m, i) => (i === 2 ? m : this.mats.destSide))
    edge.material = this.mats.destEdge
  }

  /** Reconstruit le tracé quand l'itinéraire, l'avancement ou l'échelle changent sensiblement */
  private updateRoute(route: Route | null, along: number, floor: number, width: number) {
    const st = this.routeState
    if (st.route === route && Math.abs(st.along - along) < 0.5 && st.floor === floor && st.width === width) return
    Object.assign(st, { route, along, floor, width })
    this.routeGroup.clear()
    if (!route) return

    const ribbon = (line: Pt[], y: number, mat: THREE.Material, w: number) => {
      for (let i = 1; i < line.length; i++) {
        const a = line[i - 1], b = line[i]
        const dx = b.x - a.x, dz = b.y - a.y
        const len = Math.hypot(dx, dz)
        if (len < 0.01) continue
        const m = new THREE.Mesh(this.unitBox, mat)
        m.scale.set(len, 0.3, w)
        m.position.copy(this.world({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, y))
        m.rotation.y = -Math.atan2(dz, dx)
        this.routeGroup.add(m)
      }
      for (const p of line) {
        const j = new THREE.Mesh(this.unitDisc, mat)
        j.scale.set(w / 2, 0.3, w / 2)
        j.position.copy(this.world(p, y))
        this.routeGroup.add(j)
      }
    }

    for (const fl of this.plan.floors) {
      const y = fl.index * GAP + 0.5
      const { done, todo } = pieces(route, along, fl.index)
      for (const line of done) ribbon(line, y, this.mats.done, width)
      for (const line of todo) ribbon(line, y - 0.05, this.mats.casing, width * 1.7)
      for (const line of todo) ribbon(line, y, this.mats.todo, width)
    }
    // Changements de niveau : colonne pour l'ascenseur, rampes inclinées pour les escalators
    for (const v of verticals(route, along, floor)) {
      const mat = v.done ? this.mats.done : this.mats.todo
      if (v.kind === 'ascenseur') {
        this.segment(this.world(v, v.from * GAP + 0.5), this.world(v, v.to * GAP + 0.5), mat, width)
        continue
      }
      for (let f = Math.min(v.from, v.to); f < Math.max(v.from, v.to); f++) {
        const { a, b } = this.escalatorEnds(v, f, 0.5)
        this.segment(a, b, mat, width)
        this.segment(b, this.world(v, (f + 1) * GAP + 0.5), mat, width)
      }
    }
  }

  /**
   * Rampe d'escalator entre le niveau `lower` et le suivant : part du connecteur et monte le long de l'allée
   * (axe nord-sud). Le sens alterne d'un étage à l'autre (zigzag), sauf si l'arrivée sortirait des couloirs.
   */
  private escalatorEnds(c: Pt, lower: number, lift = 0) {
    let s = lower % 2 === 0 ? -1 : 1
    if (!this.plan.floors[lower + 1].walkable(c.x, c.y + s * ESCALATOR_RUN)) s = -s
    return {
      a: this.world(c, lower * GAP + lift),
      b: this.world({ x: c.x, y: c.y + s * ESCALATOR_RUN }, (lower + 1) * GAP + lift),
    }
  }

  /** Ruban plat de largeur w entre deux points 3D (horizontal, incliné ou vertical) */
  private segment(p: THREE.Vector3, q: THREE.Vector3, mat: THREE.Material, w: number, thickness = 0.3, parent: THREE.Object3D = this.routeGroup) {
    const dir = q.clone().sub(p)
    const len = dir.length()
    if (len < 0.01) return
    dir.normalize()
    // Repère local : x = sens du ruban, z = horizontale perpendiculaire (largeur)
    let side = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0))
    if (side.lengthSq() < 1e-6) side = new THREE.Vector3(0, 0, 1)
    side.normalize()
    const up = new THREE.Vector3().crossVectors(side, dir)
    const m = new THREE.Mesh(this.unitBox, mat)
    m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(dir, up, side))
    m.scale.set(len, thickness, w)
    m.position.copy(p).add(q).multiplyScalar(0.5)
    parent.add(m)
    return m
  }

  private updateCamera(f: Frame, dotY: number) {
    const fit = this.fitDistance()
    const target = f.overview
      ? new THREE.Vector3(0, (this.plan.floors.length - 1) * GAP / 2, 0)
      : this.world(f.estimate, dotY)
    const dist = f.overview ? fit : Math.min(FOLLOW_DIST, fit * 0.8)
    if (!this.ready) {
      this.controls.target.copy(target)
      this.camera.position.copy(target).addScaledVector(VIEW_DIR, dist)
      this.ready = true
    }
    if (f.overview !== this.wasOverview) { this.autoZoom = true; this.wasOverview = f.overview }
    // La caméra suit la cible en gardant l'angle choisi par l'utilisateur
    const delta = target.sub(this.controls.target).multiplyScalar(0.08)
    this.controls.target.add(delta)
    this.camera.position.add(delta)
    if (this.autoZoom) {
      const offset = this.camera.position.clone().sub(this.controls.target)
      const len = offset.length()
      if (Math.abs(dist - len) < 1) this.autoZoom = false
      this.camera.position.copy(this.controls.target).addScaledVector(offset.normalize(), len + (dist - len) * 0.08)
    }
    this.controls.update()
  }

  draw(f: Frame) {
    this.currentFloor = f.floor
    // Le point glisse d'un niveau à l'autre (escalator, ascenseur)
    const floorY = f.floor * GAP
    this.dotY = this.dotY == null ? floorY : this.dotY + (floorY - this.dotY) * 0.06
    const dotY = this.dotY

    this.updateOpacity(f.floor)
    this.updateAccessible(f.accessible)
    this.updateDestination(f.destination?.shop)

    // Largeur du tracé adaptée au zoom pour rester visible en vue d'ensemble
    const camDist = this.camera.position.distanceTo(this.controls.target)
    const width = Math.round(Math.max(1.8, Math.min(6, camDist / 220)) * 2) / 2
    this.updateRoute(f.route, f.along, f.floor, width)

    this.marker.position.copy(this.world(f.estimate, dotY + 0.7))
    const acc = Math.max(2.5, f.estimate.accuracy)
    this.accuracy.scale.set(acc, acc, 1)
    this.cone.visible = f.heading != null
    if (f.heading != null) this.cone.rotation.y = -f.heading

    const pos = this.particles.geometry.getAttribute('position') as THREE.BufferAttribute
    const { x, y } = f.particles
    for (let i = 0; i < x.length && i < pos.count; i++) pos.setXYZ(i, x[i] - this.cx, dotY + 0.6, y[i] - this.cz)
    pos.needsUpdate = true

    const dest = f.destination
    this.pin.visible = !!dest
    if (dest) this.pin.position.copy(this.world(dest.pt, dest.floor * GAP + 0.5))

    this.updateCamera(f, dotY)
    this.renderer.render(this.scene, this.camera)
  }
}
