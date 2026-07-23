import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mapSearchSchema, parcelManifestSchema } from '../../src/map/validation'

describe('shareable URL state', () => {
  it('parses supported modes and parcel disambiguation', () => {
    expect(
      mapSearchSchema.parse({
        mode: 'zoning',
        parcel: '09306411300',
        parId: '1234',
        floor: '8',
      }),
    ).toEqual({
      mode: 'zoning',
      parcel: '09306411300',
      parId: 1234,
      floor: '8',
    })
  })

  it('falls back safely from invalid mode and identifiers', () => {
    expect(mapSearchSchema.parse({ mode: 'traffic', parId: 'nope' })).toEqual({
      mode: 'overview',
      parId: undefined,
    })
    expect(
      mapSearchSchema.parse({
        mode: 'value',
        parcel: '',
        parId: '-1',
        floor: 'x'.repeat(33),
      }),
    ).toEqual({
      mode: 'value',
      parcel: undefined,
      parId: undefined,
      floor: undefined,
    })
  })
})

describe('packaged May 12 parcel snapshot', () => {
  const raw = JSON.parse(
    readFileSync(resolve('public/data/parcels/manifest.json'), 'utf8'),
  )
  const manifest = parcelManifestSchema.parse(raw)

  it('keeps all source records addressable under the versioned manifest', () => {
    expect(manifest.source.date).toBe('2026-05-12')
    expect(manifest.source.recordCount).toBe(286_458)
    expect(manifest.validation.deduplicatedRecordCount).toBe(286_458)
    expect(manifest.validation.shardRecordReferences).toBeGreaterThan(286_458)
    expect(manifest.overviewUrl).toContain('/2026-05-12/')
    expect(manifest.shards.length).toBeGreaterThan(500)
  })

  it('keeps every leaf shard below configured feature and byte limits', () => {
    expect(
      Math.max(...manifest.shards.map(({ featureCount }) => featureCount)),
    ).toBeLessThanOrEqual(5_000)
    expect(
      Math.max(...manifest.shards.map(({ byteLength }) => byteLength)),
    ).toBeLessThanOrEqual(4 * 1024 * 1024)
  })

  it('aligns transformed bounds with the Davidson County Metro extent', () => {
    const [minX, minY, maxX, maxY] = manifest.projection.bounds
    expect(minX).toBeGreaterThan(-9_700_000)
    expect(maxX).toBeLessThan(-9_600_000)
    expect(minY).toBeGreaterThan(4_290_000)
    expect(maxY).toBeLessThan(4_360_000)
    expect(maxX - minX).toBeGreaterThan(50_000)
    expect(maxY - minY).toBeGreaterThan(50_000)
  })

  it('records missing optional civic fields without failing the build', () => {
    expect(manifest.statistics.missingAddress).toBeGreaterThan(0)
    expect(manifest.statistics.missingLandUse).toBeGreaterThan(0)
    expect(manifest.statistics.missingZoning).toBeGreaterThan(0)
    expect(manifest.validation.simplifiedCoordinateCount).toBe(0)
    expect(manifest.validation.projectedCoordinateCount).toBe(
      manifest.validation.sourceCoordinateCount +
        manifest.validation.repairedRings,
    )
    expect(manifest.validation.warnings).toEqual([])
  })
})
