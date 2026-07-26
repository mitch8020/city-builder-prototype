import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import {
  baseCellKeys,
  cellBounds,
  childCells,
  closeRing,
  geometryBounds,
  geometryCoordinateCount,
  intersects,
  primaryZoning,
  projectCoordinate,
  projectGeometry,
  quantiles,
  resolvePublicAsset,
  sourceDateFromDbfHeader,
} from '../../scripts/parcel-utils.mjs'

describe('parcel preprocessing geometry', () => {
  it('projects Nashville State Plane coordinates into finite Web Mercator', () => {
    const coordinate = projectCoordinate([1_750_000, 660_000])
    expect(coordinate.every(Number.isFinite)).toBe(true)
    expect(coordinate[0]).toBeGreaterThan(-9_800_000)
    expect(coordinate[0]).toBeLessThan(-9_500_000)
    expect(coordinate[1]).toBeGreaterThan(4_200_000)
    expect(coordinate[1]).toBeLessThan(4_500_000)
  })

  it('closes rings without changing already closed geometry', () => {
    const open = [
      [0, 0],
      [2, 0],
      [2, 2],
    ]
    expect(closeRing(open)).toEqual([...open, [0, 0]])
    expect(closeRing([...open, [0, 0]])).toHaveLength(4)
    expect(closeRing([])).toEqual([])
  })

  it('preserves polygon holes and multipolygon parts through projection', () => {
    const geometry = {
      type: 'MultiPolygon',
      coordinates: [
        [
          [
            [1_750_000, 660_000],
            [1_750_100, 660_000],
            [1_750_100, 660_100],
            [1_750_000, 660_000],
          ],
          [
            [1_750_020, 660_020],
            [1_750_030, 660_020],
            [1_750_020, 660_020],
          ],
        ],
        [
          [
            [1_751_000, 661_000],
            [1_751_100, 661_000],
            [1_751_000, 661_000],
          ],
        ],
      ],
    }
    const projected = projectGeometry(geometry)
    expect(projected.type).toBe('MultiPolygon')
    expect(projected.coordinates).toHaveLength(2)
    expect(projected.coordinates[0]).toHaveLength(2)
    expect(projected.coordinates[0][0]).toHaveLength(4)
    expect(geometryCoordinateCount(projected)).toBe(10)
    expect(geometryBounds(projected).every(Number.isFinite)).toBe(true)

    const polygon = projectGeometry({
      type: 'Polygon',
      coordinates: [geometry.coordinates[0][0]],
    })
    expect(polygon.type).toBe('Polygon')
    expect(geometryCoordinateCount(polygon)).toBe(4)
    expect(geometryCoordinateCount(null)).toBe(0)
    expect(projectGeometry(null)).toBeNull()
    expect(() => projectGeometry({ type: 'Point', coordinates: [] })).toThrow(
      'Unsupported parcel geometry type: Point',
    )
  })

  it('assigns every intersected 2,048 meter base cell', () => {
    const bounds = cellBounds('20-20')
    const keys = baseCellKeys([
      bounds[0] + 10,
      bounds[1] + 10,
      bounds[2] + 10,
      bounds[3] + 10,
    ])
    expect(keys).toEqual(['20-20', '20-21', '21-20', '21-21'])
  })

  it('calculates stable data helpers', () => {
    expect(quantiles([0, 10, 20, 30, 40])).toEqual([0, 10, 20, 30])
    expect(quantiles([Number.NaN, -1])).toEqual([0, 0, 0, 0])
    expect(primaryZoning('R6; OV-UZO')).toBe('R6')
    expect(primaryZoning(undefined)).toBe('')
    expect(primaryZoning('  ')).toBe('')
    expect(sourceDateFromDbfHeader(Uint8Array.from([3, 126, 5, 12]))).toBe(
      '2026-05-12',
    )
  })

  it('resolves only rooted local assets contained by the public directory', () => {
    const publicDirectory = resolve('public')
    expect(
      resolvePublicAsset(
        publicDirectory,
        '/data/parcels/2026-05-12/cells/1.fgb',
      ),
    ).toBe(resolve(publicDirectory, 'data/parcels/2026-05-12/cells/1.fgb'))

    for (const invalid of [
      null,
      'data/parcels/1.fgb',
      '//remote-host/1.fgb',
      '/data\\parcels\\1.fgb',
    ]) {
      expect(() => resolvePublicAsset(publicDirectory, invalid)).toThrow(
        'Public asset URL must be a rooted local path',
      )
    }
    for (const outside of ['/', '/..', '/../public-other/1.fgb']) {
      expect(() => resolvePublicAsset(publicDirectory, outside)).toThrow(
        'Public asset URL resolves outside public',
      )
    }
  })

  it('rejects empty geometry bounds', () => {
    expect(() =>
      geometryBounds({ type: 'Polygon', coordinates: [[]] }),
    ).toThrow('Geometry has no finite bounds')
  })

  it('covers every bounding-box direction and subdivides parent cells', () => {
    expect(intersects([0, 0, 2, 2], [1, 1, 3, 3])).toBe(true)
    expect(intersects([0, 0, 2, 2], [3, 0, 4, 1])).toBe(false)
    expect(intersects([3, 0, 4, 1], [0, 0, 2, 2])).toBe(false)
    expect(intersects([0, 0, 2, 2], [0, 3, 1, 4])).toBe(false)
    expect(intersects([0, 3, 1, 4], [0, 0, 2, 2])).toBe(false)

    const children = childCells([0, 0, 8, 8], 'parent')
    expect(children).toEqual([
      { id: 'parent-0', bounds: [0, 0, 4, 4] },
      { id: 'parent-1', bounds: [4, 0, 8, 4] },
      { id: 'parent-2', bounds: [0, 4, 4, 8] },
      { id: 'parent-3', bounds: [4, 4, 8, 8] },
    ])
    expect(cellBounds('0-0', 512)[2] - cellBounds('0-0', 512)[0]).toBe(512)
  })
})
