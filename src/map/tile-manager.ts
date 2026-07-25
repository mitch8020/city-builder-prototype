import * as THREE from 'three'
import { GOOGLE_MAP_SERVICE_BOUNDS } from './constants'

const WORLD_HALF = 20_037_508.342789244
const WORLD_SIZE = WORLD_HALF * 2
const EARTH_RADIUS = WORLD_HALF / Math.PI
const MAX_VISIBLE_TILES = 36
const MAX_CACHED_TILES = 96
const MAX_TILE_ATTEMPTS = 3
const ATTRIBUTION_DELAY_MS = 120

export interface GoogleBasemapState {
  available: boolean
  copyright?: string
}

interface TileCandidate {
  x: number
  y: number
  zoom: number
  key: string
}

interface CachedTile {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  texture: THREE.Texture
  lastUsed: number
}

interface TileFailure {
  attempts: number
  retryAt: number
}

export function mercatorTileCoordinate(x: number, y: number, zoom: number) {
  const scale = 2 ** zoom
  return {
    x: Math.floor(((x + WORLD_HALF) / WORLD_SIZE) * scale),
    y: Math.floor(((WORLD_HALF - y) / WORLD_SIZE) * scale),
  }
}

export function mercatorTileBounds(x: number, y: number, zoom: number) {
  const tileSize = WORLD_SIZE / 2 ** zoom
  const minX = -WORLD_HALF + x * tileSize
  const maxX = minX + tileSize
  const maxY = WORLD_HALF - y * tileSize
  const minY = maxY - tileSize
  return [minX, minY, maxX, maxY] as const
}

export function mercatorToLngLat(x: number, y: number) {
  const constrainedY = THREE.MathUtils.clamp(y, -WORLD_HALF, WORLD_HALF)
  return [
    (x / WORLD_HALF) * 180,
    (Math.atan(Math.sinh(constrainedY / EARTH_RADIUS)) * 180) / Math.PI,
  ] as const
}

export function zoomForResolution(metersPerPixel: number) {
  return Math.log2(156_543.03392804097 / Math.max(metersPerPixel, 0.01))
}

export class GoogleTileManager {
  readonly group = new THREE.Group()
  private readonly loader = new THREE.TextureLoader()
  private readonly cache = new Map<string, CachedTile>()
  private readonly failures = new Map<string, TileFailure>()
  private readonly pending = new Set<string>()
  private wanted = new Map<string, TileCandidate>()
  private requestGeneration = 0
  private attribution?: string
  private attributionTimer?: ReturnType<typeof setTimeout>
  private attributionAbort?: AbortController
  private retryTimer?: ReturnType<typeof setTimeout>
  private lastPublished?: GoogleBasemapState
  private disposed = false

  constructor(
    private readonly origin: [number, number],
    private readonly onState: (state: GoogleBasemapState) => void,
  ) {
    this.group.name = 'Google Maps roadmap'
    this.group.visible = false
    this.loader.setCrossOrigin('anonymous')
  }

  update(bounds: [number, number, number, number], metersPerPixel: number) {
    if (this.disposed) return
    const zoom = Math.max(
      8,
      Math.min(18, Math.round(zoomForResolution(metersPerPixel))),
    )
    const northwest = mercatorTileCoordinate(bounds[0], bounds[3], zoom)
    const southeast = mercatorTileCoordinate(bounds[2], bounds[1], zoom)
    const serviceNorthwest = mercatorTileCoordinate(
      GOOGLE_MAP_SERVICE_BOUNDS[0],
      GOOGLE_MAP_SERVICE_BOUNDS[3],
      zoom,
    )
    const serviceSoutheast = mercatorTileCoordinate(
      GOOGLE_MAP_SERVICE_BOUNDS[2],
      GOOGLE_MAP_SERVICE_BOUNDS[1],
      zoom,
    )
    const candidates: TileCandidate[] = []

    for (
      let x = Math.max(northwest.x, serviceNorthwest.x);
      x <= Math.min(southeast.x, serviceSoutheast.x);
      x += 1
    ) {
      for (
        let y = Math.max(northwest.y, serviceNorthwest.y);
        y <= Math.min(southeast.y, serviceSoutheast.y);
        y += 1
      ) {
        candidates.push({ x, y, zoom, key: `${zoom}/${x}/${y}` })
      }
    }

    const centerX = (northwest.x + southeast.x) / 2
    const centerY = (northwest.y + southeast.y) / 2
    candidates.sort(
      (a, b) =>
        Math.hypot(a.x - centerX, a.y - centerY) -
        Math.hypot(b.x - centerX, b.y - centerY),
    )
    const limited = candidates.slice(0, MAX_VISIBLE_TILES)
    this.wanted = new Map(limited.map((tile) => [tile.key, tile]))
    this.requestGeneration += 1
    const generation = this.requestGeneration

    for (const [key, cached] of this.cache) {
      cached.mesh.visible = this.wanted.has(key)
      if (cached.mesh.visible) cached.lastUsed = performance.now()
    }

    for (const tile of limited) this.requestTile(tile, generation)
    this.scheduleAttribution(bounds, zoom, generation)
    this.scheduleRetry()
    this.trim()
    this.publishState()
  }

  private requestTile(tile: TileCandidate, generation: number) {
    if (this.cache.has(tile.key) || this.pending.has(tile.key)) return
    const failure = this.failures.get(tile.key)
    if (
      failure &&
      (failure.attempts >= MAX_TILE_ATTEMPTS ||
        failure.retryAt > performance.now())
    ) {
      return
    }
    void this.loadTile(tile, generation)
  }

  private async loadTile(tile: TileCandidate, generation: number) {
    this.pending.add(tile.key)
    try {
      const bounds = mercatorTileBounds(tile.x, tile.y, tile.zoom)
      const texture = await this.loader.loadAsync(
        `/api/google-map/tiles/${tile.zoom}/${tile.x}/${tile.y}`,
      )
      if (this.disposed) {
        texture.dispose()
        return
      }

      texture.colorSpace = THREE.SRGBColorSpace
      texture.anisotropy = 4
      const width = bounds[2] - bounds[0]
      const height = bounds[3] - bounds[1]
      const geometry = new THREE.PlaneGeometry(width, height)
      geometry.rotateX(-Math.PI / 2)
      const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity: 0.86,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: 1,
      })
      const mesh = new THREE.Mesh(geometry, material)
      mesh.position.set(
        (bounds[0] + bounds[2]) / 2 - this.origin[0],
        0.16,
        -((bounds[1] + bounds[3]) / 2 - this.origin[1]),
      )
      mesh.renderOrder = -5
      mesh.visible = this.wanted.has(tile.key)
      this.group.add(mesh)
      this.cache.set(tile.key, {
        mesh,
        texture,
        lastUsed: performance.now(),
      })
      this.failures.delete(tile.key)
      this.trim()
    } catch {
      if (!this.disposed) {
        const attempts = (this.failures.get(tile.key)?.attempts ?? 0) + 1
        this.failures.set(tile.key, {
          attempts,
          retryAt:
            performance.now() +
            Math.min(4_000, 500 * 2 ** Math.max(0, attempts - 1)),
        })
      }
    } finally {
      this.pending.delete(tile.key)
      if (!this.disposed) {
        if (generation === this.requestGeneration) this.publishState()
        this.scheduleRetry()
      }
    }
  }

  private scheduleAttribution(
    bounds: [number, number, number, number],
    zoom: number,
    generation: number,
  ) {
    clearTimeout(this.attributionTimer)
    this.attributionAbort?.abort()
    this.attribution = undefined
    this.group.visible = false
    this.publishState()
    this.attributionTimer = setTimeout(() => {
      void this.loadAttribution(bounds, zoom, generation)
    }, ATTRIBUTION_DELAY_MS)
  }

  private async loadAttribution(
    bounds: [number, number, number, number],
    zoom: number,
    generation: number,
  ) {
    this.attributionAbort?.abort()
    const controller = new AbortController()
    this.attributionAbort = controller
    const [west, south] = mercatorToLngLat(bounds[0], bounds[1])
    const [east, north] = mercatorToLngLat(bounds[2], bounds[3])
    const parameters = new URLSearchParams({
      zoom: String(zoom),
      north: String(north),
      south: String(south),
      east: String(east),
      west: String(west),
    })

    try {
      const response = await fetch(
        `/api/google-map/attribution?${parameters}`,
        {
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        },
      )
      if (!response.ok) throw new Error('Google attribution unavailable')
      const payload = (await response.json()) as { copyright?: unknown }
      if (typeof payload.copyright !== 'string' || !payload.copyright.trim()) {
        throw new Error('Google attribution invalid')
      }
      if (generation !== this.requestGeneration || this.disposed) return
      this.attribution = payload.copyright.trim()
      this.group.visible = true
      this.publishState()
    } catch (error) {
      if (
        generation === this.requestGeneration &&
        !this.disposed &&
        !(error instanceof DOMException && error.name === 'AbortError')
      ) {
        this.attribution = undefined
        this.group.visible = false
        this.publishState()
      }
    } finally {
      if (this.attributionAbort === controller) {
        this.attributionAbort = undefined
      }
    }
  }

  private scheduleRetry() {
    clearTimeout(this.retryTimer)
    let nextRetry = Number.POSITIVE_INFINITY
    for (const [key, failure] of this.failures) {
      if (
        this.wanted.has(key) &&
        failure.attempts < MAX_TILE_ATTEMPTS &&
        !this.pending.has(key)
      ) {
        nextRetry = Math.min(nextRetry, failure.retryAt)
      }
    }
    if (!Number.isFinite(nextRetry)) return

    this.retryTimer = setTimeout(
      () => {
        if (this.disposed) return
        const generation = this.requestGeneration
        for (const tile of this.wanted.values()) {
          this.requestTile(tile, generation)
        }
        this.scheduleRetry()
      },
      Math.max(0, nextRetry - performance.now()),
    )
  }

  private publishState() {
    const hasVisibleTile =
      this.group.visible &&
      [...this.wanted.keys()].some((key) => this.cache.has(key))
    const next: GoogleBasemapState = {
      available: Boolean(this.attribution && hasVisibleTile),
      copyright:
        this.attribution && hasVisibleTile ? this.attribution : undefined,
    }
    if (
      next.available === this.lastPublished?.available &&
      next.copyright === this.lastPublished.copyright
    ) {
      return
    }
    this.lastPublished = next
    this.onState(next)
  }

  private trim() {
    if (this.cache.size <= MAX_CACHED_TILES) return
    const sorted = [...this.cache.entries()].sort(
      (a, b) => a[1].lastUsed - b[1].lastUsed,
    )
    for (const [key, cached] of sorted.slice(
      0,
      this.cache.size - MAX_CACHED_TILES,
    )) {
      this.group.remove(cached.mesh)
      cached.mesh.geometry.dispose()
      cached.mesh.material.dispose()
      cached.texture.dispose()
      this.cache.delete(key)
    }
  }

  dispose() {
    this.disposed = true
    clearTimeout(this.attributionTimer)
    clearTimeout(this.retryTimer)
    this.attributionAbort?.abort()
    for (const cached of this.cache.values()) {
      cached.mesh.geometry.dispose()
      cached.mesh.material.dispose()
      cached.texture.dispose()
    }
    this.cache.clear()
    this.failures.clear()
    this.pending.clear()
    this.wanted.clear()
    this.group.clear()
  }
}
