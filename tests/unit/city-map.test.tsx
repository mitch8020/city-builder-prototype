// @vitest-environment jsdom

import { createRef } from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CityMap } from '../../src/map/CityMap'
import type { CityMapController, ParcelManifestV1 } from '../../src/map/types'

const sceneState = vi.hoisted<{
  error: unknown
  instances: Array<{
    callbacks: unknown
    home: ReturnType<typeof vi.fn>
    zoomBy: ReturnType<typeof vi.fn>
    rotateToNorth: ReturnType<typeof vi.fn>
    tiltBy: ReturnType<typeof vi.fn>
    flyTo: ReturnType<typeof vi.fn>
    selectAt: ReturnType<typeof vi.fn>
    dispose: ReturnType<typeof vi.fn>
    updateCallbacks: ReturnType<typeof vi.fn>
    setMode: ReturnType<typeof vi.fn>
    setSelectedRid: ReturnType<typeof vi.fn>
  }>
}>(() => ({
  error: undefined,
  instances: [] as Array<{
    callbacks: unknown
    home: ReturnType<typeof vi.fn>
    zoomBy: ReturnType<typeof vi.fn>
    rotateToNorth: ReturnType<typeof vi.fn>
    tiltBy: ReturnType<typeof vi.fn>
    flyTo: ReturnType<typeof vi.fn>
    selectAt: ReturnType<typeof vi.fn>
    dispose: ReturnType<typeof vi.fn>
    updateCallbacks: ReturnType<typeof vi.fn>
    setMode: ReturnType<typeof vi.fn>
    setSelectedRid: ReturnType<typeof vi.fn>
  }>,
}))

vi.mock('../../src/map/NashvilleScene', () => ({
  NashvilleScene: class {
    callbacks: unknown
    home = vi.fn()
    zoomBy = vi.fn()
    rotateToNorth = vi.fn()
    tiltBy = vi.fn()
    flyTo = vi.fn()
    selectAt = vi.fn()
    dispose = vi.fn()
    updateCallbacks = vi.fn()
    setMode = vi.fn()
    setSelectedRid = vi.fn()

    constructor(
      _host: HTMLElement,
      _manifest: ParcelManifestV1,
      _mode: string,
      callbacks: unknown,
    ) {
      if (sceneState.error) throw sceneState.error
      this.callbacks = callbacks
      sceneState.instances.push(this)
    }
  },
}))

const manifest = {
  projection: { bounds: [0, 0, 1, 1] },
} as ParcelManifestV1

function props() {
  return {
    manifest,
    mode: 'overview' as const,
    selectedRid: 7,
    onSelect: vi.fn(),
    onHover: vi.fn(),
    onStatus: vi.fn(),
    onAnchor: vi.fn(),
    onModeShortcut: vi.fn(),
    onEscape: vi.fn(),
    onUnsupported: vi.fn(),
  }
}

afterEach(() => {
  cleanup()
  sceneState.error = undefined
  sceneState.instances.length = 0
})

describe('CityMap', () => {
  it('wires the scene lifecycle, callback updates, state, and controller ref', () => {
    const ref = createRef<CityMapController>()
    const initial = props()
    const view = render(<CityMap ref={ref} {...initial} />)
    const scene = sceneState.instances[0]

    expect(
      view.container.querySelector('.map-canvas')?.getAttribute('aria-hidden'),
    ).toBe('true')
    expect(scene.setMode).toHaveBeenCalledWith('overview')
    expect(scene.setSelectedRid).toHaveBeenCalledWith(7)

    ref.current?.home()
    ref.current?.zoomBy(2)
    ref.current?.rotateToNorth()
    ref.current?.tiltBy(0.5)
    ref.current?.flyTo(1, 2, 3)
    ref.current?.selectAt(1, 2, { parId: 3 })
    expect(scene.home).toHaveBeenCalledOnce()
    expect(scene.zoomBy).toHaveBeenCalledWith(2)
    expect(scene.rotateToNorth).toHaveBeenCalledOnce()
    expect(scene.tiltBy).toHaveBeenCalledWith(0.5)
    expect(scene.flyTo).toHaveBeenCalledWith(1, 2, 3)
    expect(scene.selectAt).toHaveBeenCalledWith(1, 2, { parId: 3 })

    const updated = {
      ...initial,
      mode: 'value' as const,
      selectedRid: undefined,
      onSelect: vi.fn(),
    }
    view.rerender(<CityMap ref={ref} {...updated} />)
    const latestCallbacks = scene.updateCallbacks.mock.calls.at(-1)?.[0] as {
      onSelect: unknown
    }
    expect(latestCallbacks.onSelect).toBe(updated.onSelect)
    expect(scene.setMode).toHaveBeenLastCalledWith('value')
    expect(scene.setSelectedRid).toHaveBeenLastCalledWith(undefined)
    expect(sceneState.instances).toHaveLength(1)

    view.unmount()
    expect(scene.dispose).toHaveBeenCalledOnce()
  })

  it('reports unsupported WebGL and leaves controller calls safe', () => {
    sceneState.error = new Error('WEBGL2_UNAVAILABLE')
    const ref = createRef<CityMapController>()
    const values = props()
    render(<CityMap ref={ref} {...values} />)

    expect(values.onUnsupported).toHaveBeenCalledOnce()
    expect(() => {
      ref.current?.home()
      ref.current?.zoomBy(2)
      ref.current?.rotateToNorth()
      ref.current?.tiltBy(1)
      ref.current?.flyTo(1, 2, 3)
      ref.current?.selectAt(1, 2)
    }).not.toThrow()
  })

  it.each([new Error('unexpected'), 'unexpected'])(
    'rethrows unexpected scene failures',
    (error) => {
      sceneState.error = error
      expect(() => render(<CityMap {...props()} />)).toThrow()
    },
  )
})
