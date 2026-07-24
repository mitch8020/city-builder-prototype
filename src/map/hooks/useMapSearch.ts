import { useCallback, useEffect, useRef, useState } from 'react'
import { landmarkSuggestions, searchNashville } from '../nashville-search'
import type { SearchResult } from '../types'

const MIN_REMOTE_QUERY_LENGTH = 2
const SEARCH_DEBOUNCE_MS = 260

type SearchNashville = (
  query: string,
  options?: { signal?: AbortSignal },
) => Promise<SearchResult[]>

interface UseMapSearchOptions {
  onSelect: (result: SearchResult) => void
  onError: (message: string) => void
  search?: SearchNashville
}

export function useMapSearch({
  onSelect,
  onError,
  search = searchNashville,
}: UseMapSearchOptions) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (query.trim().length < MIN_REMOTE_QUERY_LENGTH) {
      setResults(landmarkSuggestions(query))
      setSearching(false)
      return
    }

    setResults([])
    setSearching(true)
    const controller = new AbortController()
    const timer = setTimeout(() => {
      search(query, { signal: controller.signal })
        .then(setResults)
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === 'AbortError')
            return
          setResults(landmarkSuggestions(query))
          onError('Metro search is offline. Landmark jumps still work.')
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false)
        })
    }, SEARCH_DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [onError, query, search])

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (
        event.key !== '/' ||
        target?.matches('input, textarea, select') ||
        target?.isContentEditable
      ) {
        return
      }
      event.preventDefault()
      setOpen(true)
      if (!query) setResults(landmarkSuggestions(query))
      inputRef.current?.focus()
    }
    window.addEventListener('keydown', focusSearch)
    return () => window.removeEventListener('keydown', focusSearch)
  }, [query])

  const changeQuery = useCallback((value: string) => {
    setQuery(value)
    setOpen(true)
    if (value.trim().length < MIN_REMOTE_QUERY_LENGTH) {
      setResults(landmarkSuggestions(value))
      setSearching(false)
    } else {
      setResults([])
      setSearching(true)
    }
  }, [])

  const openSearch = useCallback(() => {
    setOpen(true)
    if (!query) setResults(landmarkSuggestions(query))
  }, [query])

  const closeSearch = useCallback(() => setOpen(false), [])

  const selectResult = useCallback(
    (result: SearchResult) => {
      setQuery(result.label)
      setSearching(false)
      setOpen(false)
      onSelect(result)
    },
    [onSelect],
  )

  return {
    inputRef,
    query,
    results,
    searching,
    open,
    setQuery,
    changeQuery,
    openSearch,
    closeSearch,
    selectResult,
  }
}
