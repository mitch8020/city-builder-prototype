// @vitest-environment jsdom

import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CameraRig } from '../../src/map/CameraRig'

afterEach(() => {
  vi.restoreAllMocks()
})

function createRig() {
  const canvas = document.createElement('canvas')
  const onViewChange = vi.fn()
  const rig = new CameraRig(canvas, {
    width: 800,
    height: 400,
    countyBounds: [0, 0, 1_000, 500],
    localOrigin: [0, 0],
    onViewChange,
  })
  return { rig, onViewChange }
}

describe('CameraRig', () => {
  it('owns direct zoom, rotation, tilt, resize, and control changes', () => {
    const { rig, onViewChange } = createRig()
    expect(rig.target).toBe(rig.controls.target)
    expect(rig.distance).toBeGreaterThan(0)

    rig.zoomBy(0)
    expect(rig.distance).toBe(rig.controls.minDistance)
    rig.zoomBy(1_000)
    expect(rig.distance).toBe(rig.controls.maxDistance)
    rig.rotateToNorth()
    expect(rig.camera.position.x).toBeCloseTo(rig.target.x)
    rig.tiltBy(-100)
    rig.tiltBy(100)
    rig.resize(300, 200)
    expect(rig.camera.aspect).toBe(1.5)

    const before = onViewChange.mock.calls.length
    rig.controls.dispatchEvent({ type: 'change' })
    expect(onViewChange.mock.calls.length).toBeGreaterThan(before)
    rig.dispose()
  })

  it('applies keyboard, edge-pan, rotation, zoom, tilt, and clamping paths', () => {
    const { rig, onViewChange } = createRig()

    rig.setKey('w', true)
    rig.update(0.1)
    rig.setKey('w', false)
    expect(onViewChange).toHaveBeenCalled()

    for (const key of ['arrowup', 'arrowdown', 'arrowright', 'arrowleft']) {
      rig.setKey(key, true)
    }
    rig.update(0.1)
    for (const key of ['arrowup', 'arrowdown', 'arrowright', 'arrowleft']) {
      rig.setKey(key, false)
    }

    for (const key of ['w', 's', 'd', 'a']) rig.setKey(key, true)
    rig.update(0.1)
    for (const key of ['w', 's', 'd', 'a']) rig.setKey(key, false)

    rig.setEdgePan(1, -1)
    rig.update(0.1)
    rig.setEdgePan(0, 0)

    for (const key of ['q', 'e', 'z', 'x', 'home', 'end']) {
      rig.setKey(key, true)
      rig.update(0.05)
      rig.setKey(key, false)
    }

    rig.controls.target.set(100_000, 0, -100_000)
    rig.update(0)
    expect(rig.controls.target.x).toBeLessThan(100_000)
    rig.update(0)
    rig.dispose()
  })

  it('eases fly-to and home tweens through both halves to completion', () => {
    const clock = vi.spyOn(performance, 'now').mockReturnValue(0)
    const { rig, onViewChange } = createRig()
    const target = new THREE.Vector3(100, 0, -100)

    rig.flyTo(target, 500, 1_000)
    rig.setKey('w', true)
    clock.mockReturnValue(250)
    rig.update(0.1)
    expect(rig.target.x).toBeGreaterThan(0)

    clock.mockReturnValue(1_000)
    rig.update(0.1)
    expect(onViewChange).toHaveBeenCalledWith(0)
    expect((rig as unknown as { tween?: unknown }).tween).toBeUndefined()

    rig.home()
    clock.mockReturnValue(1_800)
    rig.update(0.1)
    expect(
      onViewChange.mock.calls.filter(([delay]) => delay === 0),
    ).toHaveLength(2)
    rig.setKey('w', false)
    rig.dispose()
  })
})
