// frontend/src/__tests__/Accounts.test.tsx
// Logging in, the account dialogs, the account menu, and what each role sees. There are
// no account pages any more: everything here happens in a modal over whatever screen is
// open (spec 2026-10-08 §1.2, §1.3).

import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RESET_STORAGE_KEY } from '../components/account/ForgotPassword'
import * as api from '../services/api'
import { STORAGE_KEY } from '../settings/settings'
import { makeDocument, makeStatus } from './fixtures'
import {
  ADMIN,
  USER,
  asUser,
  currentLocation,
  findDialog,
  givenDrive,
  givenSession,
  loggedOut,
  makeDriveFile,
  renderApp,
  renderResults,
} from './helpers'

beforeEach(() => {
  vi.spyOn(api, 'getDocuments').mockResolvedValue([makeDocument()])
  vi.spyOn(api, 'getIndexStatus').mockResolvedValue(makeStatus())
  vi.spyOn(api, 'getJobs').mockResolvedValue([])
  vi.spyOn(api, 'fetchReadiness').mockResolvedValue({ status: 'ready', model_loaded: true })
  vi.spyOn(api, 'listUsers').mockResolvedValue([])
  vi.spyOn(api, 'search').mockResolvedValue({ query: 'x', count: 0, took_ms: 1, results: [] })
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** Open the login dialog the way a visitor does, from the top-right button. */
async function openLogin(): Promise<HTMLElement> {
  await userEvent.click(await screen.findByRole('button', { name: 'Log in' }))
  return findDialog('Log in to DocSage')
}

async function logIn(dialog: HTMLElement, username = 'kim', password = 'a long password') {
  await userEvent.type(within(dialog).getByLabelText('Username'), username)
  await userEvent.type(within(dialog).getByLabelText('Password'), password)
  await userEvent.click(within(dialog).getByRole('button', { name: 'Log in' }))
}

async function openAccountMenu(username: string) {
  await userEvent.click(await screen.findByRole('button', { name: `Account: ${username}` }))
}

async function openSettings(): Promise<HTMLElement> {
  await userEvent.click(await screen.findByRole('button', { name: 'Settings' }))
  return screen.findByRole('dialog', { name: 'Settings' })
}

describe('logging in', () => {
  it('happens in a dialog over the current screen, which stays where it was', async () => {
    loggedOut()
    const login = vi.spyOn(api, 'login').mockResolvedValue({ user: USER })
    renderApp()
    await logIn(await openLogin())

    expect(login).toHaveBeenCalledWith('kim', 'a long password')
    const avatar = await screen.findByRole('button', { name: 'Account: kim' })
    expect(avatar).toHaveTextContent('K')
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Log in to DocSage' })).not.toBeInTheDocument(),
    )
    expect(currentLocation()).toBe('/')
  })

  it('asks a visitor on the drive to log in, then loads it in place', async () => {
    loggedOut()
    vi.spyOn(api, 'login').mockResolvedValue({ user: USER })
    renderApp('/drive')

    expect(await screen.findByText('Log in to manage your documents')).toBeInTheDocument()
    await logIn(await findDialog('Log in to DocSage'))

    expect(await screen.findByRole('navigation', { name: 'Folders' })).toBeInTheDocument()
    expect(currentLocation()).toBe('/drive')
  })

  it('can be closed, leaving the visitor where they were', async () => {
    loggedOut()
    renderApp('/drive')
    const dialog = await findDialog('Log in to DocSage')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Log in to DocSage' })).not.toBeInTheDocument(),
    )
    // The prompt behind it can open it again.
    expect(screen.getByText('Log in to manage your documents')).toBeInTheDocument()
  })

  it('shows the error when the login is refused', async () => {
    loggedOut()
    vi.spyOn(api, 'login').mockRejectedValue(new Error('Wrong username or password'))
    renderApp()
    const dialog = await openLogin()
    await logIn(dialog, 'kim', 'not it')
    expect(await within(dialog).findByText('Wrong username or password')).toBeInTheDocument()
  })

  it('offers sign-up only while it is open', async () => {
    loggedOut({ registration_open: false })
    renderApp()
    const dialog = await openLogin()
    expect(within(dialog).queryByRole('button', { name: /create an account/i })).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /forgot your password/i })).toBeInTheDocument()
  })
})

describe('the steps inside the login dialog', () => {
  it('switches to sign-up and back without leaving the dialog', async () => {
    loggedOut()
    renderApp()
    const dialog = await openLogin()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create an account' }))

    const signUp = await findDialog('Create an account')
    expect(within(signUp).getByLabelText('Password again')).toBeInTheDocument()
    expect(currentLocation()).toBe('/')

    await userEvent.click(within(signUp).getByRole('button', { name: 'Log in' }))
    expect(await findDialog('Log in to DocSage')).toBeInTheDocument()
  })

  it('switches to forgot-password and back', async () => {
    loggedOut()
    renderApp()
    const dialog = await openLogin()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Forgot your password?' }))

    const forgot = await findDialog('Reset your password')
    expect(within(forgot).getByRole('button', { name: 'Request a reset' })).toBeInTheDocument()

    await userEvent.click(within(forgot).getByRole('button', { name: 'Back to log in' }))
    expect(await findDialog('Log in to DocSage')).toBeInTheDocument()
  })

  it('creates an account and logs straight in', async () => {
    loggedOut()
    const register = vi.spyOn(api, 'register').mockResolvedValue({ user: USER })
    renderApp()
    const dialog = await openLogin()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create an account' }))
    const signUp = await findDialog('Create an account')
    await userEvent.type(within(signUp).getByLabelText('Username'), 'kim')
    await userEvent.type(within(signUp).getByLabelText('Password'), 'first password')
    await userEvent.type(within(signUp).getByLabelText('Password again'), 'first password')
    await userEvent.click(within(signUp).getByRole('button', { name: 'Create account' }))

    expect(register).toHaveBeenCalledWith('kim', 'first password')
    expect(await screen.findByRole('button', { name: 'Account: kim' })).toBeInTheDocument()
  })

  it('checks the password is typed the same twice', async () => {
    loggedOut()
    const register = vi.spyOn(api, 'register')
    renderApp('/register')
    const signUp = await findDialog('Create an account')
    await userEvent.type(within(signUp).getByLabelText('Username'), 'kim')
    await userEvent.type(within(signUp).getByLabelText('Password'), 'first password')
    await userEvent.type(within(signUp).getByLabelText('Password again'), 'other password')
    await userEvent.click(within(signUp).getByRole('button', { name: 'Create account' }))
    expect(await within(signUp).findByText('The two passwords do not match')).toBeInTheDocument()
    expect(register).not.toHaveBeenCalled()
  })

  it('says registration is closed in the sign-up step', async () => {
    loggedOut({ registration_open: false })
    renderApp('/register')
    expect(await screen.findByText(/registration is closed/i)).toBeInTheDocument()
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

    const dialog = await findDialog('Reset your password')
    await userEvent.type(within(dialog).getByLabelText('Username'), 'kim')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Request a reset' }))

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
    expect(await screen.findByRole('button', { name: 'Account: kim' })).toBeInTheDocument()
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

describe('first-run setup', () => {
  it('opens over the home page on a fresh install', async () => {
    loggedOut({ setup_required: true })
    renderApp()
    const dialog = await findDialog('Set up DocSage')
    expect(within(dialog).getByLabelText('Administrator username')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'DocSage' })).toBeInTheDocument()
  })

  it('opens over any screen, and the login dialog stays out of its way', async () => {
    loggedOut({ setup_required: true })
    renderApp('/drive')
    expect(await findDialog('Set up DocSage')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Log in to DocSage' })).not.toBeInTheDocument()
  })

  it('cannot be closed', async () => {
    loggedOut({ setup_required: true })
    renderApp()
    const dialog = await findDialog('Set up DocSage')
    await waitFor(() => expect(dialog).toBeVisible())
    expect(within(dialog).queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await userEvent.click(dialog.closest('.ant-modal-wrap') as HTMLElement)
    expect(screen.getByRole('heading', { name: 'Set up DocSage' })).toBeVisible()
  })

  it('creates the administrator and closes', async () => {
    loggedOut({ setup_required: true })
    const setup = vi.spyOn(api, 'setupAdmin').mockResolvedValue({ user: ADMIN })
    renderApp()
    const dialog = await findDialog('Set up DocSage')
    await userEvent.type(within(dialog).getByLabelText('Administrator username'), 'boss')
    await userEvent.type(within(dialog).getByLabelText('Password'), 'a long password')
    await userEvent.type(within(dialog).getByLabelText('Password again'), 'a long password')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create administrator' }))

    expect(setup).toHaveBeenCalledWith('boss', 'a long password')
    expect(await screen.findByRole('button', { name: 'Account: boss' })).toBeInTheDocument()
  })
})

describe('a password that must change', () => {
  const MUST_CHANGE = { ...USER, must_change_password: true }

  it.each(['/', '/search?q=x', '/drive'])('holds the user in the dialog on %s', async (route) => {
    givenSession(MUST_CHANGE)
    renderApp(route)
    expect(await findDialog('Choose your own password')).toBeInTheDocument()
  })

  it('cannot be dismissed: no close button, Esc does nothing, and the mask is not clickable', async () => {
    givenSession(MUST_CHANGE)
    renderApp()
    const dialog = await findDialog('Choose your own password')
    await waitFor(() => expect(dialog).toBeVisible())
    expect(within(dialog).queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    // antd closes on a click that lands on the wrap around the dialog, outside it.
    await userEvent.click(dialog.closest('.ant-modal-wrap') as HTMLElement)
    expect(screen.getByRole('heading', { name: 'Choose your own password' })).toBeVisible()
  })

  it('offers logging out as the only other way out', async () => {
    givenSession(MUST_CHANGE)
    vi.spyOn(api, 'logout').mockResolvedValue(undefined)
    renderApp()
    const dialog = await findDialog('Choose your own password')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Log out instead' }))
    expect(await screen.findByRole('button', { name: 'Log in' })).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Choose your own password' })).not.toBeInTheDocument(),
    )
  })

  it('does not load the drive behind the dialog', async () => {
    givenSession(MUST_CHANGE)
    renderApp('/drive')
    await findDialog('Choose your own password')
    expect(screen.queryByText('My documents')).not.toBeInTheDocument()
  })

  it('lets go once the password is changed', async () => {
    givenSession(MUST_CHANGE)
    const change = vi.spyOn(api, 'changePassword').mockResolvedValue(undefined)
    renderApp()
    const dialog = await findDialog('Choose your own password')
    await userEvent.type(within(dialog).getByLabelText('Password you were given'), 'given one')
    await userEvent.type(within(dialog).getByLabelText('New password'), 'my own password')
    await userEvent.type(within(dialog).getByLabelText('New password again'), 'my own password')
    // The session now says the change is done.
    asUser()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Change password' }))

    expect(change).toHaveBeenCalledWith('given one', 'my own password')
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Choose your own password' })).not.toBeInTheDocument(),
    )
  })
})

describe('the account menu', () => {
  it('opens the document manager in a new tab', async () => {
    asUser()
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    renderApp()
    await openAccountMenu('kim')
    await userEvent.click(await screen.findByText('Manage documents'))
    expect(open).toHaveBeenCalledWith(expect.stringMatching(/#\/drive$/), '_blank', 'noopener')
    // This tab stays where it was.
    expect(currentLocation()).toBe('/')
  })

  it('changes the password in a dialog that can be cancelled', async () => {
    asUser()
    renderApp()
    await openAccountMenu('kim')
    await userEvent.click(await screen.findByText('Change password'))
    const dialog = await findDialog('Change your password')
    expect(within(dialog).getByLabelText('Current password')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Change your password' })).not.toBeInTheDocument(),
    )
  })

  it('has no Appearance item any more: that lives in settings', async () => {
    asUser()
    renderApp()
    await openAccountMenu('kim')
    await screen.findByText('Change password')
    expect(screen.queryByText('Appearance')).not.toBeInTheDocument()
  })

  it('gives a regular user no admin items', async () => {
    asUser()
    renderApp()
    await openAccountMenu('kim')
    await screen.findByText('Log out')
    expect(screen.queryByText('Admin tools')).not.toBeInTheDocument()
    expect(screen.queryByText(/^Users/)).not.toBeInTheDocument()
  })

  it('logs out without leaving the screen', async () => {
    asUser()
    const logout = vi.spyOn(api, 'logout').mockResolvedValue(undefined)
    renderApp('/')
    await openAccountMenu('kim')
    await userEvent.click(await screen.findByText('Log out'))

    expect(logout).toHaveBeenCalled()
    expect(await screen.findByRole('button', { name: 'Log in' })).toBeInTheDocument()
    expect(currentLocation()).toBe('/')
    expect(screen.getByRole('heading', { name: 'DocSage' })).toBeInTheDocument()
  })
})

describe('a regular user', () => {
  it('has the settings button, and settings shows them three tabs', async () => {
    asUser()
    renderApp()
    const dialog = await openSettings()
    const tabs = within(dialog)
      .getAllByRole('tab')
      .map((tab) => tab.textContent)
    expect(tabs).toEqual(['Appearance', 'Search', 'System'])
  })

  it.each(['/admin', '/admin/users'])('is sent from %s to the home page', async (route) => {
    asUser()
    renderApp(route)
    expect(await screen.findByRole('heading', { name: 'DocSage' })).toBeInTheDocument()
    expect(currentLocation()).toBe('/')
  })

  it('can change the theme from settings', async () => {
    asUser()
    renderApp()
    const dialog = await openSettings()
    await userEvent.click(within(dialog).getByText('Dark'))
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'))
  })

  it('can turn answers off from settings', async () => {
    asUser()
    renderApp()
    const dialog = await openSettings()
    await userEvent.click(within(dialog).getByRole('tab', { name: 'Search' }))
    const toggle = within(dialog).getByLabelText('Answer questions with AI')
    expect(toggle).toBeChecked()
    await userEvent.click(toggle)
    await waitFor(() =>
      expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}').answersEnabled).toBe(false),
    )
  })

  it('sees their own documents apart from public ones, and cannot delete public ones', async () => {
    asUser()
    givenDrive([makeDriveFile({ name: 'mine.pdf' })])
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
    renderApp('/drive')

    expect(await screen.findByText('mine.pdf')).toBeInTheDocument()
    expect(screen.queryByText('shared.pdf')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Public' }))
    expect(await screen.findByText('shared.pdf')).toBeInTheDocument()
    expect(screen.queryByText('mine.pdf')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument()
    // Neither the library nor anyone else's tree is offered to a regular user.
    expect(screen.queryByRole('button', { name: 'Library' })).not.toBeInTheDocument()
  })

  it('chooses between their own documents and public ones when searching', async () => {
    asUser()
    const search = vi
      .spyOn(api, 'search')
      .mockResolvedValue({ query: 'x', count: 0, took_ms: 1, results: [] })
    renderResults('x')
    await screen.findByRole('button', { name: 'Account: kim' })
    await userEvent.click(await screen.findByLabelText('Show'))
    await userEvent.click(await screen.findByTitle('Only public'))
    // The same query again re-runs it with the new scope.
    await userEvent.type(screen.getByRole('textbox', { name: /search documents/i }), '{Enter}')
    await waitFor(() =>
      expect(search).toHaveBeenLastCalledWith(expect.objectContaining({ scope: 'public' })),
    )
  })
})

describe('an administrator', () => {
  it('opens the library and other users, and can make a document public', async () => {
    givenDrive([makeDriveFile({ name: 'manual_zh.pdf' })])
    vi.spyOn(api, 'listUsers').mockResolvedValue([
      { user_id: 'admin-id', username: 'boss' } as api.UserAdminView,
      { user_id: 'kim-id', username: 'kim' } as api.UserAdminView,
    ])
    const publish = vi
      .spyOn(api, 'setVisibilityInBulk')
      .mockResolvedValue({ updated: 1, not_found: [] })
    renderApp('/drive')

    expect(await screen.findByRole('button', { name: 'Library' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'kim' })).toBeInTheDocument()
    fireEvent.contextMenu(await screen.findByText('manual_zh.pdf'))
    await userEvent.click(await screen.findByText('Make public'))
    expect(publish).toHaveBeenCalledWith(['a'.repeat(64)], 'public')
  })

  it('reaches the admin tools from the account menu', async () => {
    renderApp()
    await openAccountMenu('boss')
    await userEvent.click(await screen.findByText('Admin tools'))
    expect(await screen.findByText(/read-only/i)).toBeInTheDocument()
    expect(currentLocation()).toBe('/admin')
  })

  it('reaches the users page from the account menu', async () => {
    vi.spyOn(api, 'getAuthSettings').mockResolvedValue({ registration_open: true })
    vi.spyOn(api, 'listResetRequests').mockResolvedValue([])
    renderApp()
    await openAccountMenu('boss')
    await userEvent.click(await screen.findByText('Users'))
    await waitFor(() => expect(currentLocation()).toBe('/admin/users'))
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

  it('sees all five settings tabs', async () => {
    renderApp()
    const dialog = await openSettings()
    await within(dialog).findByRole('tab', { name: 'Administration' })
    expect(within(dialog).getAllByRole('tab')).toHaveLength(5)
  })
})
