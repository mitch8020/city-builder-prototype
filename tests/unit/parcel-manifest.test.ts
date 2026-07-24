import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { loadParcelManifest } from '../../src/map/hooks/useParcelManifest'

const packagedManifest = JSON.parse(
  readFileSync(resolve('public/data/parcels/manifest.json'), 'utf8'),
)

function manifestResponse(manifest: unknown) {
  return new Response(JSON.stringify(manifest), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('loadParcelManifest', () => {
  it('loads and validates the packaged parcel contract', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(manifestResponse(packagedManifest))

    const manifest = await loadParcelManifest({ fetcher })

    expect(fetcher).toHaveBeenCalledWith(
      '/data/parcels/manifest.json',
      expect.objectContaining({ signal: undefined }),
    )
    expect(manifest.source.recordCount).toBe(286_458)
  })

  it('rejects a structurally valid snapshot with the wrong source count', async () => {
    const invalidManifest = {
      ...packagedManifest,
      source: { ...packagedManifest.source, recordCount: 1 },
    }
    const fetcher = vi.fn().mockResolvedValue(manifestResponse(invalidManifest))

    await expect(loadParcelManifest({ fetcher })).rejects.toThrow(
      'The parcel manifest failed validation',
    )
  })
})
