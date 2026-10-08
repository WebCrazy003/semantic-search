// frontend/src/app/DialogsContext.tsx
// Logging in, signing up, resetting or changing a password, setup and settings all
// happen in modals over whatever screen is open, never on a page of their own (spec
// 2026-10-08 §1.3). This owns which one is open and renders it.
//
// Two are forced and cannot be closed: setup on a fresh install, and choosing a new
// password after an administrator set one. Both follow from the auth state, not from
// anything a component asked for.
import { Modal } from 'antd'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useSearchParams } from 'react-router-dom'
import { ChangePasswordForm } from '../components/account/ChangePasswordForm'
import { ForgotPassword } from '../components/account/ForgotPassword'
import { LoginForm } from '../components/account/LoginForm'
import { RegisterForm } from '../components/account/RegisterForm'
import { SetupForm } from '../components/account/SetupForm'
import { SettingsPanel } from '../components/settings/SettingsPanel'
import { useAuth } from './AuthContext'

export type DialogName = 'login' | 'register' | 'forgot' | 'password' | 'settings'

const NAMES: readonly DialogName[] = ['login', 'register', 'forgot', 'password', 'settings']

/** The query parameter an old page route redirects with, to open its modal. */
export const DIALOG_PARAM = 'dialog'

interface DialogsValue {
  open: DialogName | null
  show: (name: DialogName) => void
  close: () => void
}

const DialogsContext = createContext<DialogsValue | null>(null)

export function DialogsProvider({ children }: { children: ReactNode }) {
  const { phase, user, setupRequired } = useAuth()
  const [open, setOpen] = useState<DialogName | null>(null)
  const [params, setParams] = useSearchParams()

  const show = useCallback((name: DialogName) => setOpen(name), [])
  const close = useCallback(() => setOpen(null), [])

  // #/login and the other old routes land here as ?dialog=login: open it, then drop the
  // parameter so a reload or Back does not reopen it.
  const requested = params.get(DIALOG_PARAM)
  useEffect(() => {
    if (!requested) return
    if ((NAMES as readonly string[]).includes(requested)) setOpen(requested as DialogName)
    const next = new URLSearchParams(params)
    next.delete(DIALOG_PARAM)
    setParams(next, { replace: true })
  }, [requested, params, setParams])

  // A login dialog has nothing left to do once someone is logged in, by any route.
  useEffect(() => {
    if (user) setOpen((current) => (current === 'login' || current === 'register' ? null : current))
  }, [user])

  const value = useMemo(() => ({ open, show, close }), [open, show, close])
  const forcedPassword = !!user?.must_change_password

  return (
    <DialogsContext.Provider value={value}>
      {children}

      <Modal
        open={setupRequired}
        closable={false}
        mask={{ closable: false }}
        keyboard={false}
        footer={null}
        width={440}
        centered
        destroyOnHidden
      >
        <SetupForm />
      </Modal>

      <Modal
        open={!setupRequired && (forcedPassword || open === 'password')}
        onCancel={forcedPassword ? undefined : close}
        closable={!forcedPassword}
        mask={{ closable: !forcedPassword }}
        keyboard={!forcedPassword}
        footer={null}
        width={440}
        centered
        destroyOnHidden
      >
        <ChangePasswordForm onDone={close} onCancel={close} />
      </Modal>

      {/* Not before the session is known: someone already logged in who follows an old
          #/login bookmark would see the dialog flash open and close again. */}
      <Modal
        open={
          phase === 'ready' &&
          !setupRequired &&
          !user &&
          (open === 'login' || open === 'register' || open === 'forgot')
        }
        onCancel={close}
        footer={null}
        width={440}
        centered
        destroyOnHidden
      >
        {open === 'register' ? <RegisterForm /> : null}
        {open === 'forgot' ? <ForgotPassword /> : null}
        {open === 'login' ? <LoginForm /> : null}
      </Modal>

      <Modal
        title="Settings"
        open={open === 'settings'}
        onCancel={close}
        footer={null}
        width={720}
        destroyOnHidden
        className="settings-modal"
      >
        <SettingsPanel />
      </Modal>
    </DialogsContext.Provider>
  )
}

export function useDialogs(): DialogsValue {
  const value = useContext(DialogsContext)
  if (!value) throw new Error('useDialogs must be used inside a DialogsProvider')
  return value
}
