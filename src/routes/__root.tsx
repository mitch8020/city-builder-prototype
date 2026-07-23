import {
  HeadContent,
  Link,
  Scripts,
  createRootRoute,
} from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { ArrowIcon, BrandMark } from '../map/components/icons'
import appCss from '../styles.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1, viewport-fit=cover',
      },
      {
        name: 'theme-color',
        content: COLORS.ink,
      },
      {
        name: 'description',
        content:
          'Explore Nashville and Davidson County parcels in an interactive 3D civic map.',
      },
      { title: 'Nashville Parcel Diorama' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
    ],
  }),
  notFoundComponent: NotFoundScreen,
  shellComponent: RootDocument,
})

const COLORS = { ink: '#17343b' }

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}

function NotFoundScreen() {
  return (
    <main className="fatal-screen">
      <BrandMark />
      <p className="eyebrow">404 / Map edge</p>
      <h1>That Nashville view does not exist</h1>
      <p>
        The link may be incomplete or outdated. Return to the county map and
        search for the parcel again.
      </p>
      <Link className="primary-link" to="/">
        Return to the county map <ArrowIcon />
      </Link>
    </main>
  )
}
