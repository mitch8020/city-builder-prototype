import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import {
  clearBasemapRoutes,
  useGoogleBasemap,
  useLocalBasemap,
} from './google-map-fixture'

test.beforeEach(async ({ page }) => {
  await useLocalBasemap(page)
})

async function waitForMap(page: Page) {
  await expect(page.locator('canvas')).toBeVisible()
}

async function mockMetroSearch(page: Page) {
  const condoPoint = [-9_660_824.0987, 4_322_768.1837]
  const broadwayPoint = [-9_659_740.9883, 4_322_976.044]

  await page.route('**/findAddressCandidates?**', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        candidates: [
          {
            address: '930 COMMERCE ST, 37203',
            location: { x: condoPoint[0], y: condoPoint[1] },
            score: 100,
            attributes: { Addr_type: 'StreetAddress' },
          },
        ],
      }),
    })
  })
  await page.route(
    '**/Cadastral/Parcels/MapServer/0/query?**',
    async (route) => {
      const isParcelId = new URL(route.request().url()).searchParams
        .get('where')
        ?.startsWith('ParID=')
      const point = isParcelId ? condoPoint : broadwayPoint
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: {
                APN: isParcelId ? '093054I30600CO' : '09306208600',
                ParID: isParcelId ? 479400 : 130203,
                PropAddr: isParcelId ? '930 COMMERCE ST' : '100 BROADWAY',
              },
              geometry: { type: 'Point', coordinates: point },
            },
          ],
        }),
      })
    },
  )
}

test('uses Google Maps as the attributed background without requesting the Metro basemap', async ({
  page,
}) => {
  await clearBasemapRoutes(page)
  const googleTiles: string[] = []
  const metroBasemapRequests: string[] = []
  await useGoogleBasemap(page, (url) => googleTiles.push(url))
  page.on('request', (request) => {
    if (request.url().includes('NashvilleBasemapMuted')) {
      metroBasemapRequests.push(request.url())
    }
  })

  await page.goto('/')
  await waitForMap(page)
  await expect(page.getByText('Google map')).toBeVisible()
  await expect(page.getByAltText('Google Maps')).toBeVisible()
  await expect(
    page.getByText('Map data ©2026 Nashville Davidson County'),
  ).toBeVisible()
  await expect.poll(() => googleTiles.length).toBeGreaterThan(0)

  await page.getByLabel('Zoom in').click()
  await page.getByLabel('Tilt camera down').click()
  await page.getByRole('button', { name: 'Zoning 3' }).click()
  await page.getByLabel('Reset county view').click()
  await expect(page.getByText('Google map')).toBeVisible()

  const refreshedAttribution = page.waitForResponse((response) =>
    response.url().includes('/api/google-map/attribution?'),
  )
  await page.setViewportSize({ width: 960, height: 621 })
  await refreshedAttribution
  const attribution = page.locator('.google-attribution')
  await expect(attribution).toBeVisible()
  const attributionBox = await attribution.boundingBox()
  const modeDockBox = await page
    .getByRole('navigation', { name: 'Parcel data maps' })
    .boundingBox()
  expect(attributionBox).not.toBeNull()
  expect(modeDockBox).not.toBeNull()
  expect(
    attributionBox!.x + attributionBox!.width <= modeDockBox!.x ||
      modeDockBox!.x + modeDockBox!.width <= attributionBox!.x ||
      attributionBox!.y + attributionBox!.height <= modeDockBox!.y ||
      modeDockBox!.y + modeDockBox!.height <= attributionBox!.y,
  ).toBe(true)
  expect(metroBasemapRequests).toEqual([])
})

test('starts at the full county and exposes civic controls', async ({
  page,
}) => {
  await page.goto('/')
  await waitForMap(page)
  await expect(
    page.getByText('Nashville Parcel Diorama', { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('navigation', { name: 'Parcel data maps' }),
  ).toBeVisible()
  await expect(page.getByLabel('Reset county view')).toBeVisible()
  await expect(page.locator('canvas')).toBeVisible()
})

test('changes data maps and restores URL state', async ({ page }) => {
  await page.goto('/?mode=value')
  await waitForMap(page)
  await expect(page.getByText('Appraised value', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Zoning 3' }).click()
  await expect(page).toHaveURL(/mode=zoning/)
  await expect(page.getByText('Base zoning')).toBeVisible()
  await page.keyboard.press('Digit2')
  await expect(page).toHaveURL(/mode=landUse/)
})

test('navigates Downtown and keeps keyboard shortcuts out of search', async ({
  page,
}) => {
  await page.goto('/')
  await waitForMap(page)
  const search = page.getByLabel('Search Nashville address or parcel number')
  await search.click()
  await search.fill('Downtown')
  await expect(page.getByText('Downtown Nashville')).toBeVisible()
  await search.press('4')
  await expect(page).not.toHaveURL(/mode=value/)
  await search.fill('Downtown')
  await page.getByText('Downtown Nashville').click()
  await expect(search).toHaveValue('Downtown Nashville')
})

test('opens controls and Escape closes the active panel', async ({ page }) => {
  await page.goto('/')
  await waitForMap(page)
  await page.getByLabel('Open map controls').click()
  await expect(
    page.getByRole('dialog', { name: 'Move like a city planner' }),
  ).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(
    page.getByRole('dialog', { name: 'Move like a city planner' }),
  ).toBeHidden()
})

test('retains controls when Metro services fail', async ({ page }) => {
  await clearBasemapRoutes(page)
  await useGoogleBasemap(page)
  await page.route('https://maps.nashville.gov/**', (route) => route.abort())
  await page.goto('/')
  await waitForMap(page)
  const search = page.getByLabel('Search Nashville address or parcel number')
  await search.fill('123 Main Street')
  await expect(
    page.getByText('Metro search is offline. Landmark jumps still work.'),
  ).toBeVisible()
  await expect(page.getByText('Google map')).toBeVisible()
  await expect(page.getByLabel('Reset county view')).toBeEnabled()
})

test('selects and cycles a condo, restores its share URL, and searches APN', async ({
  page,
}) => {
  test.setTimeout(60_000)
  await mockMetroSearch(page)
  await page.goto('/')
  await waitForMap(page)

  const search = page.getByLabel('Search Nashville address or parcel number')
  await search.fill('930 Commerce')
  await page.getByRole('option', { name: /930 COMMERCE ST, 37203/ }).click()
  await expect(page.getByText(/of 32/)).toBeVisible({ timeout: 20_000 })

  const firstAddress = await page
    .getByText(/930 COMMERCE ST #/)
    .first()
    .textContent()
  await page.getByRole('button', { name: 'Next condominium unit' }).click()
  await expect(page.getByText(/930 COMMERCE ST #/).first()).not.toHaveText(
    firstAddress ?? '',
  )

  const sharedUrl = page.url()
  expect(sharedUrl).toContain('parcel=')
  expect(sharedUrl).toContain('parId=')
  await page.reload()
  await expect(page.getByText(/of 32/)).toBeVisible({ timeout: 20_000 })

  await page.getByLabel('Close parcel details').click()
  let foundHover = false
  for (let y = 260; y <= 740 && !foundHover; y += 120) {
    for (let x = 320; x <= 1_200; x += 120) {
      await page.mouse.move(x, y)
      await page.waitForTimeout(40)
      if (await page.locator('.hover-card').isVisible()) {
        foundHover = true
        break
      }
    }
  }
  expect(foundHover).toBe(true)

  await search.fill('09306208600')
  await page.getByRole('option', { name: /100 BROADWAY Parcel/ }).click()
  await expect(page).toHaveURL(/parcel=09306208600/)
  await expect(
    page.getByRole('heading', { name: '108 2ND AVE N' }),
  ).toBeVisible({
    timeout: 20_000,
  })
})

test('keeps parcel coverage ahead of a sustained pan', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000)
  await useLocalBasemap(page)
  let delayParcelCells = false
  let parcelRequests = 0
  await page.route('**/*.fgb', async (route) => {
    parcelRequests += 1
    if (delayParcelCells) {
      await new Promise((resolve) => setTimeout(resolve, 150))
    }
    await route.continue()
  })

  await page.goto('/')
  await expect(page.locator('canvas')).toBeVisible()
  await page.locator('button.zoom-invitation').click()
  await expect(page.locator('.map-status--parcels-ready')).toBeVisible({
    timeout: 60_000,
  })

  let previousRequestCount = -1
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await page.waitForTimeout(250)
    if (parcelRequests === previousRequestCount) break
    previousRequestCount = parcelRequests
  }

  await page.evaluate(() => {
    const status = document.querySelector('.map-status')
    const profile = {
      frames: [] as number[],
      readyMessages: [] as string[],
      loadingTransitions: 0,
      stopped: false,
    }
    ;(
      window as typeof window & {
        __parcelPanProfile?: typeof profile & { observer?: MutationObserver }
      }
    ).__parcelPanProfile = profile
    let previousFrame = performance.now()
    const sampleFrame = (now: number) => {
      profile.frames.push(now - previousFrame)
      previousFrame = now
      if (!profile.stopped) requestAnimationFrame(sampleFrame)
    }
    requestAnimationFrame(sampleFrame)

    if (status) {
      profile.readyMessages.push(status.textContent.trim())
      const observer = new MutationObserver(() => {
        if (status.classList.contains('map-status--loading-parcels')) {
          profile.loadingTransitions += 1
        } else if (status.classList.contains('map-status--parcels-ready')) {
          profile.readyMessages.push(status.textContent.trim())
        }
      })
      observer.observe(status, {
        attributes: true,
        childList: true,
        characterData: true,
        subtree: true,
      })
      ;(profile as typeof profile & { observer?: MutationObserver }).observer =
        observer
    }
  })

  delayParcelCells = true
  const requestsBeforePan = parcelRequests
  await page.keyboard.down('d')
  await page.waitForTimeout(4_000)
  await page.keyboard.up('d')
  await page.keyboard.down('a')
  await page.waitForTimeout(4_000)
  await page.keyboard.up('a')
  await page.waitForTimeout(500)

  const profile = await page.evaluate(() => {
    const value = (
      window as typeof window & {
        __parcelPanProfile?: {
          frames: number[]
          readyMessages: string[]
          loadingTransitions: number
          stopped: boolean
          observer?: MutationObserver
        }
      }
    ).__parcelPanProfile
    if (!value) throw new Error('Parcel pan profile was not installed')
    value.stopped = true
    value.observer?.disconnect()
    const frames = value.frames.slice(2)
    const sorted = [...frames].sort((a, b) => a - b)
    const percentile = (fraction: number) =>
      sorted[
        Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))
      ] ?? 0
    return {
      frameCount: frames.length,
      averageFrameMs:
        frames.reduce((sum, duration) => sum + duration, 0) /
        Math.max(frames.length, 1),
      p95FrameMs: percentile(0.95),
      p99FrameMs: percentile(0.99),
      framesOver100Ms: frames.filter((duration) => duration > 100).length,
      loadingTransitions: value.loadingTransitions,
      readyMessageCount: new Set(value.readyMessages).size,
    }
  })

  await testInfo.attach('parcel-pan-profile', {
    body: JSON.stringify(
      {
        ...profile,
        parcelRequestsDuringPan: parcelRequests - requestsBeforePan,
      },
      null,
      2,
    ),
    contentType: 'application/json',
  })

  expect(parcelRequests - requestsBeforePan).toBeGreaterThan(0)
  expect(profile.loadingTransitions).toBe(0)
  expect(profile.readyMessageCount).toBeGreaterThan(1)
  expect(profile.frameCount).toBeGreaterThan(10)
  expect(profile.averageFrameMs).toBeLessThan(80)
  expect(profile.p95FrameMs).toBeLessThan(160)
  expect(profile.framesOver100Ms / profile.frameCount).toBeLessThan(0.15)
  await expect(page.locator('.map-status--parcels-ready')).toBeVisible()
})
