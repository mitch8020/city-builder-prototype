// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useParcelManifest } from '../../src/map/hooks/useParcelManifest'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useParcelManifest', () => {
  it('publishes a validated manifest', async () => {
    const manifest = JSON.parse(
      readFileSync(resolve('public/data/parcels/manifest.json'), 'utf8'),
    )
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(manifest))),
    )
    const { result } = renderHook(() => useParcelManifest())

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    await vi.waitFor(() =>
      expect(result.current.manifest?.source.recordCount).toBe(286_458),
    )
    expect(result.current.error).toBe('')
  })

  it('reports ordinary failures and ignores aborts during cleanup', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline')
      }),
    )
    const failure = renderHook(() => useParcelManifest())
    await vi.waitFor(() =>
      expect(failure.result.current.error).toContain('unavailable'),
    )
    failure.unmount()

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new DOMException('cancelled', 'AbortError')
      }),
    )
    const aborted = renderHook(() => useParcelManifest())
    aborted.unmount()
    expect(aborted.result.current.error).toBe('')
  })
})
