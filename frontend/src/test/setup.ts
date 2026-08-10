/**
 * Runs before every test file. Registers the extra matchers from jest-dom,
 * such as toBeInTheDocument, on Vitest's expect, and stands up the mock API.
 *
 * onUnhandledRequest: 'error' is deliberate. A component that calls an endpoint
 * nobody wrote a handler for fails the test loudly instead of hanging on a
 * pending promise and timing out with a message about nothing in particular.
 */
import '@testing-library/jest-dom/vitest'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { cleanup } from '@testing-library/react'
import { server } from '@/mocks/server'
import { resetMockData } from '@/mocks/handlers'

/**
 * jsdom's Blob has no stream(), and undici needs one to read a request body.
 *
 * Only file uploads hit this, and the symptom is nasty: the read never
 * completes, so the request <b>hangs</b> until the test times out, and the
 * failure points at the test rather than at anything resembling the cause.
 *
 * Swapping the whole Blob/File/FormData family over to Node's was tried first
 * and is worse. jsdom's FormData does not recognise a Node File as a Blob, so
 * it stores it by calling toString() and the handler receives the literal text
 * "[object File]". Getting all three from one family is not possible here
 * either, because the parser that ultimately reads the body is Node's own
 * bundled undici, not the copy in node_modules. So: keep jsdom's classes, which
 * are at least consistent with each other, add the one method it is missing,
 * and have the document handler parse the body itself rather than calling
 * request.formData(). See mocks/handlers.ts.
 */
/**
 * A note on file uploads, because the next person will try this.
 *
 * Multipart requests cannot be exercised through MSW under jsdom. The three
 * classes involved have to come from one family and here they never can:
 *
 *   jsdom File + jsdom FormData  the fetch serializer is Node's bundled undici,
 *                                which does not recognise a jsdom File and
 *                                writes the literal text "[object Blob]"
 *   Node File  + jsdom FormData  jsdom's FormData does not recognise a Node
 *                                File as a Blob and stores "[object File]"
 *   Node File  + undici FormData fetch does not recognise that FormData either
 *                                and sends "[object FormData]" as text/plain
 *
 * Node's own internal FormData would close the loop and is unreachable: jsdom
 * has already replaced the global by the time this file runs.
 *
 * So components that upload mock the api module instead, and the wire format is
 * covered where it is real, against Spring's multipart resolver. Do not spend
 * an afternoon on this again.
 */

/**
 * Tests run against the seeded fixtures; the app does not.
 *
 * The browser worker starts with nothing, so the console shows only what this
 * admin did. Tests need a known starting point to assert against, and that is
 * the one place a demo dataset earns its keep.
 */
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' })
  resetMockData(true)
})

afterEach(() => {
  cleanup()
  server.resetHandlers()
  resetMockData(true)
})

afterAll(() => server.close())
