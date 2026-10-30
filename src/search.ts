import { AMENITY_INFO, type Category, type Destination, type Plan, type Pt } from './plan'
import { AMENITY_LOGOS, drawLogo, logoFor, type Logo } from './logos'

/**
 * Recherche : enseignes de tous les niveaux + services (toilettes, sorties…),
 * filtrables par groupe et triés par distance approximative depuis la position du visiteur.
 */

type Group = 'services' | 'boutiques' | 'restauration' | 'loisirs' | 'parking'

interface Entry {
  name: string
  group: Group
  logo: Logo
  /** Texte normalisé dans lequel on cherche */
  keywords: string
  dest: Destination
  promo?: string
}

const GROUPS: { id: Group | 'tout'; label: string }[] = [
  { id: 'tout', label: 'Tout' },
  { id: 'services', label: 'Services' },
  { id: 'boutiques', label: 'Boutiques' },
  { id: 'restauration', label: 'Restauration' },
  { id: 'loisirs', label: 'Loisirs' },
  { id: 'parking', label: 'Parking' },
]
const GROUP_LABEL = Object.fromEntries(GROUPS.map(g => [g.id, g.label])) as Record<Group, string>

const CAT_GROUP: Record<Category, Group> = {
  mode: 'boutiques', beaute: 'boutiques', maison: 'boutiques', alimentaire: 'boutiques', services: 'boutiques',
  resto: 'restauration', loisirs: 'loisirs', parking: 'parking',
}
const CAT_WORDS: Record<Category, string> = {
  mode: 'mode vetements habits', beaute: 'beaute soin', maison: 'maison deco', alimentaire: 'alimentation courses',
  services: 'services', resto: 'resto restaurant restauration manger', loisirs: 'loisirs sortie enfants', parking: 'parking voiture place',
}

/** Minuscules sans accents */
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export function initSearch(plan: Plan, where: () => { pt: Pt; floor: number }, onPick: (d: Destination) => void) {
  const entries: Entry[] = []
  for (const floor of plan.floors) {
    for (const shop of floor.data.shops) {
      const promo = plan.data.promos.find(p => p.shop === shop.name)
      entries.push({
        name: shop.name,
        group: CAT_GROUP[shop.cat],
        logo: logoFor(shop),
        keywords: norm(`${shop.name} ${CAT_WORDS[shop.cat]} ${promo ? 'promo bon plan' : ''}`),
        dest: plan.destination(shop.name)!,
        promo: promo?.tag,
      })
    }
  }
  for (const a of plan.data.amenities) {
    const info = AMENITY_INFO[a.kind]
    const name = a.rer ? `${a.label ?? info.label} · RER ${a.rer.join(', ')}` : a.label ?? info.label
    const transit = a.rer ? `rer gare train transport ${a.rer.map(l => `rer${l} rer ${l}`).join(' ')}` : ''
    entries.push({
      name,
      group: 'services',
      logo: AMENITY_LOGOS[a.kind],
      keywords: norm(`${name} ${info.keywords} ${transit}`),
      dest: { label: name, pt: plan.floors[a.floor].nearestOnAxis(a).pt, floor: a.floor },
    })
  }

  const sheet = document.querySelector<HTMLElement>('#search')!
  const input = document.querySelector<HTMLInputElement>('#search-input')!
  const list = document.querySelector<HTMLUListElement>('#search-results')!
  const chips = document.querySelector<HTMLElement>('#search-chips')!
  let group: Group | 'tout' = 'tout'

  for (const g of GROUPS) {
    const b = document.createElement('button')
    b.textContent = g.label
    b.dataset.group = g.id
    b.addEventListener('click', () => { group = g.id; render() })
    b.setAttribute('aria-pressed', 'false')
    chips.append(b)
  }

  const item = (e: Entry, dist: number) => {
    const li = document.createElement('li')
    const c = document.createElement('canvas')
    c.width = c.height = 76
    drawLogo(c.getContext('2d')!, e.logo, 38, 38, 64)
    const text = document.createElement('div')
    text.className = 'r-text'
    const name = document.createElement('div')
    name.className = 'r-name'
    if (e.promo) {
      const tag = document.createElement('span')
      tag.className = 'tag'
      tag.textContent = e.promo
      name.append(tag)
    }
    name.append(e.name)
    const sub = document.createElement('div')
    sub.className = 'r-sub'
    sub.textContent = `${plan.floors[e.dest.floor].data.short} · ${GROUP_LABEL[e.group]}`
    const d = document.createElement('div')
    d.className = 'r-dist'
    d.textContent = `${Math.max(5, Math.round(dist / 5) * 5)} m`
    text.append(name, sub)
    li.append(c, text, d)
    li.tabIndex = 0
    li.setAttribute('role', 'button')
    li.addEventListener('click', () => { close(); onPick(e.dest) })
    li.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); li.click() } })
    return li
  }

  const title = (t: string) => {
    const li = document.createElement('li')
    li.className = 'results-title'
    li.textContent = t
    return li
  }

  function render() {
    chips.querySelectorAll<HTMLButtonElement>('button').forEach(b => {
      b.classList.toggle('on', b.dataset.group === group)
      b.setAttribute('aria-pressed', String(b.dataset.group === group))
    })
    const words = norm(input.value).split(/\s+/).filter(Boolean)
    const here = where()
    // Distance approximative : à vol d'oiseau + forfait par niveau à changer
    const found = entries
      .filter(e => (group === 'tout' || e.group === group) && words.every(w => e.keywords.includes(w)))
      .map(e => ({ e, d: Math.hypot(e.dest.pt.x - here.pt.x, e.dest.pt.y - here.pt.y) + 40 * Math.abs(e.dest.floor - here.floor) }))
      .sort((a, b) => a.d - b.d)

    list.replaceChildren()
    if (!found.length) {
      const li = document.createElement('li')
      li.className = 'r-empty'
      li.textContent = 'Aucun résultat'
      list.append(li)
      return
    }
    if (!words.length && group === 'tout') {
      // Vue d'accueil : le service le plus proche de chaque type, puis les enseignes
      const seen = new Set<string>()
      list.append(title('Services les plus proches'))
      for (const { e, d } of found) {
        if (e.group !== 'services' || seen.has(e.name)) continue
        seen.add(e.name)
        list.append(item(e, d))
      }
      list.append(title('Enseignes'))
      for (const { e, d } of found) if (e.group !== 'services' && e.group !== 'parking') list.append(item(e, d))
      return
    }
    for (const { e, d } of found) list.append(item(e, d))
  }

  input.addEventListener('input', render)
  sheet.addEventListener('keydown', e => { if (e.key === 'Escape') close() })
  document.querySelector('#search-close')!.addEventListener('click', () => close())

  function close() {
    sheet.hidden = true
    input.blur()
  }

  return {
    open() {
      input.value = ''
      group = 'tout'
      sheet.hidden = false
      render()
      list.scrollTop = 0
      input.focus()
    },
  }
}
