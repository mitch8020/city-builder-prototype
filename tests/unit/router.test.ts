import { expect, it, vi } from 'vitest'

const createRouter = vi.hoisted(() => vi.fn((options) => ({ options })))
const route = vi.hoisted(() => {
  const value = {
    update: vi.fn(),
    addChildren: vi.fn(),
    _addFileChildren: vi.fn(),
    _addFileTypes: vi.fn(),
  }
  value.update.mockReturnValue(value)
  value.addChildren.mockReturnValue(value)
  value._addFileChildren.mockReturnValue(value)
  value._addFileTypes.mockReturnValue(value)
  return value
})

vi.mock('@tanstack/react-router', () => ({
  createRouter,
  createRootRoute: vi.fn(() => route),
  createFileRoute: vi.fn(() => vi.fn(() => route)),
}))

it('creates the application router with restoration and intent preloading', async () => {
  const { getRouter } = await import('../../src/router')
  const router = getRouter() as unknown as {
    options: {
      scrollRestoration: boolean
      defaultPreload: string
      defaultPreloadStaleTime: number
    }
  }
  expect(router.options).toMatchObject({
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
  })
  expect(createRouter).toHaveBeenCalledOnce()
})
