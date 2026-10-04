import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        id: 'host',
        include: ['tests/**/*.spec.ts'],
      },
      {
        id: 'web',
        include: ['web/src/**/*.test.ts', 'web/src/**/*.test.tsx'],
        testEnvironment: 'jsdom',
      },
    ],
  },
})
