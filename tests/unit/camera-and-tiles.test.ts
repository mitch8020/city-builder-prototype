import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CAMERA_LIMITS,
  clampCameraTarget,
  keyboardShortcutForKey,
} from '../../src/map/camera-utils'
import { GoogleTileManager } from '../../src/map/tile-manager'
import type { GoogleBasemapState } from '../../src/map/tile-manager'
import {
  mercatorTileBounds,
  mercatorTileCoordinate,
  mercatorToLngLat,
  zoomForResolution,
} from '../../src/map/web-mercator'

interface TileManagerInternals {
  cache: Map<
    string,
    {
      mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
      texture: THREE.Texture
      lastUsed: number
    }
  >
  failures: Map<string, { attempts: number; retryAt: number }>
  pending: Set<string>
  wanted: Map<string, { x: number; y: number; zoom: number; key: string }>
  requestGeneration: number
  attribution?: string
  disposed: boolean
  loadTile: (
    tile: { x: number; y: number; zoom: number; key: string },
    generation: number,
  ) => Promise<void>
  loadAttribution: (
    bounds: [number, number, number, number],
    zoom: number,
    generation: number,
  ) => Promise<void>
  requestTile: (
    tile: { x: number; y: number; zoom: number; key: string },
    generation: number,
  ) => void
  publishState: () => void
  scheduleRetry: () => void
  trim: () => void
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('camera constraints and keyboard vocabulary', () => {
  it('keeps the target inside the padded county', () => {
    expect(clampCameraTarget(-100, -100, [0, 0, 10, 10], [0, 0], 2)).toEqual({
      x: -2,
      z: -12,
    })
    expect(clampCameraTarget(5, -5, [0, 0, 10, 10], [0, 0], 2)).toEqual({
      x: 5,
      z: -5,
    })
    expect(CAMERA_LIMITS.minimumTiltRadians).toBeLessThan(
      CAMERA_LIMITS.maximumTiltRadians,
    )
  })

  it('maps reset, close, and mode shortcuts', () => {
    expect(keyboardShortcutForKey('Backspace')).toEqual({ type: 'home' })
    expect(keyboardShortcutForKey('Escape')).toEqual({ type: 'escape' })
    expect(keyboardShortcutForKey('3')).toEqual({
      type: 'mode',
      mode: 'zoning',
    })
    expect(keyboardShortcutForKey('w')).toBeUndefined()
  })
})

describe('Google raster tile calculations and lifecycle', () => {
  it('round-trips a location and converts Web Mercator to longitude/latitude', () => {
    const point = [-9_660_490, 4_328_346]
    const tile = mercatorTileCoordinate(point[0], point[1], 15)
    const bounds = mercatorTileBounds(tile.x, tile.y, 15)
    expect(point[0]).toBeGreaterThanOrEqual(bounds[0])
    expect(point[0]).toBeLessThanOrEqual(bounds[2])
    expect(point[1]).toBeGreaterThanOrEqual(bounds[1])
    expect(point[1]).toBeLessThanOrEqual(bounds[3])
    expect(mercatorToLngLat(0, 0)).toEqual([0, 0])
    expect(mercatorToLngLat(0, Number.POSITIVE_INFINITY)[1]).toBeCloseTo(
      85.051_129,
      5,
    )
  })

  it('chooses higher zooms for finer resolutions', () => {
    expect(zoomForResolution(1)).toBeGreaterThan(zoomForResolution(100))
    expect(zoomForResolution(0)).toBe(zoomForResolution(0.01))
  })

  it('loads, attributes, reuses, hides, and disposes Google tiles', async () => {
    const loadAsync = vi
      .spyOn(THREE.TextureLoader.prototype, 'loadAsync')
      .mockImplementation(async () => new THREE.Texture())
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ copyright: 'Map data ©2026 Google' })),
    )
    const states: GoogleBasemapState[] = []
    const manager = new GoogleTileManager([0, 0], (state) => states.push(state))
    const internal = manager as unknown as TileManagerInternals

    manager.update([-9_660_000, 4_320_000, -9_659_999, 4_320_001], 100)
    await vi.waitFor(() =>
      expect(states.at(-1)).toEqual({
        available: true,
        copyright: 'Map data ©2026 Google',
      }),
    )
    const initialCount = internal.cache.size
    expect(loadAsync.mock.calls[0][0]).toMatch(
      /^\/api\/google-map\/tiles\/\d+\/\d+\/\d+$/,
    )
    expect(manager.group.name).toBe('Google Maps roadmap')
    expect(manager.group.visible).toBe(true)
    expect([...internal.cache.values()].every(({ mesh }) => mesh.visible)).toBe(
      true,
    )

    manager.update([-9_660_000, 4_320_000, -9_659_999, 4_320_001], 100)
    expect(loadAsync).toHaveBeenCalledTimes(initialCount)

    manager.update([-9_690_000, 4_297_000, -9_631_000, 4_355_000], 100)
    manager.update([-9_640_000, 4_340_000, -9_639_999, 4_340_001], 100)
    await vi.waitFor(() =>
      expect(internal.cache.size).toBeGreaterThan(initialCount),
    )
    expect([...internal.cache.values()].some(({ mesh }) => !mesh.visible)).toBe(
      true,
    )

    manager.dispose()
    manager.update([-9_660_000, 4_320_000, -9_659_999, 4_320_001], 100)
    expect(internal.cache.size).toBe(0)
    expect(internal.failures.size).toBe(0)
    expect(internal.pending.size).toBe(0)
    expect(internal.wanted.size).toBe(0)
    expect(manager.group.children).toHaveLength(0)
  })

  it('ignores stale attribution and hides imagery after a current attribution failure', async () => {
    const onState = vi.fn()
    const manager = new GoogleTileManager([0, 0], onState)
    const internal = manager as unknown as TileManagerInternals
    internal.requestGeneration = 2
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    fetchMock.mockResolvedValueOnce(
      Response.json({ copyright: 'Stale attribution' }),
    )
    await internal.loadAttribution([0, 0, 1, 1], 8, 1)
    expect(internal.attribution).toBeUndefined()

    fetchMock.mockResolvedValueOnce(
      Response.json({ copyright: '  Map data ©2026 Google  ' }),
    )
    await internal.loadAttribution([0, 0, 1, 1], 8, 2)
    expect(internal.attribution).toBe('Map data ©2026 Google')

    fetchMock.mockResolvedValueOnce(Response.json({ copyright: '' }))
    await internal.loadAttribution([0, 0, 1, 1], 8, 2)
    expect(internal.attribution).toBeUndefined()
    expect(manager.group.visible).toBe(false)

    fetchMock.mockResolvedValueOnce(
      Response.json({ copyright: 'Map data ©2026 Google' }),
    )
    await internal.loadAttribution([0, 0, 1, 1], 8, 2)
    fetchMock.mockResolvedValueOnce(new Response(undefined, { status: 503 }))
    await internal.loadAttribution([0, 0, 1, 1], 8, 2)
    expect(internal.attribution).toBeUndefined()
    expect(manager.group.visible).toBe(false)

    fetchMock.mockRejectedValueOnce(
      new DOMException('Network unavailable', 'NetworkError'),
    )
    await internal.loadAttribution([0, 0, 1, 1], 8, 2)
    expect(internal.attribution).toBeUndefined()
    manager.dispose()
  })

  it('aborts superseded attribution and reports an initial attribution failure', async () => {
    const onState = vi.fn()
    const manager = new GoogleTileManager([0, 0], onState)
    const internal = manager as unknown as TileManagerInternals
    internal.requestGeneration = 2
    let rejectFirst: ((reason: unknown) => void) | undefined
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        (_url: string, options: { signal: AbortSignal }) =>
          new Promise<Response>((_resolve, reject) => {
            rejectFirst = reject
            options.signal.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            )
          }),
      )
      .mockRejectedValueOnce(new Error('offline'))
    vi.stubGlobal('fetch', fetchMock)

    const first = internal.loadAttribution([0, 0, 1, 1], 8, 1)
    await internal.loadAttribution([0, 0, 1, 1], 8, 2)
    rejectFirst?.(new DOMException('Aborted', 'AbortError'))
    await first
    expect(manager.group.visible).toBe(false)
    expect(onState).toHaveBeenLastCalledWith({
      available: false,
      copyright: undefined,
    })
    manager.dispose()
  })

  it('retries failed current tiles with bounded backoff', async () => {
    vi.useFakeTimers()
    const loadAsync = vi
      .spyOn(THREE.TextureLoader.prototype, 'loadAsync')
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(new THREE.Texture())
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ copyright: 'Map data ©2026 Google' })),
    )
    const manager = new GoogleTileManager([0, 0], vi.fn())
    const internal = manager as unknown as TileManagerInternals

    manager.update([-9_660_000, 4_320_000, -9_659_999, 4_320_001], 100)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(loadAsync).toHaveBeenCalledTimes(3)
    expect(internal.failures.size).toBe(0)
    expect(internal.cache.size).toBe(1)
    manager.dispose()

    loadAsync.mockClear()
    const alwaysOffline = loadAsync.mockRejectedValue(new Error('offline'))
    const bounded = new GoogleTileManager([0, 0], vi.fn())
    bounded.update([-9_660_000, 4_320_000, -9_659_999, 4_320_001], 100)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(alwaysOffline).toHaveBeenCalledTimes(3)
    const boundedInternal = bounded as unknown as TileManagerInternals
    const failedTile = [...boundedInternal.wanted.values()][0]
    boundedInternal.requestTile(failedTile, boundedInternal.requestGeneration)
    expect(alwaysOffline).toHaveBeenCalledTimes(3)
    bounded.dispose()

    const disposedBeforeRetry = new GoogleTileManager([0, 0], vi.fn())
    const disposedRetryInternal =
      disposedBeforeRetry as unknown as TileManagerInternals
    disposedRetryInternal.wanted.set(failedTile.key, failedTile)
    disposedRetryInternal.failures.set(failedTile.key, {
      attempts: 1,
      retryAt: performance.now() + 10,
    })
    disposedRetryInternal.scheduleRetry()
    disposedRetryInternal.disposed = true
    await vi.advanceTimersByTimeAsync(20)
    disposedBeforeRetry.dispose()
  })

  it('disposes a tile that completes after manager disposal', async () => {
    let resolveTexture:
      ((texture: THREE.Texture<HTMLImageElement>) => void) | undefined
    vi.spyOn(THREE.TextureLoader.prototype, 'loadAsync').mockImplementation(
      () =>
        new Promise<THREE.Texture<HTMLImageElement>>((resolve) => {
          resolveTexture = resolve
        }),
    )
    const manager = new GoogleTileManager([0, 0], vi.fn())
    const internal = manager as unknown as TileManagerInternals
    const tile = { x: 0, y: 0, zoom: 8, key: '8/0/0' }
    const pending = internal.loadTile(tile, 1)
    manager.dispose()
    const texture = new THREE.Texture()
    const dispose = vi.spyOn(texture, 'dispose')
    resolveTexture?.(texture as THREE.Texture<HTMLImageElement>)
    await pending
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('ignores a late tile failure after manager disposal', async () => {
    let rejectTexture: ((reason: unknown) => void) | undefined
    vi.spyOn(THREE.TextureLoader.prototype, 'loadAsync').mockImplementation(
      () =>
        new Promise<THREE.Texture<HTMLImageElement>>((_resolve, reject) => {
          rejectTexture = reject
        }),
    )
    const manager = new GoogleTileManager([0, 0], vi.fn())
    const internal = manager as unknown as TileManagerInternals
    const pending = internal.loadTile(
      { x: 0, y: 0, zoom: 8, key: 'late-failure' },
      1,
    )
    manager.dispose()
    rejectTexture?.(new Error('offline'))
    await pending
    expect(internal.failures.size).toBe(0)
  })

  it('trims the least-recently-used cached tiles above the cap', () => {
    const manager = new GoogleTileManager([0, 0], vi.fn())
    const internal = manager as unknown as TileManagerInternals
    let oldest:
      | {
          geometry: THREE.PlaneGeometry
          material: THREE.MeshBasicMaterial
          texture: THREE.Texture
        }
      | undefined

    for (let index = 0; index < 97; index += 1) {
      const geometry = new THREE.PlaneGeometry(1, 1)
      const material = new THREE.MeshBasicMaterial()
      const mesh = new THREE.Mesh(geometry, material)
      const texture = new THREE.Texture()
      internal.cache.set(`${index}`, {
        mesh,
        texture,
        lastUsed: index,
      })
      if (index === 0) oldest = { geometry, material, texture }
    }
    const geometryDispose = vi.spyOn(oldest!.geometry, 'dispose')
    const materialDispose = vi.spyOn(oldest!.material, 'dispose')
    const textureDispose = vi.spyOn(oldest!.texture, 'dispose')

    internal.trim()

    expect(internal.cache.size).toBe(96)
    expect(geometryDispose).toHaveBeenCalledOnce()
    expect(materialDispose).toHaveBeenCalledOnce()
    expect(textureDispose).toHaveBeenCalledOnce()
    manager.dispose()
  })
})
