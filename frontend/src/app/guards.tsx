// frontend/src/app/guards.tsx
// Route wrappers. They decide where someone lands; the backend decides what they may
// do. A guard that is wrong here shows the wrong page, never the wrong data.

import { Alert, Button, Result, Spin } from 'antd'
import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './AuthContext'

export const CHANGE_PASSWORD_PATH = '/account/password'

function Loading() {
  return (
    <div className="auth-loading">
      <Spin size="large" />
    </div>
  )
}

function Offline() {
  const { error, refresh } = useAuth()
  return (
    <Result
      status="warning"
      title="DocSage is not reachable"
      subTitle={error ?? 'The backend did not answer.'}
      extra={<Button onClick={() => void refresh()}>Try again</Button>}
    />
  )
}

/** Signed in, with no password change pending. Otherwise off to setup, login or the change. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { phase, user, setupRequired } = useAuth()
  const location = useLocation()

  if (phase === 'loading') return <Loading />
  if (phase === 'offline') return <Offline />
  if (setupRequired) return <Navigate to="/setup" replace />
  if (!user) {
    const next = `${location.pathname}${location.search}`
    const query = next && next !== '/' ? `?next=${encodeURIComponent(next)}` : ''
    return <Navigate to={`/login${query}`} replace />
  }
  if (user.must_change_password && location.pathname !== CHANGE_PASSWORD_PATH) {
    return <Navigate to={CHANGE_PASSWORD_PATH} replace />
  }
  return <>{children}</>
}

/** Admins only. Anyone else lands on search, as if the page did not exist. */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth()
  if (!isAdmin) return <Navigate to="/search" replace />
  return <>{children}</>
}

/**
 * The pages for someone without a session: login, sign-up, forgot password, setup.
 * Someone already logged in is sent on, and a fresh install always goes to setup.
 */
export function PublicOnly({ children, setup = false }: { children: ReactNode; setup?: boolean }) {
  const { phase, user, setupRequired } = useAuth()
  const location = useLocation()

  if (phase === 'loading') return <Loading />
  if (phase === 'offline') return <Offline />
  if (setupRequired && !setup) return <Navigate to="/setup" replace />
  if (!setupRequired && setup) return <Navigate to="/login" replace />
  if (user) return <Navigate to={nextPath(location.search)} replace />
  return <>{children}</>
}

/** Where to go after logging in: the ?next= route if it is one of ours, else the start. */
export function nextPath(search: string): string {
  const next = new URLSearchParams(search).get('next')
  // Only an in-app path. Anything else could send someone off-site after they log in.
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/'
}

/** A form error in the style every account page uses. */
export function FormError({ message }: { message: string | null }) {
  return message ? <Alert type="error" showIcon message={message} className="auth-alert" /> : null
}
