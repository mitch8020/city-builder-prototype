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

  it('owns local suggestions, open/close actions, and the slash shortcut', () => {
    const onSelect = vi.fn()
    const onError = vi.fn()
    const search = vi.fn()
    const { result: hook } = renderHook(() =>
      useMapSearch({ onSelect, onError, search }),
    )
    const input = document.createElement('input')
    hook.current.inputRef.current = input
    document.body.append(input)

    act(() => hook.current.changeQuery('d'))
    expect(hook.current.results.length).toBeGreaterThan(0)
    act(() => hook.current.closeSearch())
    expect(hook.current.open).toBe(false)
    act(() => hook.current.openSearch())
    act(() => hook.current.setQuery(''))
    act(() => hook.current.openSearch())
    expect(hook.current.open).toBe(true)

    act(() => {
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: '/',
          bubbles: true,
          cancelable: true,
        }),
      )
    })
    expect(document.activeElement).toBe(input)

    for (const target of [
      document.createElement('input'),
      document.createElement('textarea'),
      document.createElement('select'),
    ]) {
      document.body.append(target)
      target.dispatchEvent(
        new KeyboardEvent('keydown', { key: '/', bubbles: true }),
      )
      target.remove()
    }
    act(() => {
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'x', bubbles: true }),
      )
    })
    input.remove()
  })

  it('silently ignores aborted searches and aborts pending work on change', async () => {
    vi.useFakeTimers()
    const search = vi
      .fn()
      .mockRejectedValue(new DOMException('cancelled', 'AbortError'))
    const onError = vi.fn()
    const onSelect = vi.fn()
    const { result: hook, unmount } = renderHook(() =>
      useMapSearch({ onSelect, onError, search }),
    )

    act(() => hook.current.changeQuery('first query'))
    act(() => hook.current.changeQuery('second query'))
    await act(() => vi.advanceTimersByTimeAsync(260))
    expect(onError).not.toHaveBeenCalled()
    unmount()
  })

  it('does not let an aborted request clear a newer pending search', async () => {
    vi.useFakeTimers()
    let resolveSearch: ((value: SearchResult[]) => void) | undefined
    const search = vi.fn(
      () =>
        new Promise<SearchResult[]>((resolve) => {
          resolveSearch = resolve
        }),
    )
    const onSelect = vi.fn()
    const onError = vi.fn()
    const { result: hook } = renderHook(() =>
      useMapSearch({ onSelect, onError, search }),
    )
    act(() => hook.current.changeQuery('first query'))
    await act(() => vi.advanceTimersByTimeAsync(260))
    act(() => hook.current.changeQuery('second query'))
    await act(async () => resolveSearch?.([result]))
    expect(hook.current.searching).toBe(true)
  })
})
