// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useMapSearch } from '../../src/map/hooks/useMapSearch'
import type { SearchResult } from '../../src/map/types'

const result: SearchResult = {
  id: 'test-result',
  label: '100 Test Street',
  detail: 'Nashville address',
  x: 10,
  y: 20,
  kind: 'address',
}

afterEach(() => {
  vi.useRealTimers()
})

describe('useMapSearch', () => {
  it('debounces remote queries and owns result selection state', async () => {
    vi.useFakeTimers()
    const search = vi.fn().mockResolvedValue([result])
    const onSelect = vi.fn()
    const onError = vi.fn()
    const { result: hook } = renderHook(() =>
      useMapSearch({ onSelect, onError, search }),
    )

    act(() => hook.current.changeQuery('100 test'))
    expect(hook.current.searching).toBe(true)
    expect(search).not.toHaveBeenCalled()

    await act(() => vi.advanceTimersByTimeAsync(260))
    expect(search).toHaveBeenCalledWith(
      '100 test',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(hook.current.results).toEqual([result])
    expect(hook.current.searching).toBe(false)

    act(() => hook.current.selectResult(result))
    expect(hook.current.query).toBe(result.label)
    expect(hook.current.open).toBe(false)
    expect(onSelect).toHaveBeenCalledWith(result)
  })

  it('falls back to local landmarks when Metro search is unavailable', async () => {
    vi.useFakeTimers()
    const onError = vi.fn()
    const onSelect = vi.fn()
    const search = vi.fn().mockRejectedValue(new Error('offline'))
    const { result: hook } = renderHook(() =>
      useMapSearch({
        onSelect,
        onError,
        search,
      }),
    )

    act(() => hook.current.changeQuery('downtown'))
    await act(() => vi.advanceTimersByTimeAsync(260))

    expect(hook.current.results[0]?.label).toBe('Downtown Nashville')
    expect(onError).toHaveBeenCalledWith(
      'Metro search is offline. Landmark jumps still work.',
    )
  })
})
