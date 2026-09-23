// frontend/src/settings/ThemeProvider.tsx
import { ConfigProvider, theme as antdTheme } from 'antd'
import { useEffect, useState, type ReactNode } from 'react'
import { useSettings } from './SettingsContext'

const DARK_SCHEME = '(prefers-color-scheme: dark)'

function systemPrefersDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(DARK_SCHEME).matches
}

/** Follows the operating system while the theme setting is "system". */
function useDark(choice: 'system' | 'light' | 'dark'): boolean {
  const [systemDark, setSystemDark] = useState(systemPrefersDark)

  useEffect(() => {
    if (choice !== 'system' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia(DARK_SCHEME)
    const listen = (event: MediaQueryListEvent) => setSystemDark(event.matches)
    // addListener is the pre-2019 spelling; jsdom and older Safari still need it.
    if (query.addEventListener) query.addEventListener('change', listen)
    else query.addListener?.(listen)
    setSystemDark(query.matches)
    return () => {
      if (query.removeEventListener) query.removeEventListener('change', listen)
      else query.removeListener?.(listen)
    }
  }, [choice])

  if (choice === 'dark') return true
  if (choice === 'light') return false
  return systemDark
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { settings, reducedMotion } = useSettings()
  const dark = useDark(settings.theme)
  const compact = settings.density === 'compact'

  const algorithm = [
    dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    ...(compact ? [antdTheme.compactAlgorithm] : []),
  ]

  // Our own CSS (the card clamp, the collapse transition, the charts) reads these,
  // so it follows the theme without duplicating any token values.
  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = dark ? 'dark' : 'light'
    root.dataset.motion = reducedMotion ? 'reduced' : 'full'
    root.style.colorScheme = dark ? 'dark' : 'light'
  }, [dark, reducedMotion])

  return (
    <ConfigProvider
      componentSize={compact ? 'small' : 'middle'}
      theme={{
        algorithm,
        token: { colorPrimary: settings.accent, colorLink: settings.accent },
        // antd's own component motion follows the same preference as ours.
        ...(reducedMotion ? { components: {} } : {}),
      }}
      wave={{ disabled: reducedMotion }}
    >
      {children}
    </ConfigProvider>
  )
}
