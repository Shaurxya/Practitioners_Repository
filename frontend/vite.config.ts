/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  // Read the one .env at the repo root rather than a second copy in here.
  //
  // Vite only inlines variables prefixed VITE_ into the browser bundle, so the
  // DB_* values living in that same file are loaded by the config process and
  // never reach the client. That prefix is now the boundary between a server
  // side secret and a published one, which is why .env says so in capitals.
  envDir: fileURLToPath(new URL('..', import.meta.url)),

  plugins: [react(), tailwindcss()],
  resolve: {
    // Lets imports read "@/lib/apiClient" instead of "../../../lib/apiClient".
    // Must stay in sync with "paths" in tsconfig.json.
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // Dev only. The browser calls /api/... on the Vite origin and Vite forwards
    // it to Spring Boot, so there is no CORS setup to get wrong locally.
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
})
