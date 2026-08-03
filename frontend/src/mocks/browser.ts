import { setupWorker } from 'msw/browser'
import { handlers } from './handlers'

/** Service worker used in dev only, started from main.tsx behind a flag. */
export const worker = setupWorker(...handlers)
