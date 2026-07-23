import * as THREE from 'three'
import { METRO_BASEMAP } from './constants'

const WORLD_HALF = 20_037_508.342789244
const WORLD_SIZE = WORLD_HALF * 2

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

export function zoomForResolution(metersPerPixel: number) {
  return Math.log2(156_543.03392804097 / Math.max(metersPerPixel, 0.01))
}

interface CachedTile {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  texture: THREE.Texture
  lastUsed: number
}

export class MetroTileManager {
  readonly group = new THREE.Group()
  private readonly loader = new THREE.TextureLoader()
  private readonly cache = new Map<string, CachedTile>()
  private readonly failed = new Set<string>()
  private wanted = new Set<string>()
  private requestGeneration = 0

  constructor(
    private readonly origin: [number, number],
    private readonly onAvailability: (available: boolean) => void,
  ) {
    this.group.name = 'Metro muted basemap'
    this.loader.setCrossOrigin('anonymous')
  }

  update(bounds: [number, number, number, number], metersPerPixel: number) {
    const zoom = Math.max(
      8,
      Math.min(18, Math.round(zoomForResolution(metersPerPixel))),
    )
    const northwest = mercatorTileCoordinate(bounds[0], bounds[3], zoom)
    const southeast = mercatorTileCoordinate(bounds[2], bounds[1], zoom)
    const candidates: Array<{ x: number; y: number; key: string }> = []

    for (let x = northwest.x; x <= southeast.x; x += 1) {
      for (let y = northwest.y; y <= southeast.y; y += 1) {
        candidates.push({ x, y, key: `${zoom}/${x}/${y}` })
      }
    }

    const centerX = (northwest.x + southeast.x) / 2
    const centerY = (northwest.y + southeast.y) / 2
    candidates.sort(
      (a, b) =>
        Math.hypot(a.x - centerX, a.y - centerY) -
        Math.hypot(b.x - centerX, b.y - centerY),
    )
    const limited = candidates.slice(0, 36)
    this.wanted = new Set(limited.map((tile) => tile.key))
    this.requestGeneration += 1
    const generation = this.requestGeneration

    for (const [key, cached] of this.cache) {
      cached.mesh.visible = this.wanted.has(key)
      if (cached.mesh.visible) cached.lastUsed = performance.now()
    }

    for (const tile of limited) {
      if (this.cache.has(tile.key) || this.failed.has(tile.key)) continue
      void this.loadTile(tile.x, tile.y, zoom, tile.key, generation)
    }
    this.trim()
  }

  private async loadTile(
    x: number,
    y: number,
    zoom: number,
    key: string,
    generation: number,
  ) {
    try {
      const bounds = mercatorTileBounds(x, y, zoom)
      const parameters = new URLSearchParams({
        bbox: bounds.join(','),
        bboxSR: '3857',
        imageSR: '3857',
        size: '256,256',
        format: 'png32',
        transparent: 'true',
        f: 'image',
      })
      const texture = await this.loader.loadAsync(
        `${METRO_BASEMAP}/export?${parameters}`,
      )
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
      mesh.visible = this.wanted.has(key)
      this.group.add(mesh)
      this.cache.set(key, { mesh, texture, lastUsed: performance.now() })
      if (generation === this.requestGeneration) this.onAvailability(true)
      this.trim()
    } catch {
      this.failed.add(key)
      if (generation === this.requestGeneration) this.onAvailability(false)
    }
  }

  private trim() {
    if (this.cache.size <= 96) return
    const sorted = [...this.cache.entries()].sort(
      (a, b) => a[1].lastUsed - b[1].lastUsed,
    )
    for (const [key, cached] of sorted.slice(0, this.cache.size - 96)) {
      this.group.remove(cached.mesh)
      cached.mesh.geometry.dispose()
      cached.mesh.material.dispose()
      cached.texture.dispose()
      this.cache.delete(key)
    }
  }

  dispose() {
    for (const cached of this.cache.values()) {
      cached.mesh.geometry.dispose()
      cached.mesh.material.dispose()
      cached.texture.dispose()
    }
    this.cache.clear()
    this.failed.clear()
    this.group.clear()
  }
}
