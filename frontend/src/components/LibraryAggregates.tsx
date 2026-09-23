// frontend/src/components/LibraryAggregates.tsx
import { Card, Col, Row, Statistic, Typography } from 'antd'
import { useMemo } from 'react'
import type { DocumentSummary } from '../services/api'
import { BarList, type Bar } from './charts/BarList'
import { StatusDonut, type Slice } from './charts/StatusDonut'
import { CountUp } from './CountUp'

const STATUS_TONES: Record<string, Slice['tone']> = {
  indexed: 'success',
  skipped: 'info',
  unsupported: 'warning',
  failed: 'error',
}

const LANGUAGE_NAMES: Record<string, string> = {
  zh: 'Chinese',
  ko: 'Korean',
  en: 'English',
  ja: 'Japanese',
}

export interface Aggregates {
  total: number
  indexed: number
  passages: number
  pages: number
  statusSlices: Slice[]
  languageBars: Bar[]
  largestBars: Bar[]
}

/** Everything the diagrams show, derived from the document list the app already holds. */
export function useAggregates(documents: DocumentSummary[]): Aggregates {
  return useMemo(() => {
    const indexed = documents.filter((document) => document.status === 'indexed')

    const byStatus = new Map<string, number>()
    for (const document of documents) {
      byStatus.set(document.status, (byStatus.get(document.status) ?? 0) + 1)
    }

    const byLanguage = new Map<string, number>()
    for (const document of indexed) {
      const key = document.language ?? 'unknown'
      byLanguage.set(key, (byLanguage.get(key) ?? 0) + 1)
    }

    return {
      total: documents.length,
      indexed: indexed.length,
      passages: indexed.reduce((sum, document) => sum + document.chunks, 0),
      pages: indexed.reduce((sum, document) => sum + document.pages, 0),
      statusSlices: [...byStatus.entries()]
        .sort((left, right) => right[1] - left[1])
        .map(([status, value]) => ({
          label: status,
          value,
          tone: STATUS_TONES[status] ?? 'primary',
        })),
      languageBars: [...byLanguage.entries()]
        .sort((left, right) => right[1] - left[1])
        .map(([code, value]) => ({
          label: code === 'unknown' ? 'not detected' : (LANGUAGE_NAMES[code] ?? code),
          value,
          suffix: `${value}`,
        })),
      largestBars: [...indexed]
        .sort((left, right) => right.chunks - left.chunks)
        .slice(0, 5)
        .map((document) => ({
          label: document.filename,
          value: document.chunks,
          suffix: `${document.chunks}`,
          title: document.filepath,
        })),
    }
  }, [documents])
}

/**
 * The aggregate view, in one of two shapes. Minimised, it is a single line of numbers;
 * the charts are what collapses when the add-documents card opens, because they are what
 * takes the vertical space.
 */
export function LibraryAggregates({
  aggregates,
  minimised,
}: {
  aggregates: Aggregates
  minimised: boolean
}) {
  const { total, indexed, passages, pages } = aggregates

  if (minimised) {
    return (
      <div className="aggregate-strip" data-testid="aggregate-strip">
        <Typography.Text type="secondary">
          <strong>{indexed}</strong> searchable
        </Typography.Text>
        <Typography.Text type="secondary">
          <strong>{total}</strong> known
        </Typography.Text>
        <Typography.Text type="secondary">
          <strong>{passages.toLocaleString()}</strong> passages
        </Typography.Text>
        <Typography.Text type="secondary">
          <strong>{pages.toLocaleString()}</strong> pages
        </Typography.Text>
      </div>
    )
  }

  return (
    <Row gutter={[16, 16]} className="aggregates" data-testid="aggregates">
      <Col xs={24} xl={6}>
        <Card size="small" title="Library" className="aggregate-card">
          <Row gutter={[8, 8]}>
            <Col span={12}>
              <Statistic title="Searchable" valueRender={() => <CountUp value={indexed} />} />
            </Col>
            <Col span={12}>
              <Statistic title="Known" valueRender={() => <CountUp value={total} />} />
            </Col>
            <Col span={12}>
              <Statistic title="Passages" valueRender={() => <CountUp value={passages} />} />
            </Col>
            <Col span={12}>
              <Statistic title="Pages" valueRender={() => <CountUp value={pages} />} />
            </Col>
          </Row>
        </Card>
      </Col>

      <Col xs={24} sm={12} xl={6}>
        <Card size="small" title="By status" className="aggregate-card">
          <StatusDonut slices={aggregates.statusSlices} total={total} />
        </Card>
      </Col>

      <Col xs={24} sm={12} xl={6}>
        <Card size="small" title="By language" className="aggregate-card">
          <BarList
            bars={aggregates.languageBars}
            caption="Searchable documents by language"
            unit="Documents"
            empty="No documents are searchable yet."
          />
        </Card>
      </Col>

      <Col xs={24} xl={6}>
        <Card size="small" title="Largest documents" className="aggregate-card">
          <BarList
            bars={aggregates.largestBars}
            caption="Largest documents by passage count"
            unit="Passages"
            empty="No documents are searchable yet."
          />
        </Card>
      </Col>
    </Row>
  )
}
