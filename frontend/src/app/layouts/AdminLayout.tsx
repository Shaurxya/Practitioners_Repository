import { Outlet } from 'react-router-dom'
import { Colophon, Masthead } from '@/app/layouts/Chrome'

/** Reviewer shell. Same chrome as the portal, wider measure: the queue is a dense table. */
export function AdminLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-canvas text-content">
      <Masthead variant="console" />
      <main className="shell shell--wide grow pb-20">
        <Outlet />
      </main>
      <Colophon wide />
    </div>
  )
}
