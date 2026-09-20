// frontend/src/components/SearchBar.tsx
import { useState, type FormEvent } from 'react'

interface Props {
  onSearch: (query: string) => void
  busy: boolean
}

export function SearchBar({ onSearch, busy }: Props) {
  const [value, setValue] = useState('')

  function submit(event: FormEvent) {
    event.preventDefault()
    const query = value.trim()
    if (!query) return
    onSearch(query)
  }

  return (
    <form className="search-bar" onSubmit={submit}>
      <input
        type="text"
        aria-label="Search documents"
        placeholder="Search documents..."
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <button type="submit" disabled={busy}>
        {busy ? 'Searching...' : 'Search'}
      </button>
    </form>
  )
}
