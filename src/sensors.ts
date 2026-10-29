/**
 * Lecture des capteurs du téléphone (web standard, sans app) :
 *  - cap boussole (deviceorientation) lissé
 *  - détection de pas sur la norme de l'accélération (devicemotion)
 */
export class Sensors {
  /** Cap boussole en degrés (0 = nord, sens horaire), null tant qu'inconnu */
  heading: number | null = null
  onStep: (() => void) | null = null

  private hx = 0
  private hy = 0
  private smooth = 9.81
  private gravity = 9.81
  private high = false
  private lastStep = 0

  /** À appeler depuis un geste utilisateur (exigence iOS) */
  async start() {
    const DM = DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> }
    const DO = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> }
    const asks = [DM.requestPermission?.(), DO.requestPermission?.()].filter(Boolean)
    const results = await Promise.all(asks)
    if (results.some(r => r !== 'granted')) throw new Error('Accès aux capteurs refusé')

    // Android : orientation absolue (par rapport au nord) ; iOS : webkitCompassHeading
    const event = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation'
    window.addEventListener(event, e => this.onOrientation(e as DeviceOrientationEvent))
    window.addEventListener('devicemotion', e => this.onMotion(e))
  }

  private onOrientation(e: DeviceOrientationEvent) {
    const ios = (e as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading
    const raw = ios ?? (e.alpha != null ? 360 - e.alpha : null)
    if (raw == null) return
    // Lissage circulaire (évite le saut 359° → 0°)
    const r = raw * Math.PI / 180
    const k = this.heading == null ? 1 : 0.15
    this.hx += (Math.sin(r) - this.hx) * k
    this.hy += (Math.cos(r) - this.hy) * k
    this.heading = (Math.atan2(this.hx, this.hy) * 180 / Math.PI + 360) % 360
  }

  private onMotion(e: DeviceMotionEvent) {
    const a = e.accelerationIncludingGravity
    if (!a || a.x == null || a.y == null || a.z == null) return
    const mag = Math.hypot(a.x, a.y, a.z)
    this.smooth += (mag - this.smooth) * 0.25
    this.gravity += (mag - this.gravity) * 0.02
    const v = this.smooth - this.gravity
    const now = performance.now()
    // Pic d'accélération avec hystérésis + 300 ms minimum entre deux pas
    if (!this.high && v > 1.2 && now - this.lastStep > 300) {
      this.high = true
      this.lastStep = now
      this.onStep?.()
    } else if (this.high && v < 0.2) {
      this.high = false
    }
  }
}
