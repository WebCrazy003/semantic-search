// frontend/src/app/guards.tsx
// Route wrappers. They decide what someone sees; the backend decides what they may do.
// A guard that is wrong here shows the wrong page, never the wrong data.
//
// There is no login page (spec 2026-10-08 §1.3): a page that needs a login opens the
// login dialog over itself and loads in place once someone has logged in.

import { LockOutlined } from '@ant-design/icons'
import { Button, Result, Spin } from 'antd'
import { useEffect, type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { useDialogs } from './DialogsContext'

function Loading() {
  return (
    <div className="auth-loading">
      <Spin size="large" />
    </div>
  )
}

export function Offline() {
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

function LogInPrompt({ what }: { what: string }) {
  const { setupRequired } = useAuth()
  const { show } = useDialogs()
  // Ask straight away, as a login page would have; closing it leaves this prompt.
  useEffect(() => {
    if (!setupRequired) show('login')
  }, [setupRequired, show])
  return (
    <Result
      icon={<LockOutlined />}
      title={`Log in to ${what}`}
      extra={
        <Button type="primary" onClick={() => show('login')}>
          Log in
        </Button>
      }
    />
  )
}

/**
 * Logged in, with no password change pending. Otherwise a prompt to log in; a pending
 * password change is held in its own dialog (DialogsContext), so nothing here loads
 * behind it.
 */
export function RequireAuth({ children, what }: { children: ReactNode; what: string }) {
  const { phase, user } = useAuth()

  if (phase === 'loading') return <Loading />
  if (phase === 'offline') return <Offline />
  if (!user) return <LogInPrompt what={what} />
  if (user.must_change_password) return <Loading />
  return <>{children}</>
}

/** Admins only. Anyone else lands on the home page, as if the page did not exist. */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth()
  if (!isAdmin) return <Navigate to="/" replace />
  return <>{children}</>
}
