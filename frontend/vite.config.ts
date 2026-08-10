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
    port: Number(process.env['VITE_DEV_PORT'] ?? 5173),
    // Dev only. The browser calls /api/... on the Vite origin and Vite forwards
    // it to Spring Boot, so there is no CORS setup to get wrong locally.
    //
    // The port is read from the environment rather than fixed at 8080, because
    // SERVER_PORT already moves Spring and a hardcoded target here turns that
    // into a silent failure: unmocked requests fall through to whatever else
    // happens to own 8080, get an HTML page back, and surface as a select box
    // stuck on "Loading" with a 200 in the network tab.
    proxy: {
      '/api': {
        target: `http://localhost:${process.env['SERVER_PORT'] ?? 8080}`,
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
