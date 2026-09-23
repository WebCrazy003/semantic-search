// frontend/src/pages/SearchPage.tsx
import { PlusOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Col, Drawer, Empty, Grid, Row, Select, Skeleton, Space, Typography } from 'antd'
import { useRef, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { keyOf, useSearchContext } from '../app/SearchContext'
import { ResultCard } from '../components/ResultCard'
import { ResultDetail } from '../components/ResultDetail'
import { SearchBar } from '../components/SearchBar'
import { LANGUAGES, TOP_K_CHOICES } from '../settings/settings'
import { useSettings } from '../settings/SettingsContext'

export function SearchPage() {
  const navigate = useNavigate()
  const { settings } = useSettings()
  const screens = Grid.useBreakpoint()
  const listRef = useRef<HTMLDivElement>(null)
  const {
    query, response, selected, select, topK, setTopK, language, setLanguage, busy, error, run,
  } = useSearchContext()

  // Side by side once there is room for both; a drawer below that, or whenever the
  // setting asks for one.
  const sideBySide = settings.detailView === 'auto' && !!screens.xl
  const results = response?.results ?? []

  /** ↑/↓ move the selection while the list has focus, as a listbox should. */
  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    if (results.length === 0) return
    event.preventDefault()
    const current = results.findIndex((hit) => selected && keyOf(hit) === keyOf(selected))
    const step = event.key === 'ArrowDown' ? 1 : -1
    const next = Math.min(results.length - 1, Math.max(0, (current === -1 ? 0 : current) + step))
    select(results[next])
    const cards = listRef.current?.querySelectorAll<HTMLElement>('[data-testid="result-card"]')
    cards?.[next]?.focus()
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
              <Card key={index} size="small" className="result-card">
                <Skeleton active paragraph={{ rows: 2 }} title={{ width: '40%' }} />
              </Card>
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

      <Button
        type="dashed"
        icon={<PlusOutlined aria-hidden="true" />}
        className="add-more"
        onClick={() => navigate('/documents')}
      >
        Add more documents
      </Button>
    </>
  )

  return (
    <div className="page search-page">
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
        </Space>
      </div>

      {error ? <Alert type="error" showIcon message={error} className="page-alert" /> : null}

      {sideBySide ? (
        <Row gutter={16} className="search-split">
          <Col span={14}>{resultList}</Col>
          <Col span={10}>
            <Card className="detail-panel" size="small">
              <ResultDetail hit={selected} query={response?.query} />
            </Card>
          </Col>
        </Row>
      ) : (
        <>
          {resultList}
          <Drawer
            open={!!selected}
            onClose={() => select(null)}
            placement="right"
            width={Math.min(520, typeof window === 'undefined' ? 520 : window.innerWidth * 0.9)}
            title={selected?.filename}
          >
            <ResultDetail hit={selected} query={response?.query} />
          </Drawer>
        </>
      )}
    </div>
  )
}
