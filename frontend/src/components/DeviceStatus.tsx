// frontend/src/components/DeviceStatus.tsx
import { useEffect, useState } from 'react'
import { fetchReadiness, type Readiness } from '../services/api'

/** Which processor indexing runs on, and why not the GPU when there is one. */
export function DeviceStatus() {
  const [readiness, setReadiness] = useState<Readiness | null>(null)

  useEffect(() => {
    let live = true
    fetchReadiness()
      .then((result) => {
        if (live) setReadiness(result)
      })
      .catch(() => {
        // The job panel already reports an unreachable backend; stay quiet here.
      })
    return () => {
      live = false
    }
  }, [])

  return <DeviceLine readiness={readiness} />
}

export function DeviceLine({ readiness }: { readiness: Readiness | null }) {
  if (!readiness?.embedding_device) return null
  const { embedding_device: device, embedding_device_name: name } = readiness

  if (device === 'cuda') {
    const memory = readiness.embedding_memory_gb ? `, ${readiness.embedding_memory_gb} GB` : ''
    return (
      <p className="hint device" data-device="cuda">
        Indexing runs on the GPU: <strong>{name}</strong>
        {memory} ({readiness.embedding_precision}, batches of {readiness.embedding_batch_size})
      </p>
    )
  }
  if (device === 'mps') {
    return (
      <p className="hint device" data-device="mps">
        Indexing runs on the <strong>Apple GPU</strong>.
      </p>
    )
  }
  return (
    <p className="hint device" data-device="cpu">
      Indexing runs on the <strong>CPU</strong>.
      {readiness.embedding_fallback_reason ? (
        <> The GPU is not used because {readiness.embedding_fallback_reason}.</>
      ) : null}
    </p>
  )
}
