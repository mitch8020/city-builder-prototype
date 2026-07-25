import { intersectsBounds, shardsForBounds } from './map-utils'
import type {
  ParcelManifestV1,
  ParcelShard,
  ParcelWorkerRequest,
  ParcelWorkerResponse,
  WorkerLoadedResponse,
} from './types'

type MapBounds = [number, number, number, number]
type MapVelocity = [number, number]

const WORKER_COUNT = 4
const PREFETCH_MARGIN_CELLS = 1
const LOOKAHEAD_SECONDS = 2.25
const MAX_LOOKAHEAD_CELLS = 6
const MAX_IDLE_CELLS = 16
const MAX_ATTEMPTS = 3

export interface ParcelCoverage {
  viewportCells: number
  readyViewportCells: number
  targetCells: number
  readyTargetCells: number
  viewportReady: boolean
}

export interface ParcelStreamCallbacks {
  onProgress: (message: string) => void
  onLoaded: (response: WorkerLoadedResponse) => void
  onError: (message: string) => void
  onVisibleShards: (shardIds: ReadonlySet<string>) => void
  onEvict: (shardId: string) => void
  onCoverage: (coverage: ParcelCoverage) => void
}

interface WorkerJob {
  generation: number
  shard: ParcelShard
}

interface WorkerSlot {
  worker: Worker
  job?: WorkerJob
}

interface LoadedShard {
  lastUsed: number
}

function defaultWorkerFactory() {
  return new Worker(new URL('./parcel.worker.ts', import.meta.url), {
    type: 'module',
  })
}

function centerOf(bounds: MapBounds) {
  return [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2] as const
}

export class ParcelStream {
  private readonly slots: WorkerSlot[] = []
  private readonly loaded = new Map<string, LoadedShard>()
  private readonly attempts = new Map<string, number>()
  private readonly failureKeys = new Map<string, string>()
  private wanted = new Map<string, ParcelShard>()
  private viewport = new Set<string>()
  private queue: ParcelShard[] = []
  private generation = 0
  private activeShardKey = ''
  private activeFailureKey = ''
  private visibleShardKey = ''
  private coverageKey = ''
  private disposed = false

  constructor(
    private readonly manifest: ParcelManifestV1,
    private readonly callbacks: ParcelStreamCallbacks,
    private readonly workerFactory: () => Worker = defaultWorkerFactory,
    workerCount = WORKER_COUNT,
  ) {
    for (let index = 0; index < workerCount; index += 1) {
      this.slots.push(this.createSlot())
    }
  }

  get isLoading() {
    return this.queue.length > 0 || this.slots.some((slot) => slot.job)
  }

  get hasViewportCoverage() {
    return [...this.viewport].every((id) => this.loaded.has(id))
  }

  load(
    bounds: MapBounds,
    velocity: MapVelocity = [0, 0],
    retainInFlight = false,
  ) {
    if (this.disposed) return undefined

    const viewportShards = shardsForBounds(this.manifest.shards, bounds)
    const targetBounds = this.prefetchBounds(bounds, velocity)
    const targetShards = shardsForBounds(this.manifest.shards, targetBounds)
    const nextShardKey = targetShards
      .map((shard) => shard.id)
      .sort()
      .join('|')
    const changed = nextShardKey !== this.activeShardKey
    const scaleStep = this.manifest.projection.baseCellSizeMeters / 8
    const nextFailureKey = `${nextShardKey}#${Math.round(
      (bounds[2] - bounds[0]) / scaleStep,
    )}x${Math.round((bounds[3] - bounds[1]) / scaleStep)}`
    const previousViewport = this.viewport
    this.activeShardKey = nextShardKey
    this.activeFailureKey = nextFailureKey
    this.viewport = new Set(viewportShards.map((shard) => shard.id))
    this.wanted = new Map(targetShards.map((shard) => [shard.id, shard]))
    for (const [id, failureKey] of this.failureKeys) {
      if (
        failureKey !== this.activeFailureKey ||
        (this.viewport.has(id) && !previousViewport.has(id))
      ) {
        this.failureKeys.delete(id)
        this.attempts.delete(id)
      }
    }
    for (const id of this.attempts.keys()) {
      if (!this.wanted.has(id)) {
        this.attempts.delete(id)
        this.failureKeys.delete(id)
      }
    }

    const now = performance.now()
    for (const shard of targetShards) {
      const cached = this.loaded.get(shard.id)
      if (cached) cached.lastUsed = now
    }

    if (!retainInFlight) this.cancelUnwantedJobs()
    this.rebuildQueue(bounds, velocity)
    if (this.preemptSpeculativeJobs()) this.rebuildQueue(bounds, velocity)
    this.publishVisibility()
    this.trimCache()
    this.publishCoverage()
    this.pump()

    return changed ? targetShards.length : undefined
  }

  cancel() {
    const hadWork =
      this.activeShardKey.length > 0 ||
      this.queue.length > 0 ||
      this.slots.some((slot) => slot.job)
    if (!hadWork) return false

    this.activeShardKey = ''
    this.activeFailureKey = ''
    this.wanted.clear()
    this.viewport.clear()
    this.queue = []
    this.attempts.clear()
    this.failureKeys.clear()
    for (const slot of this.slots) this.cancelSlot(slot)
    this.publishVisibility()
    this.publishCoverage()
    return true
  }

  dispose() {
    this.disposed = true
    for (const slot of this.slots) slot.worker.terminate()
    this.slots.length = 0
    this.queue = []
    this.wanted.clear()
    this.viewport.clear()
    this.loaded.clear()
    this.attempts.clear()
    this.failureKeys.clear()
  }

  private createSlot() {
    const slot = {} as WorkerSlot
    this.attachWorker(slot)
    return slot
  }

  private attachWorker(slot: WorkerSlot) {
    slot.worker = this.workerFactory()
    slot.worker.onmessage = (event: MessageEvent<ParcelWorkerResponse>) =>
      this.handleMessage(slot, event.data)
    slot.worker.onerror = () =>
      this.handleWorkerFailure(
        slot,
        'The parcel renderer stopped. Reload the map to restore it.',
      )
    slot.worker.onmessageerror = () =>
      this.handleWorkerFailure(
        slot,
        'Parcel worker returned an unreadable response.',
      )
  }

  private replaceWorker(slot: WorkerSlot) {
    slot.worker.terminate()
    slot.job = undefined
    this.attachWorker(slot)
  }

  private prefetchBounds(bounds: MapBounds, velocity: MapVelocity): MapBounds {
    const cellSize = this.manifest.projection.baseCellSizeMeters
    const margin = cellSize * PREFETCH_MARGIN_CELLS
    const maxLookahead = cellSize * MAX_LOOKAHEAD_CELLS
    const lookaheadX = Math.max(
      -maxLookahead,
      Math.min(maxLookahead, velocity[0] * LOOKAHEAD_SECONDS),
    )
    const lookaheadY = Math.max(
      -maxLookahead,
      Math.min(maxLookahead, velocity[1] * LOOKAHEAD_SECONDS),
    )

    return [
      bounds[0] - margin + Math.min(0, lookaheadX),
      bounds[1] - margin + Math.min(0, lookaheadY),
      bounds[2] + margin + Math.max(0, lookaheadX),
      bounds[3] + margin + Math.max(0, lookaheadY),
    ]
  }

  private cancelSlot(slot: WorkerSlot) {
    if (!slot.job) return
    slot.worker.postMessage({
      type: 'cancel',
      generation: slot.job.generation,
    } satisfies ParcelWorkerRequest)
    slot.job = undefined
  }

  private cancelUnwantedJobs() {
    for (const slot of this.slots) {
      if (slot.job && !this.wanted.has(slot.job.shard.id)) {
        this.cancelSlot(slot)
      }
    }
  }

  private rebuildQueue(bounds: MapBounds, velocity: MapVelocity) {
    const active = new Set(
      this.slots.flatMap((slot) => (slot.job ? [slot.job.shard.id] : [])),
    )
    const viewCenter = centerOf(bounds)
    const predictedCenter: readonly [number, number] = [
      viewCenter[0] + velocity[0] * LOOKAHEAD_SECONDS,
      viewCenter[1] + velocity[1] * LOOKAHEAD_SECONDS,
    ]
    this.queue = [...this.wanted.values()]
      .filter(
        (shard) =>
          !this.loaded.has(shard.id) &&
          !active.has(shard.id) &&
          (this.attempts.get(shard.id) ?? 0) < MAX_ATTEMPTS,
      )
      .sort((a, b) => {
        const aVisible = intersectsBounds(a.bounds, bounds) ? 0 : 1
        const bVisible = intersectsBounds(b.bounds, bounds) ? 0 : 1
        if (aVisible !== bVisible) return aVisible - bVisible
        const aCenter = centerOf(a.bounds)
        const bCenter = centerOf(b.bounds)
        return (
          Math.hypot(
            aCenter[0] - predictedCenter[0],
            aCenter[1] - predictedCenter[1],
          ) -
          Math.hypot(
            bCenter[0] - predictedCenter[0],
            bCenter[1] - predictedCenter[1],
          )
        )
      })
  }

  private preemptSpeculativeJobs() {
    const queuedViewportCells = this.queue.filter((shard) =>
      this.viewport.has(shard.id),
    ).length
    if (queuedViewportCells === 0) return false

    let requiredSlots = Math.max(
      0,
      queuedViewportCells - this.slots.filter((slot) => !slot.job).length,
    )
    if (requiredSlots === 0) return false

    let preempted = false
    for (const slot of this.slots) {
      if (
        requiredSlots === 0 ||
        !slot.job ||
        this.viewport.has(slot.job.shard.id)
      ) {
        continue
      }
      this.cancelSlot(slot)
      requiredSlots -= 1
      preempted = true
    }
    return preempted
  }

  private pump() {
    if (this.disposed) return
    for (const slot of this.slots) {
      if (slot.job) continue
      const shard = this.queue.shift()
      if (!shard) break
      this.generation += 1
      slot.job = { generation: this.generation, shard }
      slot.worker.postMessage({
        type: 'load',
        generation: this.generation,
        shard: { id: shard.id, url: shard.url, bounds: shard.bounds },
        origin: this.manifest.projection.localOrigin,
        countyBounds: this.manifest.projection.bounds,
      } satisfies ParcelWorkerRequest)
    }
  }

  private handleMessage(slot: WorkerSlot, response: ParcelWorkerResponse) {
    const job = slot.job
    if (
      !job ||
      response.generation !== job.generation ||
      ('shardId' in response && response.shardId !== job.shard.id)
    ) {
      return
    }

    if (response.type === 'progress') {
      this.callbacks.onProgress(response.message)
      return
    }

    slot.job = undefined
    if (response.type === 'error') {
      this.retryOrFail(job.shard)
    } else {
      this.attempts.delete(job.shard.id)
      this.failureKeys.delete(job.shard.id)
      this.loaded.set(job.shard.id, { lastUsed: performance.now() })
      this.callbacks.onLoaded(response)
      this.publishVisibility()
      this.trimCache()
    }
    this.publishCoverage()
    this.pump()
  }

  private handleWorkerFailure(slot: WorkerSlot, message: string) {
    const shard = slot.job?.shard
    this.replaceWorker(slot)
    if (shard) this.retryOrFail(shard, message)
    else this.callbacks.onError(message)
    this.publishCoverage()
    this.pump()
  }

  private retryOrFail(shard: ParcelShard, workerMessage?: string) {
    const attempts = (this.attempts.get(shard.id) ?? 0) + 1
    this.attempts.set(shard.id, attempts)
    if (attempts < MAX_ATTEMPTS && this.wanted.has(shard.id)) {
      this.queue = [
        shard,
        ...this.queue.filter((queued) => queued.id !== shard.id),
      ]
      return
    }

    this.failureKeys.set(shard.id, this.activeFailureKey)
    if (this.viewport.has(shard.id)) {
      this.callbacks.onError(
        workerMessage ??
          'Parcel data did not load. Move or zoom the map to retry.',
      )
    }
  }

  private publishVisibility() {
    const visible = [...this.wanted.keys()]
      .filter((id) => this.loaded.has(id))
      .sort()
    const key = visible.join('|')
    if (key === this.visibleShardKey) return
    this.visibleShardKey = key
    this.callbacks.onVisibleShards(new Set(visible))
  }

  private publishCoverage() {
    const readyViewportCells = [...this.viewport].filter((id) =>
      this.loaded.has(id),
    ).length
    const readyTargetCells = [...this.wanted.keys()].filter((id) =>
      this.loaded.has(id),
    ).length
    const coverage: ParcelCoverage = {
      viewportCells: this.viewport.size,
      readyViewportCells,
      targetCells: this.wanted.size,
      readyTargetCells,
      viewportReady: readyViewportCells === this.viewport.size,
    }
    const key = JSON.stringify(coverage)
    if (key === this.coverageKey) return
    this.coverageKey = key
    this.callbacks.onCoverage(coverage)
  }

  private trimCache() {
    const maximum = this.wanted.size + MAX_IDLE_CELLS
    if (this.loaded.size <= maximum) return

    const idle = [...this.loaded.entries()]
      .filter(([id]) => !this.wanted.has(id))
      .sort(([, a], [, b]) => a.lastUsed - b.lastUsed)
    while (this.loaded.size > maximum) {
      const oldest = idle.shift()!
      this.loaded.delete(oldest[0])
      this.attempts.delete(oldest[0])
      this.failureKeys.delete(oldest[0])
      this.callbacks.onEvict(oldest[0])
    }
  }
}
