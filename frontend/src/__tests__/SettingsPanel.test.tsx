// frontend/src/__tests__/SettingsPanel.test.tsx
// The settings modal's body (spec 2026-10-08 §1.3). Its tabs depend on who is looking;
// these render it as an administrator, who sees all five, unless a test says otherwise.
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsPanel, tabsFor } from '../components/settings/SettingsPanel'
import * as api from '../services/api'
import { DEFAULT_SETTINGS, STORAGE_KEY, coerceSettings } from '../settings/settings'
import { makeDocument, makeStatus } from './fixtures'
import {
  asUser,
  chooseOption,
  currentLocation,
  givenSettings,
  loggedOut,
  renderApp,
  renderWithProviders,
} from './helpers'

const TAB_STORAGE_KEY = 'docsage.settingsTab'

/** The panel, once the session has loaded and its tabs follow who is looking. */
async function renderPanel() {
  const result = renderWithProviders(<SettingsPanel />)
  await screen.findByRole('tab', { name: 'Appearance' })
  return result
}

function tabNames(): string[] {
  return screen.getAllByRole('tab').map((tab) => tab.textContent ?? '')
}

async function openTab(name: string) {
  // The tabs for a logged-in role appear once the session has loaded.
  await userEvent.click(await screen.findByRole('tab', { name }))
}

function stored() {
  return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}')
}

beforeEach(() => {
  vi.spyOn(api, 'getDocuments').mockResolvedValue([])
  vi.spyOn(api, 'getIndexStatus').mockResolvedValue(makeStatus())
  vi.spyOn(api, 'getJobs').mockResolvedValue([])
  vi.spyOn(api, 'fetchReadiness').mockResolvedValue({
    status: 'ready',
    model_loaded: true,
    embedding_device: 'cpu',
    embedding_fallback_reason: 'no CUDA device was found',
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('persisting settings', () => {
  it('stores the theme', async () => {
    renderWithProviders(<SettingsPanel />)
    await userEvent.click(screen.getByText('Dark'))
    await waitFor(() => expect(stored().theme).toBe('dark'))
  })

  it('stores the density', async () => {
    renderWithProviders(<SettingsPanel />)
    await userEvent.click(screen.getByText('Compact'))
    await waitFor(() => expect(stored().density).toBe('compact'))
  })

  it('stores the accent colour', async () => {
    renderWithProviders(<SettingsPanel />)
    // antd hides the native radio, so the visible label is what a user clicks.
    await userEvent.click(screen.getByText('Purple'))
    await waitFor(() => expect(stored().accent).toBe('#722ed1'))
  })

  it('stores the results per search', async () => {
    renderWithProviders(<SettingsPanel />)
    await openTab('Search')
    await chooseOption('Results per search', '20')
    await waitFor(() => expect(stored().resultsPerSearch).toBe(20))
  })

  it('stores the default language filter', async () => {
    renderWithProviders(<SettingsPanel />)
    await openTab('Search')
    await chooseOption('Default language filter', 'Korean')
    await waitFor(() => expect(stored().defaultLanguage).toBe('ko'))
  })

  it('stores the preview lines', async () => {
    renderWithProviders(<SettingsPanel />)
    await openTab('Search')
    await userEvent.click(screen.getByText('6'))
    await waitFor(() => expect(stored().previewLines).toBe(6))
  })

  it('stores the toggles', async () => {
    renderWithProviders(<SettingsPanel />)
    await userEvent.click(screen.getByLabelText('Animations'))
    await waitFor(() => expect(stored().animations).toBe(false))
    await openTab('Search')
    await userEvent.click(screen.getByLabelText('Highlight query terms'))
    await waitFor(() => expect(stored().highlightTerms).toBe(false))
    await userEvent.click(screen.getByLabelText('Answer questions with AI'))
    await waitFor(() => expect(stored().answersEnabled).toBe(false))
    await openTab('Developer')
    await userEvent.click(screen.getByLabelText('Show admin links'))
    await waitFor(() => expect(stored().showAdminLinks).toBe(true))
    await userEvent.click(screen.getByLabelText('Developer mode'))
    await waitFor(() => expect(stored().developerMode).toBe(true))
  })

  it('starts from what was stored before, and applies it', () => {
    givenSettings({ theme: 'dark', previewLines: 4 })
    renderWithProviders(<SettingsPanel />)
    // The applied theme is the contract, not which radio antd marks internally.
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('resets everything', async () => {
    givenSettings({ theme: 'dark', density: 'compact', showAdminLinks: true })
    renderWithProviders(<SettingsPanel />)
    await userEvent.click(screen.getByRole('button', { name: /reset to defaults/i }))
    await userEvent.click(await screen.findByRole('button', { name: /^reset$/i }))
    await waitFor(() => expect(stored()).toEqual(DEFAULT_SETTINGS))
  })
})

describe('answering questions', () => {
  it('is on by default and explained on the search tab', async () => {
    renderWithProviders(<SettingsPanel />)
    await openTab('Search')
    expect(screen.getByLabelText('Answer questions with AI')).toBeChecked()
    expect(screen.getByText(/runs on this computer/i)).toBeInTheDocument()
  })

  it('remembers being turned off', async () => {
    givenSettings({ answersEnabled: false })
    renderWithProviders(<SettingsPanel />)
    await openTab('Search')
    expect(screen.getByLabelText('Answer questions with AI')).not.toBeChecked()
    await userEvent.click(screen.getByLabelText('Answer questions with AI'))
    await waitFor(() => expect(stored().answersEnabled).toBe(true))
  })

  it('is not repeated on the settings page appearance tab', () => {
    renderWithProviders(<SettingsPanel />)
    expect(screen.queryByLabelText('Answer questions with AI')).not.toBeInTheDocument()
  })

  it('ignores a stored value that is not a boolean', () => {
    expect(coerceSettings({ answersEnabled: 'yes' }).answersEnabled).toBe(true)
    expect(coerceSettings({ answersEnabled: false }).answersEnabled).toBe(false)
  })
})

describe('malformed stored settings', () => {
  it('falls back to the defaults rather than breaking', () => {
    window.localStorage.setItem(STORAGE_KEY, '{ not json')
    renderWithProviders(<SettingsPanel />)
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(screen.getByLabelText('Animations')).toBeChecked()
  })

  it('ignores a value that is not one of the allowed ones', () => {
    expect(coerceSettings({ theme: 'neon', previewLines: 99, resultsPerSearch: 'lots' })).toEqual(
      DEFAULT_SETTINGS,
    )
  })

  it('keeps the valid fields of a partly wrong object', () => {
    expect(coerceSettings({ theme: 'dark', density: 'enormous' })).toEqual({
      ...DEFAULT_SETTINGS,
      theme: 'dark',
    })
  })
})

describe('the way to the admin page', () => {
  it('is on the administration tab', async () => {
    renderWithProviders(<SettingsPanel />)
    await openTab('Administration')
    expect(screen.getByRole('button', { name: /open the admin page/i })).toBeInTheDocument()
  })

  it('explains what it is for', async () => {
    renderWithProviders(<SettingsPanel />)
    await openTab('Administration')
    expect(screen.getByText(/how the index is structured/i)).toBeInTheDocument()
  })
})

describe('the backend block', () => {
  it('says where indexing runs and why not the GPU', async () => {
    renderWithProviders(<SettingsPanel />)
    await openTab('System')
    expect(await screen.findByText(/indexing runs on the/i)).toBeInTheDocument()
    expect(screen.getByText(/no CUDA device was found/)).toBeInTheDocument()
  })

  it('states that settings stay on this machine', async () => {
    renderWithProviders(<SettingsPanel />)
    await openTab('System')
    expect(screen.getByText(/stored in this browser only/i)).toBeInTheDocument()
  })
})

describe('the tabs', () => {
  it('opens on appearance and offers an administrator every section', async () => {
    renderWithProviders(<SettingsPanel />)
    // The admin tabs arrive with the session.
    expect(await screen.findByRole('tab', { name: 'Administration' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Appearance' })).toHaveAttribute('aria-selected', 'true')
    expect(tabNames()).toEqual(['Appearance', 'Search', 'Developer', 'Administration', 'System'])
  })

  it('offers a logged-in user appearance, search and system', async () => {
    asUser()
    renderWithProviders(<SettingsPanel />)
    await screen.findByRole('tab', { name: 'System' })
    expect(tabNames()).toEqual(['Appearance', 'Search', 'System'])
  })

  it('offers a visitor appearance and search only', async () => {
    loggedOut()
    await renderPanel()
    // Let the session settle as logged out before counting: a visitor's tabs are also
    // what shows while it loads.
    await waitFor(() => expect(api.getAuthStatus).toHaveBeenCalled())
    await act(async () => {})
    expect(tabNames()).toEqual(['Appearance', 'Search'])
  })

  it('decides the tabs by role', () => {
    expect(tabsFor(false, false)).toEqual(['appearance', 'search'])
    expect(tabsFor(true, false)).toEqual(['appearance', 'search', 'system'])
    expect(tabsFor(true, true)).toEqual([
      'appearance',
      'search',
      'developer',
      'administration',
      'system',
    ])
  })

  it('reopens on the tab last chosen, kept in this browser', async () => {
    const { unmount } = await renderPanel()
    await openTab('Developer')
    expect(window.localStorage.getItem(TAB_STORAGE_KEY)).toBe('developer')
    unmount()

    renderWithProviders(<SettingsPanel />)
    expect(await screen.findByRole('tab', { name: 'Developer' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByLabelText('Developer mode')).toBeInTheDocument()
  })

  it('falls back to appearance when the remembered tab is not one this person has', async () => {
    window.localStorage.setItem(TAB_STORAGE_KEY, 'developer')
    asUser()
    renderWithProviders(<SettingsPanel />)
    await screen.findByRole('tab', { name: 'System' })
    expect(screen.getByRole('tab', { name: 'Appearance' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByLabelText('Developer mode')).not.toBeInTheDocument()
  })

  it('ignores a tab named in the address: the tab is not part of the URL', async () => {
    renderWithProviders(<SettingsPanel />, '/?tab=developer')
    await screen.findByRole('tab', { name: 'Developer' })
    expect(screen.getByRole('tab', { name: 'Appearance' })).toHaveAttribute('aria-selected', 'true')
  })
})

describe('in the app', () => {
  it('opens from the gear as a modal, 720 wide', async () => {
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Settings' }))
    const dialog = await screen.findByRole('dialog', { name: 'Settings' })
    expect(within(dialog).getByRole('tab', { name: 'Appearance' })).toBeInTheDocument()
    expect(dialog.closest('.ant-modal')).toHaveStyle({ width: '720px' })
  })

  it('takes an administrator to the admin page and closes itself', async () => {
    vi.spyOn(api, 'getDocuments').mockResolvedValue([makeDocument()])
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Settings' }))
    const dialog = await screen.findByRole('dialog', { name: 'Settings' })
    await userEvent.click(within(dialog).getByRole('tab', { name: 'Administration' }))
    await userEvent.click(within(dialog).getByRole('button', { name: /open the admin page/i }))

    expect(await screen.findByText(/read-only/i)).toBeInTheDocument()
    expect(currentLocation()).toBe('/admin')
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument(),
    )
  })

  it('takes an administrator to the users page', async () => {
    vi.spyOn(api, 'listUsers').mockResolvedValue([])
    vi.spyOn(api, 'listResetRequests').mockResolvedValue([])
    vi.spyOn(api, 'getAuthSettings').mockResolvedValue({ registration_open: true })
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Settings' }))
    const dialog = await screen.findByRole('dialog', { name: 'Settings' })
    await userEvent.click(within(dialog).getByRole('tab', { name: 'Administration' }))
    await userEvent.click(within(dialog).getByRole('button', { name: /manage users/i }))
    await waitFor(() => expect(currentLocation()).toBe('/admin/users'))
  })
})
