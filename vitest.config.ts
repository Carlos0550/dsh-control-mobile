import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'host', include: ['tests/**/*.spec.ts'] } },
      { test: { name: 'web', include: ['web/src/**/*.test.ts', 'web/src/**/*.test.tsx'], environment: 'jsdom', globals: true } },
    ],
  },
})
