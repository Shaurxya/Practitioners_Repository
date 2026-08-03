/// <reference types="vite/client" />

/** Types the VITE_ variables so import.meta.env is not `any`. */
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string
  /** "true" starts the MSW mock API in dev. Never set in a deployed build. */
  readonly VITE_USE_MOCKS: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
