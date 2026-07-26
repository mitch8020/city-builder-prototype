import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { useLocalBasemap } from './google-map-fixture'

test.beforeEach(async ({ page }) => {
  await useLocalBasemap(page)
})

async function waitForMap(page: Page) {
  await expect(page.locator('canvas')).toBeVisible()
}

async function mockCondoSearch(page: Page) {
  await page.route('**/findAddressCandidates?**', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        candidates: [
          {
            address: '930 COMMERCE ST, 37203',
            location: { x: -9_660_824.0987, y: 4_322_768.1837 },
            score: 100,
            attributes: { Addr_type: 'StreetAddress' },
          },
        ],
      }),
    }),
  )
}

test('exposes every persistent map control under safe URL defaults', async ({
  page,
}) => {
  await useLocalBasemap(page)
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await page.goto('/?mode=unknown&parId=-1&parcel=&floor=')
  await waitForMap(page)

  await expect(page).toHaveTitle('Nashville Parcel Diorama')
  await expect(page.getByText('GIS snapshot May 12, 2026')).toBeVisible()
  await expect(page.getByText('City overview', { exact: true })).toBeVisible()
  await expect(page.locator('.height-note')).toHaveCSS(
    'color',
    'rgb(89, 115, 122)',
  )
  await expect(
    page
      .getByRole('combobox', {
        name: 'Search Nashville address or parcel number',
      })
      .evaluate((element) => getComputedStyle(element, '::placeholder').color),
  ).resolves.toBe('rgb(89, 115, 122)')
  await expect(
    page.getByRole('navigation', { name: 'Parcel data maps' }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Overview 1' }),
  ).toHaveAttribute('aria-pressed', 'true')

  for (const name of [
    'Face north',
    'Zoom in',
    'Zoom out',
    'Tilt camera up',
    'Tilt camera down',
    'Reset county view',
  ]) {
    const control = page.getByRole('button', { name })
    await expect(control).toBeEnabled()
    await control.click()
  }
  const zoomIn = page.getByRole('button', { name: 'Zoom in' })
  await zoomIn.hover()
  await expect
    .poll(() =>
      zoomIn.evaluate(
        (element) => getComputedStyle(element, '::after').opacity,
      ),
    )
    .toBe('1')
  await expect
    .poll(() =>
      zoomIn.evaluate(
        (element) => getComputedStyle(element, '::after').content,
      ),
    )
    .toBe('"Zoom in"')

  await expect(pageErrors).toEqual([])
})

test('search owns focus, keyboard navigation, dismissal, and pending results', async ({
  page,
}) => {
  await useLocalBasemap(page)
  await page.route('**/findAddressCandidates?**', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ candidates: [] }),
    }),
  )
  await page.goto('/')
  await waitForMap(page)

  const search = page.getByRole('combobox', {
    name: 'Search Nashville address or parcel number',
  })
  await page.keyboard.press('/')
  await expect(search).toBeFocused()
  await expect(search).toHaveAttribute('aria-expanded', 'true')
  await expect(
    page.getByRole('listbox', { name: 'Nashville search results' }),
  ).toBeVisible()

  await search.press('ArrowDown')
  await expect(
    page.getByRole('option', { name: /Downtown Nashville/ }),
  ).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(search).toBeFocused()
  await expect(search).toHaveAttribute('aria-expanded', 'false')

  await search.fill('zzzzzz')
  await search.press('Enter')
  await expect(search).toHaveValue('zzzzzz')
  await expect(page).not.toHaveURL(/parcel=/)
  await expect(page.getByText('No match yet.')).toBeVisible()

  await page.getByRole('button', { name: 'Reset county view' }).click()
  await expect(search).toHaveAttribute('aria-expanded', 'false')
})

test('search removes duplicate destinations and translates Metro service labels', async ({
  page,
}) => {
  await page.route('**/findAddressCandidates?**', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        candidates: [
          {
            address: '600 CHURCH ST, 37219',
            location: { x: -9_660_091, y: 4_323_845 },
            score: 100,
            attributes: { Addr_type: 'StreetAddress' },
          },
          {
            address: '600 CHURCH ST 37219',
            location: { x: -9_660_092, y: 4_323_846 },
            score: 99,
            attributes: { Addr_type: 'StreetAddress' },
          },
          {
            address: '600 CHURCH ST',
            location: { x: -9_660_093, y: 4_323_847 },
            score: 98,
            attributes: { Addr_type: 'StreetAddress' },
          },
          {
            address: '600 CHURCH ST E, 37027',
            location: { x: -9_648_000, y: 4_315_000 },
            score: 91,
            attributes: { Addr_type: 'StreetAddress' },
          },
        ],
      }),
    }),
  )
  await page.goto('/')
  await waitForMap(page)

  const search = page.getByRole('combobox', {
    name: 'Search Nashville address or parcel number',
  })
  await search.fill('600 CHURCH ST')
  await expect(page.getByText('2 matches', { exact: true })).toBeVisible()
  await expect(page.getByRole('option')).toHaveCount(2)
  await expect(page.getByText('Street address · 100% match')).toBeVisible()
  await expect(page.getByText('StreetAddress', { exact: false })).toHaveCount(0)
})

test('controls modal traps focus, blocks map shortcuts, and restores focus', async ({
  page,
}) => {
  await useLocalBasemap(page)
  await page.goto('/')
  await waitForMap(page)

  const opener = page.getByRole('button', { name: 'Open map controls' })
  await opener.click()
  const dialog = page.getByRole('dialog', {
    name: 'Move like a city planner',
  })
  const close = page.getByRole('button', { name: 'Close controls' })
  const returnToMap = page.getByRole('button', { name: 'Return to the map' })

  await expect(dialog).toBeVisible()
  await expect(close).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(returnToMap).toBeFocused()
  await page.keyboard.press('Digit4')
  await expect(page).not.toHaveURL(/mode=value/)
  await page.keyboard.press('Tab')
  await expect(close).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(opener).toBeFocused()

  await opener.click()
  await page.locator('.modal-backdrop').click({ position: { x: 2, y: 2 } })
  await expect(dialog).toBeHidden()
})

test('desktop guard is the only interactive experience below minimum size', async ({
  page,
}) => {
  await page.setViewportSize({ width: 959, height: 900 })
  await page.goto('/')
  const guard = page.getByRole('heading', {
    name: 'Open Nashville Parcel Diorama on a desktop',
  })
  const search = page.getByLabel('Search Nashville address or parcel number')

  await expect(guard).toBeVisible()
  await expect(search).toBeHidden()
  await expect(page.getByLabel('Reset county view')).toBeHidden()

  await page.setViewportSize({ width: 960, height: 621 })
  await expect(guard).toBeHidden()
  await expect(search).toBeVisible()

  await page.setViewportSize({ width: 960, height: 620 })
  await expect(guard).toBeVisible()
  await expect(search).toBeHidden()
})

test('manifest failure gives a safe explanation and retry action', async ({
  page,
}) => {
  await page.route('**/data/parcels/manifest.json', (route) =>
    route.fulfill({ status: 503, body: 'unavailable' }),
  )
  await page.goto('/')

  await expect(
    page.getByRole('heading', { name: 'The map data did not load' }),
  ).toBeVisible()
  await expect(
    page.getByText('The packaged parcel snapshot is unavailable or invalid.'),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Try loading the map again' }),
  ).toBeVisible()
  await expect(
    page.getByText(/npm run|Manifest returned|ZodError/),
  ).toBeHidden()
})

test('missing WebGL2 gives the supported browser and Metro alternative', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      type,
      ...args
    ) {
      if (type === 'webgl2') return null
      return getContext.call(this, type, ...args)
    } as typeof HTMLCanvasElement.prototype.getContext
  })
  await page.goto('/')

  await expect(
    page.getByRole('heading', { name: 'This map needs WebGL 2' }),
  ).toBeVisible()
  const alternative = page.getByRole('link', {
    name: 'Open Metro Parcel Viewer',
  })
  await expect(alternative).toHaveAttribute(
    'href',
    'https://maps.nashville.gov/ParcelViewer/',
  )
})

test('unknown routes retain a useful 404 and a way back to the map', async ({
  page,
}) => {
  const response = await page.goto('/not-a-route')
  expect(response?.status()).toBe(404)
  await expect(
    page.getByRole('heading', {
      name: 'That Nashville view does not exist',
    }),
  ).toBeVisible()
  await page.getByRole('link', { name: 'Return to the county map' }).click()
  await expect(page).toHaveURL(/\?mode=overview$/)
  await waitForMap(page)
})

test('clipboard denial is recoverable and does not raise a page error', async ({
  page,
}) => {
  test.setTimeout(60_000)
  await useLocalBasemap(page)
  await mockCondoSearch(page)
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: () => Promise.reject(new Error('clipboard denied')),
      },
    })
  })
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.goto('/')
  await waitForMap(page)

  const search = page.getByLabel('Search Nashville address or parcel number')
  await search.fill('930 Commerce')
  await page.getByRole('option', { name: /930 COMMERCE ST, 37203/ }).click()
  await expect(page.getByText(/of 32/)).toBeVisible({ timeout: 20_000 })
  await expect(page.getByLabel('Close parcel details')).toBeFocused()

  const metro = page.getByRole('link', { name: 'Metro details' })
  await expect(metro).toHaveAttribute('target', '_blank')
  await expect(metro).toHaveAttribute('rel', 'noreferrer')
  await expect(page.locator('.property-grid dt').first()).toHaveCSS(
    'color',
    'rgb(89, 115, 122)',
  )
  await expect(page.locator('.accuracy-note')).toHaveCSS(
    'color',
    'rgb(89, 115, 122)',
  )
  await page.getByRole('button', { name: 'Copy map link' }).click()
  await expect(
    page.getByRole('alert').filter({
      hasText: 'Could not copy the link. Copy it from the address bar.',
    }),
  ).toBeVisible()
  await expect(pageErrors).toEqual([])
})

test('parcel shard failure is explained and the same view can retry', async ({
  page,
}) => {
  test.setTimeout(45_000)
  await useLocalBasemap(page)
  let requests = 0
  await page.route('**/*.fgb', (route) => {
    requests += 1
    return route.abort()
  })
  await page.goto('/')
  await waitForMap(page)

  const search = page.getByLabel('Search Nashville address or parcel number')
  await search.fill('Downtown')
  await page.getByRole('option', { name: /Downtown Nashville/ }).click()
  await expect(
    page.getByText('Parcel data did not load. Move or zoom the map to retry.'),
  ).toBeVisible({ timeout: 20_000 })

  const failedRequests = requests
  expect(failedRequests).toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Zoom in' }).click()
  await expect.poll(() => requests).toBeGreaterThan(failedRequests)
})
