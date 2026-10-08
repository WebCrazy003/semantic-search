// frontend/src/app/AuthContext.tsx
// Who is logged in. Loaded once at start from /api/auth/status, which answers without a
// session, and updated by login, logout and the API client noticing a 401.
//
// It sits above the router. Search is open to visitors, so the search state mounts for
// everyone and runs its query again when the user changes; the library poller mounts
// only on the pages that need a login (App.tsx), so nothing asks for the document list
// before there is someone to ask for.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import * as api from '../services/api'
import type { User } from '../services/api'

// Admins see a count of waiting reset requests; this keeps it roughly current.
const ADMIN_REFRESH_MS = 60_000

export type AuthPhase = 'loading' | 'ready' | 'offline'

interface AuthValue {
  phase: AuthPhase
  user: User | null
  isAdmin: boolean
  setupRequired: boolean
  registrationOpen: boolean
  pendingResetRequests: number
  /** Why the app could not load, when phase is 'offline'. */
  error: string | null
  login: (username: string, password: string) => Promise<User>
  register: (username: string, password: string) => Promise<User>
  setup: (username: string, password: string) => Promise<User>
  logout: () => Promise<void>
  /** Re-read the session, after a password change or a reset. */
  refresh: () => Promise<void>
  /** Adopt a user returned by an endpoint that logs in, such as completing a reset. */
  adopt: (user: User) => void
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<AuthPhase>('loading')
  const [user, setUser] = useState<User | null>(null)
  const [setupRequired, setSetupRequired] = useState(false)
  const [registrationOpen, setRegistrationOpen] = useState(true)
  const [pending, setPending] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const status = await api.getAuthStatus()
      setUser(status.user)
      setSetupRequired(status.setup_required)
      setRegistrationOpen(status.registration_open)
      setError(null)
      setPhase('ready')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not reach the backend')
      setPhase('offline')
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // The API client reports a 401 from any route: the session expired, was revoked, or
  // the account was disabled. A password that must change is carried on the user.
  useEffect(() => {
    api.onAuthEvent((event) => {
      if (event === 'unauthorized') setUser(null)
      if (event === 'password_change_required') {
        setUser((current) => (current ? { ...current, must_change_password: true } : current))
      }
    })
    return () => api.onAuthEvent(null)
  }, [])

  const isAdmin = user?.role === 'admin'
  useEffect(() => {
    if (!isAdmin || user?.must_change_password) {
      setPending(0)
      return
    }
    let cancelled = false
    const read = () =>
      api
        .getMe()
        .then((me) => {
          if (!cancelled) setPending(me.pending_reset_requests ?? 0)
        })
        .catch(() => undefined)
    void read()
    const timer = window.setInterval(read, ADMIN_REFRESH_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [isAdmin, user?.must_change_password])

  const adopt = useCallback((next: User) => {
    setUser(next)
    setSetupRequired(false)
  }, [])

  const login = useCallback(
    async (username: string, password: string) => {
      const me = await api.login(username, password)
      adopt(me.user)
      return me.user
    },
    [adopt],
  )

  const register = useCallback(
    async (username: string, password: string) => {
      const me = await api.register(username, password)
      adopt(me.user)
      return me.user
    },
    [adopt],
  )

  const setup = useCallback(
    async (username: string, password: string) => {
      const me = await api.setupAdmin(username, password)
      adopt(me.user)
      return me.user
    },
    [adopt],
  )

  const logout = useCallback(async () => {
    try {
      await api.logout()
    } finally {
      setUser(null)
    }
  }, [])

  const value = useMemo<AuthValue>(
    () => ({
      phase,
      user,
      isAdmin,
      setupRequired,
      registrationOpen,
      pendingResetRequests: pending,
      error,
      login,
      register,
      setup,
      logout,
      refresh,
      adopt,
    }),
    [
      phase,
      user,
      isAdmin,
      setupRequired,
      registrationOpen,
      pending,
      error,
      login,
      register,
      setup,
      logout,
      refresh,
      adopt,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside an AuthProvider')
  return value
}
