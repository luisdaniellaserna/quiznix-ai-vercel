import { defineConfig } from 'vitest/config'

// Client unit tests live next to the code under src/. The server suite is run
// separately by `npm run test:server` (node:test), so keep it out of Vitest.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
