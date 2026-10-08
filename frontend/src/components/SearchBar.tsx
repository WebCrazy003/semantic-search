// frontend/src/components/SearchBar.tsx
// The one search box, in two sizes: the big rounded box in the middle of the home page,
// and the slimmer one in the results header. Enter searches; there is no search button
// on the home page, as on Google's, and an icon button at the end of the header's.
import { SearchOutlined } from '@ant-design/icons'
import { Button, Input } from 'antd'
import { useState, type FormEvent, type KeyboardEvent } from 'react'

interface Props {
  onSearch: (query: string) => void
  busy?: boolean
  initialValue?: string
  variant?: 'home' | 'header'
  autoFocus?: boolean
}

export function SearchBar({
  onSearch,
  busy = false,
  initialValue = '',
  variant = 'header',
  autoFocus = false,
}: Props) {
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
    <form className={`search-bar search-bar-${variant}`} onSubmit={submit} role="search">
      <Input
        size="large"
        allowClear
        autoFocus={autoFocus}
        aria-label="Search documents"
        placeholder={
          variant === 'home' ? 'Search or ask in Chinese, Korean or English' : 'Search your documents'
        }
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={keyDown}
        prefix={variant === 'home' ? <SearchOutlined aria-hidden="true" /> : undefined}
        suffix={
          variant === 'header' ? (
            <Button
              type="text"
              htmlType="submit"
              size="small"
              aria-label="Search"
              loading={busy}
              icon={<SearchOutlined aria-hidden="true" />}
              className="search-bar-submit"
            />
          ) : undefined
        }
      />
    </form>
  )
}
