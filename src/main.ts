// Polices embarquées (fonctionne hors connexion le jour du pitch)
import '@fontsource/bricolage-grotesque/500.css'
import '@fontsource/bricolage-grotesque/600.css'
import '@fontsource/bricolage-grotesque/800.css'
import '@fontsource/dm-serif-display/400.css'
import '@fontsource/dm-serif-display/400-italic.css'
import './style.css'
import { Plan, PLANS, type Pt, type Shop } from './plan'
import { ParticleFilter } from './filter'
import { Sensors } from './sensors'
import { Walker } from './sim'
import { Renderer } from './render'
import { findRoute, nextInstruction, progressOn, type Route } from './route'

const DEG = Math.PI / 180
const WALK_SPEED = 1.2 // m/s, pour l'estimation du temps de trajet
const DEMO_STEP_MS = 200 // démo accélérée (~×3 par rapport à la marche réelle)
const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!

// Paramètres d'URL : ?plan=mall|test  &anchor=<id du QR/NFC scanné>  &step=<foulée en m>
const params = new URLSearchParams(location.search)
const plan = new Plan(PLANS[params.get('plan') ?? 'mall'] ?? PLANS.mall)
const anchors = plan.data.anchors
const anchor = anchors[params.get('anchor') ?? ''] ?? Object.values(anchors)[0]
const stepLength = Number(params.get('step')) || 0.7

// Le canvas ne déclenche pas toujours le chargement des polices : on les précharge
for (const f of ['600 12px "Bricolage Grotesque"', '800 12px "Bricolage Grotesque"', '12px "DM Serif Display"', 'italic 12px "DM Serif Display"']) {
  document.fonts.load(f).catch(() => {})
}

const filter = new ParticleFilter(plan)
const renderer = new Renderer($<HTMLCanvasElement>('#map'), plan)
const sensors = new Sensors()

type Destination = { label: string; pt: Pt; shop?: Shop }

let mode: 'demo' | 'real' = 'demo'
let steps = 0
let lastHeading: number | null = null
let walker: Walker | null = null
let demoTimer = 0
let sensorsOn = false

let dest: Destination | null = null
let route: Route | null = null
let along = 0
let overview = false
let overviewUntil = 0
let tripIndex = 0
let nextTripTimer = 0

// Décalage entre le nord magnétique et le « haut » du plan (degrés)
let northOffset = 0
try { northOffset = Number(localStorage.getItem('inmap.northOffset')) || 0 } catch {}

function setDestination(d: Destination) {
  dest = d
  route = findRoute(plan, filter.estimate(), d.pt)
  along = 0
  // Montre le trajet complet quelques secondes avant de passer en suivi
  overviewUntil = performance.now() + 3000
  if (walker) {
    const r = findRoute(plan, walker.pos, d.pt)
    walker.setPath(r ? [walker.pos, ...r.pts] : [])
  }
  clearTimeout(nextTripTimer)
  nextTripTimer = 0
}

function startNextTrip() {
  const trips = plan.data.demoTrips
  const d = plan.destination(trips[tripIndex++ % trips.length])
  if (d) setDestination(d)
}

function startDemo() {
  walker = new Walker(anchor)
  filter.init(walker.pos, 1)
  tripIndex = 0
  startNextTrip()
  demoTimer = window.setInterval(() => {
    const s = walker?.step()
    if (!s) return
    lastHeading = s.heading
    filter.step(s.heading, s.length)
    steps++
  }, DEMO_STEP_MS)
}

function stopDemo() {
  clearInterval(demoTimer)
  clearTimeout(nextTripTimer)
  nextTripTimer = 0
  walker = null
}

function setMode(m: typeof mode) {
  mode = m
  document.querySelectorAll<HTMLButtonElement>('.seg button').forEach(b => b.classList.toggle('on', b.dataset.mode === m))
  $('#real-controls').hidden = m !== 'real'
  $('#hint').textContent = m === 'real'
    ? 'Touchez une boutique pour y aller · un couloir pour vous recaler'
    : 'Touchez une boutique pour changer de destination'
  stopDemo()
  steps = 0
  lastHeading = null
  dest = null
  route = null
  if (m === 'demo') startDemo()
  else filter.init(anchor, 1)
}

document.querySelectorAll<HTMLButtonElement>('.seg button').forEach(b =>
  b.addEventListener('click', () => setMode(b.dataset.mode as typeof mode)))

sensors.onStep = () => {
  if (mode !== 'real' || sensors.heading == null) return
  filter.step((sensors.heading - northOffset) * DEG, stepLength)
  steps++
}

$('#btn-sensors').addEventListener('click', async () => {
  const btn = $<HTMLButtonElement>('#btn-sensors')
  const hint = $('#hint')
  if (!window.isSecureContext) {
    hint.textContent = 'Les capteurs exigent HTTPS.'
    hint.classList.add('warn')
    return
  }
  try {
    await sensors.start()
    sensorsOn = true
    btn.disabled = true
    btn.textContent = 'Guidage actif'
    // Garder l'écran allumé : le suivi s'arrête si la page passe en arrière-plan
    try { await navigator.wakeLock?.request('screen') } catch {}
  } catch (e) {
    hint.textContent = (e as Error).message
    hint.classList.add('warn')
  }
})

$('#btn-align').addEventListener('click', () => {
  if (sensors.heading == null) return
  northOffset = sensors.heading
  try { localStorage.setItem('inmap.northOffset', String(northOffset)) } catch {}
  filter.init(filter.estimate(), 1)
})

$('#btn-view').addEventListener('click', () => {
  overview = !overview
  overviewUntil = 0
  $('#btn-view').textContent = overview ? 'Suivre ma position' : "Vue d'ensemble"
})

// Toucher une boutique = itinéraire ; toucher un couloir = recalage (équivalent d'un scan QR / NFC)
$('#map').addEventListener('pointerdown', e => {
  const p = renderer.toPlan(e.clientX, e.clientY)
  const shop = plan.shopAt(p)
  if (shop) setDestination(plan.destination(shop.name)!)
  else if (mode === 'real' && plan.walkable(p.x, p.y)) filter.init(p, 1, true)
})

const svg = (d: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`
const ICONS = {
  gauche: svg('M17 20v-7a4 4 0 0 0-4-4H5M9 5 5 9l4 4'),
  droite: svg('M7 20v-7a4 4 0 0 1 4-4h8M15 5l4 4-4 4'),
  'demi-tour': svg('M6 20V10a5 5 0 0 1 10 0v10M12 16l4 4 4-4'),
  arrivee: svg('M6 21V4h11l-2.5 4L17 12H6'),
  arrive: svg('M5 12.5 9.5 17 19 7'),
  logo: svg('M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11ZM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z'),
}

let lastBanner = ''

function updateBanner(arrived: boolean) {
  let icon = ICONS.logo, main = '', sub = `${plan.data.name} · départ : ${anchor.label}`
  if (dest && route) {
    const remaining = Math.max(0, route.length - along)
    if (arrived) {
      icon = ICONS.arrive
      main = 'Vous êtes arrivé'
      sub = dest.label
    } else {
      const ins = nextInstruction(route, along)
      const d = ins.dist < 20 ? Math.round(ins.dist) : Math.round(ins.dist / 5) * 5
      icon = ICONS[ins.dir]
      if (ins.dir === 'arrivee') main = `Destination dans ${d} m`
      else {
        const action = ins.dir === 'demi-tour' ? 'faites demi-tour' : `tournez à ${ins.dir}`
        main = ins.dist < 8 ? action[0].toUpperCase() + action.slice(1) : `Dans ${d} m, ${action}`
      }
      sub = `${Math.max(1, Math.round(remaining / WALK_SPEED / 60))} min · ${Math.round(remaining)} m · ${dest.label}`
    }
  }
  // Ne touche au DOM que si le contenu change (appelé à chaque image)
  const key = `${!!route}|${icon}|${main}|${sub}`
  if (key === lastBanner) return
  lastBanner = key
  $('#banner').classList.toggle('nav', !!route)
  $('#nav-icon').innerHTML = icon
  if (main) $('#nav-main').textContent = main
  else $('#nav-main').innerHTML = 'In<span class="accent">Map</span>'
  $('#nav-sub').textContent = sub
}

function frame() {
  const est = filter.estimate()

  let arrived = false
  if (dest && route) {
    const pr = progressOn(route, est)
    if (mode === 'real' && pr.offset > 8) {
      // Écart trop important : nouveau calcul d'itinéraire depuis la position actuelle
      route = findRoute(plan, est, dest.pt)
      along = 0
    } else {
      along = pr.along
    }
    arrived = !!route && route.length - along < 3 && (!walker || walker.done)
    if (arrived && walker && !nextTripTimer) nextTripTimer = window.setTimeout(startNextTrip, 3000)
  }
  updateBanner(arrived)

  const rawHeading = mode === 'real'
    ? (sensors.heading != null ? (sensors.heading - northOffset) * DEG : null)
    : lastHeading
  renderer.draw({
    particles: filter.particles(),
    estimate: est,
    heading: rawHeading != null ? rawHeading + est.bias : null,
    truth: walker?.pos ?? null,
    route,
    along,
    destination: dest,
    overview: overview || performance.now() < overviewUntil,
  })

  const parts = [`Pas : ${steps}`, `Précision : ±${est.accuracy.toFixed(1)} m`]
  if (walker) parts.push(`Erreur réelle : ${Math.hypot(est.x - walker.pos.x, est.y - walker.pos.y).toFixed(1)} m`)
  if (mode === 'real') {
    parts.push(sensorsOn && sensors.heading != null ? `Cap : ${Math.round(sensors.heading)}°` : 'Capteurs inactifs')
  }
  $('#stats').textContent = parts.join(' · ')
  requestAnimationFrame(frame)
}

setMode('demo')
requestAnimationFrame(frame)
