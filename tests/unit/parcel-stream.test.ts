import { describe, expect, it, vi } from 'vitest'
import {
  createParcelLoadPlan,
  prioritizeParcelShards,
} from '../../src/map/ParcelLoadPlanner'
import { ParcelStream } from '../../src/map/ParcelStream'
import type {
  ParcelManifestV1,
  ParcelWorkerRequest,
  ParcelWorkerResponse,
  WorkerLoadedResponse,
} from '../../src/map/types'

class FakeWorker {
  onmessage: ((event: MessageEvent<ParcelWorkerResponse>) => void) | null = null
  onerror: (() => void) | null = null
  onmessageerror: (() => void) | null = null
  readonly requests: ParcelWorkerRequest[] = []
  readonly terminate = vi.fn()

  postMessage(request: ParcelWorkerRequest) {
    this.requests.push(request)
  }

  emit(response: ParcelWorkerResponse) {
    this.onmessage?.({ data: response } as MessageEvent<ParcelWorkerResponse>)
  }
}

const manifest: ParcelManifestV1 = {
  schemaVersion: 1,
  source: {
    name: 'Test parcels',
    date: '2026-07-24',
    epsg: 2274,
    recordCount: 2,
    checksumSha256: 'test',
    attribution: 'Test',
  },
  projection: {
    epsg: 3857,
    localOrigin: [100, 200],
    bounds: [0, 0, 20, 10],
    baseCellSizeMeters: 10,
    minimumCellSizeMeters: 10,
    gridOrigin: [0, 0],
  },
  overviewUrl: '/overview.json',
  shards: [
    {
      id: 'west',
      bounds: [0, 0, 10, 10],
      featureCount: 1,
      byteLength: 10,
      url: '/west.fgb',
    },
    {
      id: 'east',
      bounds: [10, 0, 20, 10],
      featureCount: 1,
      byteLength: 10,
      url: '/east.fgb',
    },
  ],
  statistics: {
    appraisalQuantiles: [1, 2, 3, 4],
    landUse: [],
    zoning: [],
    featureTypes: [],
    missingAddress: 0,
    missingLandUse: 0,
    missingZoning: 0,
  },
  validation: {
    repairedRings: 0,
    sourceCoordinateCount: 0,
    projectedCoordinateCount: 0,
    simplifiedCoordinateCount: 0,
    shardRecordReferences: 2,
    deduplicatedRecordCount: 2,
    warnings: [],
    generatedAt: '2026-07-24T00:00:00.000Z',
  },
}

const loadedResponse = (
  generation: number,
  shardId: string,
): WorkerLoadedResponse => ({
  type: 'loaded',
  generation,
  shardId,
  logicalRecordCount: 0,
  groups: [],
  topPositions: new Float32Array(),
  topIndices: new Uint32Array(),
  topVertexGroups: new Uint32Array(),
  topTriangleGroups: new Uint32Array(),
  sidePositions: new Float32Array(),
  sideIndices: new Uint32Array(),
  sideVertexGroups: new Uint32Array(),
  sideNormals: new Float32Array(),
  edgePositions: new Float32Array(),
  edgeVertexGroups: new Uint32Array(),
})

function harness(workerCount = 2, value = manifest) {
  const workers: FakeWorker[] = []
  const callbacks = {
    onProgress: vi.fn(),
    onLoaded: vi.fn(),
    onError: vi.fn(),
    onVisibleShards: vi.fn(),
    onEvict: vi.fn(),
    onCoverage: vi.fn(),
  }
  const stream = new ParcelStream(
    value,
    callbacks,
    () => {
      const worker = new FakeWorker()
      workers.push(worker)
      return worker as unknown as Worker
    },
    workerCount,
  )
  return { stream, workers, callbacks }
}

function loadRequest(worker: FakeWorker) {
  const request = worker.requests.find(
    (candidate): candidate is Extract<ParcelWorkerRequest, { type: 'load' }> =>
      candidate.type === 'load',
  )
  if (!request) throw new Error('Expected a worker load request')
  return request
}

describe('parcel load planning', () => {
  const forward = {
    id: 'forward',
    bounds: [60, 0, 70, 10],
    featureCount: 1,
    byteLength: 10,
    url: '/forward.fgb',
  } satisfies ParcelManifestV1['shards'][number]
  const behind = {
    id: 'behind',
    bounds: [-30, 0, -20, 10],
    featureCount: 1,
    byteLength: 10,
    url: '/behind.fgb',
  } satisfies ParcelManifestV1['shards'][number]

  it('builds bounded lookahead and failure scopes from one pure plan', () => {
    const plan = createParcelLoadPlan(
      { ...manifest, shards: [...manifest.shards, forward, behind] },
      [0, 0, 9, 9],
      [1_000, 0],
    )

    expect(plan.viewportShards.map((shard) => shard.id)).toEqual(['west'])
    expect(plan.targetShards.map((shard) => shard.id)).toEqual([
      'west',
      'east',
      'forward',
    ])
    expect(plan.shardKey).toBe('east|forward|west')
    expect(plan.failureKey).toBe('east|forward|west#7x7')
  })

  it('prioritizes visible shards before velocity-aligned prefetch work', () => {
    expect(
      prioritizeParcelShards(
        [manifest.shards[1], forward, manifest.shards[0]],
        [0, 0, 9, 9],
        [30, 0],
      ).map((shard) => shard.id),
    ).toEqual(['west', 'forward', 'east'])
  })
})

describe('ParcelStream', () => {
  it('loads viewport cells incrementally and keeps prefetched cells alive', () => {
    const { stream, workers, callbacks } = harness()
    const internal = stream as unknown as {
      attempts: Map<string, number>
      failureKeys: Map<string, string>
    }
    internal.attempts.set('west', 2)
    internal.failureKeys.set('west', 'east|west#7x7')
    internal.attempts.set('east', 2)
    internal.failureKeys.set('east', 'east|west#7x7')
    internal.attempts.set('missing', 1)

    expect(stream.load([0, 0, 9, 9])).toBe(2)
    expect(internal.attempts).toEqual(new Map([['east', 2]]))
    expect(internal.failureKeys).toEqual(new Map([['east', 'east|west#7x7']]))
    expect(stream.isLoading).toBe(true)
    expect(stream.hasViewportCoverage).toBe(false)
    expect(loadRequest(workers[0])).toMatchObject({
      shard: { id: 'west', url: '/west.fgb' },
      origin: [100, 200],
    })
    expect(loadRequest(workers[1]).shard.id).toBe('east')

    const west = loadRequest(workers[0])
    workers[0].emit({
      type: 'progress',
      generation: west.generation,
      shardId: 'west',
      message: 'Generating west',
    })
    expect(callbacks.onProgress).toHaveBeenCalledWith('Generating west')
    workers[0].emit(loadedResponse(west.generation, 'wrong'))
    expect(callbacks.onLoaded).not.toHaveBeenCalled()

    workers[0].emit(loadedResponse(west.generation, 'west'))
    expect(stream.hasViewportCoverage).toBe(true)
    expect(stream.isLoading).toBe(true)
    expect(callbacks.onVisibleShards).toHaveBeenLastCalledWith(
      new Set(['west']),
    )

    const east = loadRequest(workers[1])
    workers[1].emit(loadedResponse(east.generation, 'east'))
    expect(stream.isLoading).toBe(false)
    expect(callbacks.onLoaded).toHaveBeenCalledTimes(2)
    expect(callbacks.onVisibleShards).toHaveBeenLastCalledWith(
      new Set(['east', 'west']),
    )
    expect(stream.load([0, 0, 9, 9])).toBeUndefined()
    expect(workers.flatMap((worker) => worker.requests)).toHaveLength(2)
    expect(callbacks.onCoverage).toHaveBeenLastCalledWith({
      viewportCells: 1,
      readyViewportCells: 1,
      targetCells: 2,
      readyTargetCells: 2,
      viewportReady: true,
    })
  })

  it('cancels active work without throwing away completed cell geometry', () => {
    const { stream, workers, callbacks } = harness()
    stream.load([0, 0, 9, 9])
    const west = loadRequest(workers[0])
    workers[0].emit(loadedResponse(west.generation, 'west'))

    expect(stream.cancel()).toBe(true)
    expect(stream.isLoading).toBe(false)
    expect(stream.cancel()).toBe(false)
    expect(callbacks.onVisibleShards).toHaveBeenLastCalledWith(new Set())
    expect(workers[1].requests.at(-1)).toMatchObject({ type: 'cancel' })

    expect(stream.load([0, 0, 9, 9])).toBe(2)
    expect(stream.hasViewportCoverage).toBe(true)
    expect(callbacks.onVisibleShards).toHaveBeenLastCalledWith(
      new Set(['west']),
    )
    stream.dispose()
    for (const worker of workers)
      expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it('retries failures, replaces broken workers, and reports only exhausted viewport cells', () => {
    const { stream, workers, callbacks } = harness(1)
    stream.load([0, 0, 9, 9])

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const worker = workers.at(-1)!
      const request = worker.requests.at(-1) as Extract<
        ParcelWorkerRequest,
        { type: 'load' }
      >
      worker.emit({
        type: 'error',
        generation: request.generation,
        shardId: request.shard.id,
        message: 'Internal worker detail',
      })
    }
    expect(callbacks.onError).toHaveBeenCalledOnce()
    expect(callbacks.onError).toHaveBeenCalledWith(
      'Parcel data did not load. Move or zoom the map to retry.',
    )

    const activeWorker = workers.at(-1)!
    activeWorker.onerror?.()
    expect(workers).toHaveLength(2)
    expect(activeWorker.terminate).toHaveBeenCalledOnce()
    expect(callbacks.onError).toHaveBeenCalledTimes(1)

    const replacement = workers.at(-1)!
    replacement.onmessageerror?.()
    expect(workers).toHaveLength(3)
    expect(callbacks.onError).toHaveBeenCalledTimes(1)

    const finalAttempt = workers.at(-1)!
    finalAttempt.onmessageerror?.()
    expect(workers).toHaveLength(4)
    expect(callbacks.onError).toHaveBeenCalledTimes(1)

    const idleWorker = workers.at(-1)!
    idleWorker.onmessageerror?.()
    expect(workers).toHaveLength(5)
    expect(callbacks.onError).toHaveBeenCalledTimes(2)
    expect(callbacks.onError).toHaveBeenLastCalledWith(
      'Parcel worker returned an unreadable response.',
    )
    stream.dispose()
  })

  it('retries an exhausted viewport cell when the view scale changes', () => {
    const singleManifest = {
      ...manifest,
      projection: {
        ...manifest.projection,
        bounds: [0, 0, 10, 10] as [number, number, number, number],
      },
      shards: [manifest.shards[0]],
    }
    const { stream, workers } = harness(1, singleManifest)
    const worker = workers[0]
    stream.load([0, 0, 9, 9])

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const request = worker.requests.at(-1) as Extract<
        ParcelWorkerRequest,
        { type: 'load' }
      >
      worker.emit({
        type: 'error',
        generation: request.generation,
        shardId: request.shard.id,
        message: 'Unavailable',
      })
    }
    const requestsBeforeZoom = worker.requests.length

    expect(stream.load([1, 1, 8, 8])).toBeUndefined()
    expect(worker.requests).toHaveLength(requestsBeforeZoom + 1)
    expect(worker.requests.at(-1)).toMatchObject({
      type: 'load',
      shard: { id: 'west' },
    })
    stream.dispose()
  })

  it('prioritizes the live viewport, then looks ahead in the pan direction', () => {
    const directionalManifest = {
      ...manifest,
      projection: {
        ...manifest.projection,
        bounds: [-40, 0, 50, 10] as [number, number, number, number],
      },
      shards: Array.from({ length: 9 }, (_, index) => {
        const x = index - 4
        return {
          id: `${x}`,
          bounds: [x * 10, 0, x * 10 + 10, 10] as [
            number,
            number,
            number,
            number,
          ],
          featureCount: 1,
          byteLength: 10,
          url: `/${x}.fgb`,
        }
      }),
    }
    const { stream, workers } = harness(3, directionalManifest)

    stream.load([0.1, 0, 9, 9], [100, 0])

    expect(loadRequest(workers[0]).shard.id).toBe('0')
    expect(Number(loadRequest(workers[1]).shard.id)).toBeGreaterThan(0)
    expect(Number(loadRequest(workers[2]).shard.id)).toBeGreaterThan(0)
    stream.dispose()
  })

  it('preempts speculative work when a newly visible cell needs a worker', () => {
    const directionalManifest = {
      ...manifest,
      projection: {
        ...manifest.projection,
        bounds: [-30, 0, 40, 10] as [number, number, number, number],
      },
      shards: Array.from({ length: 7 }, (_, index) => {
        const x = index - 3
        return {
          id: `${x}`,
          bounds: [x * 10, 0, x * 10 + 10, 10] as [
            number,
            number,
            number,
            number,
          ],
          featureCount: 1,
          byteLength: 10,
          url: `/${x}.fgb`,
        }
      }),
    }
    const { stream, workers } = harness(1, directionalManifest)
    const worker = workers[0]

    stream.load([0.1, 0, 9, 9], [100, 0])
    const viewport = loadRequest(worker)
    worker.emit(loadedResponse(viewport.generation, '0'))
    const speculative = worker.requests
      .filter(
        (request): request is Extract<ParcelWorkerRequest, { type: 'load' }> =>
          request.type === 'load',
      )
      .at(-1)
    expect(Number(speculative?.shard.id)).toBeGreaterThan(0)

    stream.load([-9, 0, -0.1, 9], [100, 0])

    expect(worker.requests.at(-2)).toMatchObject({ type: 'cancel' })
    expect(worker.requests.at(-1)).toMatchObject({
      type: 'load',
      shard: { id: '-1' },
    })
    stream.load([30.1, 0, 39, 9])
    expect(worker.requests.at(-2)).toMatchObject({ type: 'cancel' })
    expect(worker.requests.at(-1)).toMatchObject({
      type: 'load',
      shard: { id: '3' },
    })
    stream.dispose()
  })

  it('can retain an in-flight lookahead cell during a destination flight', () => {
    const directionalManifest = {
      ...manifest,
      projection: {
        ...manifest.projection,
        bounds: [-30, 0, 40, 10] as [number, number, number, number],
      },
      shards: Array.from({ length: 7 }, (_, index) => {
        const x = index - 3
        return {
          id: `${x}`,
          bounds: [x * 10, 0, x * 10 + 10, 10] as [
            number,
            number,
            number,
            number,
          ],
          featureCount: 1,
          byteLength: 10,
          url: `/${x}.fgb`,
        }
      }),
    }
    const { stream, workers } = harness(1, directionalManifest)
    const worker = workers[0]

    stream.load([0.1, 0, 9, 9], [100, 0])
    const viewport = loadRequest(worker)
    worker.emit(loadedResponse(viewport.generation, '0'))
    const lookahead = worker.requests.at(-1) as Extract<
      ParcelWorkerRequest,
      { type: 'load' }
    >
    expect(Number(lookahead.shard.id)).toBeGreaterThan(0)

    stream.load([0.1, 0, 9, 9], [-100, 0], true)

    expect(worker.requests.at(-1)).toBe(lookahead)
    worker.emit(loadedResponse(lookahead.generation, lookahead.shard.id))
    expect(
      Number(
        (
          worker.requests.at(-1) as Extract<
            ParcelWorkerRequest,
            { type: 'load' }
          >
        ).shard.id,
      ),
    ).toBeLessThan(0)

    stream.load([0.1, 0, 9, 9], [100, 0])
    expect(worker.requests.at(-2)).toMatchObject({ type: 'cancel' })
    expect(
      Number(
        (
          worker.requests.at(-1) as Extract<
            ParcelWorkerRequest,
            { type: 'load' }
          >
        ).shard.id,
      ),
    ).toBeGreaterThan(0)
    stream.dispose()
  })

  it('keeps viewport jobs while assigning queued work to another slot', () => {
    const { stream, workers } = harness(2)
    const internal = stream as unknown as {
      viewport: Set<string>
      queue: typeof manifest.shards
      slots: Array<{
        worker: Worker
        job?: { generation: number; shard: (typeof manifest.shards)[number] }
      }>
      preemptSpeculativeJobs: () => boolean
      pump: () => void
    }
    internal.viewport = new Set(['west'])
    internal.queue = [manifest.shards[0]]
    internal.slots[0].job = { generation: 1, shard: manifest.shards[0] }
    internal.slots[1].job = { generation: 2, shard: manifest.shards[1] }

    expect(internal.preemptSpeculativeJobs()).toBe(true)
    expect(workers[1].requests.at(-1)).toMatchObject({ type: 'cancel' })

    internal.queue = [manifest.shards[1]]
    internal.pump()
    expect(workers[1].requests.at(-1)).toMatchObject({
      type: 'load',
      shard: { id: 'east' },
    })
    stream.dispose()
  })

  it('evicts the oldest retained cells after the viewport moves', () => {
    const wideManifest = {
      ...manifest,
      projection: {
        ...manifest.projection,
        bounds: [0, 0, 250, 10] as [number, number, number, number],
      },
      shards: Array.from({ length: 25 }, (_, index) => ({
        id: `${index}`,
        bounds: [index * 10, 0, index * 10 + 10, 10] as [
          number,
          number,
          number,
          number,
        ],
        featureCount: 1,
        byteLength: 10,
        url: `/${index}.fgb`,
      })),
    }
    const { stream, workers, callbacks } = harness(25, wideManifest)

    stream.load([0.1, 0, 249.9, 9])
    workers.forEach((worker) => {
      const load = loadRequest(worker)
      worker.emit(loadedResponse(load.generation, load.shard.id))
    })
    expect(stream.isLoading).toBe(false)

    stream.load([120.1, 0, 129.9, 9])

    expect(callbacks.onEvict).toHaveBeenCalledTimes(6)
    stream.dispose()
  })

  it('uses the browser worker factory and ignores work after disposal', () => {
    vi.stubGlobal('Worker', FakeWorker)
    const callbacks = {
      onProgress: vi.fn(),
      onLoaded: vi.fn(),
      onError: vi.fn(),
      onVisibleShards: vi.fn(),
      onEvict: vi.fn(),
      onCoverage: vi.fn(),
    }
    const stream = new ParcelStream(manifest, callbacks)
    const internal = stream as unknown as {
      cancelSlot: (slot: { worker: Worker }) => void
      pump: () => void
    }

    internal.cancelSlot({ worker: new FakeWorker() as unknown as Worker })
    stream.dispose()
    expect(stream.load([0, 0, 9, 9])).toBeUndefined()
    internal.pump()
    vi.unstubAllGlobals()
  })
})
