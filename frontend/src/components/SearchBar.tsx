// frontend/src/components/SearchBar.tsx
import { SearchOutlined } from '@ant-design/icons'
import { Button, Input, Space } from 'antd'
import { useState, type FormEvent, type KeyboardEvent } from 'react'

interface Props {
  onSearch: (query: string) => void
  busy: boolean
  initialValue?: string
}

export function SearchBar({ onSearch, busy, initialValue = '' }: Props) {
  const [value, setValue] = useState(initialValue)

  function submit(event?: FormEvent) {
    event?.preventDefault()
    const query = value.trim()
    if (!query) return
    onSearch(query)
  }

  // Implicit form submission is not guaranteed once an IME or an automated key event is
  // involved, so Enter is handled explicitly as well. isComposing keeps a Korean or
  // Chinese candidate selection from submitting a half-typed query.
  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <form className="search-bar" onSubmit={submit} role="search">
      <Space.Compact className="search-bar-inner">
        <Input
          size="large"
          allowClear
          aria-label="Search documents"
          placeholder="Ask a question, or describe the passage you want…"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={keyDown}
        />
        <Button
          type="primary"
          size="large"
          htmlType="submit"
          loading={busy}
          icon={<SearchOutlined aria-hidden="true" />}
        >
          Search
        </Button>
      </Space.Compact>
    </form>
  )
}
