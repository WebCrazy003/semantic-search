// frontend/src/__tests__/SearchBar.test.tsx
// The one search box, in its two sizes: the home page's, which has no button (Enter
// searches, as on Google's), and the results header's, with an icon button at its end.
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SearchBar } from '../components/SearchBar'

describe('SearchBar', () => {
  it('submits on Enter', async () => {
    const onSearch = vi.fn()
    render(<SearchBar onSearch={onSearch} />)
    await userEvent.type(screen.getByRole('textbox', { name: 'Search documents' }), '更换滤芯{Enter}')
    expect(onSearch).toHaveBeenCalledWith('更换滤芯')
  })

  it('does not submit an empty or whitespace query', async () => {
    const onSearch = vi.fn()
    render(<SearchBar onSearch={onSearch} />)
    await userEvent.click(screen.getByRole('button', { name: 'Search' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Search documents' }), '   {Enter}')
    expect(onSearch).not.toHaveBeenCalled()
  })

  it('trims the query it hands on', async () => {
    const onSearch = vi.fn()
    render(<SearchBar onSearch={onSearch} />)
    await userEvent.type(screen.getByLabelText('Search documents'), '  필터 교체 방법  {Enter}')
    expect(onSearch).toHaveBeenCalledWith('필터 교체 방법')
  })

  it('starts from the value it is given', () => {
    render(<SearchBar onSearch={vi.fn()} initialValue="版本控制" />)
    expect(screen.getByRole('textbox', { name: 'Search documents' })).toHaveValue('版本控制')
  })
})

describe('on the home page', () => {
  it('has no search button, and no "Search" text button either', () => {
    render(<SearchBar variant="home" onSearch={vi.fn()} />)
    expect(screen.getByRole('textbox', { name: 'Search documents' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /search/i })).not.toBeInTheDocument()
  })

  it('invites a question in any of the three languages', () => {
    render(<SearchBar variant="home" onSearch={vi.fn()} />)
    expect(screen.getByPlaceholderText(/chinese, korean or english/i)).toBeInTheDocument()
  })

  it('searches on Enter', async () => {
    const onSearch = vi.fn()
    render(<SearchBar variant="home" onSearch={onSearch} />)
    await userEvent.type(screen.getByRole('textbox', { name: 'Search documents' }), '필터 교체{Enter}')
    expect(onSearch).toHaveBeenCalledWith('필터 교체')
  })

  it('takes the focus when asked to', () => {
    render(<SearchBar variant="home" autoFocus onSearch={vi.fn()} />)
    expect(screen.getByRole('textbox', { name: 'Search documents' })).toHaveFocus()
  })
})

describe('in the results header', () => {
  it('ends in an icon button named Search, not a text one', () => {
    render(<SearchBar variant="header" onSearch={vi.fn()} />)
    const button = screen.getByRole('button', { name: 'Search' })
    expect(button).toHaveClass('ant-btn-icon-only')
    expect(button).not.toHaveTextContent(/search/i)
  })

  it('searches when the button is clicked', async () => {
    const onSearch = vi.fn()
    render(<SearchBar variant="header" onSearch={onSearch} />)
    await userEvent.type(screen.getByRole('textbox', { name: 'Search documents' }), '필터 교체')
    await userEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(onSearch).toHaveBeenCalledWith('필터 교체')
  })

  it('shows the button as busy while a search is running', () => {
    render(<SearchBar variant="header" onSearch={vi.fn()} busy />)
    // antd renders a loading button as aria-disabled rather than disabled, so it keeps
    // its place in the tab order instead of dropping focus mid-search.
    expect(screen.getByRole('button', { name: 'Search' })).toHaveClass('ant-btn-loading')
  })
})
