// frontend/src/pages/DocumentsPage.tsx
import { PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Popconfirm, Space, Typography } from 'antd'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLibraryContext } from '../app/LibraryContext'
import { AddDocumentsCard } from '../components/AddDocumentsCard'
import { DocumentList } from '../components/DocumentList'
import { LibraryAggregates, useAggregates } from '../components/LibraryAggregates'
import { useSettings } from '../settings/SettingsContext'

export function DocumentsPage() {
  const navigate = useNavigate()
  const { reducedMotion } = useSettings()
  const library = useLibraryContext()
  const [adding, setAdding] = useState(false)

  const aggregates = useAggregates(library.documents)
  const running = library.status?.status === 'running'

  return (
    <div className="page documents-page">
      <div className="page-head">
        <Typography.Title level={3}>Documents</Typography.Title>
        <Space wrap>
          <Button icon={<SearchOutlined aria-hidden="true" />} onClick={() => navigate('/search')}>
            Search
          </Button>
          <Button
            icon={<ReloadOutlined aria-hidden="true" />}
            onClick={() => void library.refresh()}
            disabled={library.busy}
          >
            Refresh
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined aria-hidden="true" />}
            onClick={() => setAdding(true)}
            disabled={adding}
          >
            Add documents
          </Button>
        </Space>
      </div>

      {library.error ? (
        <Alert
          type="error"
          showIcon
          closable
          message={library.error}
          onClose={library.dismissError}
          className="page-alert"
        />
      ) : null}

      {/*
        The charts collapse by animating grid-template-rows from 1fr to 0fr, which gets a
        transition to the content's real height without measuring it in JavaScript. The
        minimised strip of numbers stays, so the summary never disappears entirely.
      */}
      <div
        className={`aggregate-wrap${adding ? ' minimised' : ''}${reducedMotion ? ' no-motion' : ''}`}
        data-testid="aggregate-wrap"
      >
        <div className="aggregate-inner">
          <LibraryAggregates aggregates={aggregates} minimised={false} />
        </div>
      </div>

      {adding ? (
        <div className="aggregate-summary-row">
          <LibraryAggregates aggregates={aggregates} minimised />
          <Button type="link" size="small" onClick={() => setAdding(false)}>
            Show summary
          </Button>
        </div>
      ) : null}

      {adding ? <AddDocumentsCard library={library} onClose={() => setAdding(false)} /> : null}

      <Card
        title="Indexed documents"
        className="documents-card"
        extra={
          running ? (
            <Typography.Text type="secondary">
              A job is running; this list updates as it goes.
            </Typography.Text>
          ) : null
        }
      >
        <DocumentList
          documents={library.documents}
          busy={library.busy || running}
          onRemove={(documentId) => void library.remove(documentId)}
        />
      </Card>

      <Card title="Clear the index" className="danger-card">
        <Typography.Paragraph type="secondary">
          Removes every passage and every document record. Your files stay where they are and the
          job history is kept, so you can index again from scratch.
        </Typography.Paragraph>
        <Popconfirm
          title="Clear all indexing?"
          description={`${library.documents.length} document${
            library.documents.length === 1 ? '' : 's'
          } will stop being searchable.`}
          okText="Yes, clear it"
          okButtonProps={{ danger: true }}
          onConfirm={() => void library.clearAll()}
          disabled={library.busy || running}
        >
          <Button danger disabled={library.busy || running}>
            Clear all indexing
          </Button>
        </Popconfirm>
        {library.lastClear ? (
          <Typography.Paragraph type="secondary" className="clear-result">
            Cleared {library.lastClear.documents_removed} documents and{' '}
            {library.lastClear.passages_removed} passages. The files themselves were kept.
          </Typography.Paragraph>
        ) : null}
      </Card>
    </div>
  )
}
