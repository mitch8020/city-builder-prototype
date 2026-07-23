/// <reference lib="webworker" />

import { geojson as flatgeobuf } from 'flatgeobuf'
import { buildParcelGeometry, groupParcelFeatures } from './parcel-geometry'
import type {
  ParcelFeature,
  ParcelWorkerRequest,
  ParcelWorkerResponse,
} from './types'

let activeController: AbortController | null = null
let activeGeneration = 0

async function fetchFeatures(urls: string[], signal: AbortSignal) {
  const byRid = new Map<number, ParcelFeature>()
  let loaded = 0

  for (const url of urls) {
    const response = await fetch(url, { signal })
    if (!response.ok) throw new Error(`${url} returned ${response.status}`)
    const bytes = new Uint8Array(await response.arrayBuffer())
    for await (const feature of flatgeobuf.deserialize(bytes)) {
      const parcel = feature as ParcelFeature
      byRid.set(Number(parcel.properties.rid), parcel)
    }
    loaded += 1
    self.postMessage({
      type: 'progress',
      generation: activeGeneration,
      message: `Reading parcel cell ${loaded} of ${urls.length}`,
      loaded,
      total: urls.length,
    } satisfies ParcelWorkerResponse)
  }

  return [...byRid.values()]
}

self.onmessage = async (event: MessageEvent<ParcelWorkerRequest>) => {
  const request = event.data
  if (request.type === 'cancel') {
    if (request.generation >= activeGeneration) activeController?.abort()
    return
  }

  activeController?.abort()
  activeController = new AbortController()
  activeGeneration = request.generation

  try {
    const features = await fetchFeatures(request.urls, activeController.signal)
    if (request.generation !== activeGeneration) return
    const groups = groupParcelFeatures(features)
    self.postMessage({
      type: 'progress',
      generation: request.generation,
      message: `Drawing ${groups.length.toLocaleString()} parcel footprints`,
      loaded: request.urls.length,
      total: request.urls.length,
    } satisfies ParcelWorkerResponse)
    const geometry = buildParcelGeometry(groups, request.origin)
    const response: ParcelWorkerResponse = {
      type: 'loaded',
      generation: request.generation,
      logicalRecordCount: features.length,
      ...geometry,
    }
    self.postMessage(response, {
      transfer: [
        geometry.topPositions.buffer,
        geometry.topIndices.buffer,
        geometry.topVertexGroups.buffer,
        geometry.topTriangleGroups.buffer,
        geometry.sidePositions.buffer,
        geometry.sideIndices.buffer,
        geometry.sideVertexGroups.buffer,
        geometry.edgePositions.buffer,
      ],
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return
    const response: ParcelWorkerResponse = {
      type: 'error',
      generation: request.generation,
      message: error instanceof Error ? error.message : 'Parcel loading failed',
    }
    self.postMessage(response)
  }
}

export {}
