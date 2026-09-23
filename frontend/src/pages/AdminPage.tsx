// frontend/src/pages/AdminPage.tsx
import { ArrowLeftOutlined } from '@ant-design/icons'
import { Button, Tabs, Typography } from 'antd'
import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useLibraryContext } from '../app/LibraryContext'
import { ExtractionPanel } from '../components/admin/ExtractionPanel'
import { PassagesPanel } from '../components/admin/PassagesPanel'
import { SchemaPanel } from '../components/admin/SchemaPanel'

type TabKey = 'extraction' | 'schema' | 'passages'

const TAB_KEYS: TabKey[] = ['extraction', 'schema', 'passages']

export function AdminPage() {
  const navigate = useNavigate()
  const { documents } = useLibraryContext()
  const [params, setParams] = useSearchParams()

  // A link from a search result arrives with the document and passage it came from.
  const requested = params.get('tab')
  const [tab, setTab] = useState<TabKey>(
    TAB_KEYS.includes(requested as TabKey) ? (requested as TabKey) : 'extraction',
  )
  const [documentId, setDocumentId] = useState<string | null>(params.get('document'))
  const focusChunk = params.get('chunk') === null ? null : Number(params.get('chunk'))

  function chooseDocument(next: string) {
    setDocumentId(next)
    // The chunk in the URL belonged to the document that was there before.
    params.delete('chunk')
    params.set('document', next)
    setParams(params, { replace: true })
  }

  return (
    <div className="page admin-page">
      <div className="page-head">
        <div>
          <Typography.Title level={3}>Admin</Typography.Title>
          <Typography.Text type="secondary">
            Read-only. Nothing on this page changes the index.
          </Typography.Text>
        </div>
        <Button icon={<ArrowLeftOutlined aria-hidden="true" />} onClick={() => navigate('/settings')}>
          Back to settings
        </Button>
      </div>

      <Tabs
        activeKey={tab}
        onChange={(key) => setTab(key as TabKey)}
        items={[
          {
            key: 'extraction',
            label: 'Extracted text',
            children: (
              <ExtractionPanel
                documents={documents}
                documentId={documentId}
                onDocumentChange={chooseDocument}
              />
            ),
          },
          {
            key: 'schema',
            label: 'Index structure',
            children: <SchemaPanel />,
          },
          {
            key: 'passages',
            label: 'Passages',
            children: (
              <PassagesPanel
                documents={documents}
                documentId={documentId}
                onDocumentChange={chooseDocument}
                focusChunk={focusChunk}
              />
            ),
          },
        ]}
      />
    </div>
  )
}
