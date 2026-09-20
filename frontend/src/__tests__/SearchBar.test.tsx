// frontend/src/__tests__/SearchBar.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SearchBar } from '../components/SearchBar'

describe('SearchBar', () => {
  it('renders an input and a button', () => {
    render(<SearchBar onSearch={vi.fn()} busy={false} />)
    expect(screen.getByRole('textbox', { name: /search/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /search/i })).toBeInTheDocument()
  })

  it('calls onSearch with the typed query when the button is clicked', async () => {
    const onSearch = vi.fn()
    render(<SearchBar onSearch={onSearch} busy={false} />)
    await userEvent.type(screen.getByRole('textbox', { name: /search/i }), '필터 교체')
    await userEvent.click(screen.getByRole('button', { name: /search/i }))
    expect(onSearch).toHaveBeenCalledWith('필터 교체')
  })

  it('submits on Enter', async () => {
    const onSearch = vi.fn()
    render(<SearchBar onSearch={onSearch} busy={false} />)
    await userEvent.type(screen.getByRole('textbox', { name: /search/i }), '更换滤芯{Enter}')
    expect(onSearch).toHaveBeenCalledWith('更换滤芯')
  })

  it('does not submit an empty or whitespace query', async () => {
    const onSearch = vi.fn()
    render(<SearchBar onSearch={onSearch} busy={false} />)
    await userEvent.click(screen.getByRole('button', { name: /search/i }))
    await userEvent.type(screen.getByRole('textbox', { name: /search/i }), '   {Enter}')
    expect(onSearch).not.toHaveBeenCalled()
  })

  it('disables the button while a search is running', () => {
    render(<SearchBar onSearch={vi.fn()} busy />)
    expect(screen.getByRole('button', { name: /searching/i })).toBeDisabled()
  })

  it('searches when Enter is pressed in the box', async () => {
    const onSearch = vi.fn()
    render(<SearchBar onSearch={onSearch} busy={false} />)
    await userEvent.type(screen.getByLabelText('Search documents'), '필터 교체 방법{Enter}')
    expect(onSearch).toHaveBeenCalledWith('필터 교체 방법')
  })

})
