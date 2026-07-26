// @vitest-environment jsdom

import { createRef } from 'react'
import type { ComponentType } from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DesktopGuard,
  HoverCard,
  LegendPanel,
  ManifestErrorScreen,
  MapFooter,
  MapLoading,
  MapToast,
  MapTopbar,
  SurveyTether,
  UnsupportedScreen,
  ZoomInvitation,
} from '../../src/map/components/MapChrome'
import {
  CameraRail,
  ControlsModal,
  ModeRibbon,
} from '../../src/map/components/MapControls'
import { MapSearch } from '../../src/map/components/MapSearch'
import { ParcelInspector } from '../../src/map/components/ParcelInspector'
import * as Icons from '../../src/map/components/icons'
import type {
  CityMapController,
  ParcelGroup,
  ParcelManifestV1,
  ParcelRecord,
  SceneStatus,
  SearchResult,
} from '../../src/map/types'

const record: ParcelRecord = {
  rid: 1,
  stanpar: '001',
  parId: 10,
  featureType: 'Condominium',
  floor: '3',
  address: '100 Test Street',
  acres: 0.25,
  landUseCode: 'RES',
  landUse: 'Residential',
  zoning: 'R6',
  landAppraisal: 100,
  improvementAppraisal: 200,
  totalAppraisal: 300,
}

const group = {
  id: 1,
  bounds: [0, 0, 1, 1],
  center: [0.5, 0.5],
  height: 2,
  records: [record, { ...record, rid: 2, floor: '', stanpar: '', parId: -1 }],
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [1, 0],
        [0, 1],
        [0, 0],
      ],
    ],
  },
} as ParcelGroup

const manifest = {
  source: { date: '2026-05-12' },
  statistics: {
    appraisalQuantiles: [100, 200, 300, 400],
    landUse: [{ key: 'RES', label: 'Residential', count: 1 }],
    zoning: [{ key: 'R6', label: 'R6', count: 1 }],
  },
} as ParcelManifestV1

const onlineStatus: SceneStatus = {
  phase: 'parcels-ready',
  message: 'Ready',
  visibleParcels: 2,
  onlineTiles: true,
  basemapCopyright: 'Map data ©2026 Google',
}

afterEach(cleanup)

describe('map chrome and controls', () => {
  it('renders every chrome state and activates its actions', () => {
    const retry = vi.fn()
    const openControls = vi.fn()
    const zoom = vi.fn()
    const view = render(
      <>
        <UnsupportedScreen />
        <ManifestErrorScreen message="Broken" onRetry={retry} />
        <DesktopGuard />
        <MapLoading />
        <MapTopbar
          manifest={manifest}
          status={onlineStatus}
          search={<span>Search slot</span>}
          onOpenControls={openControls}
        />
        <LegendPanel manifest={manifest} mode="value" />
        <SurveyTether anchor={{ x: 10, y: 20 }} />
        <HoverCard group={group} mode="overview" />
        <MapFooter status={onlineStatus} />
        <ZoomInvitation onActivate={zoom} />
        <MapToast message="Copied" />
        <MapToast message="Offline" tone="error" />
      </>,
    )
    expect(view.container.textContent).toContain('May 12, 2026')
    expect(view.container.textContent).toContain('Google map')
    expect(view.getByLabelText('Google base map available')).not.toBeNull()
    expect(view.getByAltText('Google Maps').getAttribute('src')).toBe(
      '/google-maps-attribution.svg',
    )
    expect(view.container.textContent).toContain('Map data ©2026 Google')
    expect(view.container.textContent).toContain(
      'Building forms are illustrative, based on parcel land use and available floor data.',
    )
    expect(view.getByRole('status').textContent).toContain('Copied')
    expect(view.getByRole('alert').textContent).toContain('Offline')
    fireEvent.click(view.getByText(/Try loading/))
    fireEvent.click(view.getByLabelText('Open map controls'))
    fireEvent.click(view.getByText(/Parcel fabric appears/))
    expect(retry).toHaveBeenCalledOnce()
    expect(openControls).toHaveBeenCalledOnce()
    expect(zoom).toHaveBeenCalledOnce()

    view.rerender(
      <>
        <MapTopbar
          status={{ ...onlineStatus, onlineTiles: false }}
          search={null}
          onOpenControls={openControls}
        />
        <LegendPanel mode="overview" />
      </>,
    )
    expect(view.container.textContent).toContain('Local map')
    expect(
      view.getByLabelText('Google base map unavailable; using local map'),
    ).not.toBeNull()
  })

  it('runs every camera and mode control with and without an inspector', () => {
    const controller: CityMapController = {
      home: vi.fn(),
      zoomBy: vi.fn(),
      rotateToNorth: vi.fn(),
      tiltBy: vi.fn(),
      flyTo: vi.fn(),
      selectAt: vi.fn(),
    }
    const mapRef = { current: controller }
    const onModeChange = vi.fn()
    const view = render(
      <>
        <CameraRail mapRef={mapRef} inspectorOpen={false} />
        <ModeRibbon mode="overview" onModeChange={onModeChange} />
      </>,
    )
    for (const label of [
      'Face north',
      'Zoom in',
      'Zoom out',
      'Tilt camera up',
      'Tilt camera down',
      'Reset county view',
    ]) {
      fireEvent.click(view.getByLabelText(label))
    }
    for (const button of view
      .getByLabelText('Parcel data maps')
      .querySelectorAll('button')) {
      fireEvent.click(button)
    }
    expect(controller.zoomBy).toHaveBeenCalledTimes(2)
    expect(onModeChange).toHaveBeenCalledTimes(4)

    view.rerender(
      <CameraRail mapRef={{ current: null }} inspectorOpen={true} />,
    )
    expect(
      view.container.querySelector('.camera-rail--inspector'),
    ).not.toBeNull()
    fireEvent.click(view.getByLabelText('Face north'))
  })

  it('traps modal focus, handles Escape, backdrop clicks, and restores focus', () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const onClose = vi.fn()
    const view = render(<ControlsModal onClose={onClose} />)
    const dialog = view.getByRole('dialog')
    const close = view.getByLabelText('Close controls')
    const last = view.getByText('Return to the map')
    expect(document.activeElement).toBe(close)

    fireEvent.keyDown(dialog, { key: 'x' })
    fireEvent.keyDown(dialog, { key: 'Escape' })
    close.focus()
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
    fireEvent.keyDown(dialog, { key: 'Tab' })
    expect(document.activeElement).toBe(close)
    fireEvent.keyDown(dialog, { key: 'Tab' })
    last.focus()
    fireEvent.keyDown(dialog, { key: 'ArrowUp' })
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })
    for (const button of dialog.querySelectorAll('button'))
      button.disabled = true
    fireEvent.keyDown(dialog, { key: 'Tab' })
    for (const button of dialog.querySelectorAll('button'))
      button.disabled = false
    fireEvent.mouseDown(dialog)
    fireEvent.mouseDown(view.container.querySelector('.modal-backdrop')!)
    fireEvent.click(close)
    expect(onClose).toHaveBeenCalledTimes(3)

    view.unmount()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('handles a modal mount when no HTMLElement owns focus', () => {
    const activeElement = vi
      .spyOn(document, 'activeElement', 'get')
      .mockReturnValue(null)
    const view = render(<ControlsModal onClose={vi.fn()} />)
    activeElement.mockRestore()
    view.unmount()
  })
})

describe('search and parcel details', () => {
  const results: SearchResult[] = [
    {
      id: 'parcel',
      label: 'Parcel result',
      detail: 'Parcel',
      x: 1,
      y: 2,
      kind: 'parcel',
    },
    {
      id: 'address',
      label: 'Address result',
      detail: 'Address',
      x: 3,
      y: 4,
      kind: 'address',
    },
  ]

  it('covers search submission, keyboard navigation, blur, and display states', () => {
    const inputRef = createRef<HTMLInputElement>()
    const actions = {
      onQueryChange: vi.fn(),
      onOpen: vi.fn(),
      onClose: vi.fn(),
      onSelect: vi.fn(),
    }
    const view = render(
      <MapSearch
        query="test"
        results={results}
        searching={false}
        open
        inputRef={inputRef}
        {...actions}
      />,
    )
    const form = view.getByRole('search')
    const input = view.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'next' } })
    fireEvent.focus(input)
    fireEvent.submit(form)
    expect(actions.onSelect).toHaveBeenCalledWith(results[0])
    const options = view.getAllByRole('option')
    fireEvent.keyDown(form, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(options[0])
    fireEvent.keyDown(form, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(options.at(-1))
    fireEvent.keyDown(form, { key: 'ArrowDown' })
    options[1].focus()
    fireEvent.keyDown(form, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(options[0])
    fireEvent.keyDown(form, { key: 'Escape' })
    fireEvent.keyDown(form, { key: 'x' })
    fireEvent.blur(input, { relatedTarget: options[0] })
    fireEvent.blur(input)
    fireEvent.click(options[1])
    expect(actions.onClose).toHaveBeenCalledTimes(2)

    view.rerender(
      <MapSearch
        query=""
        results={[]}
        searching
        open
        inputRef={inputRef}
        {...actions}
      />,
    )
    fireEvent.submit(view.getByRole('search'))
    fireEvent.keyDown(view.getByRole('search'), { key: 'ArrowDown' })
    expect(view.container.textContent).toContain('Nashville landmarks')

    view.rerender(
      <MapSearch
        query="none"
        results={[]}
        searching={false}
        open
        inputRef={inputRef}
        {...actions}
      />,
    )
    expect(view.container.textContent).toContain('No match yet')
    view.rerender(
      <MapSearch
        query=""
        results={[]}
        searching={false}
        open={false}
        inputRef={inputRef}
        {...actions}
      />,
    )
  })

  it('renders condominium and single-record inspector branches', () => {
    const actions = {
      onClose: vi.fn(),
      onCycleUnit: vi.fn(),
      onCopyLink: vi.fn(),
    }
    const view = render(
      <ParcelInspector group={group} selectedRid={1} {...actions} />,
    )
    fireEvent.click(view.getByText('Previous condominium unit'))
    fireEvent.click(view.getByText('Next condominium unit'))
    fireEvent.click(view.getByText(/Copy map link/))
    fireEvent.click(view.getByLabelText('Close parcel details'))
    expect(actions.onCycleUnit).toHaveBeenNthCalledWith(1, -1)
    expect(actions.onCycleUnit).toHaveBeenNthCalledWith(2, 1)

    view.rerender(
      <ParcelInspector group={group} selectedRid={2} {...actions} />,
    )
    expect(view.container.textContent).not.toContain('Floor')
    view.rerender(
      <ParcelInspector
        group={{ ...group, records: [group.records[1]] }}
        selectedRid={999}
        {...actions}
      />,
    )
    expect(view.container.textContent).toContain('Record 2')
    expect(view.container.textContent).toContain('Not available')
  })
})

it('renders every icon export', () => {
  const entries = Object.entries(Icons)
  const view = render(
    <>
      {entries.map(([name, Value]) => {
        const Icon = Value as ComponentType<{ keys?: string }>
        return <Icon key={name} keys="WASD" />
      })}
    </>,
  )
  expect(view.container.querySelectorAll('svg').length).toBeGreaterThan(10)
})
