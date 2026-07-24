import { describe, expect, it } from 'vitest'
import {
  bestParcelMatch,
  colorForRecord,
  displayValue,
  formatAcres,
  formatCurrency,
  groupPrimaryRecord,
  intersectsBounds,
  legendForMode,
  normalizeAddressRoot,
  parcelHeight,
  pointInGroup,
  shardsForBounds,
  tooltipDetail,
} from '../../src/map/map-utils'
import type {
  ParcelGroup,
  ParcelManifestV1,
  ParcelRecord,
} from '../../src/map/types'

const record: ParcelRecord = {
  rid: 1,
  stanpar: '00100000100',
  parId: 10,
  featureType: 'Parcel',
  floor: '',
  address: '',
  acres: -1,
  landUseCode: 'RES',
  landUse: 'Residential',
  zoning: 'R6',
  landAppraisal: 100_000,
  improvementAppraisal: 200_000,
  totalAppraisal: 300_000,
}

const manifest = {
  statistics: {
    appraisalQuantiles: [100_000, 250_000, 500_000, 1_000_000],
    landUse: [{ key: 'RES', label: 'Residential', count: 1 }],
    zoning: [{ key: 'R6', label: 'R6', count: 1 }],
  },
} as ParcelManifestV1

describe('map presentation helpers', () => {
  it('uses stable mode colors and legends', () => {
    expect(colorForRecord(record, 'value', manifest)).toMatch(/^#[0-9a-f]{6}$/)
    expect(colorForRecord(record, 'landUse', manifest)).toBe(
      colorForRecord(record, 'landUse', manifest),
    )
    expect(legendForMode('overview', manifest)).toHaveLength(3)
    expect(legendForMode('value', manifest)).toHaveLength(5)
    expect(legendForMode('zoning', manifest)[0].label).toBe('R6')
    expect(legendForMode('landUse', manifest)[0].label).toBe('Residential')

    expect(
      colorForRecord({ ...record, landUseCode: '' }, 'landUse', manifest),
    ).toBe('#b6c1bc')
    expect(colorForRecord({ ...record, zoning: '' }, 'zoning', manifest)).toBe(
      '#b6c1bc',
    )
    expect(colorForRecord(record, 'zoning', manifest)).toMatch(/^#[0-9a-f]{6}$/)
    expect(
      colorForRecord({ ...record, totalAppraisal: -1 }, 'value', manifest),
    ).toBe('#b6c1bc')
    expect(
      colorForRecord(
        { ...record, totalAppraisal: 2_000_000 },
        'value',
        manifest,
      ),
    ).toMatch(/^#[0-9a-f]{6}$/)
    expect(
      colorForRecord(
        { ...record, featureType: 'Open space' },
        'overview',
        manifest,
      ),
    ).not.toBe('#d9d4c8')
    expect(
      colorForRecord(
        { ...record, featureType: 'Common area' },
        'overview',
        manifest,
      ),
    ).toBe('#9fb6a2')
    expect(
      colorForRecord(
        { ...record, featureType: 'Condominium' },
        'overview',
        manifest,
      ),
    ).toBe('#b8c9cc')
    expect(colorForRecord(record, 'overview', manifest)).toBe('#d9d4c8')
  })

  it('formats unavailable and present parcel values', () => {
    expect(formatCurrency(-1)).toBe('Not available')
    expect(formatCurrency(300_000)).toBe('$300,000')
    expect(formatAcres(-1)).toBe('Not available')
    expect(formatAcres(0.25)).toBe('0.25 ac')
    expect(formatAcres(12.34)).toBe('12.3 ac')
    expect(displayValue('')).toBe('Not available')
    expect(displayValue(1_000)).toBe('1,000')
    expect(displayValue(Number.NaN)).toBe('Not available')
    expect(tooltipDetail(record, 'landUse')).toBe('Land use: Residential')
    expect(tooltipDetail(record, 'zoning')).toBe('Zoning: R6')
    expect(tooltipDetail(record, 'value')).toBe('Appraised value: $300,000')
    expect(tooltipDetail(record, 'overview')).toBe('Parcel · Not available')
    expect(parcelHeight({ ...record, improvementAppraisal: 0 })).toBe(1.1)
    expect(parcelHeight(record)).toBeGreaterThan(1.5)
    expect(
      parcelHeight({ ...record, improvementAppraisal: Number.MAX_VALUE }),
    ).toBe(8.5)
  })

  it('finds visible shards by bounding box', () => {
    const shards = [
      { id: 'a', bounds: [0, 0, 10, 10] },
      { id: 'b', bounds: [20, 20, 30, 30] },
    ] as ParcelManifestV1['shards']
    expect(shardsForBounds(shards, [5, 5, 15, 15]).map(({ id }) => id)).toEqual(
      ['a'],
    )

    expect(intersectsBounds([0, 0, 2, 2], [1, 1, 3, 3])).toBe(true)
    expect(intersectsBounds([0, 0, 2, 2], [3, 0, 4, 1])).toBe(false)
    expect(intersectsBounds([3, 0, 4, 1], [0, 0, 2, 2])).toBe(false)
    expect(intersectsBounds([0, 0, 2, 2], [0, 3, 1, 4])).toBe(false)
    expect(intersectsBounds([0, 3, 1, 4], [0, 0, 2, 2])).toBe(false)
  })

  it('respects polygon holes while locating search results', () => {
    const group = {
      bounds: [0, 0, 10, 10],
      geometry: {
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
            [4, 4],
            [6, 4],
            [6, 6],
            [4, 6],
            [4, 4],
          ],
        ],
      },
    } as ParcelGroup
    expect(pointInGroup([2, 2], group)).toBe(true)
    expect(pointInGroup([5, 5], group)).toBe(false)
    expect(pointInGroup([12, 2], group)).toBe(false)

    const multi = {
      ...group,
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          group.geometry.coordinates,
          [
            [
              [20, 20],
              [30, 20],
              [30, 30],
              [20, 30],
              [20, 20],
            ],
          ],
        ],
      },
      bounds: [0, 0, 30, 30],
    } as ParcelGroup
    expect(pointInGroup([25, 25], multi)).toBe(true)
    expect(pointInGroup([15, 15], multi)).toBe(false)
  })

  it('uses official search metadata to resolve overlapping condo parcels', () => {
    const geometry = {
      type: 'Polygon' as const,
      coordinates: [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0],
        ],
      ],
    }
    const base = {
      bounds: [0, 0, 10, 10],
      geometry,
      records: [{ ...record, rid: 2, parId: 20, address: '0 COMMERCE ST' }],
    } as ParcelGroup
    const condo = {
      bounds: [0, 0, 10, 10],
      geometry,
      records: [
        {
          ...record,
          rid: 3,
          parId: 479400,
          stanpar: '093054I30600CO',
          address: '930 COMMERCE ST #3304',
        },
      ],
    } as ParcelGroup

    expect(
      bestParcelMatch([base, condo], {
        address: '930 Commerce St, 37203',
      })?.group,
    ).toBe(condo)
    expect(bestParcelMatch([base, condo], { parId: 479400 })?.rid).toBe(3)
    expect(
      bestParcelMatch([base, condo], { parcel: '093054I30600CO' })?.rid,
    ).toBe(3)
    expect(bestParcelMatch([base, condo])?.rid).toBe(2)
    expect(bestParcelMatch([])).toBeUndefined()
    expect(groupPrimaryRecord(condo, 3).rid).toBe(3)
    expect(groupPrimaryRecord(condo, 999).rid).toBe(3)
    expect(normalizeAddressRoot()).toBe('')
    expect(normalizeAddressRoot('930 Commerce St Unit 4, 37203')).toBe(
      '930 COMMERCE ST',
    )
  })
})
