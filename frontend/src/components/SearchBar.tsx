// frontend/src/components/SearchBar.tsx
import { useState, type FormEvent, type KeyboardEvent } from 'react'

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

  // Implicit form submission is not guaranteed once an IME or an automated key
  // event is involved, so Enter is handled explicitly as well.
  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault()
      submit(event)
    }
  }

  return (
    <form className="search-bar" onSubmit={submit}>
      <input
        type="text"
        aria-label="Search documents"
        placeholder="Search documents..."
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={keyDown}
      />
      <button type="submit" disabled={busy}>
        {busy ? 'Searching...' : 'Search'}
      </button>
    </form>
  )
}
