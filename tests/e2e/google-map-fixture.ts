import type { Page } from '@playwright/test'

export const GOOGLE_TILE_ROUTE = '**/api/google-map/tiles/**'
export const GOOGLE_ATTRIBUTION_ROUTE = '**/api/google-map/attribution?**'

const TEST_MAP_TILE = `
<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <rect width="256" height="256" fill="#e9e6dc"/>
  <path d="M-20 42 L276 198 M-30 210 L286 78 M38 -20 L218 276" fill="none" stroke="#ffffff" stroke-width="13"/>
  <path d="M-20 42 L276 198 M-30 210 L286 78 M38 -20 L218 276" fill="none" stroke="#c7c2b7" stroke-width="2"/>
  <path d="M84 -20 C108 42 86 84 116 132 C142 174 126 220 156 276" fill="none" stroke="#8fc4d3" stroke-width="10"/>
  <path d="M18 104 H238 M128 18 V238" fill="none" stroke="#d9a94c" stroke-width="3"/>
  <g fill="#758083">
    <rect x="24" y="22" width="34" height="20" rx="3"/>
    <rect x="174" y="26" width="42" height="28" rx="3"/>
    <rect x="38" y="170" width="48" height="34" rx="3"/>
    <rect x="168" y="170" width="52" height="42" rx="3"/>
  </g>
</svg>`

export async function useGoogleBasemap(
  page: Page,
  onTile?: (url: string) => void,
) {
  await page.route(GOOGLE_TILE_ROUTE, (route) => {
    onTile?.(route.request().url())
    return route.fulfill({
      contentType: 'image/svg+xml',
      body: TEST_MAP_TILE,
      headers: { 'Cache-Control': 'private, max-age=60' },
    })
  })
  await page.route(GOOGLE_ATTRIBUTION_ROUTE, (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        copyright: 'Map data ©2026 Nashville Davidson County',
      }),
    }),
  )
}

export async function useLocalBasemap(page: Page) {
  await page.route('**/api/google-map/**', (route) => route.abort())
}

export async function clearBasemapRoutes(page: Page) {
  await page.unroute('**/api/google-map/**')
}
