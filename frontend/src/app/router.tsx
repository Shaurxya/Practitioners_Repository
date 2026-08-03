import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom'
import { RootLayout } from '@/app/layouts/RootLayout'
import { AdminLayout } from '@/app/layouts/AdminLayout'
import { NotFoundPage } from '@/app/NotFoundPage'
import { LoginPage } from '@/features/auth/components/LoginPage'
import { SubmitCasePage } from '@/features/verification/components/SubmitCasePage'
import { CaseStatusPage } from '@/features/verification/components/CaseStatusPage'
import { MyCasesPage } from '@/features/verification/components/MyCasesPage'
import { ReviewQueuePage } from '@/features/admin-review/components/ReviewQueuePage'
import { ReviewDetailPage } from '@/features/admin-review/components/ReviewDetailPage'
import { PublicVerifyPage } from '@/features/public-verify/components/PublicVerifyPage'

/**
 * Route table. Kept in one file so the URL surface is readable at a glance.
 *
 * Two separate trees on purpose: the portal is used once a year on a phone, the
 * console is used all day on a desktop. They share tokens and primitives and
 * nothing else.
 *
 * Route guards land in phase 8, wrapping elements in a RequireAuth. The index
 * redirect also becomes auth aware then, since choosing between "submit" and
 * "your open case" needs to know who is asking.
 */
export const routes = [
  {
    path: '/',
    element: <RootLayout />,
    errorElement: <NotFoundPage />,
    children: [
      { index: true, element: <SubmitCasePage /> },
      { path: 'login', element: <LoginPage /> },
      { path: 'cases', element: <MyCasesPage /> },
      { path: 'cases/:caseId', element: <CaseStatusPage /> },
      { path: 'verify', element: <PublicVerifyPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
  {
    path: '/admin',
    element: <AdminLayout />,
    errorElement: <NotFoundPage />,
    children: [
      { index: true, element: <ReviewQueuePage /> },
      { path: 'review', element: <Navigate to="/admin" replace /> },
      { path: 'review/:caseId', element: <ReviewDetailPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]

const router = createBrowserRouter(routes)

export function AppRouter() {
  return <RouterProvider router={router} />
}
