import { describe, expect, it } from 'vitest'
import {
  CAMERA_LIMITS,
  clampCameraTarget,
  keyboardShortcutForKey,
} from '../../src/map/camera-utils'
import {
  mercatorTileBounds,
  mercatorTileCoordinate,
  zoomForResolution,
} from '../../src/map/tile-manager'

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
  })
})
