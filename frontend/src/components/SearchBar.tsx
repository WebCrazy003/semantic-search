// frontend/src/components/SearchBar.tsx
// The one search box, in two sizes: the big rounded box in the middle of the home page,
// and the slimmer one in the results header. Enter searches; there is no search button
// on the home page, as on Google's, and an icon button at the end of the header's.
//
// Both remember what was searched from them. Clicking into the box (or ↓) drops down
// the recent searches, narrowed to what is typed; the home page also shows the last two
// as shortcuts under its box.
import { CloseOutlined, HistoryOutlined, SearchOutlined } from '@ant-design/icons'
import { Button, Input } from 'antd'
import { useId, useMemo, useState, type FormEvent, type KeyboardEvent } from 'react'
import {
  forgetSearch,
  readRecentSearches,
  rememberSearch,
  type HistoryOwner,
} from '../app/recentSearches'

interface Props {
  onSearch: (query: string) => void
  busy?: boolean
  initialValue?: string
  variant?: 'home' | 'header'
  autoFocus?: boolean
  /** Whose recent searches to remember and offer: an account id, or null for a visitor. */
  historyOwner?: HistoryOwner
  /** The last two searches as buttons under the box (the home page). */
  showRecent?: boolean
}

const SHORTCUTS = 2

export function SearchBar({
  onSearch,
  busy = false,
  initialValue = '',
  variant = 'header',
  autoFocus = false,
  historyOwner = null,
  showRecent = false,
}: Props) {
  const [value, setValue] = useState(initialValue)
  const [history, setHistory] = useState(() => readRecentSearches(historyOwner))
  // A login or logout swaps in that person's searches, without remounting the box (which
  // would lose its focus and what is typed).
  const [historyFor, setHistoryFor] = useState(historyOwner)
  if (historyFor !== historyOwner) {
    setHistoryFor(historyOwner)
    setHistory(readRecentSearches(historyOwner))
  }
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const listId = useId()

  // What the dropdown offers: the history narrowed to what is typed, but never the very
  // query already in the box.
  const typed = value.trim().toLowerCase()
  const suggestions = useMemo(
    () =>
      history.filter((item) => {
        const lower = item.toLowerCase()
        return lower !== typed && lower.includes(typed)
      }),
    [history, typed],
  )
  const expanded = open && suggestions.length > 0

  function close() {
    setOpen(false)
    setActive(-1)
  }

  function search(query: string) {
    setValue(query)
    setHistory(rememberSearch(historyOwner, query))
    close()
    onSearch(query)
  }

  function submit(event?: FormEvent) {
    event?.preventDefault()
    const query = value.trim()
    if (!query) return
    search(query)
  }

  function forget(query: string) {
    setHistory(forgetSearch(historyOwner, query))
    setActive(-1)
  }

  // Implicit form submission is not guaranteed once an IME or an automated key event is
  // involved, so Enter is handled explicitly as well. isComposing keeps a Korean or
  // Chinese candidate selection from submitting a half-typed query.
  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (suggestions.length === 0) return
      event.preventDefault()
      if (!expanded) {
        setOpen(true)
        setActive(event.key === 'ArrowDown' ? 0 : suggestions.length - 1)
        return
      }
      const step = event.key === 'ArrowDown' ? 1 : -1
      // Past either end comes back to the box itself (-1), as Google's list does.
      const slots = suggestions.length + 1
      setActive(((active + 1 + step + slots) % slots) - 1)
    } else if (event.key === 'Delete' && event.shiftKey && expanded && active >= 0) {
      // The keyboard's way to the × button, which only a pointer can reach.
      event.preventDefault()
      forget(suggestions[active])
    } else if (event.key === 'Escape' && expanded) {
      event.preventDefault()
      close()
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (expanded && active >= 0) search(suggestions[active])
      else submit()
    }
  }

  const optionId = (index: number) => `${listId}-option-${index}`

  return (
    <form className={`search-bar search-bar-${variant}`} onSubmit={submit} role="search">
      <div className="search-bar-field">
        <Input
          size="large"
          allowClear
          autoFocus={autoFocus}
          aria-label="Search documents"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={expanded ? listId : undefined}
          aria-activedescendant={expanded && active >= 0 ? optionId(active) : undefined}
          autoComplete="off"
          placeholder={
            variant === 'home' ? 'Search or ask in Chinese, Korean or English' : 'Search your documents'
          }
          value={value}
          onChange={(event) => {
            setValue(event.target.value)
            setOpen(true)
            setActive(-1)
          }}
          onClick={() => setOpen(true)}
          onBlur={close}
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

        {expanded ? (
          <ul id={listId} role="listbox" aria-label="Recent searches" className="search-history">
            {suggestions.map((item, index) => (
              <li
                key={item}
                id={optionId(index)}
                role="option"
                aria-selected={index === active}
                className={`search-history-item${index === active ? ' active' : ''}`}
                // Keep the focus in the box, so its blur does not close the list first.
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => search(item)}
              >
                <HistoryOutlined aria-hidden="true" className="search-history-icon" />
                <span className="search-history-text">{item}</span>
                <Button
                  type="text"
                  size="small"
                  tabIndex={-1}
                  aria-label={`Remove “${item}” from recent searches`}
                  icon={<CloseOutlined aria-hidden="true" />}
                  className="search-history-remove"
                  onClick={(event) => {
                    event.stopPropagation()
                    forget(item)
                  }}
                />
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {showRecent && history.length > 0 ? (
        <div className="search-recent" role="group" aria-label="Last searches">
          {history.slice(0, SHORTCUTS).map((item) => (
            <Button
              key={item}
              shape="round"
              icon={<HistoryOutlined aria-hidden="true" />}
              className="search-recent-chip"
              title={item}
              onClick={() => search(item)}
            >
              {item}
            </Button>
          ))}
        </div>
      ) : null}
    </form>
  )
}
