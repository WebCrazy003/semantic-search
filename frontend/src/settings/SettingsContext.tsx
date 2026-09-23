// frontend/src/settings/SettingsContext.tsx
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import {
  DEFAULT_SETTINGS,
  readSettings,
  writeSettings,
  type UiSettings,
} from './settings'

interface SettingsContextValue {
  settings: UiSettings
  update: <K extends keyof UiSettings>(key: K, value: UiSettings[K]) => void
  reset: () => void
  /** True when the user asked for no motion, here or in the operating system. */
  reducedMotion: boolean
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_MOTION).matches
  )
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<UiSettings>(readSettings)

  const update = useCallback(
    <K extends keyof UiSettings>(key: K, value: UiSettings[K]) => {
      setSettings((current) => {
        const next = { ...current, [key]: value }
        writeSettings(next)
        return next
      })
    },
    [],
  )

  const reset = useCallback(() => {
    writeSettings(DEFAULT_SETTINGS)
    setSettings(DEFAULT_SETTINGS)
  }, [])

  const value = useMemo<SettingsContextValue>(
    () => ({
      settings,
      update,
      reset,
      // The operating system's preference wins over the app's own toggle: someone who
      // set it has a reason, and an app switch should not be able to override it.
      reducedMotion: !settings.animations || prefersReducedMotion(),
    }),
    [settings, update, reset],
  )

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export function useSettings(): SettingsContextValue {
  const value = useContext(SettingsContext)
  if (!value) throw new Error('useSettings must be used inside a SettingsProvider')
  return value
}
