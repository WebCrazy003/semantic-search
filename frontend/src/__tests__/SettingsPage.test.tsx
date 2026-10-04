// frontend/src/__tests__/SettingsPage.test.tsx
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsPage } from '../pages/SettingsPage'
import * as api from '../services/api'
import { DEFAULT_SETTINGS, STORAGE_KEY, coerceSettings } from '../settings/settings'
import { makeStatus } from './fixtures'
import { chooseOption, givenSettings, renderWithProviders } from './helpers'

async function openTab(name: string) {
  await userEvent.click(screen.getByRole('tab', { name }))
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
    renderWithProviders(<SettingsPage />)
    await userEvent.click(screen.getByText('Dark'))
    await waitFor(() => expect(stored().theme).toBe('dark'))
  })

  it('stores the density', async () => {
    renderWithProviders(<SettingsPage />)
    await userEvent.click(screen.getByText('Compact'))
    await waitFor(() => expect(stored().density).toBe('compact'))
  })

  it('stores the accent colour', async () => {
    renderWithProviders(<SettingsPage />)
    // antd hides the native radio, so the visible label is what a user clicks.
    await userEvent.click(screen.getByText('Purple'))
    await waitFor(() => expect(stored().accent).toBe('#722ed1'))
  })

  it('stores the results per search', async () => {
    renderWithProviders(<SettingsPage />)
    await openTab('Search')
    await chooseOption('Results per search', '20')
    await waitFor(() => expect(stored().resultsPerSearch).toBe(20))
  })

  it('stores the default language filter', async () => {
    renderWithProviders(<SettingsPage />)
    await openTab('Search')
    await chooseOption('Default language filter', 'Korean')
    await waitFor(() => expect(stored().defaultLanguage).toBe('ko'))
  })

  it('stores the preview lines', async () => {
    renderWithProviders(<SettingsPage />)
    await openTab('Search')
    await userEvent.click(screen.getByText('6'))
    await waitFor(() => expect(stored().previewLines).toBe(6))
  })

  it('stores the toggles', async () => {
    renderWithProviders(<SettingsPage />)
    await userEvent.click(screen.getByLabelText('Animations'))
    await waitFor(() => expect(stored().animations).toBe(false))
    await openTab('Search')
    await userEvent.click(screen.getByLabelText('Highlight query terms'))
    await waitFor(() => expect(stored().highlightTerms).toBe(false))
    await openTab('Developer')
    await userEvent.click(screen.getByLabelText('Show admin links'))
    await waitFor(() => expect(stored().showAdminLinks).toBe(true))
    await userEvent.click(screen.getByLabelText('Developer mode'))
    await waitFor(() => expect(stored().developerMode).toBe(true))
  })

  it('starts from what was stored before, and applies it', () => {
    givenSettings({ theme: 'dark', previewLines: 4 })
    renderWithProviders(<SettingsPage />)
    // The applied theme is the contract, not which radio antd marks internally.
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('resets everything', async () => {
    givenSettings({ theme: 'dark', density: 'compact', showAdminLinks: true })
    renderWithProviders(<SettingsPage />)
    await userEvent.click(screen.getByRole('button', { name: /reset to defaults/i }))
    await userEvent.click(await screen.findByRole('button', { name: /^reset$/i }))
    await waitFor(() => expect(stored()).toEqual(DEFAULT_SETTINGS))
  })
})

describe('malformed stored settings', () => {
  it('falls back to the defaults rather than breaking', () => {
    window.localStorage.setItem(STORAGE_KEY, '{ not json')
    renderWithProviders(<SettingsPage />)
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
    renderWithProviders(<SettingsPage />)
    await openTab('Administration')
    expect(screen.getByRole('button', { name: /open the admin page/i })).toBeInTheDocument()
  })

  it('explains what it is for', async () => {
    renderWithProviders(<SettingsPage />)
    await openTab('Administration')
    expect(screen.getByText(/how the index is structured/i)).toBeInTheDocument()
  })
})

describe('the backend block', () => {
  it('says where indexing runs and why not the GPU', async () => {
    renderWithProviders(<SettingsPage />)
    await openTab('System')
    expect(await screen.findByText(/indexing runs on the/i)).toBeInTheDocument()
    expect(screen.getByText(/no CUDA device was found/)).toBeInTheDocument()
  })

  it('states that settings stay on this machine', async () => {
    renderWithProviders(<SettingsPage />)
    await openTab('System')
    expect(screen.getByText(/stored in this browser only/i)).toBeInTheDocument()
  })
})

describe('the tabs', () => {
  it('opens on appearance and offers every section', () => {
    renderWithProviders(<SettingsPage />)
    expect(screen.getByRole('tab', { name: 'Appearance' })).toHaveAttribute('aria-selected', 'true')
    for (const name of ['Search', 'Developer', 'Administration', 'System']) {
      expect(screen.getByRole('tab', { name })).toBeInTheDocument()
    }
  })

  it('opens the tab named in the address', () => {
    renderWithProviders(<SettingsPage />, '/settings?tab=developer')
    expect(screen.getByLabelText('Developer mode')).toBeInTheDocument()
  })
})
