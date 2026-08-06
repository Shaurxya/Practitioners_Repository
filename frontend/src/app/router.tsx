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
import { LandingPage } from '@/features/landing/components/LandingPage'
import { AboutPage } from '@/features/about/components/AboutPage'
import { DeveloperPage } from '@/features/developer/components/DeveloperPage'
import { RequireAdmin } from '@/features/auth/components/RequireAdmin'
import { ImportListPage } from '@/features/registry-import/components/ImportListPage'
import { RegistryPage } from '@/features/registry-import/components/RegistryPage'
import { NewImportPage } from '@/features/registry-import/components/NewImportPage'
import { ImportDetailPage } from '@/features/registry-import/components/ImportDetailPage'
import { ColumnMappingPage } from '@/features/registry-import/components/ColumnMappingPage'
import { DiffPreviewPage } from '@/features/registry-import/components/DiffPreviewPage'
import { ParserProfilesPage } from '@/features/registry-import/components/ParserProfilesPage'
import { AccuracyPage } from '@/features/registry-import/components/AccuracyPage'

/**
 * Route table. Kept in one file so the URL surface is readable at a glance.
 *
 * Three trees on purpose: the landing page is read once and shared, the portal
 * is used once a year on a phone, the console is used all day on a desktop.
 * They differ in measure and density, not in language: all three take their
 * chrome, tokens and document primitives from src/styles.
 *
 * Route guards land in phase 8, wrapping elements in a RequireAuth. /submit also
 * becomes auth aware then, since choosing between "submit" and "your open case"
 * needs to know who is asking.
 */
export const routes = [
  {
    path: '/',
    element: <LandingPage />,
    errorElement: <NotFoundPage />,
  },
  {
    // Pathless layout route: it contributes chrome, not a URL segment, so the
    // landing page above can own "/" without the two definitions competing.
    element: <RootLayout />,
    errorElement: <NotFoundPage />,
    children: [
      { path: 'submit', element: <SubmitCasePage /> },
      { path: 'login', element: <LoginPage /> },
      { path: 'cases', element: <MyCasesPage /> },
      { path: 'cases/:caseId', element: <CaseStatusPage /> },
      { path: 'verify', element: <PublicVerifyPage /> },
      { path: 'about', element: <AboutPage /> },
      { path: 'developers', element: <DeveloperPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
  {
    path: '/admin',
    // RequireAdmin sits between the path and the layout, so an unauthenticated
    // visitor never renders console chrome at all. It hides screens and nothing
    // more: the endpoints behind them do their own checking. See RequireAdmin.
    element: <RequireAdmin />,
    errorElement: <NotFoundPage />,
    children: [
      {
        element: <AdminLayout />,
        children: [
          { index: true, element: <ReviewQueuePage /> },
          { path: 'review', element: <Navigate to="/admin" replace /> },
          { path: 'review/:caseId', element: <ReviewDetailPage /> },

          // Registry import. The order matters: "new" has to be declared before
          // ":batchId" or React Router matches /admin/imports/new as a batch
          // whose id is the literal string "new".
          { path: 'registry', element: <RegistryPage /> },
          { path: 'imports', element: <ImportListPage /> },
          { path: 'imports/new', element: <NewImportPage /> },
          { path: 'imports/:batchId', element: <ImportDetailPage /> },
          { path: 'imports/:batchId/mapping', element: <ColumnMappingPage /> },
          { path: 'imports/:batchId/review', element: <DiffPreviewPage /> },

          { path: 'profiles', element: <ParserProfilesPage /> },
          { path: 'accuracy', element: <AccuracyPage /> },

          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
]

const router = createBrowserRouter(routes)

export function AppRouter() {
  return <RouterProvider router={router} />
}

