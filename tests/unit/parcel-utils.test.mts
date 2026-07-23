import { describe, expect, it } from 'vitest'
import {
  baseCellKeys,
  cellBounds,
  closeRing,
  geometryBounds,
  geometryCoordinateCount,
  primaryZoning,
  projectCoordinate,
  projectGeometry,
  quantiles,
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
    expect(primaryZoning('R6; OV-UZO')).toBe('R6')
    expect(sourceDateFromDbfHeader(Uint8Array.from([3, 126, 5, 12]))).toBe(
      '2026-05-12',
    )
  })
})
