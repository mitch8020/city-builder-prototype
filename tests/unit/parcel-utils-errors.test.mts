import { expect, it, vi } from 'vitest'

vi.mock('proj4', () => {
  const project = Object.assign(
    vi.fn(() => [Infinity, Infinity]),
    {
      defs: vi.fn(),
    },
  )
  return { default: project }
})

it('rejects projection results that are not finite', async () => {
  const { projectCoordinate } = await import('../../scripts/parcel-utils.mjs')

  expect(() => projectCoordinate([1, 2])).toThrow(
    'Projection produced an invalid coordinate: 1,2',
  )
})
