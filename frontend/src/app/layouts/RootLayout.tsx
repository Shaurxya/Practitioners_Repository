import { Outlet } from 'react-router-dom'
import { Colophon, Masthead } from '@/app/layouts/Chrome'

/**
 * Practitioner facing shell: shared masthead, content slot, shared colophon.
 * Outlet is where the matched child route renders.
 */
export function RootLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-canvas text-content">
      <Masthead />
      {/* The reading column is left aligned inside the full page measure rather
          than centred in a narrower one, so its left edge lands on the same
          line as the wordmark above it and the colophon below. */}
      <main className="shell grow pb-20">
        <div className="max-w-[46rem]">
          <Outlet />
        </div>
      </main>
      <Colophon />
    </div>
  )
}
