/**
 * Options d'accessibilité : mémorisées sur l'appareil, appliquées par classes CSS sur <html>
 * (contraste, taille du texte, animations) et par le guidage (voix, vibrations).
 */

export interface A11yOptions {
  contrast: boolean
  largeText: boolean
  reduceMotion: boolean
  voice: boolean
  vibrate: boolean
}

const KEY = 'inmap.a11y'

export const a11y: A11yOptions = {
  contrast: matchMedia('(prefers-contrast: more)').matches,
  largeText: false,
  reduceMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
  voice: false,
  vibrate: false,
}
try { Object.assign(a11y, JSON.parse(localStorage.getItem(KEY) ?? '{}')) } catch {}

function apply() {
  const root = document.documentElement
  root.classList.toggle('a11y-contrast', a11y.contrast)
  root.classList.toggle('a11y-large', a11y.largeText)
  root.classList.toggle('a11y-motion', a11y.reduceMotion)
}
apply()

/** Lit une consigne : zone aria-live (lecteurs d'écran), synthèse vocale, vibration si `imminent` */
export function announce(text: string, imminent: boolean) {
  const live = document.querySelector('#sr-live')
  if (live) live.textContent = text
  if (a11y.voice && 'speechSynthesis' in window) {
    speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'fr-FR'
    speechSynthesis.speak(u)
  }
  if (a11y.vibrate && imminent) navigator.vibrate?.([90, 60, 90])
}

interface Item { key: keyof A11yOptions | 'pmr'; label: string; desc: string }

const ITEMS: Item[] = [
  { key: 'pmr', label: 'Itinéraire PMR', desc: 'Ascenseurs uniquement, sans escalator ni escalier' },
  { key: 'voice', label: 'Guidage vocal', desc: 'Les instructions sont lues à voix haute' },
  { key: 'vibrate', label: 'Vibrations', desc: 'Le téléphone vibre avant chaque virage ou changement de niveau' },
  { key: 'contrast', label: 'Contraste renforcé', desc: 'Textes et contours plus marqués' },
  { key: 'largeText', label: 'Texte agrandi', desc: 'Interface et noms des boutiques plus grands' },
  { key: 'reduceMotion', label: 'Animations réduites', desc: 'Pas de transitions ni de mouvements de caméra' },
]

/** Feuille « Accessibilité » ; le mode PMR reste géré par l'orchestrateur */
export function initA11y(pmr: { get: () => boolean; set: (on: boolean) => void }, onChange: () => void) {
  const sheet = document.querySelector<HTMLElement>('#a11y')!
  const list = document.querySelector<HTMLUListElement>('#a11y-list')!
  const opener = document.querySelector<HTMLButtonElement>('#btn-a11y')!
  const buttons = new Map<Item['key'], HTMLButtonElement>()

  for (const item of ITEMS) {
    const li = document.createElement('li')
    const b = document.createElement('button')
    b.setAttribute('role', 'switch')
    b.innerHTML = '<span class="opt-text"><span class="opt-label"></span><span class="opt-desc"></span></span><span class="switch" aria-hidden="true"></span>'
    b.querySelector('.opt-label')!.textContent = item.label
    b.querySelector('.opt-desc')!.textContent = item.desc
    b.addEventListener('click', () => {
      if (item.key === 'pmr') pmr.set(!pmr.get())
      else {
        a11y[item.key] = !a11y[item.key]
        try { localStorage.setItem(KEY, JSON.stringify(a11y)) } catch {}
        apply()
        // Le premier énoncé doit suivre un geste de l'utilisateur (iOS)
        if (item.key === 'voice' && a11y.voice) announce('Guidage vocal activé', false)
        if (item.key === 'vibrate' && a11y.vibrate) navigator.vibrate?.(120)
        onChange()
      }
      sync()
    })
    li.append(b)
    list.append(li)
    buttons.set(item.key, b)
  }

  function sync() {
    for (const [key, b] of buttons) b.setAttribute('aria-checked', String(key === 'pmr' ? pmr.get() : a11y[key]))
  }

  const close = () => { sheet.hidden = true; opener.focus() }
  opener.addEventListener('click', () => {
    sync()
    sheet.hidden = false
    buttons.values().next().value?.focus()
  })
  document.querySelector('#a11y-close')!.addEventListener('click', close)
  sheet.addEventListener('keydown', e => { if (e.key === 'Escape') close() })
}
