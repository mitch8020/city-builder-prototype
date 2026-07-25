const WORLD_HALF = 20_037_508.342789244
const WORLD_SIZE = WORLD_HALF * 2
const EARTH_RADIUS = WORLD_HALF / Math.PI

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
  const constrainedY = Math.max(-WORLD_HALF, Math.min(WORLD_HALF, y))
  return [
    (x / WORLD_HALF) * 180,
    (Math.atan(Math.sinh(constrainedY / EARTH_RADIUS)) * 180) / Math.PI,
  ] as const
}

export function zoomForResolution(metersPerPixel: number) {
  return Math.log2(156_543.03392804097 / Math.max(metersPerPixel, 0.01))
}
