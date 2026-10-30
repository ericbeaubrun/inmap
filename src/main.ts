// Polices embarquées (fonctionne hors connexion le jour du pitch)
import '@fontsource/bricolage-grotesque/500.css'
import '@fontsource/bricolage-grotesque/600.css'
import '@fontsource/bricolage-grotesque/700.css'
import '@fontsource/bricolage-grotesque/800.css'
import '@fontsource/dm-serif-display/400.css'
import '@fontsource/dm-serif-display/400-italic.css'
import './style.css'
import { Plan, PLANS, type Destination, type Pt } from './plan'
import { ParticleFilter } from './filter'
import { Sensors } from './sensors'
import { Walker } from './sim'
import { Renderer, type Frame } from './render'
import type { Renderer3D } from './render3d'
import { findRoute, isConnector, nextInstruction, progressOn, verticals, type Route } from './route'
import { initSearch } from './search'
import { drawLogo, logoFor } from './logos'
import { a11y, announce, initA11y } from './a11y'
import { HeatMap, HOUR_MAX, HOUR_MIN } from './heatmap'

const DEG = Math.PI / 180
const WALK_SPEED = 1.2 // m/s, pour l'estimation du temps de trajet
const FLOOR_CHANGE_S = 30 // temps forfaitaire d'un changement de niveau
const STILL_MS = 1500 // immobilité près d'un connecteur au-delà de laquelle on considère qu'on change de niveau
const DEMO_STEP_MS = 200 // démo accélérée (~×3 par rapport à la marche réelle)
const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!

// Paramètres d'URL : ?plan=mall|test  &anchor=<id du QR/NFC scanné>  &step=<foulée en m>
const params = new URLSearchParams(location.search)
const plan = new Plan(PLANS[params.get('plan') ?? 'mall'] ?? PLANS.mall)
const anchors = plan.data.anchors
const anchor = anchors[params.get('anchor') ?? ''] ?? Object.values(anchors)[0]
const stepLength = Number(params.get('step')) || 0.7

// Le canvas ne déclenche pas toujours le chargement des polices : on les précharge
const fontsReady = Promise.all(
  ['600 12px "Bricolage Grotesque"', '700 12px "Bricolage Grotesque"', '800 12px "Bricolage Grotesque"',
    '12px "DM Serif Display"', 'italic 12px "DM Serif Display"'].map(f => document.fonts.load(f)),
).catch(() => {})

const sensors = new Sensors()
const renderer = new Renderer($<HTMLCanvasElement>('#map'), plan)
let renderer3d: Renderer3D | null = null

let floor = anchor.floor // niveau où se trouve le visiteur
const filter = new ParticleFilter(plan.floors[floor])

let mode: 'demo' | 'real' = 'demo'
let view: '2d' | '3d' = '2d'
let accessible = false // mode PMR : ascenseurs uniquement
let steps = 0
let lastStepAt = 0
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

/** Place le visiteur à un niveau ; `keepLearned` conserve le biais de boussole et la foulée appris */
function setFloor(f: number, at: Pt, keepLearned = true) {
  floor = f
  filter.setArea(plan.floors[f])
  filter.init(at, 1, keepLearned)
}

function stepDetected(heading: number, length: number) {
  filter.step(heading, length)
  steps++
  lastStepAt = performance.now()
}

function setDestination(d: Destination) {
  dest = d
  route = findRoute(plan, filter.estimate(), floor, d.pt, d.floor, accessible)
  along = 0
  lastStepAt = performance.now() // l'immobilité ne compte qu'à partir du départ

  // Montre le trajet complet quelques secondes avant de passer en suivi
  overviewUntil = performance.now() + 3000
  if (walker) {
    const r = findRoute(plan, walker.pos, walker.floor, d.pt, d.floor, accessible)
    walker.setPath(r ? [{ ...walker.pos, floor: walker.floor }, ...r.pts] : [])
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
  walker = new Walker(anchor, anchor.floor)
  setFloor(anchor.floor, walker.pos, false)
  tripIndex = 0
  startNextTrip()
  demoTimer = window.setInterval(() => {
    const s = walker?.step()
    if (!s) return
    lastHeading = s.heading
    stepDetected(s.heading, s.length)
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
  document.querySelectorAll<HTMLButtonElement>('button[data-mode]').forEach(b => {
    b.classList.toggle('on', b.dataset.mode === m)
    b.setAttribute('aria-pressed', String(b.dataset.mode === m))
  })
  $('#real-controls').hidden = m !== 'real'
  $('#hint').textContent = m === 'real'
    ? 'Touchez une boutique pour y aller · un couloir pour vous recaler'
    : 'Touchez une boutique pour changer de destination'
  stopDemo()
  steps = 0
  lastHeading = null
  dest = null
  route = null
  shownPromos.clear() // chaque offre n'apparaît qu'une fois par session
  if (m === 'demo') startDemo()
  else setFloor(anchor.floor, anchor, false)
}

document.querySelectorAll<HTMLButtonElement>('button[data-mode]').forEach(b =>
  b.addEventListener('click', () => setMode(b.dataset.mode as typeof mode)))

// Bascule 2D / 3D ; la vue 3D (Three.js) n'est chargée qu'à la première demande
async function setView(v: typeof view) {
  if (v === '3d' && !renderer3d) {
    try {
      await fontsReady
      const { Renderer3D } = await import('./render3d')
      renderer3d ??= new Renderer3D($<HTMLCanvasElement>('#map3d'), plan, shop => {
        const d = plan.destination(shop.name)
        if (d) setDestination(d)
      })
    } catch {
      $('#hint').textContent = 'La vue 3D n’est pas disponible sur cet appareil.'
      $('#hint').classList.add('warn')
      v = '2d'
    }
  }
  // Chargement de la 3D terminé pendant l'onglet Fréquentation : on y reviendra en quittant l'onglet
  if (v === '3d' && tab === 'heat') { viewBeforeHeat = v; return }
  view = v
  document.querySelectorAll<HTMLButtonElement>('button[data-view]').forEach(b => {
    b.classList.toggle('on', b.dataset.view === v)
    b.setAttribute('aria-pressed', String(b.dataset.view === v))
  })
  $('#map').hidden = v !== '2d'
  $('#map3d').hidden = v !== '3d'
  // En arrivant en 3D, on montre d'abord la pile complète des niveaux
  if (v === '3d') overviewUntil = performance.now() + 2500
}

document.querySelectorAll<HTMLButtonElement>('button[data-view]').forEach(b =>
  b.addEventListener('click', () => setView(b.dataset.view as typeof view)))

sensors.onStep = () => {
  if (mode !== 'real' || sensors.heading == null) return
  stepDetected((sensors.heading - northOffset) * DEG, stepLength)
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

// Mode PMR : recalcule l'itinéraire en cours par les ascenseurs
function setAccessible(on: boolean) {
  accessible = on
  $('#btn-pmr').setAttribute('aria-pressed', String(accessible))
  if (dest) setDestination(dest)
}
$('#btn-pmr').addEventListener('click', () => setAccessible(!accessible))

// Options d'accessibilité (contraste, texte, voix, vibrations…) ; force le rafraîchissement du bandeau
initA11y({ get: () => accessible, set: setAccessible }, () => { lastBanner = '' })

// ─── Onglet Fréquentation : carte de chaleur simulée, par niveau et par heure ───
let tab: 'guide' | 'heat' = 'guide'
let heat: HeatMap | null = null
let heatFloor = plan.floors.length > 1 ? 1 : 0
let heatHour = 15
let heatTop: string[] = []
let heatPlaying = 0
let viewBeforeHeat: '2d' | '3d' = '3d'
const fmtHour = (h: number) => `${Math.floor(h)} h${h % 1 ? String(Math.round((h % 1) * 60)).padStart(2, '0') : ''}`

function setTab(t: typeof tab) {
  if (t === tab) return
  tab = t
  document.body.classList.toggle('heat-mode', t === 'heat')
  document.querySelectorAll<HTMLButtonElement>('button[data-tab]').forEach(b => {
    b.classList.toggle('on', b.dataset.tab === t)
    b.setAttribute('aria-selected', String(b.dataset.tab === t))
  })
  $('#promo-toast').hidden = true
  lastBanner = ''
  if (t === 'heat') {
    heat ??= new HeatMap(plan)
    // La carte de chaleur est une vue 2D d'ensemble
    viewBeforeHeat = view
    setView('2d')
    renderHeatFloors()
    updateHeat()
  } else {
    stopHeatPlay()
    setView(viewBeforeHeat)
  }
}
document.querySelectorAll<HTMLButtonElement>('button[data-tab]').forEach(b =>
  b.addEventListener('click', () => setTab(b.dataset.tab as typeof tab)))

function renderHeatFloors() {
  $('#heat-floors').replaceChildren(...plan.floors.map((f, i) => {
    const b = document.createElement('button')
    b.textContent = f.data.short
    b.classList.toggle('on', i === heatFloor)
    b.setAttribute('aria-pressed', String(i === heatFloor))
    b.addEventListener('click', () => { heatFloor = i; renderHeatFloors(); updateHeat() })
    return b
  }))
}

function updateHeat() {
  if (!heat) return
  heat.update(heatFloor, heatHour)
  const st = heat.stats(heatFloor, heatHour)
  heatTop = st.top
  $<HTMLInputElement>('#heat-hour').value = String(heatHour)
  $('#heat-hour-label').textContent = fmtHour(heatHour)
  const kpi = (v: string, l: string) => `<div class="kpi"><b>${v}</b><span>${l}</span></div>`
  $('#heat-kpis').innerHTML =
    kpi(st.visitors.toLocaleString('fr-FR'), 'visiteurs / h') +
    kpi(`${st.occupancy} %`, 'allées chargées') +
    kpi(`${Math.floor(st.dwell / 60)} h ${String(st.dwell % 60).padStart(2, '0')}`, 'temps moyen')
}

$('#heat-hour').addEventListener('input', () => {
  stopHeatPlay()
  heatHour = Number($<HTMLInputElement>('#heat-hour').value)
  updateHeat()
})

// Lecture de la journée : 9 h → 21 h en ~12 s, en boucle
function stopHeatPlay() {
  clearInterval(heatPlaying)
  heatPlaying = 0
  $('#heat-play').textContent = '▶'
  $('#heat-play').setAttribute('aria-label', 'Lire la journée')
}
$('#heat-play').addEventListener('click', () => {
  if (heatPlaying) return stopHeatPlay()
  $('#heat-play').textContent = '❚❚'
  $('#heat-play').setAttribute('aria-label', 'Mettre en pause')
  heatPlaying = window.setInterval(() => {
    heatHour = heatHour >= HOUR_MAX ? HOUR_MIN : Math.min(HOUR_MAX, heatHour + 0.25)
    updateHeat()
  }, a11y.reduceMotion ? 1000 : 250)
})

// Recherche d'une enseigne ou d'un service
const search = initSearch(plan, () => ({ pt: filter.estimate(), floor }), d => {
  overview = false
  $('#btn-view').textContent = "Vue d'ensemble"
  setDestination(d)
})
$('#btn-search').addEventListener('click', () => search.open())

// ─── Offre flash : carte « bon plan » quand on passe près d'une enseigne en promotion ───
const PROMO_RADIUS = 25 // m
const promoSpots = plan.data.promos.flatMap(p => {
  const d = plan.destination(p.shop)
  return d?.shop ? [{ promo: p, dest: d, shop: d.shop }] : []
})
const shownPromos = new Set<string>()
let toastUntil = 0
let toastDest: Destination | null = null

function showPromo(spot: (typeof promoSpots)[number], dist: number) {
  const toast = $('#promo-toast')
  const c = toast.querySelector('canvas')!
  const g = c.getContext('2d')!
  g.clearRect(0, 0, c.width, c.height)
  drawLogo(g, logoFor(spot.shop), 44, 44, 76)
  toast.querySelector('.toast-title')!.innerHTML = '<span class="tag"></span>'
  toast.querySelector('.toast-title .tag')!.textContent = spot.promo.tag
  toast.querySelector('.toast-title')!.append(spot.shop.name)
  toast.querySelector('.toast-sub')!.textContent = `À ${Math.max(5, Math.round(dist / 5) * 5)} m · ${spot.promo.offer}`
  // Au-dessus du panneau du bas, quelle que soit sa hauteur
  toast.style.bottom = `${window.innerHeight - $('.panel').getBoundingClientRect().top + 10}px`
  toast.hidden = false
  toastDest = spot.dest
  toastUntil = performance.now() + 5000
}

function checkPromos(est: Pt) {
  const now = performance.now()
  if (!$('#promo-toast').hidden && now > toastUntil) $('#promo-toast').hidden = true
  if (now < toastUntil + 3000) return // une offre à la fois, avec une pause entre deux
  for (const spot of promoSpots) {
    if (shownPromos.has(spot.promo.shop) || spot.dest.floor !== floor) continue
    const dist = Math.hypot(spot.dest.pt.x - est.x, spot.dest.pt.y - est.y)
    if (dist < PROMO_RADIUS) {
      shownPromos.add(spot.promo.shop)
      showPromo(spot, dist)
      return
    }
  }
}

$('#promo-toast').addEventListener('click', () => {
  $('#promo-toast').hidden = true
  if (toastDest) setDestination(toastDest)
})
$('#promo-toast').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') $('#promo-toast').click() })

// 2D : toucher une boutique = itinéraire ; toucher un couloir = recalage (équivalent d'un scan QR / NFC)
$('#map').addEventListener('pointerdown', e => {
  if (tab === 'heat') return
  const p = renderer.toPlan(e.clientX, e.clientY)
  const shop = plan.floors[floor].shopAt(p)
  if (shop) setDestination(plan.destination(shop.name)!)
  else if (mode === 'real' && plan.floors[floor].walkable(p.x, p.y)) filter.init(p, 1, true)
})

const svg = (d: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`
const ICONS = {
  gauche: svg('M17 20v-7a4 4 0 0 0-4-4H5M9 5 5 9l4 4'),
  droite: svg('M7 20v-7a4 4 0 0 1 4-4h8M15 5l4 4-4 4'),
  'demi-tour': svg('M6 20V10a5 5 0 0 1 10 0v10M12 16l4 4 4-4'),
  escalator: svg('M3 18h4l9-12h5'),
  ascenseur: svg('M8 9.5 12 5l4 4.5M8 14.5l4 4.5 4-4.5'),
  escalier: svg('M3 20h5v-5h5v-5h5V5h3'),
  arrivee: svg('M6 21V4h11l-2.5 4L17 12H6'),
  arrive: svg('M5 12.5 9.5 17 19 7'),
  heat: svg('M4 20V10M9.3 20V4M14.6 20v-8M20 20V7'),
  logo: svg('M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11ZM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z'),
}
const CONNECTOR_NAME = { escalator: "l'escalator", ascenseur: "l'ascenseur", escalier: "l'escalier" }

let lastBanner = ''
let lastCue = ''

function updateBanner(arrived: boolean) {
  if (tab === 'heat') {
    const key = `heat|${heatFloor}|${heatHour}|${heatTop}`
    if (key === lastBanner) return
    lastBanner = key
    $('#banner').classList.remove('nav')
    $('#banner').classList.add('heat')
    $('#nav-icon').innerHTML = ICONS.heat
    $('#nav-main').textContent = `Fréquentation · ${fmtHour(heatHour)}`
    $('#nav-sub').textContent = `${plan.floors[heatFloor].data.short} · samedi (simulé) · ${heatTop.join(', ')}`
    return
  }
  $('#banner').classList.remove('heat')
  let icon = ICONS.logo, main = '', sub = `${plan.data.name} · départ : ${anchor.label}`
  if (dest && route) {
    const remaining = Math.max(0, route.length - along)
    const destFloor = plan.floors[dest.floor].data.short
    if (arrived) {
      icon = ICONS.arrive
      main = 'Vous êtes arrivé'
      sub = `${destFloor} · ${dest.label}`
    } else {
      const ins = nextInstruction(route, along, floor)
      const d = ins.dist < 20 ? Math.round(ins.dist) : Math.round(ins.dist / 5) * 5
      icon = ICONS[ins.kind]
      if (ins.kind === 'arrivee') main = `Destination dans ${d} m`
      else if (ins.toFloor != null) {
        // Changement de niveau : « Prenez l'ascenseur ↑ Niveau 1 »
        const target = `${ins.toFloor > floor ? '↑' : '↓'} ${plan.floors[ins.toFloor].data.short}`
        main = ins.dist < 8 ? `Prenez ${CONNECTOR_NAME[ins.kind as keyof typeof CONNECTOR_NAME]} ${target}` : `Dans ${d} m, ${ins.kind} ${target}`
      } else {
        const action = ins.kind === 'demi-tour' ? 'faites demi-tour' : `tournez à ${ins.kind}`
        main = ins.dist < 8 ? action[0].toUpperCase() + action.slice(1) : `Dans ${d} m, ${action}`
      }
      const floorChanges = verticals(route, along, floor).filter(v => !v.done).length
      const minutes = Math.max(1, Math.round((remaining / WALK_SPEED + floorChanges * FLOOR_CHANGE_S) / 60))
      sub = `${accessible ? 'PMR · ' : ''}${minutes} min · ${Math.round(remaining)} m · ${destFloor} · ${dest.label}`
      // Nouvelle consigne, ou consigne devenue imminente : lecteur d'écran, voix, vibration
      const imminent = ins.dist < 8
      const cue = `${ins.kind}|${ins.toFloor ?? ''}|${imminent}|${dest.label}`
      if (cue !== lastCue) {
        lastCue = cue
        announce(main, imminent && ins.kind !== 'arrivee')
      }
    }
    if (arrived && lastCue !== 'arrive') {
      lastCue = 'arrive'
      announce(`Vous êtes arrivé : ${dest.label}`, true)
    }
  }
  // Ne touche au DOM que si le contenu change (appelé à chaque image)
  const key = `${!!route}|${icon}|${main}|${sub}|${floor}`
  if (key === lastBanner) return
  lastBanner = key
  $('#banner').classList.toggle('nav', !!route)
  $('#nav-icon').innerHTML = icon
  if (main) $('#nav-main').textContent = main
  else $('#nav-main').innerHTML = 'In<span class="accent">Map</span>'
  $('#nav-sub').textContent = sub
  $('#floor-chip').textContent = plan.floors[floor].data.name
}

function frame() {
  let est = filter.estimate()

  let arrived = false
  if (dest && route) {
    const pr = progressOn(route, est, floor)
    if (mode === 'real' && pr.offset > 8) {
      // Écart trop important : nouveau calcul d'itinéraire depuis la position actuelle
      route = findRoute(plan, est, floor, dest.pt, dest.floor, accessible)
      along = 0
    } else {
      along = pr.along
    }
    // Changement de niveau : immobile (sur l'escalator, dans l'ascenseur) près d'un connecteur du trajet
    if (route && performance.now() - lastStepAt > STILL_MS) {
      const r = route
      const ev = r.events.find(e => isConnector(e) && r.pts[e.i].floor === floor && Math.abs(r.cum[e.i] - along) < 5)
      if (ev && isConnector(ev)) {
        setFloor(ev.toFloor, r.pts[ev.i])
        est = filter.estimate()
        along = progressOn(r, est, floor).along
      }
    }
    // Démo : marcheur arrivé mais estimation restée en retrait (longue allée droite sans virage pour corriger la foulée)
    // → recalage, comme le scan du QR / NFC posé à la destination
    if (walker?.done && walker.floor === floor && route && route.length - along >= 3 && performance.now() - lastStepAt > 2000) {
      filter.init(walker.pos, 1, true)
      est = filter.estimate()
      along = progressOn(route, est, floor).along
    }
    arrived = !!route && floor === dest.floor && route.length - along < 3 && (!walker || walker.done)
    if (arrived && walker && !nextTripTimer) nextTripTimer = window.setTimeout(startNextTrip, 3000)
  }
  updateBanner(arrived)
  if (tab === 'guide') checkPromos(est)

  const rawHeading = mode === 'real'
    ? (sensors.heading != null ? (sensors.heading - northOffset) * DEG : null)
    : lastHeading
  const f: Frame = {
    floor: tab === 'heat' ? heatFloor : floor,
    particles: filter.particles(),
    estimate: est,
    heading: rawHeading != null ? rawHeading + est.bias : null,
    truth: walker ? { ...walker.pos, floor: walker.floor } : null,
    route,
    along,
    destination: dest,
    overview: tab === 'heat' || overview || performance.now() < overviewUntil,
    accessible,
    heat: tab === 'heat' ? heat : null,
  }
  if (view === '3d' && renderer3d) renderer3d.draw(f)
  else renderer.draw(f)

  const parts = [`Pas : ${steps}`, `Précision : ±${est.accuracy.toFixed(1)} m`]
  if (walker) {
    parts.push(walker.floor === floor
      ? `Erreur réelle : ${Math.hypot(est.x - walker.pos.x, est.y - walker.pos.y).toFixed(1)} m`
      : 'Changement de niveau…')
  }
  if (mode === 'real') {
    parts.push(sensorsOn && sensors.heading != null ? `Cap : ${Math.round(sensors.heading)}°` : 'Capteurs inactifs')
  }
  $('#stats').textContent = parts.join(' · ')
  requestAnimationFrame(frame)
}

setMode('demo')
requestAnimationFrame(frame)
setView('3d') // 3D par défaut ; repli en 2D si WebGL est indisponible
