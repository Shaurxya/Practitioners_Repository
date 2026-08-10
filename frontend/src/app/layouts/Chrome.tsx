import { useEffect, useState } from 'react'
import { NavLink, Link } from 'react-router-dom'
import { useIsAuthenticated, useSignOut } from '@/features/auth/hooks/useCurrentUser'

/**
 * The header and footer every route shares.
 *
 * There used to be three: a floating card nav on the portal, a bare strip on
 * the console, and the landing page's own masthead. Three headers means three
 * places to change when a route moves, and it means a person can tell which
 * part of the product they are in from the furniture rather than the content.
 * One masthead, one colophon, one set of rules.
 *
 * Styling lives in src/styles/chrome.css, not in utility classes, because this
 * is chrome rather than page content: it changes rarely and it changes
 * everywhere at once.
 */

interface Item {
  to: string
  label: string
  /** Reference links, hidden on a phone so the two actions survive. */
  secondary?: boolean
  /** The one link drawn with a rule when nothing else is current. */
  primary?: boolean
}

const SITE_NAV: Item[] = [
  { to: '/about', label: 'About', secondary: true },
  { to: '/developers', label: 'Developers', secondary: true },
  { to: '/submit', label: 'Submit a claim' },
  { to: '/verify', label: 'Verify an ID', primary: true },
]

const CONSOLE_NAV: Item[] = [
  // "Review", not "Queue". The page it opens is headed "Review queue" and the
  // case URLs are /admin/review/:id, but the nav said Queue, so the one screen
  // where a person approves or rejects a practitioner was the hardest thing in
  // the console to find. A label should name the job, not the data structure.
  { to: '/admin', label: 'Review' },
  // Registry before Imports, because it is the thing being maintained and
  // Imports is how you maintain it. Someone opening the console to ask "is this
  // practitioner on our register" should not have to know what a batch is.
  { to: '/admin/registry', label: 'Registry' },
  { to: '/admin/imports', label: 'Imports' },
  { to: '/admin/profiles', label: 'Profiles', secondary: true },
  { to: '/admin/accuracy', label: 'Accuracy', secondary: true },
  { to: '/', label: 'Public site', primary: true },
]

/**
 * Sign in belongs in the masthead, not only behind a redirect from a guarded
 * route. Before this, /login existed but nothing linked to it, so the only way
 * to reach it was to already know the URL or to be bounced there by
 * RequireAdmin. An admin arriving at the public site had no way in.
 */
function AccountNav({ isConsole }: { isConsole: boolean }) {
  const { isAuthenticated, isResolving, user } = useIsAuthenticated()
  const signOut = useSignOut()

  // Only while a session is actually being resolved. Rendering nothing for a
  // signed out visitor would leave the public site with no way in at all, which
  // is what happened before /login was linked from anywhere.
  if (isResolving) return null

  if (!isAuthenticated || !user) {
    return (
      <>
        <NavLink to="/login" data-secondary>
          Sign in
        </NavLink>
        <NavLink to="/signup" className="is-primary">
          Sign up
        </NavLink>
      </>
    )
  }

  const canReview = user.role === 'ADMIN' || user.role === 'REVIEWER'

  return (
    <>
      {/* Not while already in the console: CONSOLE_NAV's "Public site" is the
          link out, and a Console link inside the console points at the page you
          are on. */}
      {canReview && !isConsole && <NavLink to="/admin">Console</NavLink>}
      {!isConsole && <NavLink to="/account">Account</NavLink>}
      <button
        type="button"
        className="masthead__signout"
        disabled={signOut.isPending}
        onClick={() => signOut.mutate()}
      >
        Sign out
      </button>
    </>
  )
}

export function Masthead({ variant = 'site' }: { variant?: 'site' | 'console' }) {
  const stuck = useStuck()
  const isConsole = variant === 'console'
  const items = isConsole ? CONSOLE_NAV : SITE_NAV

  return (
    <header className="masthead" data-stuck={stuck}>
      {/* The console runs on a wider measure than the portal, and the chrome
          follows it, so the wordmark stays on the same line as the table. */}
      <div className={`shell masthead__inner${isConsole ? ' shell--wide' : ''}`}>
        <Link className="wordmark" to={isConsole ? '/admin' : '/'}>
          <b>HerbImmortal</b>
          <i>{isConsole ? 'Review console' : 'Verification'}</i>
        </Link>
        <nav aria-label={isConsole ? 'Console' : 'Primary'}>
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/' || item.to === '/admin'}
              data-secondary={item.secondary || undefined}
              className={item.primary ? 'is-primary' : undefined}
            >
              {item.label}
            </NavLink>
          ))}
          <AccountNav isConsole={isConsole} />
        </nav>
      </div>
    </header>
  )
}

export function Colophon({ wide = false }: { wide?: boolean }) {
  return (
    <footer className="colophon">
      <div className={`shell colophon__inner${wide ? ' shell--wide' : ''}`}>
        <p>
          HerbImmortal Verification. Design contract v1, {new Date().getFullYear()}. Registry data
          belongs to the issuing councils.
        </p>
        <nav aria-label="Footer">
          <Link to="/">Overview</Link>
          <Link to="/about">About</Link>
          <Link to="/developers">API</Link>
          <Link to="/verify">Verify</Link>
          <Link to="/admin">Console</Link>
        </nav>
      </div>
    </footer>
  )
}

/**
 * Adds a hairline under the masthead once the page has moved off the top, so
 * the header separates from content only when it is actually overlapping it.
 */
export function useStuck() {
  const [stuck, setStuck] = useState(false)

  useEffect(() => {
    let frame = 0
    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        setStuck(window.scrollY > 8)
      })
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])

  return stuck
}
