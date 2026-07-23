import type { ReactNode, RefObject } from 'react'
import { MODE_DETAILS } from '../constants'
import type { CityMapController, MapMode } from '../types'
import {
  CityIcon,
  CloseIcon,
  GridIcon,
  HomeIcon,
  KeysIcon,
  LeafIcon,
  MinusIcon,
  MouseIcon,
  PlusIcon,
  TiltDownIcon,
  TiltUpIcon,
  ValueIcon,
} from './icons'

export function CameraRail({
  mapRef,
  inspectorOpen,
}: {
  mapRef: RefObject<CityMapController | null>
  inspectorOpen: boolean
}) {
  return (
    <nav
      className={`camera-rail ${inspectorOpen ? 'camera-rail--inspector' : ''}`}
      aria-label="Map camera controls"
    >
      <button
        type="button"
        onClick={() => mapRef.current?.rotateToNorth()}
        aria-label="Face north"
      >
        <span className="north-arrow">N</span>
      </button>
      <span className="rail-divider" />
      <button
        type="button"
        onClick={() => mapRef.current?.zoomBy(0.72)}
        aria-label="Zoom in"
      >
        <PlusIcon />
      </button>
      <button
        type="button"
        onClick={() => mapRef.current?.zoomBy(1.38)}
        aria-label="Zoom out"
      >
        <MinusIcon />
      </button>
      <span className="rail-divider" />
      <button
        type="button"
        onClick={() => mapRef.current?.tiltBy(-0.12)}
        aria-label="Tilt camera up"
      >
        <TiltUpIcon />
      </button>
      <button
        type="button"
        onClick={() => mapRef.current?.tiltBy(0.12)}
        aria-label="Tilt camera down"
      >
        <TiltDownIcon />
      </button>
      <button
        type="button"
        onClick={() => mapRef.current?.home()}
        aria-label="Reset county view"
      >
        <HomeIcon />
      </button>
    </nav>
  )
}

export function ModeRibbon({
  mode: activeMode,
  onModeChange,
}: {
  mode: MapMode
  onModeChange: (mode: MapMode) => void
}) {
  return (
    <nav className="mode-ribbon" aria-label="Parcel data maps">
      {(Object.keys(MODE_DETAILS) as MapMode[]).map((mode) => (
        <button
          key={mode}
          className={activeMode === mode ? 'is-active' : ''}
          type="button"
          aria-pressed={activeMode === mode}
          onClick={() => onModeChange(mode)}
        >
          <span className={`mode-icon mode-icon--${mode}`}>
            {mode === 'overview' && <CityIcon />}
            {mode === 'landUse' && <LeafIcon />}
            {mode === 'zoning' && <GridIcon />}
            {mode === 'value' && <ValueIcon />}
          </span>
          <span>{MODE_DETAILS[mode].shortLabel}</span>
          <kbd>{MODE_DETAILS[mode].shortcut}</kbd>
        </button>
      ))}
    </nav>
  )
}

export function ControlsModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="controls-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="controls-title"
      >
        <div className="modal-head">
          <div>
            <p className="eyebrow">Map navigation</p>
            <h2 id="controls-title">Move like a city planner</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Close controls"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </div>
        <div className="controls-grid">
          <Control
            icon={<MouseIcon />}
            title="Mouse"
            detail="Left-drag to pan, right-drag to orbit, and use the wheel to zoom."
          />
          <Control
            icon={<KeysIcon keys="WASD" />}
            title="Move"
            detail="Use W A S D or the arrow keys. Move the pointer to an edge to scroll."
          />
          <Control
            icon={<KeysIcon keys="Q / E" />}
            title="Rotate"
            detail="Turn around the current map target."
          />
          <Control
            icon={<KeysIcon keys="Z / X" />}
            title="Zoom"
            detail="Move closer to or farther from the map."
          />
          <Control
            icon={<KeysIcon keys="Home" />}
            title="Tilt"
            detail="Home and End raise or lower the camera angle."
          />
          <Control
            icon={<KeysIcon keys="⌫" />}
            title="County view"
            detail="Backspace returns to the full Davidson County view."
          />
        </div>
        <button className="modal-primary" type="button" onClick={onClose}>
          Return to the map
        </button>
      </section>
    </div>
  )
}

function Control({
  icon,
  title,
  detail,
}: {
  icon: ReactNode
  title: string
  detail: string
}) {
  return (
    <div className="control-card">
      {icon}
      <div>
        <strong>{title}</strong>
        <p>{detail}</p>
      </div>
    </div>
  )
}
