import { describe, expect, it } from 'vitest'
import {
  buildParcelGeometry,
  groupParcelFeatures,
} from '../../src/map/parcel-geometry'
import type { ParcelFeature, ParcelRecord } from '../../src/map/types'

const geometry: ParcelFeature['geometry'] = {
  type: 'Polygon',
  coordinates: [
    [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ],
    [
      [3, 3],
      [7, 3],
      [7, 7],
      [3, 7],
      [3, 3],
    ],
  ],
}

function parcel(rid: number, floor: string): ParcelRecord {
  return {
    rid,
    stanpar: '100',
    parId: rid,
    featureType: 'Condominium',
    floor,
    address: '100 Broadway',
    acres: 0.2,
    landUseCode: 'CONDO',
    landUse: 'Condominium',
    zoning: 'DTC',
    landAppraisal: 10_000,
    improvementAppraisal: 100_000 * rid,
    totalAppraisal: 110_000 * rid,
  }
}

describe('worker parcel geometry', () => {
  it('renders one footprint while retaining every logical condo unit', () => {
    const features = [1, 2].map((rid): ParcelFeature => ({
      type: 'Feature',
      properties: parcel(rid, `${rid}`),
      geometry,
    }))
    const groups = groupParcelFeatures(features)
    expect(groups).toHaveLength(1)
    expect(groups[0].records.map(({ rid }) => rid)).toEqual([1, 2])
  })

  it('triangulates holes without filling their area', () => {
    const [group] = groupParcelFeatures([
      {
        type: 'Feature',
        properties: parcel(1, '1'),
        geometry,
      },
    ])
    const output = buildParcelGeometry([group], [0, 0])
    let area = 0
    for (let index = 0; index < output.topIndices.length; index += 3) {
      const triangle = [0, 1, 2].map((offset) => {
        const vertex = output.topIndices[index + offset] * 3
        return [output.topPositions[vertex], output.topPositions[vertex + 2]]
      })
      area +=
        Math.abs(
          triangle[0][0] * (triangle[1][1] - triangle[2][1]) +
            triangle[1][0] * (triangle[2][1] - triangle[0][1]) +
            triangle[2][0] * (triangle[0][1] - triangle[1][1]),
        ) / 2
    }
    expect(area).toBeCloseTo(84)
    expect(output.topTriangleGroups.every((id) => id === group.id)).toBe(true)
    const [a, b, c] = output.topIndices
    const ax = output.topPositions[a * 3]
    const az = output.topPositions[a * 3 + 2]
    const bx = output.topPositions[b * 3]
    const bz = output.topPositions[b * 3 + 2]
    const cx = output.topPositions[c * 3]
    const cz = output.topPositions[c * 3 + 2]
    const normalY = (bz - az) * (cx - ax) - (bx - ax) * (cz - az)
    expect(normalY).toBeGreaterThan(0)
  })

  it('includes each multipolygon part in one logical parcel group', () => {
    const multi: ParcelFeature = {
      type: 'Feature',
      properties: parcel(3, ''),
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          geometry.coordinates,
          [
            [
              [20, 20],
              [22, 20],
              [22, 22],
              [20, 22],
              [20, 20],
            ],
          ],
        ],
      },
    }
    const groups = groupParcelFeatures([multi])
    const output = buildParcelGeometry(groups, [0, 0])
    expect(groups[0].bounds).toEqual([0, 0, 22, 22])
    expect(output.topTriangleGroups.length).toBeGreaterThan(2)
  })
})
