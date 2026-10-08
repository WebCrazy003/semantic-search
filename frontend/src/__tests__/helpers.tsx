// frontend/src/__tests__/helpers.tsx
// Rendering helpers. The app's state lives in providers, so a test that renders a page in
// isolation has to supply the same tree main.tsx and App do.
//
// Every test starts logged in as an administrator (vitest.setup.ts mocks the session);
// `asUser()` and `loggedOut()` change that for one test.

import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfigProvider } from 'antd'
import type { ReactElement, ReactNode } from 'react'
import { MemoryRouter, useLocation, useNavigate, type NavigateFunction } from 'react-router-dom'
import { vi } from 'vitest'
import App from '../App'
import { AuthProvider } from '../app/AuthContext'
import { DialogsProvider } from '../app/DialogsContext'
import { LibraryProvider } from '../app/LibraryContext'
import { SearchProvider } from '../app/SearchContext'
import { searchPath } from '../pages/searchPath'
import * as api from '../services/api'
import type { User } from '../services/api'
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

// No antd motion: jsdom never fires the animation events that end a modal's or a
// drawer's enter and leave, so a dialog would stay half-open or half-closed and could
// not be asserted on. The app's own ConfigProvider (ThemeProvider) inherits this token.
const NO_MOTION = { token: { motion: false } }

function Providers({ children }: { children: ReactNode }) {
  return (
    <ConfigProvider theme={NO_MOTION}>
      <SettingsProvider>
        <ThemeProvider>
          <AuthProvider>{children}</AuthProvider>
        </ThemeProvider>
      </SettingsProvider>
    </ConfigProvider>
  )
}

// The router this render is using, captured so a test can press Back or read where the
// app is: MemoryRouter has no address bar to look at.
let routerNavigate: NavigateFunction | null = null

function RouterProbe() {
  const location = useLocation()
  routerNavigate = useNavigate()
  return (
    <output data-testid="location" hidden>
      {location.pathname + location.search}
    </output>
  )
}

/** Where the app is, as `pathname + search`, e.g. `/search?q=x`. */
export function currentLocation(): string {
  return screen.getByTestId('location').textContent ?? ''
}

/** The browser's Back button. */
export async function goBack() {
  await act(async () => {
    await routerNavigate?.(-1)
  })
}

/**
 * One page or component, at one route, with the real providers around it, as App mounts
 * them. The dialogs read the URL (?dialog=), so they sit inside the router.
 */
export function renderWithProviders(ui: ReactElement, route = '/') {
  return render(
    <Providers>
      <MemoryRouter initialEntries={[route]}>
        <DialogsProvider>
          <LibraryProvider>
            <SearchProvider>
              {ui}
              <RouterProbe />
            </SearchProvider>
          </LibraryProvider>
        </DialogsProvider>
      </MemoryRouter>
    </Providers>,
  )
}

/** The whole app, starting at `route`. */
export function renderApp(route = '/') {
  return render(
    <Providers>
      <MemoryRouter initialEntries={[route]}>
        <App />
        <RouterProbe />
      </MemoryRouter>
    </Providers>,
  )
}

/** The whole app, opened straight on the results for `query`, as a bookmark would. */
export function renderResults(query: string) {
  return renderApp(searchPath(query))
}

/**
 * Search the way a reader does: type into whichever search box is on screen (the big
 * one on the home page, or the header's on the results page) and press Enter. The
 * header box shows the current query, so it is cleared first.
 */
export async function searchFor(query: string) {
  const box = await screen.findByRole('textbox', { name: /search documents/i })
  await userEvent.clear(box)
  await userEvent.type(box, `${query}{Enter}`)
}

/** The modal that is open, by its heading (antd modals without a title have no name). */
export async function findDialog(heading: string | RegExp): Promise<HTMLElement> {
  const title = await screen.findByRole('heading', { name: heading })
  return title.closest('.ant-modal') as HTMLElement
}

/**
 * Choose a value in an Ant Design Select. It is not a native <select>, so
 * userEvent.selectOptions does not apply: the control is a combobox that opens a
 * listbox of its own.
 */
export async function chooseOption(label: string | RegExp, option: string | RegExp) {
  await userEvent.click(screen.getByLabelText(label))
  await userEvent.click(await screen.findByTitle(option))
}

/** What the document manager lists: by default an empty tree, as on a fresh account. */
export function givenDrive(files: api.DriveFile[] = [], folders: api.DriveFolder[] = []) {
  vi.spyOn(api, 'listDrive').mockImplementation(async (tree = 'me', folderId = null) => ({
    tree,
    folder_id: folderId ?? null,
    breadcrumb: [],
    folders: folderId ? [] : folders,
    files: files.filter((file) => (file.folder_id ?? null) === (folderId ?? null)),
    not_indexed: files.filter((file) => file.state === 'not_indexed').length,
  }))
  vi.spyOn(api, 'getDriveTree').mockImplementation(async (tree = 'me') => ({
    tree,
    folders,
    root_file_count: files.filter((file) => !file.folder_id).length,
  }))
}

/** One file as the document manager lists it. */
export function makeDriveFile(overrides: Partial<api.DriveFile> = {}): api.DriveFile {
  return {
    file_id: 'file-1',
    name: 'manual_zh.pdf',
    folder_id: null,
    file_type: 'pdf',
    size: 4096,
    modified_at: '2026-10-01T00:00:00Z',
    state: 'indexed',
    error: null,
    document_id: 'a'.repeat(64),
    pages: 12,
    pages_approximate: false,
    chunks: 30,
    visibility: 'private',
    ...overrides,
  }
}

