// frontend/src/components/DeviceUsageMeter.tsx
import { Progress, Space, Tag, Tooltip, Typography } from 'antd'
import type { DeviceUsage } from '../services/api'

const LABEL: Record<DeviceUsage['device'], string> = {
  cuda: 'GPU',
  mps: 'GPU (Apple)',
  cpu: 'CPU',
}

/**
 * What the machine is doing while a job runs. The point is to answer "is the GPU being
 * used?" at a glance, so the device is named first and its memory shown as a bar.
 *
 * Values are individually optional: a platform that cannot report one still reports the
 * rest, and a missing figure is left out rather than shown as zero.
 */
export function DeviceUsageMeter({ usage }: { usage: DeviceUsage | null | undefined }) {
  if (!usage) return null

  const onGpu = usage.device !== 'cpu'
  // Percent of one core; over 100 means several cores at once.
  const cores = usage.cpu_cores ?? 0
  const coresBusy = usage.cpu_percent != null ? usage.cpu_percent / 100 : null

  return (
    <div className="device-usage" data-testid="device-usage">
      <Space size="small" wrap align="center">
        <Tag color={onGpu ? 'success' : 'default'}>
          Indexing on the {LABEL[usage.device]}
        </Tag>
        {usage.name ? (
          <Typography.Text type="secondary">{usage.name}</Typography.Text>
        ) : null}
      </Space>

      <div className="device-meters">
        {usage.gpu_percent != null ? (
          <Meter
            label="GPU"
            percent={usage.gpu_percent}
            caption={`${Math.round(usage.gpu_percent)}%`}
            hint="How busy the graphics card is"
          />
        ) : null}

        {usage.memory_percent != null ? (
          <Meter
            label={onGpu ? 'GPU memory' : 'Memory'}
            percent={usage.memory_percent}
            caption={
              usage.memory_used_gb != null && usage.memory_total_gb != null
                ? `${usage.memory_used_gb.toFixed(1)} / ${usage.memory_total_gb.toFixed(1)} GB`
                : `${Math.round(usage.memory_percent)}%`
            }
            hint={
              usage.device === 'mps'
                ? 'Apple GPUs share system memory; the total is what the model is allowed to use'
                : 'Memory in use on the device'
            }
          />
        ) : null}

        {coresBusy != null ? (
          <Meter
            label="CPU"
            // Against all cores, so a 10-core machine at 300% reads 30%.
            percent={cores > 0 ? Math.min(100, (coresBusy / cores) * 100) : Math.min(100, usage.cpu_percent ?? 0)}
            caption={
              cores > 0
                ? `${coresBusy.toFixed(1)} of ${cores} cores`
                : `${Math.round(usage.cpu_percent ?? 0)}%`
            }
            hint="Processor time this service is using, averaged since the last update"
          />
        ) : null}
      </div>
    </div>
  )
}

function Meter({
  label,
  percent,
  caption,
  hint,
}: {
  label: string
  percent: number
  caption: string
  hint: string
}) {
  return (
    <Tooltip title={hint}>
      <div className="device-meter">
        <span className="device-meter-label">{label}</span>
        <Progress
          percent={Math.max(0, Math.min(100, Math.round(percent)))}
          size="small"
          showInfo={false}
          aria-label={`${label}: ${caption}`}
        />
        <span className="device-meter-value">{caption}</span>
      </div>
    </Tooltip>
  )
}
