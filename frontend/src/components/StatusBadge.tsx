// frontend/src/components/StatusBadge.tsx
interface Props {
  status: string
  pulse?: boolean
}

const TONE: Record<string, string> = {
  indexed: 'ok',
  completed: 'ok',
  running: 'busy',
  skipped: 'subtle',
  unsupported: 'warn',
  failed: 'bad',
  idle: 'subtle',
}

export function StatusBadge({ status, pulse = false }: Props) {
  const tone = TONE[status] ?? 'subtle'
  return (
    <span className={`badge ${tone}${pulse ? ' pulse' : ''}`}>
      <span className="dot" aria-hidden="true" />
      {status}
    </span>
  )
}
