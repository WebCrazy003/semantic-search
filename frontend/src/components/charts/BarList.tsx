// frontend/src/components/charts/BarList.tsx
import { Progress, Typography } from 'antd'
import { ChartTable } from './ChartTable'

export interface Bar {
  label: string
  value: number
  /** Shown at the end of the row; defaults to the value. */
  suffix?: string
  title?: string
}

/**
 * A horizontal bar row, used for both the language split and the largest documents.
 * Every bar carries its own number as text, so the length is a second channel rather
 * than the only one.
 */
export function BarList({
  bars,
  caption,
  unit,
  empty = 'Nothing to show yet.',
}: {
  bars: Bar[]
  caption: string
  unit: string
  empty?: string
}) {
  if (bars.length === 0) {
    return <Typography.Text type="secondary">{empty}</Typography.Text>
  }

  const largest = Math.max(...bars.map((bar) => bar.value), 1)

  return (
    <div className="chart bar-list">
      {bars.map((bar) => (
        <div className="bar-row" key={bar.label} title={bar.title}>
          <span className="bar-label" title={bar.label}>
            {bar.label}
          </span>
          <Progress
            percent={Math.round((bar.value / largest) * 100)}
            showInfo={false}
            size="small"
            aria-hidden="true"
          />
          <span className="bar-value">{bar.suffix ?? bar.value}</span>
        </div>
      ))}
      <ChartTable
        caption={caption}
        columns={['Name', unit]}
        rows={bars.map((bar) => [bar.label, bar.value])}
      />
    </div>
  )
}
