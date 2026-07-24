import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ParcelFeature, ParcelWorkerRequest } from '../../src/map/types'

const deserialize = vi.hoisted(() => vi.fn())

vi.mock('flatgeobuf', () => ({
  geojson: { deserialize },
}))

interface WorkerScope {
  onmessage?: (event: MessageEvent<ParcelWorkerRequest>) => Promise<void>
  postMessage: ReturnType<typeof vi.fn>
}

function parcel(rid: number): ParcelFeature {
  return {
    type: 'Feature',
    properties: {
      rid,
      stanpar: `${rid}`,
      parId: rid,
      featureType: 'Parcel',
      floor: '',
      address: 'Test',
      acres: 1,
      landUseCode: 'RES',
      landUse: 'Residential',
      zoning: 'R6',
      landAppraisal: 1,
      improvementAppraisal: 1,
      totalAppraisal: 2,
    },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [0, 1],
          [0, 0],
        ],
      ],
    },
  }
}

async function loadWorker() {
  const scope: WorkerScope = { postMessage: vi.fn() }
  vi.stubGlobal('self', scope)
  await import('../../src/map/parcel.worker')
  if (!scope.onmessage) throw new Error('Worker handler was not installed')
  return scope
}

function request(generation: number, urls = ['/one.fgb']): ParcelWorkerRequest {
  return {
    type: 'load',
    generation,
    urls,
    origin: [0, 0],
  }
}

beforeEach(() => {
  vi.resetModules()
  deserialize.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('parcel worker', () => {
  it('deduplicates records, reports progress, and transfers geometry', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const rid = url.includes('two') ? 2 : 1
        return new Response(Uint8Array.from([rid]))
      }),
    )
    deserialize.mockImplementation(async function* (bytes: Uint8Array) {
      yield parcel(bytes[0])
      yield parcel(bytes[0])
    })
    const scope = await loadWorker()

    await scope.onmessage!({
      data: request(1, ['/one.fgb', '/two.fgb']),
    } as MessageEvent<ParcelWorkerRequest>)

    const messages = scope.postMessage.mock.calls.map(([message]) => message)
    expect(messages.filter(({ type }) => type === 'progress')).toHaveLength(3)
    expect(messages.at(-1)).toMatchObject({
      type: 'loaded',
      generation: 1,
      logicalRecordCount: 2,
    })
    expect(scope.postMessage.mock.calls.at(-1)?.[1].transfer).toHaveLength(8)
  })

  it('cancels current work and ignores stale successful generations', async () => {
    let releaseFirst: ((response: Response) => void) | undefined
    const firstResponse = new Promise<Response>((resolve) => {
      releaseFirst = resolve
    })
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockReturnValueOnce(firstResponse)
        .mockResolvedValueOnce(new Response(Uint8Array.from([2]))),
    )
    deserialize.mockImplementation(async function* (bytes: Uint8Array) {
      yield parcel(bytes[0])
    })
    const abort = vi.spyOn(AbortController.prototype, 'abort')
    const scope = await loadWorker()

    const first = scope.onmessage!({
      data: request(1),
    } as MessageEvent<ParcelWorkerRequest>)
    const second = scope.onmessage!({
      data: request(2, ['/two.fgb']),
    } as MessageEvent<ParcelWorkerRequest>)
    releaseFirst!(new Response(Uint8Array.from([1])))
    await Promise.all([first, second])

    await scope.onmessage!({
      data: { type: 'cancel', generation: 1 },
    } as MessageEvent<ParcelWorkerRequest>)
    await scope.onmessage!({
      data: { type: 'cancel', generation: 2 },
    } as MessageEvent<ParcelWorkerRequest>)

    expect(abort).toHaveBeenCalledTimes(2)
    const loaded = scope.postMessage.mock.calls
      .map(([message]) => message)
      .filter(({ type }) => type === 'loaded')
    expect(loaded).toHaveLength(1)
    expect(loaded[0].generation).toBe(2)
  })

  it.each([
    [
      'HTTP failures',
      async () => new Response(undefined, { status: 503 }),
      '/one.fgb returned 503',
    ],
    [
      'ordinary errors',
      async () => {
        throw new Error('broken data')
      },
      'broken data',
    ],
    [
      'non-error values',
      async () => {
        throw 'broken value'
      },
      'Parcel loading failed',
    ],
  ])('publishes safe errors for %s', async (_name, fetcher, message) => {
    vi.stubGlobal('fetch', vi.fn(fetcher))
    const scope = await loadWorker()

    await scope.onmessage!({
      data: request(1),
    } as MessageEvent<ParcelWorkerRequest>)

    expect(scope.postMessage).toHaveBeenLastCalledWith({
      type: 'error',
      generation: 1,
      message,
    })
  })

  it('silently ignores abort errors and cancellation before a load', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new DOMException('cancelled', 'AbortError')
      }),
    )
    const scope = await loadWorker()

    await scope.onmessage!({
      data: { type: 'cancel', generation: 0 },
    } as MessageEvent<ParcelWorkerRequest>)
    await scope.onmessage!({
      data: request(1),
    } as MessageEvent<ParcelWorkerRequest>)

    expect(scope.postMessage).not.toHaveBeenCalled()
  })
})
