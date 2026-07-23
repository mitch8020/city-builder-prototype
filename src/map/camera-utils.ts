import type { MapMode } from './types'

export const CAMERA_LIMITS = {
  minimumDistance: 320,
  minimumTiltRadians: (24 * Math.PI) / 180,
  maximumTiltRadians: (72 * Math.PI) / 180,
  countyPadding: 3_000,
} as const

export type KeyboardShortcut =
  { type: 'home' } | { type: 'escape' } | { type: 'mode'; mode: MapMode }

export function keyboardShortcutForKey(
  value: string,
): KeyboardShortcut | undefined {
  const key = value.toLowerCase()
  if (key === 'backspace') return { type: 'home' }
  if (key === 'escape') return { type: 'escape' }
  const modeKeys: Partial<Record<string, MapMode>> = {
    '1': 'overview',
    '2': 'landUse',
    '3': 'zoning',
    '4': 'value',
  }
  const mode = modeKeys[key]
  return mode ? { type: 'mode', mode } : undefined
}

export function clampCameraTarget(
  x: number,
  z: number,
  countyBounds: [number, number, number, number],
  origin: [number, number],
  padding: number = CAMERA_LIMITS.countyPadding,
) {
  const minX = countyBounds[0] - origin[0] - padding
  const maxX = countyBounds[2] - origin[0] + padding
  const minZ = -(countyBounds[3] - origin[1]) - padding
  const maxZ = -(countyBounds[1] - origin[1]) + padding

  return {
    x: Math.min(maxX, Math.max(minX, x)),
    z: Math.min(maxZ, Math.max(minZ, z)),
  }
}
