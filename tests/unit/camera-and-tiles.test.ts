import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CAMERA_LIMITS,
  clampCameraTarget,
  keyboardShortcutForKey,
} from '../../src/map/camera-utils'
import {
  mercatorTileBounds,
  mercatorTileCoordinate,
  MetroTileManager,
  zoomForResolution,
} from '../../src/map/tile-manager'

interface TileManagerInternals {
  cache: Map<
    string,
    {
      mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
      texture: THREE.Texture
      lastUsed: number
    }
  >
  failed: Set<string>
  wanted: Set<string>
  requestGeneration: number
  loadTile: (
    x: number,
    y: number,
    zoom: number,
    key: string,
    generation: number,
  ) => Promise<void>
  trim: () => void
}

afterEach(() => {
  vi.restoreAllMocks()
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

describe('Metro raster tile calculations', () => {
  it('round-trips a location into a containing tile', () => {
    const point = [-9_660_490, 4_328_346]
    const tile = mercatorTileCoordinate(point[0], point[1], 15)
    const bounds = mercatorTileBounds(tile.x, tile.y, 15)
    expect(point[0]).toBeGreaterThanOrEqual(bounds[0])
    expect(point[0]).toBeLessThanOrEqual(bounds[2])
    expect(point[1]).toBeGreaterThanOrEqual(bounds[1])
    expect(point[1]).toBeLessThanOrEqual(bounds[3])
  })

  it('chooses higher zooms for finer resolutions', () => {
    expect(zoomForResolution(1)).toBeGreaterThan(zoomForResolution(100))
    expect(zoomForResolution(0)).toBe(zoomForResolution(0.01))
  })

  it('loads, reuses, hides, and disposes Metro raster tiles', async () => {
    const loadAsync = vi
      .spyOn(THREE.TextureLoader.prototype, 'loadAsync')
      .mockImplementation(async () => new THREE.Texture())
    const onAvailability = vi.fn()
    const manager = new MetroTileManager([0, 0], onAvailability)
    const internal = manager as unknown as TileManagerInternals

    manager.update([0, 0, 1, 1], 100)
    await vi.waitFor(() => expect(internal.cache.size).toBeGreaterThan(0))
    const initialCount = internal.cache.size
    expect(loadAsync.mock.calls[0][0]).toContain('bbox=')
    expect(onAvailability).toHaveBeenCalledWith(true)
    expect([...internal.cache.values()].every(({ mesh }) => mesh.visible)).toBe(
      true,
    )

    manager.update([0, 0, 1, 1], 100)
    expect(loadAsync).toHaveBeenCalledTimes(initialCount)

    manager.update([1_000_000, 1_000_000, 1_000_001, 1_000_001], 100)
    await vi.waitFor(() =>
      expect(internal.cache.size).toBeGreaterThan(initialCount),
    )
    expect([...internal.cache.values()].some(({ mesh }) => !mesh.visible)).toBe(
      true,
    )

    manager.dispose()
    expect(internal.cache.size).toBe(0)
    expect(internal.failed.size).toBe(0)
    expect(manager.group.children).toHaveLength(0)
  })

  it('isolates stale tile completions and records current failures', async () => {
    const loadAsync = vi.spyOn(THREE.TextureLoader.prototype, 'loadAsync')
    const onAvailability = vi.fn()
    const manager = new MetroTileManager([0, 0], onAvailability)
    const internal = manager as unknown as TileManagerInternals
    internal.requestGeneration = 2
    internal.wanted = new Set()

    loadAsync.mockResolvedValueOnce(new THREE.Texture())
    await internal.loadTile(0, 0, 8, 'stale-success', 1)
    expect(onAvailability).not.toHaveBeenCalled()
    expect(internal.cache.get('stale-success')?.mesh.visible).toBe(false)

    loadAsync.mockRejectedValueOnce(new Error('offline'))
    await internal.loadTile(0, 0, 8, 'current-failure', 2)
    expect(internal.failed.has('current-failure')).toBe(true)
    expect(onAvailability).toHaveBeenLastCalledWith(false)

    loadAsync.mockRejectedValueOnce(new Error('stale offline'))
    await internal.loadTile(0, 0, 8, 'stale-failure', 1)
    expect(onAvailability).toHaveBeenCalledOnce()
    manager.dispose()
  })

  it('trims the least-recently-used cached tiles above the cap', () => {
    const manager = new MetroTileManager([0, 0], vi.fn())
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
