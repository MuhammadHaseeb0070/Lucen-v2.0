import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  worker: {
    format: 'es'
  },
  // @ts-expect-error - vitest extends the Vite config type but nested vite type conflicts can occur
  test: {
    globals: true,
    environment: 'jsdom',
    exclude: [
      'node_modules',
      'dist',
      '.idea',
      '.git',
      '.cache',
      'tests/e2e/**/*'
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      thresholds: {
        lines: 50,
        branches: 40,
        functions: 45,
        statements: 50
      }
    }
  }
})
