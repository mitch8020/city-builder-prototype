export type MapBounds = [number, number, number, number]
export type MapVelocity = [number, number]

export interface ParcelViewportUpdate {
  bounds: MapBounds
  velocity: MapVelocity
  settled: boolean
}

interface MapViewportSchedulerOptions {
  readBounds: () => MapBounds
  onParcelUpdate: (update: ParcelViewportUpdate) => boolean
  onTileUpdate: (bounds: MapBounds) => void
  now?: () => number
}

const DATA_DELAY_MS = 48
const TILE_DELAY_MS = 90
const VELOCITY_SETTLE_MS = 220
const MOVING_METERS_PER_SECOND = 100
const VELOCITY_SMOOTHING = 0.42

export class MapViewportScheduler {
  private readonly now: () => number
  private dataTimer?: ReturnType<typeof setTimeout>
  private tileTimer?: ReturnType<typeof setTimeout>
  private velocityTimer?: ReturnType<typeof setTimeout>
  private dataTimerDueAt = Infinity
  private tileTimerDueAt = Infinity
  private settledUpdatePending = false
  private previousViewSample?: {
    center: [number, number]
    sampledAt: number
  }
  private velocity: MapVelocity = [0, 0]
  private disposed = false

  constructor(private readonly options: MapViewportSchedulerOptions) {
    this.now = options.now ?? performance.now.bind(performance)
  }

  schedule(delay = DATA_DELAY_MS, settled = false) {
    if (this.disposed) return
    this.settledUpdatePending ||= settled
    const now = this.now()
    const dataDelay = Math.max(0, Math.min(delay, DATA_DELAY_MS))
    const dataDueAt = now + dataDelay
    if (!this.dataTimer || dataDueAt < this.dataTimerDueAt) {
      clearTimeout(this.dataTimer)
      this.dataTimerDueAt = dataDueAt
      this.dataTimer = setTimeout(() => {
        this.dataTimer = undefined
        this.dataTimerDueAt = Infinity
        const shouldSettle = this.settledUpdatePending
        this.settledUpdatePending = false
        this.runParcelUpdate(shouldSettle)
      }, dataDelay)
    }

    const tileDelay = Math.max(0, Math.min(delay, TILE_DELAY_MS))
    const tileDueAt = now + tileDelay
    if (!this.tileTimer || tileDueAt < this.tileTimerDueAt) {
      clearTimeout(this.tileTimer)
      this.tileTimerDueAt = tileDueAt
      this.tileTimer = setTimeout(() => {
        this.tileTimer = undefined
        this.tileTimerDueAt = Infinity
        this.options.onTileUpdate(this.options.readBounds())
      }, tileDelay)
    }
  }

  cancelPendingSettle() {
    this.settledUpdatePending = false
  }

  private runParcelUpdate(settled: boolean) {
    if (this.disposed) return
    const bounds = this.options.readBounds()
    const now = this.now()
    const center: [number, number] = [
      (bounds[0] + bounds[2]) / 2,
      (bounds[1] + bounds[3]) / 2,
    ]
    if (this.previousViewSample) {
      const elapsed = Math.max(
        (now - this.previousViewSample.sampledAt) / 1_000,
        0.016,
      )
      const instant: MapVelocity = [
        (center[0] - this.previousViewSample.center[0]) / elapsed,
        (center[1] - this.previousViewSample.center[1]) / elapsed,
      ]
      this.velocity = [
        lerp(this.velocity[0], instant[0], VELOCITY_SMOOTHING),
        lerp(this.velocity[1], instant[1], VELOCITY_SMOOTHING),
      ]
    }
    if (settled) this.velocity = [0, 0]
    this.previousViewSample = { center, sampledAt: now }

    const active = this.options.onParcelUpdate({
      bounds,
      velocity: this.velocity,
      settled,
    })
    clearTimeout(this.velocityTimer)
    this.velocityTimer = undefined
    if (!active) {
      this.resetMotion()
      return
    }
    if (!settled && Math.hypot(...this.velocity) > MOVING_METERS_PER_SECOND) {
      this.velocityTimer = setTimeout(() => {
        this.velocityTimer = undefined
        this.velocity = [0, 0]
        this.runParcelUpdate(false)
      }, VELOCITY_SETTLE_MS)
    }
  }

  private resetMotion() {
    clearTimeout(this.velocityTimer)
    this.velocityTimer = undefined
    this.previousViewSample = undefined
    this.velocity = [0, 0]
  }

  dispose() {
    this.disposed = true
    clearTimeout(this.dataTimer)
    clearTimeout(this.tileTimer)
    this.resetMotion()
  }
}

function lerp(start: number, end: number, amount: number) {
  return start + (end - start) * amount
}
