import * as THREE from 'three'
import { keyboardShortcutForKey } from './camera-utils'
import type { MapMode, ParcelGroup } from './types'

interface InteractionCamera {
  setEdgePan: (x: number, y: number) => void
  setKey: (key: string, pressed: boolean) => void
}

export interface MapInteractionCallbacks {
  pickGroup: (pointer: THREE.Vector2) => ParcelGroup | undefined
  onSelect: (group?: ParcelGroup) => void
  onHover: (group?: ParcelGroup) => void
  onHome: () => void
  onEscape: () => void
  onModeShortcut: (mode: MapMode) => void
  onContextLost: () => void
}

export class MapInteractions {
  private readonly pointer = new THREE.Vector2()
  private pointerDown?: { x: number; y: number }
  private hoveredRecordId = -1

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly camera: InteractionCamera,
    private readonly callbacks: MapInteractionCallbacks,
  ) {
    window.addEventListener('keydown', this.handleKeyDown)
    window.addEventListener('keyup', this.handleKeyUp)
    canvas.addEventListener('pointermove', this.handlePointerMove)
    canvas.addEventListener('pointerdown', this.handlePointerDown)
    canvas.addEventListener('pointerup', this.handlePointerUp)
    canvas.addEventListener('pointerleave', this.handlePointerLeave)
    canvas.addEventListener('webglcontextlost', this.handleContextLost)
  }

  dispose() {
    window.removeEventListener('keydown', this.handleKeyDown)
    window.removeEventListener('keyup', this.handleKeyUp)
    this.canvas.removeEventListener('pointermove', this.handlePointerMove)
    this.canvas.removeEventListener('pointerdown', this.handlePointerDown)
    this.canvas.removeEventListener('pointerup', this.handlePointerUp)
    this.canvas.removeEventListener('pointerleave', this.handlePointerLeave)
    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost)
  }

  private readonly handleKeyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null
    if (
      target?.matches('input, textarea, select') ||
      target?.isContentEditable
    ) {
      return
    }
    const key = event.key.toLowerCase()
    const shortcut = keyboardShortcutForKey(key)
    if (shortcut?.type === 'home') {
      event.preventDefault()
      this.callbacks.onHome()
      return
    }
    if (shortcut?.type === 'escape') {
      this.callbacks.onEscape()
      return
    }
    if (shortcut?.type === 'mode') {
      this.callbacks.onModeShortcut(shortcut.mode)
      return
    }
    this.camera.setKey(key, true)
  }

  private readonly handleKeyUp = (event: KeyboardEvent) => {
    this.camera.setKey(event.key.toLowerCase(), false)
  }

  private readonly handlePointerMove = (event: PointerEvent) => {
    const rect = this.canvas.getBoundingClientRect()
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    const edge = 28
    const edgePanX =
      event.clientX - rect.left < edge
        ? -1
        : rect.right - event.clientX < edge
          ? 1
          : 0
    const edgePanY =
      event.clientY - rect.top < edge
        ? 1
        : rect.bottom - event.clientY < edge
          ? -1
          : 0
    this.camera.setEdgePan(edgePanX, edgePanY)
    if (event.buttons === 0) this.pickHover()
  }

  private readonly handlePointerDown = (event: PointerEvent) => {
    this.pointerDown = { x: event.clientX, y: event.clientY }
  }

  private readonly handlePointerUp = (event: PointerEvent) => {
    if (!this.pointerDown) return
    const distance = Math.hypot(
      event.clientX - this.pointerDown.x,
      event.clientY - this.pointerDown.y,
    )
    this.pointerDown = undefined
    if (distance > 5) return
    this.callbacks.onSelect(this.callbacks.pickGroup(this.pointer))
  }

  private readonly handlePointerLeave = () => {
    this.camera.setEdgePan(0, 0)
    if (this.hoveredRecordId === -1) return
    this.hoveredRecordId = -1
    this.callbacks.onHover(undefined)
  }

  private readonly handleContextLost = (event: Event) => {
    event.preventDefault()
    this.callbacks.onContextLost()
  }

  private pickHover() {
    const group = this.callbacks.pickGroup(this.pointer)
    const recordId = group?.records[0]?.rid ?? -1
    if (recordId === this.hoveredRecordId) return
    this.hoveredRecordId = recordId
    this.canvas.style.cursor = group ? 'pointer' : 'grab'
    this.callbacks.onHover(group)
  }
}
