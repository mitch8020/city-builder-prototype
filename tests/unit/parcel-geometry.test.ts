import { describe, expect, it } from 'vitest'
import {
  buildParcelGeometry,
  groupParcelFeatures,
  groupsOwnedByBounds,
} from '../../src/map/parcel-geometry'
import { PARCEL_SLAB_HEIGHT } from '../../src/map/parcel-massing'
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

function rectangularFeature(
  properties: ParcelRecord,
  width = 20,
  depth = 16,
): ParcelFeature {
  return {
    type: 'Feature',
    properties,
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [width, 0],
          [width, depth],
          [0, depth],
          [0, 0],
        ],
      ],
    },
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

  it('assigns a cross-cell parcel to one canonical rendering cell', () => {
    const groups = groupParcelFeatures([
      {
        type: 'Feature',
        properties: parcel(1, '1'),
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [8, 2],
              [12, 2],
              [12, 8],
              [8, 8],
              [8, 2],
            ],
          ],
        },
      },
    ])

    expect(groupsOwnedByBounds(groups, [0, 0, 10, 10], [0, 0, 20, 10])).toEqual(
      [],
    )
    expect(
      groupsOwnedByBounds(groups, [10, 0, 20, 10], [0, 0, 20, 10]),
    ).toMatchObject([{ id: 0, records: [{ rid: 1 }] }])

    const atCountyMaximum = {
      ...groups[0],
      center: [20, 10] as [number, number],
    }
    expect(
      groupsOwnedByBounds(
        [
          { ...groups[0], center: [-1, 5] },
          { ...groups[0], center: [5, -1] },
          { ...groups[0], center: [21, 5] },
          { ...groups[0], center: [15, 11] },
          atCountyMaximum,
        ],
        [10, 0, 20, 10],
        [0, 0, 20, 10],
      ),
    ).toMatchObject([{ id: 0, center: [20, 10] }])
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
    expect(output.sideNormals).toHaveLength(output.sidePositions.length)
    for (let index = 0; index < output.sideNormals.length; index += 3) {
      expect(
        Math.hypot(
          output.sideNormals[index],
          output.sideNormals[index + 1],
          output.sideNormals[index + 2],
        ),
      ).toBeCloseTo(1)
    }
  })

  it('adds fitted land-use massing to the exact selectable parcel slab', () => {
    const residential = {
      ...parcel(10, ''),
      featureType: 'Lot',
      landUseCode: '011',
      landUse: 'SINGLE FAMILY',
      improvementAppraisal: 0,
    }
    const [group] = groupParcelFeatures([
      rectangularFeature(residential, 20, 16),
    ])

    expect(group.massing.kind).toBe('residential')
    expect(group.massing.footprint).toHaveLength(4)
    expect(group.height).toBe(5)

    const output = buildParcelGeometry([group], [0, 0])
    const topHeights = [
      ...new Set(
        Array.from(output.topPositions).filter((_, index) => index % 3 === 1),
      ),
    ]
    expect(topHeights).toHaveLength(2)
    expect(topHeights[0]).toBeCloseTo(PARCEL_SLAB_HEIGHT)
    expect(topHeights[1]).toBeCloseTo(group.height)
    expect(output.topIndices).toHaveLength(12)
    expect(output.parcelTopIndexCount).toBe(6)
    expect(output.topTriangleGroups).toEqual(
      new Uint32Array([group.id, group.id, group.id, group.id]),
    )
    expect(output.sideVertexGroups).toHaveLength(32)
    expect(output.edgeVertexGroups).toHaveLength(16)
  })

  it('uses broad event boxes and slender tower boxes', () => {
    const shape = (landUseCode: string, featureType = 'Lot', floor = '') =>
      groupParcelFeatures([
        rectangularFeature(
          {
            ...parcel(11, floor),
            featureType,
            landUseCode,
            improvementAppraisal: 0,
          },
          300,
          200,
        ),
      ])[0]
    const event = shape('069')
    const tower = shape('015', 'Multistory Cond', '60')
    const eventFootprint = event.massing.footprint!
    const towerFootprint = tower.massing.footprint!
    const footprintArea = (footprint: [number, number][]) =>
      Math.abs(
        footprint.reduce((area, point, index) => {
          const next = footprint[(index + 1) % footprint.length]
          return area + point[0] * next[1] - next[0] * point[1]
        }, 0) / 2,
      )

    expect(event.massing.kind).toBe('event')
    expect(event.height).toBe(18)
    expect(tower.massing.kind).toBe('tower')
    expect(tower.height).toBe(84)
    expect(footprintArea(eventFootprint)).toBeGreaterThan(
      footprintArea(towerFootprint),
    )
  })

  it('shrinks massing away from polygon holes and narrow concavities', () => {
    const properties = {
      ...parcel(30, ''),
      featureType: 'Lot',
      landUseCode: '064',
      improvementAppraisal: 0,
    }
    const feature = (coordinates: number[][][]): ParcelFeature => ({
      type: 'Feature',
      properties,
      geometry: { type: 'Polygon', coordinates },
    })
    const outer = [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
      [0, 0],
    ]
    const hole = [
      [30, 30],
      [34, 30],
      [34, 34],
      [30, 34],
      [30, 30],
    ]
    const concave = [
      [0, 0],
      [30, 0],
      [30, 40],
      [34, 40],
      [34, 0],
      [100, 0],
      [100, 100],
      [0, 100],
      [0, 0],
    ]

    const [aroundHole] = groupParcelFeatures([feature([outer, hole])])
    const [aroundNotch] = groupParcelFeatures([feature([concave])])
    for (const group of [aroundHole, aroundNotch]) {
      expect(group.massing.kind).toBe('industrial')
      expect(group.massing.footprint).toHaveLength(4)
      expect(
        Math.min(...group.massing.footprint!.map(([x]) => x)),
      ).toBeGreaterThanOrEqual(34)
    }
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

  it('places one mass on the largest multipolygon component', () => {
    const feature = rectangularFeature({
      ...parcel(12, ''),
      featureType: 'Lot',
      landUseCode: '064',
      improvementAppraisal: 0,
    })
    feature.geometry = {
      type: 'MultiPolygon',
      coordinates: [
        [
          [
            [0, 0],
            [4, 0],
            [4, 4],
            [0, 4],
            [0, 0],
          ],
        ],
        [
          [
            [20, 20],
            [60, 20],
            [60, 50],
            [20, 50],
            [20, 20],
          ],
        ],
      ],
    }
    const [group] = groupParcelFeatures([feature])

    expect(group.massing.kind).toBe('industrial')
    expect(
      group.massing.footprint!.every(
        ([x, y]) => x >= 20 && x <= 60 && y >= 20 && y <= 50,
      ),
    ).toBe(true)
  })

  it('accepts open and degenerate rings without inventing vertices', () => {
    const open: ParcelFeature = {
      type: 'Feature',
      properties: parcel(4, ''),
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [2, 0],
            [0, 2],
          ],
        ],
      },
    }
    const degenerate: ParcelFeature = {
      type: 'Feature',
      properties: parcel(5, ''),
      geometry: {
        type: 'Polygon',
        coordinates: [[[5, 5]]],
      },
    }

    const output = buildParcelGeometry(
      groupParcelFeatures([open, degenerate]),
      [0, 0],
    )
    expect(output.topPositions.length).toBe(12)
    expect(output.topIndices.length).toBe(3)
    expect(output.groups[1]).toMatchObject({
      height: PARCEL_SLAB_HEIGHT,
      massing: { kind: 'none' },
    })
  })

  it('falls back to a slab for empty geometry', () => {
    const empty: ParcelFeature = {
      type: 'Feature',
      properties: parcel(6, ''),
      geometry: { type: 'MultiPolygon', coordinates: [] },
    }
    const [group] = groupParcelFeatures([empty])
    const output = buildParcelGeometry([group], [0, 0])

    expect(group).toMatchObject({
      height: PARCEL_SLAB_HEIGHT,
      massing: { kind: 'none' },
    })
    expect(output.topPositions).toHaveLength(0)
  })

  it('skips massing for slab-only uses and collinear footprints', () => {
    const slabOnly = rectangularFeature({
      ...parcel(20, ''),
      featureType: 'Lot',
      landUseCode: '010',
      improvementAppraisal: 0,
    })
    const collinear: ParcelFeature = {
      type: 'Feature',
      properties: {
        ...parcel(21, ''),
        featureType: 'Lot',
        landUseCode: '064',
        improvementAppraisal: 0,
      },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [5, 0],
            [10, 0],
            [0, 0],
          ],
        ],
      },
    }

    expect(groupParcelFeatures([slabOnly, collinear])).toMatchObject([
      { height: PARCEL_SLAB_HEIGHT, massing: { kind: 'none' } },
      { height: PARCEL_SLAB_HEIGHT, massing: { kind: 'none' } },
    ])
  })

  it('abandons massing that cannot fit after every shrink attempt', () => {
    const narrowL: ParcelFeature = {
      type: 'Feature',
      properties: {
        ...parcel(7, ''),
        featureType: 'Lot',
        landUseCode: '064',
        improvementAppraisal: 0,
      },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [100, 0],
            [100, 1],
            [1, 1],
            [1, 100],
            [0, 100],
            [0, 0],
          ],
        ],
      },
    }
    const [group] = groupParcelFeatures([narrowL])

    expect(group).toMatchObject({
      height: PARCEL_SLAB_HEIGHT,
      massing: { kind: 'none' },
    })
  })
})
