import type { ReactNode } from 'react'

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

export function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 42 42">
        <path d="M8 29.5 16.5 8 23 25.2 29.5 12 35 30" />
        <path d="M6 32.5c7-3.2 11.8 2.8 18.2-.6 4.8-2.5 7.2-1.4 11.8.5" />
      </svg>
    </span>
  )
}

export const SearchIcon = () => (
  <Icon>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.2 4.2" />
  </Icon>
)

export const QuestionIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.9 9a2.3 2.3 0 1 1 3.4 2c-1 .6-1.3 1.1-1.3 2" />
    <path d="M12 17h.01" />
  </Icon>
)

export const ParcelIcon = () => (
  <Icon>
    <path d="m4 6 6-3 5 3 5-2v14l-5 3-5-3-6 2Z" />
    <path d="M10 3v15M15 6v15" />
  </Icon>
)

export const PinIcon = () => (
  <Icon>
    <path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" />
    <circle cx="12" cy="10" r="2.5" />
  </Icon>
)

export const LayersIcon = () => (
  <Icon>
    <path d="m12 3 9 5-9 5-9-5Z" />
    <path d="m3 12 9 5 9-5M3 16l9 5 9-5" />
  </Icon>
)

export const PlusIcon = () => (
  <Icon>
    <path d="M12 5v14M5 12h14" />
  </Icon>
)

export const MinusIcon = () => (
  <Icon>
    <path d="M5 12h14" />
  </Icon>
)

export const TiltUpIcon = () => (
  <Icon>
    <path d="M5 17 12 7l7 10M12 7V3M9 6l3-3 3 3" />
  </Icon>
)

export const TiltDownIcon = () => (
  <Icon>
    <path d="M5 7 12 17l7-10M12 17v4M9 18l3 3 3-3" />
  </Icon>
)

export const HomeIcon = () => (
  <Icon>
    <path d="m4 11 8-7 8 7" />
    <path d="M6.5 9.5V20h11V9.5M10 20v-6h4v6" />
  </Icon>
)

export const CloseIcon = () => (
  <Icon>
    <path d="m6 6 12 12M18 6 6 18" />
  </Icon>
)

export const ChevronLeftIcon = () => (
  <Icon>
    <path d="m15 18-6-6 6-6" />
  </Icon>
)

export const ChevronRightIcon = () => (
  <Icon>
    <path d="m9 18 6-6-6-6" />
  </Icon>
)

export const LinkIcon = () => (
  <Icon>
    <path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.2 1.2" />
    <path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.2-1.2" />
  </Icon>
)

export const ArrowIcon = () => (
  <Icon>
    <path d="M5 12h14M14 7l5 5-5 5" />
  </Icon>
)

export const CityIcon = () => (
  <Icon>
    <path d="M3 21h18M5 21V8h5v13M10 21V3h6v18M16 21v-9h4v9" />
    <path d="M7 11h1M12 7h2M12 11h2M18 15h1" />
  </Icon>
)

export const LeafIcon = () => (
  <Icon>
    <path d="M20 4c-8 0-14 4-14 10 0 3 2 5 5 5 6 0 9-7 9-15Z" />
    <path d="M4 21c3-6 7-9 12-12" />
  </Icon>
)

export const GridIcon = () => (
  <Icon>
    <path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />
  </Icon>
)

export const ValueIcon = () => (
  <Icon>
    <path d="M4 19V9M9 19V5M14 19v-7M19 19V3" />
    <path d="M2 21h20" />
  </Icon>
)

export const MouseIcon = () => (
  <Icon className="control-icon">
    <rect x="7" y="2" width="10" height="20" rx="5" />
    <path d="M12 2v7M7 9h10" />
  </Icon>
)

export const CheckIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <path d="m8 12 2.5 2.5L16 9" />
  </Icon>
)

export function KeysIcon({ keys }: { keys: string }) {
  return <span className="keys-icon">{keys}</span>
}
