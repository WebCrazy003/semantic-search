// frontend/src/__tests__/Accounts.test.tsx
// Logging in, the pages for someone without a session, and what each role sees.

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RESET_STORAGE_KEY } from '../pages/ForgotPasswordPage'
import * as api from '../services/api'
import { makeDocument, makeStatus } from './fixtures'
import { ADMIN, USER, asUser, givenSession, loggedOut, renderApp } from './helpers'

beforeEach(() => {
  vi.spyOn(api, 'getDocuments').mockResolvedValue([makeDocument()])
  vi.spyOn(api, 'getIndexStatus').mockResolvedValue(makeStatus())
  vi.spyOn(api, 'getJobs').mockResolvedValue([])
  vi.spyOn(api, 'fetchReadiness').mockResolvedValue({ status: 'ready', model_loaded: true })
  vi.spyOn(api, 'listUsers').mockResolvedValue([])
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('without a session', () => {
  it('sends a visitor to log in, and back where they were going afterwards', async () => {
    loggedOut()
    const login = vi.spyOn(api, 'login').mockResolvedValue({ user: USER })
    renderApp('/documents')

    await userEvent.type(await screen.findByLabelText('Username'), 'kim')
    await userEvent.type(screen.getByLabelText('Password'), 'a long password')
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }))

    expect(login).toHaveBeenCalledWith('kim', 'a long password')
    expect(await screen.findByText('My documents')).toBeInTheDocument()
  })

  it('shows the error when the login is refused', async () => {
    loggedOut()
    vi.spyOn(api, 'login').mockRejectedValue(new Error('Wrong username or password'))
    renderApp('/login')

    await userEvent.type(await screen.findByLabelText('Username'), 'kim')
    await userEvent.type(screen.getByLabelText('Password'), 'not it')
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }))
    expect(await screen.findByText('Wrong username or password')).toBeInTheDocument()
  })

  it('offers sign-up only while it is open', async () => {
    loggedOut({ registration_open: false })
    renderApp('/login')
    await screen.findByRole('button', { name: 'Log in' })
    expect(screen.queryByRole('link', { name: /create an account/i })).not.toBeInTheDocument()
  })

  it('says registration is closed on the sign-up page', async () => {
    loggedOut({ registration_open: false })
    renderApp('/register')
    expect(await screen.findByText(/registration is closed/i)).toBeInTheDocument()
  })

  it('sends a fresh install to setup', async () => {
    loggedOut({ setup_required: true })
    renderApp('/search')
    expect(await screen.findByRole('heading', { name: 'Set up DocSage' })).toBeInTheDocument()
  })

  it('checks the password is typed the same twice', async () => {
    loggedOut()
    const register = vi.spyOn(api, 'register')
    renderApp('/register')
    await userEvent.type(await screen.findByLabelText('Username'), 'kim')
    await userEvent.type(screen.getByLabelText('Password'), 'first password')
    await userEvent.type(screen.getByLabelText('Password again'), 'other password')
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByText('The two passwords do not match')).toBeInTheDocument()
    expect(register).not.toHaveBeenCalled()
  })
})

describe('forgot password', () => {
  it('asks with a username and then waits for an administrator', async () => {
    loggedOut()
    vi.spyOn(api, 'requestPasswordReset').mockResolvedValue({
      request_token: 'secret-token',
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    })
    vi.spyOn(api, 'getResetStatus').mockResolvedValue({ status: 'pending' })
    renderApp('/forgot-password')

    await userEvent.type(await screen.findByLabelText('Username'), 'kim')
    await userEvent.click(screen.getByRole('button', { name: 'Request a reset' }))

    expect(await screen.findByText(/your request for kim was sent/i)).toBeInTheDocument()
    // The token is kept for this browser, never shown.
    expect(screen.queryByText(/secret-token/)).not.toBeInTheDocument()
    expect(window.localStorage.getItem(RESET_STORAGE_KEY)).toContain('secret-token')
  })

  it('resumes after a reload and offers the new password once approved', async () => {
    loggedOut()
    window.localStorage.setItem(
      RESET_STORAGE_KEY,
      JSON.stringify({
        username: 'kim',
        token: 'secret-token',
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      }),
    )
    vi.spyOn(api, 'getResetStatus').mockResolvedValue({ status: 'approved' })
    const complete = vi.spyOn(api, 'completePasswordReset').mockResolvedValue({ user: USER })
    renderApp('/forgot-password')

    expect(await screen.findByText(/an administrator approved your request/i)).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('New password'), 'my new password')
    await userEvent.type(screen.getByLabelText('New password again'), 'my new password')
    await userEvent.click(screen.getByRole('button', { name: /set password and log in/i }))

    expect(complete).toHaveBeenCalledWith('secret-token', 'my new password')
    await waitFor(() => expect(window.localStorage.getItem(RESET_STORAGE_KEY)).toBeNull())
  })

  it('says so when the request was denied', async () => {
    loggedOut()
    window.localStorage.setItem(
      RESET_STORAGE_KEY,
      JSON.stringify({
        username: 'kim',
        token: 't',
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      }),
    )
    vi.spyOn(api, 'getResetStatus').mockResolvedValue({ status: 'denied' })
    renderApp('/forgot-password')
    expect(await screen.findByText(/an administrator declined/i)).toBeInTheDocument()
  })
})

describe('a password that must change', () => {
  it('holds the user on the change-password screen', async () => {
    givenSession({ ...USER, must_change_password: true })
    renderApp('/search')
    expect(
      await screen.findByRole('heading', { name: 'Choose your own password' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Search' })).not.toBeInTheDocument()
  })
})

describe('a regular user', () => {
  it('has no settings button, and settings and admin send them to search', async () => {
    asUser()
    renderApp('/settings')
    expect(await screen.findByRole('button', { name: /add more documents/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument()
  })

  it.each(['/admin', '/admin/users'])('is sent from %s to search', async (route) => {
    asUser()
    renderApp(route)
    expect(await screen.findByRole('button', { name: /add more documents/i })).toBeInTheDocument()
  })

  it('can change the theme from the account menu', async () => {
    asUser()
    renderApp('/search')
    await userEvent.click(await screen.findByRole('button', { name: 'Account: kim' }))
    await userEvent.click(await screen.findByText('Appearance'))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByText('Dark'))
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'))
  })

  it('sees their own documents apart from public ones, and cannot remove public ones', async () => {
    asUser()
    vi.spyOn(api, 'getDocuments').mockResolvedValue([
      makeDocument({ filename: 'mine.pdf', document_id: 'm'.repeat(64) }),
      makeDocument({
        filename: 'shared.pdf',
        document_id: 's'.repeat(64),
        is_mine: false,
        visibility: 'public',
        filepath: '',
      }),
    ])
    renderApp('/documents')

    const mine = (await screen.findByText('My documents')).closest('.ant-card') as HTMLElement
    const shared = screen.getByText('Public documents').closest('.ant-card') as HTMLElement
    // The cards render at once; their rows arrive with the document list.
    expect(await within(mine).findByText('mine.pdf')).toBeInTheDocument()
    expect(within(shared).getByText('shared.pdf')).toBeInTheDocument()
    expect(within(shared).queryByRole('button', { name: /remove/i })).not.toBeInTheDocument()
    expect(screen.queryByText('Clear the index')).not.toBeInTheDocument()
  })

  it('chooses between their own documents and public ones when searching', async () => {
    asUser()
    const search = vi
      .spyOn(api, 'search')
      .mockResolvedValue({ query: 'x', count: 0, took_ms: 1, results: [] })
    renderApp('/search')
    await userEvent.click(await screen.findByLabelText('Show'))
    await userEvent.click(await screen.findByTitle('Only public'))
    await userEvent.type(screen.getByRole('textbox', { name: /search/i }), 'x{Enter}')
    expect(search).toHaveBeenCalledWith(expect.objectContaining({ scope: 'public' }))
  })
})

describe('an administrator', () => {
  it('sees owners and can make a document public', async () => {
    vi.spyOn(api, 'getDocuments').mockResolvedValue([
      makeDocument({ owner_id: 'kim-id', owner_username: 'kim', is_mine: false }),
    ])
    const publish = vi
      .spyOn(api, 'setVisibilityInBulk')
      .mockResolvedValue({ updated: 1, not_found: [] })
    renderApp('/documents')

    const card = (await screen.findByText('Indexed documents')).closest('.ant-card') as HTMLElement
    const table = within(card).getByRole('table')
    expect(within(table).getByText('kim')).toBeInTheDocument()
    await userEvent.click(within(table).getByRole('switch', { name: /manual_zh\.pdf is private/i }))
    expect(publish).toHaveBeenCalledWith(['a'.repeat(64)], 'public')
  })

  it('is shown waiting reset requests and approves one after confirming', async () => {
    vi.spyOn(api, 'getMe').mockResolvedValue({ user: ADMIN, pending_reset_requests: 1 })
    vi.spyOn(api, 'listUsers').mockResolvedValue([])
    vi.spyOn(api, 'getAuthSettings').mockResolvedValue({ registration_open: true })
    vi.spyOn(api, 'listResetRequests').mockResolvedValue([
      {
        request_id: 'r1',
        user_id: 'kim-id',
        username: 'kim',
        user_disabled: false,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        client_ip: '192.168.0.23',
      },
    ])
    const approve = vi.spyOn(api, 'approveResetRequest').mockResolvedValue(undefined)
    renderApp('/admin/users')

    expect(await screen.findByText('192.168.0.23')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }))
    expect(await screen.findByText(/approve the password reset for kim/i)).toBeInTheDocument()
    expect(approve).not.toHaveBeenCalled()
    const confirm = screen.getAllByRole('button', { name: 'Approve' }).at(-1) as HTMLElement
    await userEvent.click(confirm)
    expect(approve).toHaveBeenCalledWith('r1')
  })

  it('has the settings button', async () => {
    renderApp('/search')
    expect(await screen.findByRole('button', { name: 'Settings' })).toBeInTheDocument()
  })
})
