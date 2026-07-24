// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { MapInteractions } from '../../src/map/MapInteractions'
import type { ParcelGroup } from '../../src/map/types'

const group = {
  id: 7,
  records: [{ rid: 70 }],
} as unknown as ParcelGroup

function pointerEvent(
  type: 'pointermove' | 'pointerdown' | 'pointerup',
  x: number,
  y: number,
  buttons = 0,
) {
  return new MouseEvent(type, {
    bubbles: true,
    clientX: x,
    clientY: y,
    buttons,
  })
}

function createHarness() {
  const canvas = document.createElement('canvas')
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    right: 200,
    bottom: 100,
    left: 0,
    width: 200,
    height: 100,
    toJSON: () => ({}),
  })
  const camera = {
    setEdgePan: vi.fn(),
    setKey: vi.fn(),
  }
  const callbacks = {
    pickGroup: vi.fn(() => group as ParcelGroup | undefined),
    onSelect: vi.fn(),
    onHover: vi.fn(),
    onHome: vi.fn(),
    onEscape: vi.fn(),
    onModeShortcut: vi.fn(),
    onContextLost: vi.fn(),
  }
  const interactions = new MapInteractions(canvas, camera, callbacks)
  return { canvas, camera, callbacks, interactions }
}

const activeInteractions: MapInteractions[] = []

afterEach(() => {
  activeInteractions.splice(0).forEach((interactions) => interactions.dispose())
})

describe('MapInteractions', () => {
  it('translates keyboard shortcuts while leaving typing targets alone', () => {
    const harness = createHarness()
    activeInteractions.push(harness.interactions)

    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }),
    )
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: '2', bubbles: true }),
    )
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'w', bubbles: true }),
    )
    document.body.dispatchEvent(
      new KeyboardEvent('keyup', { key: 'w', bubbles: true }),
    )

    expect(harness.callbacks.onHome).toHaveBeenCalledOnce()
    expect(harness.callbacks.onModeShortcut).toHaveBeenCalledWith('landUse')
    expect(harness.camera.setKey).toHaveBeenNthCalledWith(1, 'w', true)
    expect(harness.camera.setKey).toHaveBeenNthCalledWith(2, 'w', false)

    const input = document.createElement('input')
    document.body.append(input)
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: '3', bubbles: true }),
    )
    expect(harness.callbacks.onModeShortcut).toHaveBeenCalledOnce()
    input.remove()
  })

  it('owns hover, edge pan, click thresholds, and context loss', () => {
    const harness = createHarness()
    activeInteractions.push(harness.interactions)

    harness.canvas.dispatchEvent(pointerEvent('pointermove', 10, 50))
    expect(harness.camera.setEdgePan).toHaveBeenLastCalledWith(-1, 0)
    expect(harness.callbacks.onHover).toHaveBeenCalledWith(group)
    expect(harness.canvas.style.cursor).toBe('pointer')

    harness.canvas.dispatchEvent(pointerEvent('pointerdown', 100, 50, 1))
    harness.canvas.dispatchEvent(pointerEvent('pointerup', 103, 53))
    expect(harness.callbacks.onSelect).toHaveBeenCalledWith(group)

    harness.canvas.dispatchEvent(pointerEvent('pointerdown', 100, 50, 1))
    harness.canvas.dispatchEvent(pointerEvent('pointerup', 120, 70))
    expect(harness.callbacks.onSelect).toHaveBeenCalledOnce()

    harness.canvas.dispatchEvent(new MouseEvent('pointerleave'))
    expect(harness.camera.setEdgePan).toHaveBeenLastCalledWith(0, 0)
    expect(harness.callbacks.onHover).toHaveBeenLastCalledWith(undefined)

    const contextLost = new Event('webglcontextlost', { cancelable: true })
    harness.canvas.dispatchEvent(contextLost)
    expect(contextLost.defaultPrevented).toBe(true)
    expect(harness.callbacks.onContextLost).toHaveBeenCalledOnce()
  })

  it('removes every listener when disposed', () => {
    const harness = createHarness()
    harness.interactions.dispose()

    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }),
    )
    harness.canvas.dispatchEvent(pointerEvent('pointermove', 10, 50))

    expect(harness.callbacks.onHome).not.toHaveBeenCalled()
    expect(harness.callbacks.onHover).not.toHaveBeenCalled()
    expect(harness.camera.setEdgePan).not.toHaveBeenCalled()
  })
})
