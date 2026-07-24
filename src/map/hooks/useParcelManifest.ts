import { useEffect, useState } from 'react'
import type { ParcelManifestV1 } from '../types'
import { parcelManifestSchema } from '../validation'

const EXPECTED_RECORD_COUNT = 286_458

interface LoadParcelManifestOptions {
  signal?: AbortSignal
  fetcher?: typeof fetch
}

export async function loadParcelManifest({
  signal,
  fetcher = fetch,
}: LoadParcelManifestOptions = {}) {
  const response = await fetcher('/data/parcels/manifest.json', { signal })
  if (!response.ok) throw new Error(`Manifest returned ${response.status}`)

  const manifest = parcelManifestSchema.parse(await response.json())
  if (manifest.source.recordCount !== EXPECTED_RECORD_COUNT) {
    throw new Error('The parcel manifest failed validation')
  }
  return manifest
}

export function useParcelManifest() {
  const [manifest, setManifest] = useState<ParcelManifestV1>()
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    loadParcelManifest({ signal: controller.signal })
      .then(setManifest)
      .catch((loadError: unknown) => {
        if (
          loadError instanceof DOMException &&
          loadError.name === 'AbortError'
        ) {
          return
        }
        setError('The packaged parcel snapshot is unavailable or invalid.')
      })
    return () => controller.abort()
  }, [])

  return { manifest, error }
}
