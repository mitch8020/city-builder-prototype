import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

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
  await page.route('**/Basemaps/NashvilleBasemapMuted/**', (route) =>
    route.abort(),
  )
}

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
  await page.route('https://maps.nashville.gov/**', (route) => route.abort())
  await page.goto('/')
  await waitForMap(page)
  const search = page.getByLabel('Search Nashville address or parcel number')
  await search.fill('123 Main Street')
  await expect(
    page.getByText('Metro search is offline. Landmark jumps still work.'),
  ).toBeVisible()
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
