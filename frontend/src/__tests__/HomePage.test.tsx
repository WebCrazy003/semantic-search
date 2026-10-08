// frontend/src/__tests__/HomePage.test.tsx
// The first screen, laid out like google.com (spec 2026-10-08 §1.1): the wordmark, one
// search box, and only settings and the account at the top right.
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../services/api'
import { makeStatus } from './fixtures'
import { asUser, currentLocation, goBack, loggedOut, renderApp, searchFor } from './helpers'

const response: api.SearchResponse = {
  query: '更换滤芯',
  count: 1,
  took_ms: 12,
  results: [
    {
      score: 0.91,
      document_id: 'a',
      filename: 'manual_zh.pdf',
      filepath: '/documents/manual_zh.pdf',
      page_start: 12,
      page_end: 12,
      chunk_index: 4,
      heading: null,
      language: 'zh',
      text: '在更换滤芯之前，必须先关闭主电源开关。',
    },
  ],
}

beforeEach(() => {
  vi.spyOn(api, 'getDocuments').mockResolvedValue([])
  vi.spyOn(api, 'getIndexStatus').mockResolvedValue(makeStatus())
  vi.spyOn(api, 'getJobs').mockResolvedValue([])
  vi.spyOn(api, 'fetchReadiness').mockResolvedValue({ status: 'ready', model_loaded: true })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('HomePage', () => {
  it('shows the wordmark as text, not an image', async () => {
    renderApp()
    const wordmark = await screen.findByRole('heading', { name: 'DocSage' })
    expect(wordmark).toHaveTextContent('DocSage')
    expect(wordmark.querySelector('img, svg')).toBeNull()
  })

  it('has one search box, focused, and no search button', async () => {
    renderApp()
    const box = await screen.findByRole('textbox', { name: 'Search documents' })
    expect(box).toHaveFocus()
    expect(screen.getAllByRole('textbox')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /^search/i })).not.toBeInTheDocument()
  })

  it('has no navigation bar and none of the old start page', async () => {
    renderApp()
    await screen.findByRole('heading', { name: 'DocSage' })
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /manage documents/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/find knowledge locally/i)).not.toBeInTheDocument()
  })

  it('keeps the privacy note in the footer', async () => {
    renderApp()
    expect(await screen.findByText(/no document leaves it/i)).toBeInTheDocument()
  })

  it('does not ask for the library, which a visitor could not read', async () => {
    loggedOut()
    renderApp()
    await screen.findByRole('button', { name: 'Log in' })
    expect(api.getDocuments).not.toHaveBeenCalled()
  })
})

describe('the top-right buttons', () => {
  it('offers settings and Log in to a visitor', async () => {
    loggedOut()
    renderApp()
    expect(await screen.findByRole('button', { name: 'Log in' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^account/i })).not.toBeInTheDocument()
  })

  it('opens the login dialog from Log in', async () => {
    loggedOut()
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Log in' }))
    expect(await screen.findByRole('heading', { name: 'Log in to DocSage' })).toBeInTheDocument()
    // A dialog over the home page, not a page of its own.
    expect(currentLocation()).toBe('/')
    expect(screen.getByRole('heading', { name: 'DocSage' })).toBeInTheDocument()
  })

  it('shows a logged-in user an avatar with their first letter', async () => {
    asUser()
    renderApp()
    const avatar = await screen.findByRole('button', { name: 'Account: kim' })
    expect(avatar).toHaveTextContent('K')
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Log in' })).not.toBeInTheDocument()
  })

  it('opens settings in a dialog, never a page', async () => {
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Settings' }))
    expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeInTheDocument()
    expect(currentLocation()).toBe('/')
  })
})

describe('searching from here', () => {
  it('goes to the results page with the query in the address', async () => {
    const spy = vi.spyOn(api, 'search').mockResolvedValue(response)
    renderApp()
    await searchFor('更换滤芯')

    expect(currentLocation()).toBe(`/search?q=${encodeURIComponent('更换滤芯')}`)
    expect(await screen.findByTestId('result-card')).toBeInTheDocument()
    expect(spy).toHaveBeenCalledWith({ query: '更换滤芯', topK: 10 })
    // The results layout: the header carries the box, the query and the same buttons.
    expect(screen.getByRole('textbox', { name: 'Search documents' })).toHaveValue('更换滤芯')
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Account: boss' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /go to the start page/i })).toBeInTheDocument()
  })

  it('lets a visitor search too', async () => {
    loggedOut()
    const spy = vi.spyOn(api, 'search').mockResolvedValue(response)
    renderApp()
    await searchFor('更换滤芯')
    expect(await screen.findByTestId('result-card')).toBeInTheDocument()
    expect(spy).toHaveBeenCalledOnce()
  })

  it('comes back home with Back', async () => {
    vi.spyOn(api, 'search').mockResolvedValue(response)
    renderApp()
    await searchFor('更换滤芯')
    await screen.findByTestId('result-card')
    await goBack()
    expect(currentLocation()).toBe('/')
    expect(screen.getByRole('heading', { name: 'DocSage' })).toBeInTheDocument()
  })

  it('does nothing for an empty query', async () => {
    const spy = vi.spyOn(api, 'search')
    renderApp()
    await userEvent.type(await screen.findByRole('textbox', { name: 'Search documents' }), '   {Enter}')
    expect(currentLocation()).toBe('/')
    await waitFor(() => expect(spy).not.toHaveBeenCalled())
  })
})
