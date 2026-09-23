// frontend/src/components/charts/StatusDonut.tsx
import { theme, Typography } from 'antd'
import { ChartTable } from './ChartTable'

export interface Slice {
  label: string
  value: number
  /** A design-token name, resolved here so the chart follows the theme. */
  tone: 'success' | 'warning' | 'error' | 'info' | 'primary'
}

const RADIUS = 45
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/**
 * Status breakdown. Hand-drawn SVG rather than a charting library: this is one donut,
 * and pulling in a chart engine for it would cost more than the whole rest of the page.
 */
export function StatusDonut({ slices, total }: { slices: Slice[]; total: number }) {
  const { token } = theme.useToken()
  const colours: Record<Slice['tone'], string> = {
    success: token.colorSuccess,
    warning: token.colorWarning,
    error: token.colorError,
    info: token.colorInfo,
    primary: token.colorPrimary,
  }

  const present = slices.filter((slice) => slice.value > 0)
  const summary = present.map((slice) => `${slice.label} ${slice.value}`).join(', ')

  // Each arc starts where the previous one ended, so the offsets are a running total.
  let running = 0
  const arcs = present.map((slice) => {
    const length = total > 0 ? (slice.value / total) * CIRCUMFERENCE : 0
    const arc = { slice, length, offset: running }
    running += length
    return arc
  })

  return (
    <div className="chart donut-chart">
      {total === 0 ? (
        <Typography.Text type="secondary">No documents yet.</Typography.Text>
      ) : (
        <>
          <svg
            viewBox="0 0 120 120"
            className="donut"
            role="img"
            aria-label={`Documents by status: ${summary}`}
          >
            <title>Documents by status</title>
            <circle
              cx="60"
              cy="60"
              r={RADIUS}
              fill="none"
              stroke={token.colorFillSecondary}
              strokeWidth="16"
            />
            {/* -90deg puts the first slice at twelve o'clock rather than three. */}
            {arcs.map(({ slice, length, offset }) => (
              <circle
                key={slice.label}
                cx="60"
                cy="60"
                r={RADIUS}
                fill="none"
                stroke={colours[slice.tone]}
                strokeWidth="16"
                strokeDasharray={`${length} ${CIRCUMFERENCE - length}`}
                strokeDashoffset={-offset}
                transform="rotate(-90 60 60)"
              />
            ))}
            <text x="60" y="56" className="donut-value" textAnchor="middle">
              {total}
            </text>
            <text x="60" y="74" className="donut-label" textAnchor="middle">
              documents
            </text>
          </svg>

          <ul className="chart-legend">
            {present.map((slice) => (
              <li key={slice.label}>
                <span
                  className="legend-swatch"
                  style={{ background: colours[slice.tone] }}
                  aria-hidden="true"
                />
                {slice.label}
                <strong>{slice.value}</strong>
              </li>
            ))}
          </ul>

          <ChartTable
            caption="Documents by status"
            columns={['Status', 'Documents']}
            rows={present.map((slice) => [slice.label, slice.value])}
          />
        </>
      )}
    </div>
  )
}
