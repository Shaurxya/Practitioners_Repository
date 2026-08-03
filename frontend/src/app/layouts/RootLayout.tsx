import { Outlet } from 'react-router-dom'

/**
 * Practitioner facing shell: header, content slot, footer.
 * Outlet is where the matched child route renders.
 */
export function RootLayout() {
  return (
    <div className="min-h-full bg-canvas text-content">
      <header className="border-b border-border px-6 py-4">
        <span className="text-sm font-medium">HerbImmortal Verification</span>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-10">
        <Outlet />
      </main>
    </div>
  )
}
