import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  highestRecordedFloor,
  MAPPED_LAND_USE_CODES,
  MAXIMUM_MASSING_HEIGHT,
  parcelMassing,
  PARCEL_SLAB_HEIGHT,
} from '../../src/map/parcel-massing'
import type { ParcelRecord } from '../../src/map/types'

function parcel(overrides: Partial<ParcelRecord> = {}): ParcelRecord {
  return {
    rid: 1,
    stanpar: '001',
    parId: 1,
    featureType: 'Lot',
    floor: '',
    address: '100 TEST ST',
    acres: 0.25,
    landUseCode: '011',
    landUse: 'SINGLE FAMILY',
    zoning: 'R6',
    landAppraisal: 100_000,
    improvementAppraisal: 100_000,
    totalAppraisal: 200_000,
    ...overrides,
  }
}

describe('parcel massing classification', () => {
  it('covers every land-use code in the packaged snapshot', () => {
    const manifest = JSON.parse(
      readFileSync(
        new URL('../../public/data/parcels/manifest.json', import.meta.url),
        'utf8',
      ),
    ) as { statistics: { landUse: { key: string }[] } }
    const currentCodes = manifest.statistics.landUse
      .map(({ key }) => key)
      .filter((key) => key !== 'unknown')
      .sort()

    expect([...MAPPED_LAND_USE_CODES].sort()).toEqual(currentCodes)
  })

  it.each([
    ['010', 'none', PARCEL_SLAB_HEIGHT, 0],
    ['011', 'residential', 5, 0.44],
    ['015', 'condominium', 10, 0.56],
    ['032', 'commercial', 9, 0.62],
    ['064', 'industrial', 8, 0.74],
    ['093', 'civic', 12, 0.66],
    ['069', 'event', 18, 0.82],
    ['033', 'tower', 36, 0.34],
    ['055', 'utility', 45, 0.16],
  ])(
    'maps code %s to %s massing',
    (landUseCode, kind, minimumHeight, footprintScale) => {
      const massing = parcelMassing([
        parcel({ landUseCode, improvementAppraisal: 0 }),
      ])
      expect(massing).toMatchObject({
        kind,
        height: minimumHeight,
        footprintScale,
      })
    },
  )

  it.each([128_247, 129_537, 402_333])(
    'uses the venue override for parcel %s',
    (parId) => {
      expect(
        parcelMassing([
          parcel({
            parId,
            landUseCode: '001',
            improvementAppraisal: 0,
          }),
        ]),
      ).toMatchObject({ kind: 'event', height: 18 })
    },
  )

  it.each(['054', '056', '069', '098'])(
    'uses event massing for explicit venue code %s',
    (landUseCode) => {
      expect(
        parcelMassing([parcel({ landUseCode, improvementAppraisal: 0 })]).kind,
      ).toBe('event')
    },
  )

  it('leaves ordinary parks flat', () => {
    expect(
      parcelMassing([
        parcel({
          parId: 99,
          landUseCode: '001',
          improvementAppraisal: 0,
        }),
      ]),
    ).toMatchObject({ kind: 'none', height: PARCEL_SLAB_HEIGHT })
  })

  it('uses the highest valid multistory floor and caps tall towers', () => {
    const records = [
      parcel({ featureType: 'Lot', floor: '60' }),
      parcel({ rid: 2, featureType: 'Multistory Cond', floor: '-1' }),
      parcel({ rid: 3, featureType: 'Multistory Cond', floor: '0' }),
      parcel({ rid: 4, featureType: 'Multistory Cond', floor: '3.5' }),
      parcel({ rid: 5, featureType: 'Multistory Cond', floor: '7' }),
      parcel({ rid: 6, featureType: 'Multistory Cond', floor: '60' }),
      parcel({ rid: 7, featureType: 'Multistory Cond', floor: '40' }),
    ]
    expect(highestRecordedFloor(records)).toBe(60)
    expect(parcelMassing(records)).toMatchObject({
      kind: 'tower',
      height: MAXIMUM_MASSING_HEIGHT,
    })
  })

  it('elevates condos above houses and uses floor data below tower range', () => {
    const house = parcelMassing([
      parcel({ landUseCode: '011', improvementAppraisal: Number.MAX_VALUE }),
    ])
    const condo = parcelMassing([
      parcel({
        landUseCode: '015',
        featureType: 'Multistory Cond',
        floor: '7',
      }),
    ])
    expect(house.height).toBe(9)
    expect(condo.kind).toBe('condominium')
    expect(condo.height).toBeCloseTo(13.45)
    expect(condo.height).toBeGreaterThan(house.height)
  })

  it('lets multistory metadata recover unbuilt or missing land use', () => {
    expect(
      parcelMassing([
        parcel({
          landUseCode: '010',
          featureType: 'Multistory Cond',
          floor: '2',
        }),
      ]),
    ).toMatchObject({ kind: 'condominium', height: 10 })
    expect(
      parcelMassing([
        parcel({
          landUseCode: '',
          featureType: 'Multistory Comm',
          floor: '5',
        }),
      ]),
    ).toMatchObject({ kind: 'condominium', height: 10.75 })
  })

  it('prioritizes distinctive uses and provides safe unknown fallbacks', () => {
    expect(
      parcelMassing([
        parcel({ landUseCode: '011' }),
        parcel({ rid: 2, landUseCode: '069' }),
      ]).kind,
    ).toBe('event')
    expect(
      parcelMassing([parcel({ landUseCode: 'NEW', improvementAppraisal: 1 })])
        .kind,
    ).toBe('generic')
    expect(
      parcelMassing([parcel({ landUseCode: 'NEW', improvementAppraisal: 0 })])
        .kind,
    ).toBe('none')
    expect(
      parcelMassing([
        parcel({
          landUseCode: '032',
          improvementAppraisal: Number.NaN,
        }),
      ]),
    ).toMatchObject({ kind: 'commercial', height: 9 })
  })
})
