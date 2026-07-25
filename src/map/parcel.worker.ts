/// <reference lib="webworker" />

import { geojson as flatgeobuf } from 'flatgeobuf'
import {
  buildParcelGeometry,
  groupParcelFeatures,
  groupsOwnedByBounds,
} from './parcel-geometry'
import type {
  ParcelFeature,
  ParcelWorkerRequest,
  ParcelWorkerResponse,
} from './types'

let activeController: AbortController | null = null
let activeGeneration = 0

async function fetchFeatures(url: string, signal: AbortSignal) {
  const byRid = new Map<number, ParcelFeature>()

  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`${url} returned ${response.status}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  for await (const feature of flatgeobuf.deserialize(bytes)) {
    const parcel = feature as ParcelFeature
    byRid.set(Number(parcel.properties.rid), parcel)
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
    const features = await fetchFeatures(
      request.shard.url,
      activeController.signal,
    )
    if (request.generation !== activeGeneration) return
    const groups = groupsOwnedByBounds(
      groupParcelFeatures(features),
      request.shard.bounds,
      request.countyBounds,
    )
    self.postMessage({
      type: 'progress',
      generation: request.generation,
      shardId: request.shard.id,
      message: `Generating ${groups.length.toLocaleString()} parcel footprints`,
    } satisfies ParcelWorkerResponse)
    const geometry = buildParcelGeometry(groups, request.origin)
    const response: ParcelWorkerResponse = {
      type: 'loaded',
      generation: request.generation,
      shardId: request.shard.id,
      logicalRecordCount: groups.reduce(
        (total, group) => total + group.records.length,
        0,
      ),
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
        geometry.sideNormals.buffer,
        geometry.edgePositions.buffer,
        geometry.edgeVertexGroups.buffer,
      ],
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return
    const response: ParcelWorkerResponse = {
      type: 'error',
      generation: request.generation,
      shardId: request.shard.id,
      message: error instanceof Error ? error.message : 'Parcel loading failed',
    }
    self.postMessage(response)
  }
}

export {}
