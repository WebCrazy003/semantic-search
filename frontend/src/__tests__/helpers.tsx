// frontend/src/__tests__/helpers.tsx
// Rendering helpers. The app's state lives in providers, so a test that renders a page in
// isolation has to supply the same tree main.tsx and App's signed-in layout do.
//
// Every test starts logged in as an administrator (vitest.setup.ts mocks the session);
// `asUser()` and `loggedOut()` change that for one test.

import { render } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import App from '../App'
import { AuthProvider } from '../app/AuthContext'
import { LibraryProvider } from '../app/LibraryContext'
import * as api from '../services/api'
import type { User } from '../services/api'
import { SearchProvider } from '../app/SearchContext'
import { SettingsProvider } from '../settings/SettingsContext'
import { ThemeProvider } from '../settings/ThemeProvider'
import { STORAGE_KEY, type UiSettings } from '../settings/settings'

/** Seed localStorage before a render, the way a returning user's browser would. */
export function givenSettings(settings: Partial<UiSettings>): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
}

export const ADMIN: User = {
  user_id: 'admin-id',
  username: 'boss',
  role: 'admin',
  must_change_password: false,
}

export const USER: User = {
  user_id: 'kim-id',
  username: 'kim',
  role: 'user',
  must_change_password: false,
}

/** The session every test starts with. Called from vitest.setup.ts. */
export function givenSession(user: User | null, extra: Partial<api.AuthStatus> = {}) {
  vi.spyOn(api, 'getAuthStatus').mockResolvedValue({
    setup_required: false,
    registration_open: true,
    user,
    ...extra,
  })
  vi.spyOn(api, 'getMe').mockResolvedValue(
    user ? { user, pending_reset_requests: user.role === 'admin' ? 0 : null } : ({} as api.Me),
  )
}

/** What /api/health/ready says about answers. */
export function givenAnswers(available: boolean) {
  return vi.spyOn(api, 'fetchReadiness').mockResolvedValue({
    status: 'ready',
    model_loaded: true,
    answers_available: available,
    answer_model: available ? 'qwen3-4b' : null,
  })
}

/**
 * Replace /api/ask with a script that drives the handlers itself. `untilAborted` lets a
 * script hold the stream open, as a model still writing does, until Stop or a new search.
 */
export function mockAsk(
  script: (handlers: api.AskHandlers, signal: AbortSignal | undefined) => Promise<void> | void,
) {
  return vi.spyOn(api, 'ask').mockImplementation(async (_params, handlers, signal) => {
    await script(handlers, signal)
  })
}

export function untilAborted(signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (!signal || signal.aborted) return resolve()
    signal.addEventListener('abort', () => resolve(), { once: true })
  })
}

export const asUser = (user: User = USER) => givenSession(user)
export const loggedOut = (extra: Partial<api.AuthStatus> = {}) => givenSession(null, extra)

function Shell({ children }: { children: ReactNode }) {
  return (
    <SettingsProvider>
      <ThemeProvider>
        <AuthProvider>{children}</AuthProvider>
      </ThemeProvider>
    </SettingsProvider>
  )
}

/** One page, at one route, with the real providers around it, as App mounts them. */
export function renderWithProviders(ui: ReactElement, route = '/') {
  return render(
    <Shell>
      <LibraryProvider>
        <SearchProvider>
          <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
        </SearchProvider>
      </LibraryProvider>
    </Shell>,
  )
}

/** The whole app, starting at `route`. */
export function renderApp(route = '/') {
  return render(
    <Shell>
      <MemoryRouter initialEntries={[route]}>
        <App />
      </MemoryRouter>
    </Shell>,
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
