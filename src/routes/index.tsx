import {
  ClientOnly,
  createFileRoute,
  useNavigate,
} from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { CityMap } from '../map/CityMap'
import {
  LANDMARKS,
  METRO_GEOCODER,
  METRO_PARCELS,
  METRO_VIEWER,
  MODE_DETAILS,
} from '../map/constants'
import {
  displayValue,
  formatAcres,
  formatCurrency,
  groupPrimaryRecord,
  legendForMode,
  tooltipDetail,
} from '../map/map-utils'
import type {
  CityMapController,
  MapMode,
  ParcelGroup,
  ParcelManifestV1,
  SceneStatus,
  SearchResult,
} from '../map/types'
import {
  geocoderResponseSchema,
  mapSearchSchema,
  metroParcelResponseSchema,
  parcelManifestSchema,
} from '../map/validation'

export const Route = createFileRoute('/')({
  validateSearch: mapSearchSchema,
  component: NashvilleApp,
})

const INITIAL_STATUS: SceneStatus = {
  phase: 'starting',
  message: 'Preparing Davidson County',
  visibleParcels: 0,
  onlineTiles: true,
}

function NashvilleApp() {
  const search = Route.useSearch()
  const navigate = useNavigate({ from: '/' })
  const mapRef = useRef<CityMapController | null>(null)
  const searchAbortRef = useRef<AbortController | undefined>(undefined)
  const shareResolvedRef = useRef(false)
  const anchorUpdateRef = useRef({ time: 0, x: 0, y: 0 })
  const [manifest, setManifest] = useState<ParcelManifestV1>()
  const [manifestError, setManifestError] = useState('')
  const [selectedGroup, setSelectedGroup] = useState<ParcelGroup>()
  const [selectedRid, setSelectedRid] = useState<number>()
  const [hoveredGroup, setHoveredGroup] = useState<ParcelGroup>()
  const [status, setStatus] = useState(INITIAL_STATUS)
  const [helpOpen, setHelpOpen] = useState(false)
  const [unsupported, setUnsupported] = useState(false)
  const [anchor, setAnchor] = useState<{ x: number; y: number }>()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [toast, setToast] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    fetch('/data/parcels/manifest.json', { signal: controller.signal })
      .then((response) => {
        if (!response.ok)
          throw new Error(`Manifest returned ${response.status}`)
        return response.json()
      })
      .then((data: unknown) => {
        const parsed = parcelManifestSchema.parse(data)
        if (parsed.source.recordCount !== 286_458) {
          throw new Error('The parcel manifest failed validation')
        }
        setManifest(parsed)
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setManifestError(
          error instanceof Error ? error.message : 'Parcel data is unavailable',
        )
      })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(''), 3_600)
    return () => clearTimeout(timer)
  }, [toast])

  const setMode = useCallback(
    (mode: MapMode) => {
      void navigate({
        replace: true,
        search: (previous) => ({ ...previous, mode }),
      })
    },
    [navigate],
  )

  const handleSelect = useCallback(
    (group?: ParcelGroup, rid?: number) => {
      setSelectedGroup(group)
      setSelectedRid(rid)
      if (!group || rid === undefined) {
        setAnchor(undefined)
        void navigate({
          replace: true,
          search: (previous) => ({
            ...previous,
            parcel: undefined,
            parId: undefined,
            floor: undefined,
          }),
        })
        return
      }
      const record = groupPrimaryRecord(group, rid)
      void navigate({
        replace: true,
        search: (previous) => ({
          ...previous,
          parcel: record.stanpar || undefined,
          parId: record.parId >= 0 ? record.parId : undefined,
          floor: record.floor || undefined,
        }),
      })
    },
    [navigate],
  )

  const handleAnchor = useCallback((next?: { x: number; y: number }) => {
    if (!next) {
      setAnchor(undefined)
      return
    }
    const now = performance.now()
    const previous = anchorUpdateRef.current
    if (
      now - previous.time < 45 &&
      Math.hypot(next.x - previous.x, next.y - previous.y) < 2
    ) {
      return
    }
    anchorUpdateRef.current = { time: now, x: next.x, y: next.y }
    setAnchor(next)
  }, [])
  const handleEscape = useCallback(() => {
    setHelpOpen(false)
    setSearchOpen(false)
    if (selectedGroup) handleSelect(undefined)
  }, [handleSelect, selectedGroup])
  const handleUnsupported = useCallback(() => setUnsupported(true), [])

  const runSearch = useCallback(async (value: string, signal?: AbortSignal) => {
    const trimmed = value.trim()
    if (trimmed.length < 2) return []
    const parcelIdMatch = /^parId:(\d+)$/i.exec(trimmed)
    const local = LANDMARKS.filter((result) =>
      `${result.label} ${result.detail}`
        .toLowerCase()
        .includes(trimmed.toLowerCase()),
    )
    const parcelLike =
      Boolean(parcelIdMatch) ||
      (/^[\d\s-]+$/.test(trimmed) && trimmed.replace(/\D/g, '').length >= 8)

    if (local.length > 0 && !parcelLike) {
      return local.slice(0, 7)
    }

    if (parcelLike) {
      const where = parcelIdMatch
        ? `ParID=${parcelIdMatch[1]}`
        : `APN='${trimmed.replaceAll("'", "''")}'`
      const params = new URLSearchParams({
        where,
        outFields: 'APN,ParID,PropAddr',
        returnGeometry: 'true',
        outSR: '3857',
        resultRecordCount: '6',
        f: 'geojson',
      })
      const response = await fetch(`${METRO_PARCELS}?${params}`, { signal })
      if (!response.ok) throw new Error('Parcel search is unavailable')
      const collection = metroParcelResponseSchema.parse(await response.json())
      const parcels: SearchResult[] = collection.features.map((feature) => {
        const [x, y] = geometryCenter(feature.geometry)
        return {
          id: `parcel-${feature.properties.ParID || feature.properties.APN || 'result'}`,
          label: `${feature.properties.PropAddr || 'Parcel'}`,
          detail: `Parcel ${feature.properties.APN || trimmed}`.trim(),
          x,
          y,
          kind: 'parcel' as const,
          parcel: `${feature.properties.APN || ''}` || undefined,
          parId: Number.isFinite(Number(feature.properties.ParID))
            ? Number(feature.properties.ParID)
            : undefined,
        }
      })
      return [...parcels, ...local].slice(0, 7)
    }

    const params = new URLSearchParams({
      SingleLine: trimmed,
      outFields: 'Match_addr,Addr_type',
      outSR: '3857',
      maxLocations: '6',
      f: 'json',
    })
    const response = await fetch(`${METRO_GEOCODER}?${params}`, { signal })
    if (!response.ok) throw new Error('Address search is unavailable')
    const data = geocoderResponseSchema.parse(await response.json())
    const addresses: SearchResult[] = data.candidates
      .filter(
        (
          candidate,
        ): candidate is typeof candidate & {
          location: { x: number; y: number }
        } => candidate.score >= 70 && Boolean(candidate.location),
      )
      .map((candidate) => ({
        id: `address-${candidate.location.x}-${candidate.location.y}`,
        label: candidate.address,
        detail: `${candidate.attributes?.Addr_type || 'Nashville address'} · ${Math.round(candidate.score)}% match`,
        x: candidate.location.x,
        y: candidate.location.y,
        kind: 'address' as const,
      }))
    return [...local, ...addresses].slice(0, 7)
  }, [])

  useEffect(() => {
    searchAbortRef.current?.abort()
    if (query.trim().length < 2) {
      setResults(
        query.trim()
          ? LANDMARKS.filter((item) =>
              item.label.toLowerCase().includes(query.toLowerCase()),
            )
          : LANDMARKS.slice(0, 3),
      )
      setSearching(false)
      return
    }
    const controller = new AbortController()
    searchAbortRef.current = controller
    const timer = setTimeout(() => {
      setSearching(true)
      runSearch(query, controller.signal)
        .then(setResults)
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === 'AbortError')
            return
          const local = LANDMARKS.filter((result) =>
            result.label.toLowerCase().includes(query.toLowerCase()),
          )
          setResults(local)
          setToast('Metro search is offline. Landmark jumps still work.')
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false)
        })
    }, 260)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query, runSearch])

  useEffect(() => {
    if (
      !manifest ||
      !search.parcel ||
      shareResolvedRef.current ||
      !mapRef.current
    ) {
      return
    }
    shareResolvedRef.current = true
    runSearch(
      search.parId !== undefined ? `parId:${search.parId}` : search.parcel,
    )
      .then((matches) => {
        if (matches.length === 0) {
          setToast('That shared parcel could not be located.')
          return
        }
        const result =
          matches.find((match) => match.kind === 'parcel') || matches[0]
        setQuery(result.label)
        mapRef.current?.selectAt(result.x, result.y, {
          address: result.label,
          parcel: result.parcel,
          parId: result.parId,
        })
      })
      .catch(() => setToast('That shared parcel could not be restored.'))
  }, [manifest, runSearch, search.parcel, search.parId])

  const selectResult = (result: SearchResult) => {
    setQuery(result.label)
    setSearchOpen(false)
    mapRef.current?.selectAt(result.x, result.y, {
      address: result.label,
      parcel: result.parcel,
      parId: result.parId,
    })
  }

  const submitSearch = (event: FormEvent) => {
    event.preventDefault()
    if (results[0]) selectResult(results[0])
  }

  const cycleUnit = (direction: number) => {
    if (!selectedGroup || selectedRid === undefined) return
    const current = selectedGroup.records.findIndex(
      (record) => record.rid === selectedRid,
    )
    const next =
      (current + direction + selectedGroup.records.length) %
      selectedGroup.records.length
    const record = selectedGroup.records[next]
    setSelectedRid(record.rid)
    void navigate({
      replace: true,
      search: (previous) => ({
        ...previous,
        parcel: record.stanpar || undefined,
        parId: record.parId >= 0 ? record.parId : undefined,
        floor: record.floor || undefined,
      }),
    })
  }

  const copyLink = async () => {
    await navigator.clipboard.writeText(window.location.href)
    setToast('Parcel link copied')
  }

  const legend = useMemo(
    () => (manifest ? legendForMode(search.mode, manifest) : []),
    [manifest, search.mode],
  )
  const activeRecord =
    selectedGroup && selectedRid !== undefined
      ? groupPrimaryRecord(selectedGroup, selectedRid)
      : undefined
  const hoveredRecord = hoveredGroup?.records[0]

  if (unsupported) {
    return (
      <main className="fatal-screen">
        <BrandMark />
        <p className="eyebrow">Graphics check</p>
        <h1>This map needs WebGL 2</h1>
        <p>
          Open this project in a current desktop version of Chrome or Edge, or
          use Metro’s parcel map instead.
        </p>
        <a className="primary-link" href={METRO_VIEWER}>
          Open Metro Parcel Viewer <ArrowIcon />
        </a>
      </main>
    )
  }

  if (manifestError) {
    return (
      <main className="fatal-screen">
        <BrandMark />
        <p className="eyebrow">Parcel package</p>
        <h1>The map data did not load</h1>
        <p>{manifestError}</p>
        <code>npm run data:build -- --input ..\Parcels_view_....zip</code>
      </main>
    )
  }

  return (
    <main className="city-app">
      <div className="desktop-guard">
        <BrandMark />
        <h1>Open Nashville Parcel Diorama on a desktop</h1>
        <p>The camera and planning controls require a keyboard and mouse.</p>
      </div>

      <div className="map-stage">
        {manifest ? (
          <ClientOnly fallback={<MapLoading />}>
            <CityMap
              ref={mapRef}
              manifest={manifest}
              mode={search.mode}
              selectedRid={selectedRid}
              onSelect={handleSelect}
              onHover={setHoveredGroup}
              onStatus={setStatus}
              onAnchor={handleAnchor}
              onModeShortcut={setMode}
              onEscape={handleEscape}
              onUnsupported={handleUnsupported}
            />
          </ClientOnly>
        ) : (
          <MapLoading />
        )}
      </div>

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

        <form className="map-search" onSubmit={submitSearch} role="search">
          <SearchIcon />
          <input
            aria-label="Search Nashville address or parcel number"
            aria-expanded={searchOpen}
            aria-controls="search-results"
            autoComplete="off"
            placeholder="Find an address or parcel"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setSearchOpen(true)
            }}
            onFocus={() => {
              setSearchOpen(true)
              if (!query) setResults(LANDMARKS.slice(0, 3))
            }}
          />
          <kbd>/</kbd>
          {searching && (
            <span className="search-spinner" aria-label="Searching" />
          )}
          {searchOpen && (
            <div className="search-results" id="search-results">
              <p className="search-heading">
                {query ? 'Matches' : 'Nashville landmarks'}
              </p>
              {results.length ? (
                results.map((result) => (
                  <button
                    key={result.id}
                    type="button"
                    onClick={() => selectResult(result)}
                  >
                    <span className={`result-icon result-icon--${result.kind}`}>
                      {result.kind === 'parcel' ? <ParcelIcon /> : <PinIcon />}
                    </span>
                    <span>
                      <strong>{result.label}</strong>
                      <small>{result.detail}</small>
                    </span>
                  </button>
                ))
              ) : (
                <p className="search-empty">
                  No match yet. Try a street address or parcel number.
                </p>
              )}
            </div>
          )}
        </form>

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
            onClick={() => setHelpOpen(true)}
          >
            <QuestionIcon />
          </button>
        </div>
      </header>

      <aside className="legend-panel">
        <p className="eyebrow">{MODE_DETAILS[search.mode].label}</p>
        <h2>{MODE_DETAILS[search.mode].description}</h2>
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

      <nav
        className={`camera-rail ${
          selectedGroup ? 'camera-rail--inspector' : ''
        }`}
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

      {activeRecord && selectedGroup && (
        <aside className="parcel-inspector">
          <div className="inspector-grip" />
          <div className="inspector-head">
            <div className="parcel-badge">
              <ParcelIcon />
            </div>
            <div>
              <p className="eyebrow">Selected parcel</p>
              <h2>{displayValue(activeRecord.address)}</h2>
              <p className="parcel-id">
                {activeRecord.stanpar || `Record ${activeRecord.rid}`}
              </p>
            </div>
            <button
              className="icon-button"
              type="button"
              aria-label="Close parcel details"
              onClick={() => handleSelect(undefined)}
            >
              <CloseIcon />
            </button>
          </div>

          {selectedGroup.records.length > 1 && (
            <div className="unit-switcher">
              <button type="button" onClick={() => cycleUnit(-1)}>
                <span className="sr-only">Previous condominium unit</span>
                <ChevronLeftIcon />
              </button>
              <span>
                Unit{' '}
                {selectedGroup.records.findIndex(
                  (record) => record.rid === selectedRid,
                ) + 1}{' '}
                of {selectedGroup.records.length}
                {activeRecord.floor ? ` · Floor ${activeRecord.floor}` : ''}
              </span>
              <button type="button" onClick={() => cycleUnit(1)}>
                <span className="sr-only">Next condominium unit</span>
                <ChevronRightIcon />
              </button>
            </div>
          )}

          <section className="inspector-section">
            <p className="section-label">Parcel profile</p>
            <dl className="property-grid">
              <Property
                label="Feature"
                value={displayValue(activeRecord.featureType)}
              />
              <Property label="Area" value={formatAcres(activeRecord.acres)} />
              <Property
                label="Land use"
                value={displayValue(activeRecord.landUse)}
                wide
              />
              <Property
                label="Base zoning"
                value={displayValue(activeRecord.zoning)}
              />
              <Property
                label="Parcel ID"
                value={
                  activeRecord.parId >= 0
                    ? String(activeRecord.parId)
                    : 'Not available'
                }
              />
            </dl>
          </section>

          <section className="inspector-section appraisal">
            <div>
              <p className="section-label">Total appraisal</p>
              <strong>{formatCurrency(activeRecord.totalAppraisal)}</strong>
            </div>
            <div className="appraisal-split">
              <span>
                Land
                <b>{formatCurrency(activeRecord.landAppraisal)}</b>
              </span>
              <span>
                Improvements
                <b>{formatCurrency(activeRecord.improvementAppraisal)}</b>
              </span>
            </div>
          </section>

          <div className="inspector-actions">
            <button type="button" onClick={() => void copyLink()}>
              <LinkIcon /> Copy map link
            </button>
            <a
              href={`${METRO_VIEWER}?parcelID=${encodeURIComponent(
                activeRecord.stanpar,
              )}`}
              target="_blank"
              rel="noreferrer"
            >
              Metro details <ArrowIcon />
            </a>
          </div>
          <p className="accuracy-note">
            Informational GIS record. Boundaries are not a survey.
          </p>
        </aside>
      )}

      {anchor && activeRecord && (
        <svg className="survey-tether" aria-hidden="true">
          <line
            x1={anchor.x}
            y1={anchor.y}
            x2={window.innerWidth - 386}
            y2={153}
          />
          <circle cx={anchor.x} cy={anchor.y} r="5" />
        </svg>
      )}

      {hoveredRecord && !activeRecord && (
        <div className="hover-card">
          <span className="hover-dot" />
          <div>
            <strong>{displayValue(hoveredRecord.address)}</strong>
            <small>{tooltipDetail(hoveredRecord, search.mode)}</small>
          </div>
        </div>
      )}

      <nav className="mode-ribbon" aria-label="Parcel data maps">
        {(Object.keys(MODE_DETAILS) as MapMode[]).map((mode) => (
          <button
            key={mode}
            className={search.mode === mode ? 'is-active' : ''}
            type="button"
            aria-pressed={search.mode === mode}
            onClick={() => setMode(mode)}
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

      <div className="map-footer">
        <p>
          <strong>Metro GIS</strong> · Nashville & Davidson County
        </p>
        <p className={`map-status map-status--${status.phase}`}>
          <span />
          {status.message}
        </p>
      </div>

      {status.phase === 'zoom-to-parcels' && (
        <button
          className="zoom-invitation"
          type="button"
          onClick={() => {
            const downtown = LANDMARKS[0]
            mapRef.current?.flyTo(downtown.x, downtown.y, 2_400)
          }}
        >
          <span className="invitation-icon">
            <ParcelIcon />
          </span>
          <span>
            <strong>Parcel fabric appears up close</strong>
            Jump downtown or zoom toward any neighborhood.
          </span>
          <ArrowIcon />
        </button>
      )}

      {helpOpen && (
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
                onClick={() => setHelpOpen(false)}
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
            <button
              className="modal-primary"
              type="button"
              onClick={() => setHelpOpen(false)}
            >
              Return to the map
            </button>
          </section>
        </div>
      )}

      {toast && (
        <div className="toast" role="status">
          <CheckIcon /> {toast}
        </div>
      )}
    </main>
  )
}

function MapLoading() {
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

function Property({
  label,
  value,
  wide = false,
}: {
  label: string
  value: string
  wide?: boolean
}) {
  return (
    <div className={wide ? 'property--wide' : undefined}>
      <dt>{label}</dt>
      <dd>{value}</dd>
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

function geometryCenter(geometry: { type: string; coordinates: unknown }) {
  const coordinates: number[][] = []
  const visit = (value: unknown) => {
    if (
      Array.isArray(value) &&
      value.length >= 2 &&
      typeof value[0] === 'number' &&
      typeof value[1] === 'number'
    ) {
      coordinates.push(value as number[])
      return
    }
    if (Array.isArray(value)) value.forEach(visit)
  }
  visit(geometry.coordinates)
  if (!coordinates.length) return [0, 0] as const
  const xs = coordinates.map((point) => point[0])
  const ys = coordinates.map((point) => point[1])
  return [
    (Math.min(...xs) + Math.max(...xs)) / 2,
    (Math.min(...ys) + Math.max(...ys)) / 2,
  ] as const
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`))
}

function Icon({
  children,
  viewBox = '0 0 24 24',
  className,
}: {
  children: ReactNode
  viewBox?: string
  className?: string
}) {
  return (
    <svg
      className={className}
      viewBox={viewBox}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 42 42">
        <path d="M8 29.5 16.5 8 23 25.2 29.5 12 35 30" />
        <path d="M6 32.5c7-3.2 11.8 2.8 18.2-.6 4.8-2.5 7.2-1.4 11.8.5" />
      </svg>
    </span>
  )
}

const SearchIcon = () => (
  <Icon>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.2 4.2" />
  </Icon>
)
const QuestionIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.9 9a2.3 2.3 0 1 1 3.4 2c-1 .6-1.3 1.1-1.3 2" />
    <path d="M12 17h.01" />
  </Icon>
)
const ParcelIcon = () => (
  <Icon>
    <path d="m4 6 6-3 5 3 5-2v14l-5 3-5-3-6 2Z" />
    <path d="M10 3v15M15 6v15" />
  </Icon>
)
const PinIcon = () => (
  <Icon>
    <path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" />
    <circle cx="12" cy="10" r="2.5" />
  </Icon>
)
const LayersIcon = () => (
  <Icon>
    <path d="m12 3 9 5-9 5-9-5Z" />
    <path d="m3 12 9 5 9-5M3 16l9 5 9-5" />
  </Icon>
)
const PlusIcon = () => (
  <Icon>
    <path d="M12 5v14M5 12h14" />
  </Icon>
)
const MinusIcon = () => (
  <Icon>
    <path d="M5 12h14" />
  </Icon>
)
const TiltUpIcon = () => (
  <Icon>
    <path d="M5 17 12 7l7 10M12 7V3M9 6l3-3 3 3" />
  </Icon>
)
const TiltDownIcon = () => (
  <Icon>
    <path d="M5 7 12 17l7-10M12 17v4M9 18l3 3 3-3" />
  </Icon>
)
const HomeIcon = () => (
  <Icon>
    <path d="m4 11 8-7 8 7" />
    <path d="M6.5 9.5V20h11V9.5M10 20v-6h4v6" />
  </Icon>
)
const CloseIcon = () => (
  <Icon>
    <path d="m6 6 12 12M18 6 6 18" />
  </Icon>
)
const ChevronLeftIcon = () => (
  <Icon>
    <path d="m15 18-6-6 6-6" />
  </Icon>
)
const ChevronRightIcon = () => (
  <Icon>
    <path d="m9 18 6-6-6-6" />
  </Icon>
)
const LinkIcon = () => (
  <Icon>
    <path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.2 1.2" />
    <path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.2-1.2" />
  </Icon>
)
const ArrowIcon = () => (
  <Icon>
    <path d="M5 12h14M14 7l5 5-5 5" />
  </Icon>
)
const CityIcon = () => (
  <Icon>
    <path d="M3 21h18M5 21V8h5v13M10 21V3h6v18M16 21v-9h4v9" />
    <path d="M7 11h1M12 7h2M12 11h2M18 15h1" />
  </Icon>
)
const LeafIcon = () => (
  <Icon>
    <path d="M20 4c-8 0-14 4-14 10 0 3 2 5 5 5 6 0 9-7 9-15Z" />
    <path d="M4 21c3-6 7-9 12-12" />
  </Icon>
)
const GridIcon = () => (
  <Icon>
    <path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />
  </Icon>
)
const ValueIcon = () => (
  <Icon>
    <path d="M4 19V9M9 19V5M14 19v-7M19 19V3" />
    <path d="M2 21h20" />
  </Icon>
)
const MouseIcon = () => (
  <Icon className="control-icon">
    <rect x="7" y="2" width="10" height="20" rx="5" />
    <path d="M12 2v7M7 9h10" />
  </Icon>
)
const CheckIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <path d="m8 12 2.5 2.5L16 9" />
  </Icon>
)

function KeysIcon({ keys }: { keys: string }) {
  return <span className="keys-icon">{keys}</span>
}
