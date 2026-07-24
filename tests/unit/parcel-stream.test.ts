import { describe, expect, it, vi } from 'vitest'
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

const loadedResponse = (generation: number): WorkerLoadedResponse => ({
  type: 'loaded',
  generation,
  logicalRecordCount: 0,
  groups: [],
  topPositions: new Float32Array(),
  topIndices: new Uint32Array(),
  topVertexGroups: new Uint32Array(),
  topTriangleGroups: new Uint32Array(),
  sidePositions: new Float32Array(),
  sideIndices: new Uint32Array(),
  sideVertexGroups: new Uint32Array(),
  edgePositions: new Float32Array(),
})

describe('ParcelStream', () => {
  it('deduplicates viewport loads and ignores stale worker responses', () => {
    const worker = new FakeWorker()
    const onProgress = vi.fn()
    const onLoaded = vi.fn()
    const onError = vi.fn()
    const stream = new ParcelStream(
      manifest,
      { onProgress, onLoaded, onError },
      worker as unknown as Worker,
    )

    expect(stream.load([0, 0, 9, 9])).toBe(1)
    expect(stream.load([0, 0, 9, 9])).toBeUndefined()
    expect(worker.requests).toEqual([
      {
        type: 'load',
        generation: 1,
        urls: ['/west.fgb'],
        origin: [100, 200],
      },
    ])

    expect(stream.load([0, 0, 20, 10])).toBe(2)
    worker.emit(loadedResponse(1))
    expect(onLoaded).not.toHaveBeenCalled()

    worker.emit({
      type: 'progress',
      generation: 2,
      message: 'Reading parcel cells',
      loaded: 1,
      total: 2,
    })
    expect(onProgress).toHaveBeenCalledWith('Reading parcel cells')

    const response = loadedResponse(2)
    worker.emit(response)
    expect(onLoaded).toHaveBeenCalledWith(response)
    expect(onError).not.toHaveBeenCalled()
  })

  it('makes failed and cancelled viewport loads retryable', () => {
    const worker = new FakeWorker()
    const onError = vi.fn()
    const stream = new ParcelStream(
      manifest,
      { onProgress: vi.fn(), onLoaded: vi.fn(), onError },
      worker as unknown as Worker,
    )

    expect(stream.load([0, 0, 9, 9])).toBe(1)
    worker.emit({
      type: 'error',
      generation: 1,
      message: 'Internal worker detail',
    })
    expect(onError).toHaveBeenCalledWith(
      'Parcel data did not load. Move or zoom the map to retry.',
    )
    expect(stream.load([0, 0, 9, 9])).toBe(1)

    expect(stream.cancel()).toBe(true)
    expect(stream.cancel()).toBe(false)
    expect(worker.requests.at(-1)).toEqual({
      type: 'cancel',
      generation: 3,
    })

    worker.onerror?.()
    worker.onmessageerror?.()
    expect(onError).toHaveBeenNthCalledWith(
      2,
      'The parcel renderer stopped. Reload the map to restore it.',
    )
    expect(onError).toHaveBeenNthCalledWith(
      3,
      'Parcel worker returned an unreadable response.',
    )

    stream.dispose()
    expect(worker.terminate).toHaveBeenCalledOnce()
  })
})
