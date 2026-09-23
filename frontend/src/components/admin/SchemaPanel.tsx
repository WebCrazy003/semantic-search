// frontend/src/components/admin/SchemaPanel.tsx
import { CopyOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Descriptions, Skeleton, Space, Table, Tag, Typography } from 'antd'
import { useEffect, useState } from 'react'
import { getIndexSchema, type IndexSchemaResponse } from '../../services/api'

/** How the index is put together, read from the stores themselves rather than declared. */
export function SchemaPanel() {
  const [data, setData] = useState<IndexSchemaResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    getIndexSchema()
      .then((result) => {
        if (live) setData(result)
      })
      .catch((caught: unknown) => {
        if (live) setError(caught instanceof Error ? caught.message : 'Could not read the schema')
      })
    return () => {
      live = false
    }
  }, [])

  if (error) return <Alert type="error" showIcon message={error} />
  if (!data) return <Skeleton active paragraph={{ rows: 8 }} />

  const { qdrant, manifest, chunking, embedding } = data

  return (
    <div className="admin-panel">
      <Space className="schema-head" wrap>
        <Typography.Text type="secondary">
          Everything below is read from the live stores, so it is the real shape of the index
          rather than a description of it.
        </Typography.Text>
        <Button
          size="small"
          icon={<CopyOutlined aria-hidden="true" />}
          onClick={() => void navigator.clipboard?.writeText(JSON.stringify(data, null, 2))}
        >
          Copy as JSON
        </Button>
      </Space>

      <Card size="small" title="Vector store (Qdrant)">
        <Typography.Paragraph type="secondary">
          One point per passage. Searching embeds your query into the same
          {' '}{qdrant.vector_size ?? embedding.vector_size}-dimensional space and returns the
          nearest points by cosine distance.
        </Typography.Paragraph>
        <Descriptions
          size="small"
          column={{ xs: 1, sm: 2, lg: 3 }}
          items={[
            { key: 'collection', label: 'Collection', children: <code>{qdrant.collection}</code> },
            {
              key: 'exists',
              label: 'Exists',
              children: qdrant.exists ? <Tag color="success">yes</Tag> : <Tag>not created yet</Tag>,
            },
            { key: 'points', label: 'Passages stored', children: qdrant.points_count ?? '—' },
            { key: 'size', label: 'Vector size', children: qdrant.vector_size ?? '—' },
            { key: 'distance', label: 'Distance', children: qdrant.distance ?? '—' },
            { key: 'segments', label: 'Segments', children: qdrant.segments_count ?? '—' },
            {
              key: 'indexes',
              label: 'Payload indexes',
              children: qdrant.payload_indexes.length ? (
                qdrant.payload_indexes.map((field) => <Tag key={field}>{field}</Tag>)
              ) : (
                // Payload indexes are a server-Qdrant feature. The offline install runs
                // Qdrant embedded, where there are none and filtering still works.
                <Typography.Text type="secondary">
                  none — an embedded index filters without them
                </Typography.Text>
              ),
              span: 3,
            },
          ]}
        />

        <Typography.Title level={5}>What each passage stores</Typography.Title>
        <Table
          size="small"
          rowKey="name"
          pagination={false}
          dataSource={qdrant.payload_fields}
          columns={[
            { title: 'Field', dataIndex: 'name', render: (name: string) => <code>{name}</code> },
            { title: 'Type', dataIndex: 'type' },
            {
              title: 'Filterable',
              dataIndex: 'indexed',
              render: (indexed: boolean) => (indexed ? <Tag color="success">yes</Tag> : '—'),
            },
            { title: 'Meaning', dataIndex: 'description' },
          ]}
        />
      </Card>

      <Card size="small" title="Document manifest (SQLite)">
        <Typography.Paragraph type="secondary">
          A bookkeeping cache, not a second source of truth: it makes “has this file changed?” and
          the documents list fast. It can be rebuilt from the vector store at any time.
        </Typography.Paragraph>
        <Descriptions
          size="small"
          column={{ xs: 1, sm: 2 }}
          items={[
            { key: 'path', label: 'File', children: <code>{manifest.path}</code> },
            {
              key: 'statuses',
              label: 'Documents by status',
              children: Object.entries(manifest.status_breakdown).length
                ? Object.entries(manifest.status_breakdown).map(([status, count]) => (
                    <Tag key={status}>
                      {status}: {count}
                    </Tag>
                  ))
                : 'none yet',
            },
          ]}
        />
        {manifest.tables.map((table) => (
          <div key={table.name} className="manifest-table">
            <Space wrap>
              <Typography.Text strong>
                <code>{table.name}</code>
              </Typography.Text>
              <Typography.Text type="secondary">{table.rows} rows</Typography.Text>
              {table.indexes.map((index) => (
                <Tag key={index}>{index}</Tag>
              ))}
            </Space>
            <Table
              size="small"
              rowKey="name"
              pagination={false}
              dataSource={table.columns}
              columns={[
                {
                  title: 'Column',
                  dataIndex: 'name',
                  render: (name: string) => <code>{name}</code>,
                },
                { title: 'Type', dataIndex: 'type' },
                {
                  title: 'Required',
                  dataIndex: 'notnull',
                  render: (value: boolean) => (value ? 'yes' : '—'),
                },
                {
                  title: 'Key',
                  dataIndex: 'pk',
                  render: (value: boolean) => (value ? <Tag>primary</Tag> : '—'),
                },
              ]}
            />
          </div>
        ))}
      </Card>

      <Card size="small" title="How documents are split">
        <Typography.Paragraph type="secondary">
          These settings decided the passages on the Passages tab. A passage aims for the target
          size, never exceeds the maximum, and repeats the overlap from its predecessor.
        </Typography.Paragraph>
        <Descriptions
          size="small"
          column={{ xs: 1, sm: 2, lg: 3 }}
          items={[
            { key: 'target', label: 'Target tokens', children: chunking.target_tokens },
            { key: 'max', label: 'Maximum tokens', children: chunking.max_tokens },
            { key: 'min', label: 'Minimum tokens', children: chunking.min_tokens },
            { key: 'overlap', label: 'Overlap tokens', children: chunking.overlap_tokens },
            { key: 'headings', label: 'Keep headings', children: yesNo(chunking.preserve_headings) },
            { key: 'repeat', label: 'Repeat heading', children: yesNo(chunking.repeat_heading) },
            {
              key: 'cross',
              label: 'Passages may cross pages',
              children: yesNo(chunking.allow_cross_page),
            },
            {
              key: 'para',
              label: 'Prefer paragraph ends',
              children: yesNo(chunking.prefer_paragraph_boundaries),
            },
            {
              key: 'sentence',
              label: 'Prefer sentence ends',
              children: yesNo(chunking.prefer_sentence_boundaries),
            },
          ]}
        />
      </Card>

      <Card size="small" title="Embedding model">
        <Descriptions
          size="small"
          column={{ xs: 1, sm: 2, lg: 3 }}
          items={[
            { key: 'model', label: 'Model', children: <code>{embedding.model}</code> },
            { key: 'size', label: 'Vector size', children: embedding.vector_size },
            { key: 'device', label: 'Runs on', children: embedding.device ?? 'not loaded' },
            { key: 'name', label: 'Device', children: embedding.device_name ?? '—' },
            { key: 'precision', label: 'Precision', children: embedding.precision ?? '—' },
            { key: 'seq', label: 'Max sequence length', children: embedding.max_seq_length },
          ]}
        />
      </Card>
    </div>
  )
}

function yesNo(value: boolean): string {
  return value ? 'yes' : 'no'
}
