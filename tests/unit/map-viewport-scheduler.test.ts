import { afterEach, describe, expect, it, vi } from 'vitest'
import { MapViewportScheduler } from '../../src/map/MapViewportScheduler'
import type {
  MapBounds,
  ParcelViewportUpdate,
} from '../../src/map/MapViewportScheduler'

afterEach(() => {
  vi.useRealTimers()
})

describe('MapViewportScheduler', () => {
  it('coalesces earlier work while preserving and cancelling settle intent', () => {
    vi.useFakeTimers()
    let now = 0
    const bounds: MapBounds = [0, 0, 100, 100]
    const parcelUpdates: ParcelViewportUpdate[] = []
    const tileUpdates: MapBounds[] = []
    const scheduler = new MapViewportScheduler({
      readBounds: () => bounds,
      onParcelUpdate: (update) => {
        parcelUpdates.push(update)
        return true
      },
      onTileUpdate: (nextBounds) => tileUpdates.push(nextBounds),
      now: () => now,
    })

    scheduler.schedule(48, true)
    now = 10
    scheduler.schedule(5)
    scheduler.cancelPendingSettle()
    vi.advanceTimersByTime(5)

    expect(parcelUpdates).toEqual([
      { bounds, velocity: [0, 0], settled: false },
    ])
    expect(tileUpdates).toEqual([bounds])

    scheduler.dispose()
    ;(
      scheduler as unknown as { runParcelUpdate: (settled: boolean) => void }
    ).runParcelUpdate(true)
    scheduler.schedule(0, true)
    vi.runAllTimers()
    expect(parcelUpdates).toHaveLength(1)
  })

  it('samples view velocity and publishes an idle update after motion stops', () => {
    vi.useFakeTimers()
    let now = 0
    let bounds: MapBounds = [0, 0, 100, 100]
    const parcelUpdates: ParcelViewportUpdate[] = []
    const scheduler = new MapViewportScheduler({
      readBounds: () => bounds,
      onParcelUpdate: (update) => {
        parcelUpdates.push(update)
        return true
      },
      onTileUpdate: vi.fn(),
      now: () => now,
    })

    scheduler.schedule(0)
    vi.advanceTimersByTime(0)
    now = 1_000
    bounds = [1_000, 0, 1_100, 100]
    scheduler.schedule(0)
    vi.advanceTimersByTime(0)

    expect(parcelUpdates[1]).toMatchObject({
      bounds,
      settled: false,
    })
    expect(parcelUpdates[1].velocity[0]).toBeCloseTo(420)
    expect(parcelUpdates[1].velocity[1]).toBe(0)

    now = 1_220
    vi.advanceTimersByTime(220)
    expect(parcelUpdates[2]).toEqual({
      bounds,
      velocity: [0, 0],
      settled: false,
    })
  })

  it('drops velocity history while parcel streaming is inactive', () => {
    vi.useFakeTimers()
    let now = 0
    let bounds: MapBounds = [0, 0, 100, 100]
    const parcelUpdates: ParcelViewportUpdate[] = []
    const scheduler = new MapViewportScheduler({
      readBounds: () => bounds,
      onParcelUpdate: (update) => {
        parcelUpdates.push(update)
        return false
      },
      onTileUpdate: vi.fn(),
      now: () => now,
    })

    scheduler.schedule(0)
    vi.advanceTimersByTime(0)
    now = 1_000
    bounds = [1_000, 0, 1_100, 100]
    scheduler.schedule(0)
    vi.advanceTimersByTime(0)

    expect(parcelUpdates[1].velocity).toEqual([0, 0])
  })
})
