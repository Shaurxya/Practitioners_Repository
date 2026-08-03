import { Outlet } from 'react-router-dom'

/** Reviewer shell. Wider than RootLayout because the queue is a dense table. */
export function AdminLayout() {
  return (
    <div className="min-h-full bg-canvas text-content">
      <header className="border-b border-border px-6 py-4">
        <span className="text-sm font-medium">Review console</span>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  )
}
