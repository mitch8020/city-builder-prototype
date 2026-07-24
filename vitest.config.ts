import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.{ts,mts}'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}', 'scripts/parcel-utils.mjs'],
      exclude: ['src/routeTree.gen.ts'],
      reporter: ['text', 'json-summary', 'html'],
    },
  },
})
