/**
 * Logos des enseignes (fictives), dessinés sur le canvas.
 * Chaque logo = une forme + deux couleurs + un monogramme ou un pictogramme (tracé SVG 24×24).
 */

export type LogoShape = 'circle' | 'square' | 'round' | 'diamond'

export interface Logo {
  bg: string
  fg: string
  shape: LogoShape
  /** Monogramme (texte) */
  text?: string
  /** Typo du monogramme : grotesque grasse ou serif (plus « maison de luxe ») */
  serif?: boolean
  italic?: boolean
  /** Pictogramme à la place du monogramme */
  icon?: keyof typeof ICONS
}

// Pictogrammes 24×24 : `fill` = forme pleine, `stroke` = trait
export const ICONS = {
  cross: { fill: 'M9 4h6v5h5v6h-5v5H9v-5H4V9h5z' },
  play: { fill: 'M8 5v14l11-7z' },
  fish: { fill: 'M2 12c3-5 9-6 14-3l5-3v12l-5-3c-5 3-11 2-14-3z' },
  bolt: { fill: 'M13 2 4 14h7l-1 8 9-12h-7z' },
  leaf: { fill: 'M5 20c0-9 6-15 15-15 0 9-5 15-14 15z' },
  star: { fill: 'M12 2l3 6.5 7 .9-5.2 4.8 1.4 7L12 17.8 5.8 21.2l1.4-7L2 9.4l7-.9z' },
  burger: { fill: 'M4 11a8 6.5 0 0 1 16 0zM3 12.5h18v1.5H3zM4 15.5h16v.5a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z' },
  phone: { fill: 'M7.5 2h9A2.5 2.5 0 0 1 19 4.5v15a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 5 19.5v-15A2.5 2.5 0 0 1 7.5 2zM8 5v12h8V5z' },
  drop: { fill: 'M12 2c4 5 7 9 7 13a7 7 0 0 1-14 0c0-4 3-8 7-13z' },
  gem: { fill: 'M6 3h12l4 6-10 12L2 9z' },
  house: { fill: 'M3 11 12 3l9 8v10h-6v-6H9v6H3z' },
  book: { fill: 'M2 5c3.5-1.5 7-1.5 9.5.5V21C9 19 5.5 19 2 20.5zM22 5c-3.5-1.5-7-1.5-9.5.5V21c2.5-2 6-2 9.5-.5z' },
  note: { fill: 'M9 18.5a3 3 0 1 1-2-2.83V5l12-2.5v13a3 3 0 1 1-2-2.83V6.9L9 8.6z' },
  cone: { fill: 'M6.5 10.5a5.5 5.5 0 0 1 11 0zM7 12h10l-5 10z' },
  paw: { fill: 'M12 12.5c-3 0-6 3.5-6 6 0 1.6 1.2 2.5 2.6 2.5 1.3 0 2.2-.9 3.4-.9s2.1.9 3.4.9c1.4 0 2.6-.9 2.6-2.5 0-2.5-3-6-6-6zM4 8.5a2 2.5 0 1 0 4 0a2 2.5 0 1 0-4 0zM16 8.5a2 2.5 0 1 0 4 0a2 2.5 0 1 0-4 0zM8 4.5a2 2.5 0 1 0 4 0a2 2.5 0 1 0-4 0zM12 4.5a2 2.5 0 1 0 4 0a2 2.5 0 1 0-4 0z' },
  cutlery: { fill: 'M6 2h1.4v6h1.2V2H10v6h1.2V2h1.4v7.5a2.6 2.6 0 0 1-2 2.5V22H8v-10a2.6 2.6 0 0 1-2-2.5zM18 2v20h-2.2v-8H14V8c0-3 1.5-5.5 4-6z' },
  glasses: { stroke: 'M2.5 13a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0M14.5 13a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0M9.5 12.5c1.5-1 3.5-1 5 0M2.5 12 4 7M21.5 12 20 7' },
  ball: { stroke: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M12 3c3.5 3 3.5 15 0 18M12 3c-3.5 3-3.5 15 0 18M3 12h18' },
} satisfies Record<string, { fill?: string; stroke?: string }>

export const LOGOS: Record<string, Logo> = {
  // Grandes surfaces
  'Hyper Marché Central': { bg: '#e2231a', fg: '#fff', shape: 'square', text: 'HC' },
  'Maison & Déco XXL': { bg: '#0e6b4f', fg: '#fff', shape: 'round', icon: 'house' },
  'Cinéma Le Grand Écran': { bg: '#16130f', fg: '#ffc94a', shape: 'circle', icon: 'play' },
  'Espace Restauration': { bg: '#ff7a1a', fg: '#fff', shape: 'round', icon: 'cutlery' },

  // Boutiques
  'Mode & Co': { bg: '#16130f', fg: '#fff', shape: 'square', text: 'M&C', serif: true },
  'Café Lumière': { bg: '#6b3e26', fg: '#f6e7cf', shape: 'circle', text: 'CL', serif: true, italic: true },
  'Pharmacie': { bg: '#1e9e5a', fg: '#fff', shape: 'square', icon: 'cross' },
  'Librairie Page': { bg: '#8c2f39', fg: '#f6e7cf', shape: 'round', icon: 'book' },
  'Beauté+': { bg: '#f4b6c2', fg: '#8a1c3b', shape: 'circle', text: 'B+' },
  'Urban Style': { bg: '#ffd23f', fg: '#16130f', shape: 'square', text: 'US' },
  'Sushi Zen': { bg: '#d7263d', fg: '#fff', shape: 'circle', icon: 'fish' },
  'Tech Store': { bg: '#1b1b1b', fg: '#ffd23f', shape: 'round', icon: 'bolt' },
  'Maison Nature': { bg: '#2f6b3a', fg: '#fff', shape: 'round', icon: 'leaf' },
  'Jouets & Cie': { bg: '#ff7a00', fg: '#fff', shape: 'circle', icon: 'star' },
  'Denim Lab': { bg: '#2c4a7a', fg: '#fff', shape: 'square', text: 'DL' },
  'Optique Vue': { bg: '#0f4c81', fg: '#fff', shape: 'circle', icon: 'glasses' },
  'Burger Factory': { bg: '#f2a900', fg: '#5a1e0e', shape: 'round', icon: 'burger' },
  'Téléphonie Mobile': { bg: '#6c2bd9', fg: '#fff', shape: 'round', icon: 'phone' },
  'Cuisine & Art': { bg: '#c8553d', fg: '#fff', shape: 'square', text: '&', serif: true, italic: true },
  'Game Zone': { bg: '#00a6a6', fg: '#fff', shape: 'diamond', text: 'GZ' },
  'Petit Prince Kids': { bg: '#7fc8f8', fg: '#13315c', shape: 'circle', text: 'pp', serif: true, italic: true },
  'Parfums d’Ailleurs': { bg: '#b08968', fg: '#fff', shape: 'circle', icon: 'drop' },
  'Boulangerie Dorée': { bg: '#e9b44c', fg: '#4a2c0a', shape: 'round', text: 'BD', serif: true },
  'Pressing Express': { bg: '#3da5d9', fg: '#fff', shape: 'square', text: 'PE' },
  'Musique Plus': { bg: '#16130f', fg: '#f25f5c', shape: 'circle', icon: 'note' },
  'Chaussures 21': { bg: '#f25f5c', fg: '#fff', shape: 'square', text: '21' },
  'Lumière Déco': { bg: '#f6e27f', fg: '#3a3220', shape: 'circle', text: 'LD', serif: true },
  'Coiffure Studio': { bg: '#2a2620', fg: '#fff', shape: 'round', text: 'cs', serif: true, italic: true },
  'Glacier Polaire': { bg: '#3b82c4', fg: '#fff', shape: 'circle', icon: 'cone' },
  'Banque Proxi': { bg: '#00337f', fg: '#fff', shape: 'square', text: 'BP' },
  'Lingerie Douce': { bg: '#e3a1b3', fg: '#6d1a36', shape: 'circle', text: 'ld', serif: true, italic: true },
  'Fleurs du Jour': { bg: '#e4572e', fg: '#fff', shape: 'circle', text: 'F', serif: true, italic: true },
  'Bijoux Éclat': { bg: '#0b3954', fg: '#e0c068', shape: 'diamond', icon: 'gem' },
  'Thé & Toi': { bg: '#5b8e7d', fg: '#fff', shape: 'circle', text: 'T&T', serif: true },
  'Clés Minute': { bg: '#ffc300', fg: '#16130f', shape: 'square', text: 'CM' },
  'Sport Max': { bg: '#1f4fff', fg: '#fff', shape: 'round', icon: 'ball' },
  'Literie Confort': { bg: '#6d597a', fg: '#fff', shape: 'round', text: 'LC', serif: true },
  'Animalerie Câline': { bg: '#f28c28', fg: '#fff', shape: 'circle', icon: 'paw' },
  'Atelier Cuir': { bg: '#7b4b2a', fg: '#f6e7cf', shape: 'square', text: 'AC', serif: true },
  'Point Relais': { bg: '#ffcc00', fg: '#16130f', shape: 'round', text: 'PR' },
}

const paths = new Map<string, Path2D>()
const path2d = (d: string) => {
  let p = paths.get(d)
  if (!p) paths.set(d, (p = new Path2D(d)))
  return p
}

/** Dessine le logo centré en (cx, cy), de côté `size` px */
export function drawLogo(ctx: CanvasRenderingContext2D, logo: Logo, cx: number, cy: number, size: number) {
  const r = size / 2
  ctx.fillStyle = logo.bg
  ctx.beginPath()
  switch (logo.shape) {
    case 'circle': ctx.arc(cx, cy, r, 0, Math.PI * 2); break
    case 'square': ctx.rect(cx - r, cy - r, size, size); break
    case 'round': ctx.roundRect(cx - r, cy - r, size, size, size * 0.28); break
    case 'diamond':
      ctx.moveTo(cx, cy - r * 1.1); ctx.lineTo(cx + r * 1.1, cy); ctx.lineTo(cx, cy + r * 1.1); ctx.lineTo(cx - r * 1.1, cy)
      ctx.closePath()
      break
  }
  ctx.fill()

  ctx.fillStyle = logo.fg
  ctx.strokeStyle = logo.fg
  if (logo.icon) {
    const icon: { fill?: string; stroke?: string } = ICONS[logo.icon]
    const k = (size * 0.56) / 24
    ctx.save()
    ctx.translate(cx - 12 * k, cy - 12 * k)
    ctx.scale(k, k)
    if (icon.fill) ctx.fill(path2d(icon.fill))
    if (icon.stroke) {
      ctx.lineWidth = 2.2
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.stroke(path2d(icon.stroke))
    }
    ctx.restore()
  } else if (logo.text) {
    const len = logo.text.length
    const fs = size * (len >= 3 ? 0.36 : len === 2 ? 0.46 : 0.62)
    ctx.font = logo.serif
      ? `${logo.italic ? 'italic ' : ''}400 ${fs * 1.1}px "DM Serif Display", Georgia, serif`
      : `800 ${fs}px "Bricolage Grotesque", system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(logo.text, cx, cy + size * 0.03)
  }
}
