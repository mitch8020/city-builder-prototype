import { shardsForBounds } from './map-utils'
import type {
  ParcelManifestV1,
  ParcelWorkerRequest,
  ParcelWorkerResponse,
  WorkerLoadedResponse,
} from './types'

type MapBounds = [number, number, number, number]

export interface ParcelStreamCallbacks {
  onProgress: (message: string) => void
  onLoaded: (response: WorkerLoadedResponse) => void
  onError: (message: string) => void
}

export class ParcelStream {
  private activeShardKey = ''
  private generation = 0

  constructor(
    private readonly manifest: ParcelManifestV1,
    private readonly callbacks: ParcelStreamCallbacks,
    private readonly worker: Worker = new Worker(
      new URL('./parcel.worker.ts', import.meta.url),
      { type: 'module' },
    ),
  ) {
    this.worker.onmessage = (event: MessageEvent<ParcelWorkerResponse>) =>
      this.handleMessage(event.data)
    this.worker.onerror = () => {
      this.callbacks.onError(
        'The parcel renderer stopped. Reload the map to restore it.',
      )
    }
    this.worker.onmessageerror = () => {
      this.callbacks.onError('Parcel worker returned an unreadable response.')
    }
  }

  load(bounds: MapBounds) {
    const shards = shardsForBounds(this.manifest.shards, bounds)
    const shardKey = shards
      .map((shard) => shard.id)
      .sort()
      .join('|')
    if (!shardKey || shardKey === this.activeShardKey) return undefined

    this.activeShardKey = shardKey
    this.generation += 1
    this.post({
      type: 'load',
      generation: this.generation,
      urls: shards.map((shard) => shard.url),
      origin: this.manifest.projection.localOrigin,
    })
    return shards.length
  }

  cancel() {
    if (!this.activeShardKey) return false

    this.activeShardKey = ''
    this.generation += 1
    this.post({ type: 'cancel', generation: this.generation })
    return true
  }

  dispose() {
    this.worker.terminate()
  }

  private post(request: ParcelWorkerRequest) {
    this.worker.postMessage(request)
  }

  private handleMessage(response: ParcelWorkerResponse) {
    if (response.generation !== this.generation) return
    if (response.type === 'progress') {
      this.callbacks.onProgress(response.message)
      return
    }
    if (response.type === 'error') {
      this.activeShardKey = ''
      this.callbacks.onError(
        'Parcel data did not load. Move or zoom the map to retry.',
      )
      return
    }
    this.callbacks.onLoaded(response)
  }
}
