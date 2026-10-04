// frontend/src/pages/SearchPage.tsx
import { PlusOutlined } from '@ant-design/icons'
import { Alert, Button, Drawer, Empty, Grid, Select, Skeleton, Space, Typography } from 'antd'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../app/AuthContext'
import { keyOf, useSearchContext } from '../app/SearchContext'
import { ResultCard } from '../components/ResultCard'
import { ResultDetail } from '../components/ResultDetail'
import { SearchBar } from '../components/SearchBar'
import { listUsers } from '../services/api'
import { LANGUAGES, TOP_K_CHOICES } from '../settings/settings'

export function SearchPage() {
  const navigate = useNavigate()
  const screens = Grid.useBreakpoint()
  const listRef = useRef<HTMLDivElement>(null)
  const {
    query, response, selected, select, topK, setTopK, language, setLanguage, busy, error, run,
    scope, setScope, owner, setOwner, visibility, setVisibility,
  } = useSearchContext()
  const { isAdmin } = useAuth()
  const [owners, setOwners] = useState<{ value: string; label: string }[]>([])

  // An admin can narrow to one owner, so the select needs everyone's name.
  useEffect(() => {
    if (!isAdmin) return
    let cancelled = false
    listUsers()
      .then((users) => {
        if (cancelled) return
        setOwners(users.map((user) => ({ value: user.user_id, label: user.username })))
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [isAdmin])

  const results = response?.results ?? []

  /**
   * ↑/↓ move between results while the list has focus, as a listbox should. They move
   * the panel along once it is open; until then Enter opens it.
   */
  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const cards = [
      ...(listRef.current?.querySelectorAll<HTMLElement>('[data-testid="result-card"]') ?? []),
    ]
    if (cards.length === 0) return
    event.preventDefault()
    const current = cards.findIndex((card) => card === document.activeElement)
    const step = event.key === 'ArrowDown' ? 1 : -1
    const next = current === -1 ? 0 : Math.min(cards.length - 1, Math.max(0, current + step))
    cards[next].focus()
    if (selected) select(results[next])
  }

  const resultList = (
    <>
      {response && response.count > 0 ? (
        <Space className="result-meta" size="small" wrap>
          <Typography.Text strong>
            {response.count} {response.count === 1 ? 'result' : 'results'}
          </Typography.Text>
          <Typography.Text type="secondary">{response.took_ms} ms</Typography.Text>
          <Typography.Text type="secondary">for “{response.query}”</Typography.Text>
        </Space>
      ) : null}

      <div
        className="result-list"
        role="listbox"
        aria-label="Search results"
        ref={listRef}
        onKeyDown={keyDown}
      >
        {busy && !response ? (
          <>
            {[0, 1, 2].map((index) => (
              <div key={index} className="result-card">
                <Skeleton active paragraph={{ rows: 2 }} title={{ width: '40%' }} />
              </div>
            ))}
          </>
        ) : null}

        {!busy && !response ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="Search your indexed PDF and Word files in Chinese, Korean, or English."
          />
        ) : null}

        {response && response.count === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="No passages matched that query."
          />
        ) : null}

        {results.map((hit) => (
          <ResultCard
            key={keyOf(hit)}
            hit={hit}
            query={response?.query}
            selected={!!selected && keyOf(selected) === keyOf(hit)}
            onSelect={() => select(hit)}
          />
        ))}
      </div>

    </>
  )

  return (
    <div className="page search-page">
      <div className="search-page-actions">
        <Button
          type="dashed"
          icon={<PlusOutlined aria-hidden="true" />}
          onClick={() => navigate('/documents')}
        >
          Add more documents
        </Button>
      </div>

      <div className="search-controls">
        <SearchBar onSearch={(value) => void run(value)} busy={busy} initialValue={query} />
        <Space size="small" className="search-filters" wrap>
          <Select
            size="small"
            variant="filled"
            aria-label="Results to show"
            value={topK}
            onChange={setTopK}
            popupMatchSelectWidth={false}
            options={TOP_K_CHOICES.map((choice) => ({
              value: choice,
              label: `${choice} results`,
            }))}
          />
          <Select
            size="small"
            variant="filled"
            aria-label="Language"
            value={language}
            onChange={setLanguage}
            popupMatchSelectWidth={false}
            options={LANGUAGES}
          />
          {isAdmin ? (
            <>
              <Select
                size="small"
                variant="filled"
                aria-label="Owner"
                value={owner}
                onChange={setOwner}
                popupMatchSelectWidth={false}
                options={[
                  { value: '', label: 'Everyone' },
                  { value: 'library', label: 'Library' },
                  ...owners,
                ]}
              />
              <Select
                size="small"
                variant="filled"
                aria-label="Visibility"
                value={visibility}
                onChange={setVisibility}
                popupMatchSelectWidth={false}
                options={[
                  { value: '', label: 'Public and private' },
                  { value: 'public', label: 'Public only' },
                  { value: 'private', label: 'Private only' },
                ]}
              />
            </>
          ) : (
            <Select
              size="small"
              variant="filled"
              aria-label="Show"
              value={scope}
              onChange={setScope}
              popupMatchSelectWidth={false}
              options={[
                { value: 'all', label: 'Mine and public' },
                { value: 'mine', label: 'Only mine' },
                { value: 'public', label: 'Only public' },
              ]}
            />
          )}
        </Space>
      </div>

      {error ? <Alert type="error" showIcon message={error} className="page-alert" /> : null}

      {resultList}

      {/* A slide-in panel, like a search engine's preview: the list keeps its place
          and stays clickable beside it on a wide window. */}
      <Drawer
        open={!!selected}
        onClose={() => select(null)}
        placement="right"
        mask={!screens.xl}
        size={Math.min(560, typeof window === 'undefined' ? 560 : window.innerWidth * 0.92)}
        title={selected?.filename}
        className="detail-drawer"
      >
        {selected ? (
          <ResultDetail key={keyOf(selected)} hit={selected} query={response?.query} />
        ) : null}
      </Drawer>
    </div>
  )
}
