// @vitest-environment jsdom

import type { ComponentType, ReactNode } from 'react'
import { cleanup, render } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, it, vi } from 'vitest'

const root = vi.hoisted(() => ({
  config: undefined as
    | {
        head: () => unknown
        shellComponent: ComponentType<{ children: ReactNode }>
        notFoundComponent: ComponentType
      }
    | undefined,
}))

vi.mock('@tanstack/react-router', () => ({
  HeadContent: () => <meta data-testid="head-content" />,
  Scripts: () => <script data-testid="scripts" />,
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
  createRootRoute: (config: NonNullable<typeof root.config>) => {
    root.config = config
    return { options: config }
  },
}))

await import('../../src/routes/__root')

afterEach(cleanup)

it('defines document metadata, the HTML shell, and the root 404', () => {
  if (!root.config) throw new Error('Root route was not captured')
  const head = root.config.head() as {
    meta: Array<Record<string, string>>
    links: Array<Record<string, string>>
  }
  expect(
    head.meta.some(({ title }) => title === 'Nashville Parcel Diorama'),
  ).toBe(true)
  expect(head.links).toHaveLength(2)

  const Shell = root.config.shellComponent
  const shell = renderToStaticMarkup(
    <Shell>
      <main>Child content</main>
    </Shell>,
  )
  expect(shell).toContain('Child content')

  const NotFound = root.config.notFoundComponent
  const missing = render(<NotFound />)
  expect(missing.container.textContent).toContain(
    'That Nashville view does not exist',
  )
  expect(missing.container.querySelector('a')?.getAttribute('href')).toBe('/')
})
