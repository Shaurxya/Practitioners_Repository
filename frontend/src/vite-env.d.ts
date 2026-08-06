/// <reference types="vite/client" />

/** Types the VITE_ variables so import.meta.env is not `any`. */
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string
  /** "true" starts the MSW mock API in dev. Never set in a deployed build. */
  readonly VITE_USE_MOCKS: string
  /** "true" sends registry import calls to Spring instead of the mock. */
  readonly VITE_REAL_IMPORTS: string
  /** "true" sends claims, review and public verify to Spring instead of the mock. */
  readonly VITE_REAL_VERIFY: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
