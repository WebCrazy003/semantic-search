// frontend/src/__tests__/helpers.tsx
// Rendering helpers. The app's state now lives in providers above the router, so a test
// that renders a page in isolation has to supply the same tree main.tsx does.

import { render } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import App from '../App'
import { LibraryProvider } from '../app/LibraryContext'
import { SearchProvider } from '../app/SearchContext'
import { SettingsProvider } from '../settings/SettingsContext'
import { ThemeProvider } from '../settings/ThemeProvider'
import { STORAGE_KEY, type UiSettings } from '../settings/settings'

/** Seed localStorage before a render, the way a returning user's browser would. */
export function givenSettings(settings: Partial<UiSettings>): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
}

function Providers({ children }: { children: ReactNode }) {
  return (
    <SettingsProvider>
      <ThemeProvider>
        <LibraryProvider>
          <SearchProvider>{children}</SearchProvider>
        </LibraryProvider>
      </ThemeProvider>
    </SettingsProvider>
  )
}

/** One page, at one route, with the real providers around it. */
export function renderWithProviders(ui: ReactElement, route = '/') {
  return render(
    <Providers>
      <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
    </Providers>,
  )
}

/** The whole app, starting at `route`. */
export function renderApp(route = '/') {
  return render(
    <Providers>
      <MemoryRouter initialEntries={[route]}>
        <App />
      </MemoryRouter>
    </Providers>,
  )
}

/**
 * Choose a value in an Ant Design Select. It is not a native <select>, so
 * userEvent.selectOptions does not apply: the control is a combobox that opens a
 * listbox of its own.
 */
export async function chooseOption(label: string | RegExp, option: string | RegExp) {
  const { screen } = await import('@testing-library/react')
  const userEvent = (await import('@testing-library/user-event')).default
  await userEvent.click(screen.getByLabelText(label))
  await userEvent.click(await screen.findByTitle(option))
}

/** The two navigation buttons in the header, not the ones a page happens to render. */
export async function clickNav(name: string | RegExp) {
  const { screen, within } = await import('@testing-library/react')
  const userEvent = (await import('@testing-library/user-event')).default
  const nav = screen.getByRole('navigation', { name: 'Main' })
  await userEvent.click(within(nav).getByRole('button', { name }))
}
