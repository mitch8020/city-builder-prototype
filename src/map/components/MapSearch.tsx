import type { FormEvent } from 'react'
import type { SearchResult } from '../types'
import { ParcelIcon, PinIcon, SearchIcon } from './icons'

interface MapSearchProps {
  query: string
  results: SearchResult[]
  searching: boolean
  open: boolean
  onQueryChange: (value: string) => void
  onOpen: () => void
  onSelect: (result: SearchResult) => void
}

export function MapSearch({
  query,
  results,
  searching,
  open,
  onQueryChange,
  onOpen,
  onSelect,
}: MapSearchProps) {
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (results[0]) onSelect(results[0])
  }

  return (
    <form className="map-search" onSubmit={submit} role="search">
      <SearchIcon />
      <input
        aria-label="Search Nashville address or parcel number"
        aria-expanded={open}
        aria-controls="search-results"
        autoComplete="off"
        placeholder="Find an address or parcel"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onFocus={onOpen}
      />
      <kbd>/</kbd>
      {searching && <span className="search-spinner" aria-label="Searching" />}
      {open && (
        <div className="search-results" id="search-results">
          <p className="search-heading">
            {query ? 'Matches' : 'Nashville landmarks'}
          </p>
          {results.length ? (
            results.map((result) => (
              <button
                key={result.id}
                type="button"
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
            ))
          ) : (
            <p className="search-empty">
              No match yet. Try a street address or parcel number.
            </p>
          )}
        </div>
      )}
    </form>
  )
}
