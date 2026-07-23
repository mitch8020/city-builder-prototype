import type { ReactNode } from 'react'
import { METRO_VIEWER, MODE_DETAILS } from '../constants'
import { displayValue, legendForMode, tooltipDetail } from '../map-utils'
import type {
  MapMode,
  ParcelGroup,
  ParcelManifestV1,
  SceneStatus,
} from '../types'
import {
  ArrowIcon,
  BrandMark,
  CheckIcon,
  LayersIcon,
  ParcelIcon,
  QuestionIcon,
} from './icons'

export function UnsupportedScreen() {
  return (
    <main className="fatal-screen">
      <BrandMark />
      <p className="eyebrow">Graphics check</p>
      <h1>This map needs WebGL 2</h1>
      <p>
        Open this project in a current desktop version of Chrome or Edge, or use
        Metro’s parcel map instead.
      </p>
      <a className="primary-link" href={METRO_VIEWER}>
        Open Metro Parcel Viewer <ArrowIcon />
      </a>
    </main>
  )
}

export function ManifestErrorScreen({ message }: { message: string }) {
  return (
    <main className="fatal-screen">
      <BrandMark />
      <p className="eyebrow">Parcel package</p>
      <h1>The map data did not load</h1>
      <p>{message}</p>
      <code>npm run data:build -- --input ..\Parcels_view_....zip</code>
    </main>
  )
}

export function DesktopGuard() {
  return (
    <div className="desktop-guard">
      <BrandMark />
      <h1>Open Nashville Parcel Diorama on a desktop</h1>
      <p>The camera and planning controls require a keyboard and mouse.</p>
    </div>
  )
}

export function MapLoading() {
  return (
    <div className="map-loading">
      <div className="loading-model">
        <i />
        <i />
        <i />
      </div>
      <p className="eyebrow">Assembling the county</p>
      <strong>Preparing Nashville’s parcel fabric</strong>
    </div>
  )
}

export function MapTopbar({
  manifest,
  status,
  search,
  onOpenControls,
}: {
  manifest?: ParcelManifestV1
  status: SceneStatus
  search: ReactNode
  onOpenControls: () => void
}) {
  return (
    <header className="topbar">
      <div className="brand-lockup">
        <BrandMark />
        <div>
          <p className="eyebrow">Metro / Davidson</p>
          <p className="brand-name">Nashville Parcel Diorama</p>
        </div>
        {manifest && (
          <span className="source-date">
            GIS snapshot {formatDate(manifest.source.date)}
          </span>
        )}
      </div>

      {search}

      <div className="topbar-actions">
        <span
          className={`network-pill ${
            status.onlineTiles ? '' : 'network-pill--offline'
          }`}
        >
          <span />
          {status.onlineTiles ? 'Metro context' : 'Local map'}
        </span>
        <button
          className="round-button"
          type="button"
          aria-label="Open map controls"
          onClick={onOpenControls}
        >
          <QuestionIcon />
        </button>
      </div>
    </header>
  )
}

export function LegendPanel({
  manifest,
  mode,
}: {
  manifest?: ParcelManifestV1
  mode: MapMode
}) {
  const legend = manifest ? legendForMode(mode, manifest) : []

  return (
    <aside className="legend-panel">
      <p className="eyebrow">{MODE_DETAILS[mode].label}</p>
      <h2>{MODE_DETAILS[mode].description}</h2>
      <div className="legend-items">
        {legend.map((item, index) => (
          <span key={`${item.label}-${index}`}>
            <i style={{ background: item.color }} />
            {item.label}
          </span>
        ))}
      </div>
      <p className="height-note">
        <LayersIcon />
        Parcel lift is illustrative, not building height.
      </p>
    </aside>
  )
}

export function SurveyTether({ anchor }: { anchor: { x: number; y: number } }) {
  return (
    <svg className="survey-tether" aria-hidden="true">
      <line x1={anchor.x} y1={anchor.y} x2={window.innerWidth - 386} y2={153} />
      <circle cx={anchor.x} cy={anchor.y} r="5" />
    </svg>
  )
}

export function HoverCard({
  group,
  mode,
}: {
  group: ParcelGroup
  mode: MapMode
}) {
  const record = group.records[0]

  return (
    <div className="hover-card">
      <span className="hover-dot" />
      <div>
        <strong>{displayValue(record.address)}</strong>
        <small>{tooltipDetail(record, mode)}</small>
      </div>
    </div>
  )
}

export function MapFooter({ status }: { status: SceneStatus }) {
  return (
    <div className="map-footer">
      <p>
        <strong>Metro GIS</strong> · Nashville & Davidson County
      </p>
      <p className={`map-status map-status--${status.phase}`}>
        <span />
        {status.message}
      </p>
    </div>
  )
}

export function ZoomInvitation({ onActivate }: { onActivate: () => void }) {
  return (
    <button className="zoom-invitation" type="button" onClick={onActivate}>
      <span className="invitation-icon">
        <ParcelIcon />
      </span>
      <span>
        <strong>Parcel fabric appears up close</strong>
        Jump downtown or zoom toward any neighborhood.
      </span>
      <ArrowIcon />
    </button>
  )
}

export function MapToast({ message }: { message: string }) {
  return (
    <div className="toast" role="status">
      <CheckIcon /> {message}
    </div>
  )
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`))
}
