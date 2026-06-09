import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    APP_VERSION: JSON.stringify(process.env.npm_package_version || '0.0.0'),
  },
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
      include: [
        'src/shared/index.ts',
        'src/lib/artifactParser.ts',
        'src/lib/logger.ts',
        'src/lib/iframeErrorBridge.ts',
        'src/store/themeStore.ts',
        'src/store/creditsStore.ts',
        'src/store/authStore.ts'
      ],
      thresholds: {
        lines: 50,
        branches: 40,
        functions: 45,
        statements: 50
      }
    }
  }
})
