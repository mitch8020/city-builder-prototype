import type { FormEvent, KeyboardEvent, RefObject } from 'react'
import type { SearchResult } from '../types'
import { ParcelIcon, PinIcon, SearchIcon } from './icons'

interface MapSearchProps {
  query: string
  results: SearchResult[]
  searching: boolean
  open: boolean
  inputRef: RefObject<HTMLInputElement | null>
  onQueryChange: (value: string) => void
  onOpen: () => void
  onClose: () => void
  onSelect: (result: SearchResult) => void
}

export function MapSearch({
  query,
  results,
  searching,
  open,
  inputRef,
  onQueryChange,
  onOpen,
  onClose,
  onSelect,
}: MapSearchProps) {
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!searching && results[0]) onSelect(results[0])
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    event.stopPropagation()
    if (event.key === 'Escape') {
      event.preventDefault()
      inputRef.current?.focus()
      onClose()
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return

    const options = [
      ...event.currentTarget.querySelectorAll<HTMLElement>('[role="option"]'),
    ]
    if (options.length === 0) return
    event.preventDefault()
    const current = options.indexOf(document.activeElement as HTMLElement)
    const next =
      event.key === 'ArrowDown'
        ? (current + 1) % options.length
        : current <= 0
          ? options.length - 1
          : current - 1
    options[next].focus()
  }

  return (
    <form
      className="map-search"
      onSubmit={submit}
      onKeyDown={handleKeyDown}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) onClose()
      }}
      role="search"
    >
      <SearchIcon />
      <input
        ref={inputRef}
        role="combobox"
        aria-label="Search Nashville address or parcel number"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? 'search-results-listbox' : undefined}
        autoComplete="off"
        maxLength={120}
        placeholder="Find an address or parcel"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onFocus={onOpen}
      />
      <kbd>/</kbd>
      {searching && <span className="search-spinner" aria-label="Searching" />}
      {open && (
        <div className="search-results">
          <p className="search-heading">
            {query ? 'Matches' : 'Nashville landmarks'}
          </p>
          <div
            id="search-results-listbox"
            role="listbox"
            aria-label="Nashville search results"
            aria-busy={searching}
          >
            {results.map((result) => (
              <button
                key={result.id}
                id={`search-result-${result.id}`}
                type="button"
                role="option"
                aria-selected="false"
                onClick={() => onSelect(result)}
              >
                <span className={`result-icon result-icon--${result.kind}`}>
                  {result.kind === 'parcel' ? <ParcelIcon /> : <PinIcon />}
                </span>
                <span>
                  <strong>{result.label}</strong>
                  <small>{result.detail}</small>
                </span>
              </button>
            ))}
          </div>
          {!searching && results.length === 0 && (
            <p className="search-empty">
              No match yet. Try a street address or parcel number.
            </p>
          )}
        </div>
      )}
    </form>
  )
}
