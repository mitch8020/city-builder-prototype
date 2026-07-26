import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { useGoogleBasemap, useLocalBasemap } from './google-map-fixture'

async function waitForCounty(page: Page, googleMap = true) {
  await expect(page.locator('canvas')).toBeVisible()
  await expect(page.getByText('Parcel fabric appears up close')).toBeVisible()
  if (googleMap) {
    await expect(page.getByLabel('Google base map available')).toBeVisible()
    await expect(page.getByAltText('Google Maps')).toBeVisible()
  }
  await page.waitForTimeout(350)
}

async function jumpDowntown(page: Page) {
  const search = page.getByLabel('Search Nashville address or parcel number')
  await search.fill('Downtown')
  await page.getByText('Downtown Nashville').click()
  await expect(page.getByText(/\d[\d,]* visible footprints/)).toBeVisible({
    timeout: 20_000,
  })
  await page.waitForTimeout(1_200)
}

test('county overview visual', async ({ page }) => {
  await useGoogleBasemap(page)
  await page.goto('/')
  await waitForCounty(page)
  await expect(page).toHaveScreenshot('county-overview.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.015,
  })
})

test('compact desktop visual', async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 621 })
  await useGoogleBasemap(page)
  await page.goto('/')
  await waitForCounty(page)
  await expect(page).toHaveScreenshot('compact-desktop.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.015,
  })
})

test('selected parcel visual', async ({ page }) => {
  test.setTimeout(60_000)
  await useGoogleBasemap(page)
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
  await page.goto('/')
  await waitForCounty(page)
  const search = page.getByLabel('Search Nashville address or parcel number')
  await search.fill('930 Commerce')
  await page.getByRole('option', { name: /930 COMMERCE ST, 37203/ }).click()
  await expect(page.getByText(/of 32/)).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(1_200)
  await expect(page).toHaveScreenshot('selected-parcel.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.02,
  })
})

test('zoning visual', async ({ page }) => {
  await useGoogleBasemap(page)
  await page.goto('/?mode=zoning')
  await waitForCounty(page)
  await expect(page.getByText('Base zoning')).toBeVisible()
  await jumpDowntown(page)
  await expect(page).toHaveScreenshot('zoning-view.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.015,
  })
})

test('land-use massing visual', async ({ page }) => {
  await useGoogleBasemap(page)
  await page.goto('/?mode=landUse')
  await waitForCounty(page)
  await expect(
    page.getByRole('complementary').getByText('Land use', { exact: true }),
  ).toBeVisible()
  await jumpDowntown(page)
  await expect(page).toHaveScreenshot('land-use-massing.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.015,
  })
})

test('appraised value visual', async ({ page }) => {
  await useGoogleBasemap(page)
  await page.goto('/?mode=value')
  await waitForCounty(page)
  await expect(page.getByText('Appraised value', { exact: true })).toBeVisible()
  await jumpDowntown(page)
  await expect(page).toHaveScreenshot('value-view.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.015,
  })
})

test('offline fallback visual', async ({ page }) => {
  await useLocalBasemap(page)
  await page.goto('/')
  await waitForCounty(page, false)
  await expect(page.getByText('Local map')).toBeVisible()
  await expect(page).toHaveScreenshot('offline-mode.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.015,
  })
})
