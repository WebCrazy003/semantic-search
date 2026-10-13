// frontend/src/__tests__/SearchBar.test.tsx
// The one search box, in its two sizes: the home page's, which has no button (Enter
// searches, as on Google's), and the results header's, with an icon button at its end.
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { readRecentSearches, rememberSearch } from '../app/recentSearches'
import { SearchBar } from '../components/SearchBar'

describe('SearchBar', () => {
  it('submits on Enter', async () => {
    const onSearch = vi.fn()
    render(<SearchBar onSearch={onSearch} />)
    await userEvent.type(screen.getByRole('combobox', { name: 'Search documents' }), '更换滤芯{Enter}')
    expect(onSearch).toHaveBeenCalledWith('更换滤芯')
  })

  it('does not submit an empty or whitespace query', async () => {
    const onSearch = vi.fn()
    render(<SearchBar onSearch={onSearch} />)
    await userEvent.click(screen.getByRole('button', { name: 'Search' }))
    await userEvent.type(screen.getByRole('combobox', { name: 'Search documents' }), '   {Enter}')
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
    expect(screen.getByRole('combobox', { name: 'Search documents' })).toHaveValue('版本控制')
  })
})

describe('on the home page', () => {
  it('has no search button, and no "Search" text button either', () => {
    render(<SearchBar variant="home" onSearch={vi.fn()} />)
    expect(screen.getByRole('combobox', { name: 'Search documents' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /search/i })).not.toBeInTheDocument()
  })

  it('invites a question in any of the three languages', () => {
    render(<SearchBar variant="home" onSearch={vi.fn()} />)
    expect(screen.getByPlaceholderText(/chinese, korean or english/i)).toBeInTheDocument()
  })

  it('searches on Enter', async () => {
    const onSearch = vi.fn()
    render(<SearchBar variant="home" onSearch={onSearch} />)
    await userEvent.type(screen.getByRole('combobox', { name: 'Search documents' }), '필터 교체{Enter}')
    expect(onSearch).toHaveBeenCalledWith('필터 교체')
  })

  it('takes the focus when asked to', () => {
    render(<SearchBar variant="home" autoFocus onSearch={vi.fn()} />)
    expect(screen.getByRole('combobox', { name: 'Search documents' })).toHaveFocus()
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
    await userEvent.type(screen.getByRole('combobox', { name: 'Search documents' }), '필터 교체')
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

describe('recent searches', () => {
  const box = () => screen.getByRole('combobox', { name: 'Search documents' })

  it('remembers what was searched, newest first and only once', async () => {
    render(<SearchBar onSearch={vi.fn()} historyOwner="u1" />)
    await userEvent.type(box(), 'alpha{Enter}')
    await userEvent.clear(box())
    await userEvent.type(box(), 'beta{Enter}')
    await userEvent.clear(box())
    await userEvent.type(box(), 'alpha{Enter}')
    expect(readRecentSearches('u1')).toEqual(['alpha', 'beta'])
  })

  it('treats the same words in another case as the same search', () => {
    rememberSearch(null, 'filter')
    rememberSearch(null, 'Filter')
    expect(readRecentSearches(null)).toEqual(['Filter'])
  })

  it('forgets the highlighted search on Shift+Delete', async () => {
    rememberSearch(null, 'keep')
    rememberSearch(null, 'drop')
    render(<SearchBar onSearch={vi.fn()} />)
    await userEvent.click(box())
    await userEvent.keyboard('{ArrowDown}{Shift>}{Delete}{/Shift}')
    expect(readRecentSearches(null)).toEqual(['keep'])
  })

  it('keeps each account apart, and visitors apart from both', () => {
    rememberSearch('u1', 'mine')
    expect(readRecentSearches('u2')).toEqual([])
    expect(readRecentSearches(null)).toEqual([])
  })

  it('drops down on a click, not when the box merely takes the focus', async () => {
    rememberSearch(null, 'filter')
    render(<SearchBar variant="home" autoFocus onSearch={vi.fn()} />)
    expect(screen.queryByRole('listbox', { name: 'Recent searches' })).not.toBeInTheDocument()
    await userEvent.click(box())
    expect(screen.getByRole('option', { name: 'filter' })).toBeInTheDocument()
    expect(box()).toHaveAttribute('aria-expanded', 'true')
  })

  it('narrows the list to what is typed', async () => {
    rememberSearch(null, 'filter housing')
    rememberSearch(null, 'version control')
    render(<SearchBar onSearch={vi.fn()} />)
    await userEvent.click(box())
    await userEvent.type(box(), 'filt')
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'filter housing',
    ])
  })

  it('runs the highlighted search on Enter, and the typed one with nothing highlighted', async () => {
    rememberSearch(null, 'older')
    rememberSearch(null, 'newer')
    const onSearch = vi.fn()
    render(<SearchBar onSearch={onSearch} />)
    await userEvent.click(box())
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}')
    expect(onSearch).toHaveBeenCalledTimes(1)
    expect(onSearch).toHaveBeenLastCalledWith('older')

    await userEvent.clear(box())
    await userEvent.type(box(), 'fresh{Enter}')
    expect(onSearch).toHaveBeenLastCalledWith('fresh')
  })

  it('runs a search when it is clicked, and forgets one when asked', async () => {
    rememberSearch(null, 'keep')
    rememberSearch(null, 'drop')
    const onSearch = vi.fn()
    render(<SearchBar onSearch={onSearch} />)
    await userEvent.click(box())
    await userEvent.click(screen.getByRole('button', { name: 'Remove “drop” from recent searches' }))
    expect(readRecentSearches(null)).toEqual(['keep'])
    expect(onSearch).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('option', { name: 'keep' }))
    expect(onSearch).toHaveBeenCalledWith('keep')
  })

  it('shows the last two as shortcuts under the home page box', async () => {
    for (const query of ['one', 'two', 'three']) rememberSearch(null, query)
    const onSearch = vi.fn()
    render(<SearchBar variant="home" showRecent onSearch={onSearch} />)
    const shortcuts = screen.getByRole('group', { name: 'Last searches' })
    expect(within(shortcuts).getAllByRole('button').map((button) => button.textContent)).toEqual([
      'three',
      'two',
    ])
    await userEvent.click(within(shortcuts).getByRole('button', { name: /two/ }))
    expect(onSearch).toHaveBeenCalledWith('two')
  })

  it('shows no shortcuts until something has been searched', () => {
    render(<SearchBar variant="home" showRecent onSearch={vi.fn()} />)
    expect(screen.queryByRole('group', { name: 'Last searches' })).not.toBeInTheDocument()
  })
})
