import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // Loopback by default, as the privacy requirement asks. `npm run dev:lan`
    // passes --host, which overrides this and exposes the UI to the network.
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    // Only matters when serving on the network: allow this machine's own names.
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/vitest.setup.ts'],
    css: false,
  },
})
