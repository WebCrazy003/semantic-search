// frontend/src/__tests__/DeviceStatus.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DeviceLine } from '../components/DeviceStatus'
import type { Readiness } from '../services/api'

function readiness(overrides: Partial<Readiness>): Readiness {
  return { status: 'ready', model_loaded: true, ...overrides }
}

describe('which processor indexing runs on', () => {
  it('names the NVIDIA GPU with its memory, precision and batch size', () => {
    render(
      <DeviceLine
        readiness={readiness({
          embedding_device: 'cuda',
          embedding_device_name: 'NVIDIA GeForce RTX 5060',
          embedding_memory_gb: 8,
          embedding_precision: 'fp16',
          embedding_batch_size: 16,
        })}
      />,
    )
    expect(screen.getByText('NVIDIA GeForce RTX 5060')).toBeInTheDocument()
    expect(screen.getByText(/8 GB \(fp16, batches of 16\)/)).toBeInTheDocument()
  })

  it('says why the GPU is not used when it falls back to the CPU', () => {
    render(
      <DeviceLine
        readiness={readiness({
          embedding_device: 'cpu',
          embedding_fallback_reason: 'the GPU ran out of memory even one passage at a time',
        })}
      />,
    )
    expect(screen.getByText(/runs on the/i)).toHaveTextContent(
      'Indexing runs on the CPU. The GPU is not used because the GPU ran out of memory',
    )
  })

  it('shows plain CPU with no reason on a machine without a GPU', () => {
    render(<DeviceLine readiness={readiness({ embedding_device: 'cpu' })} />)
    expect(screen.getByText(/runs on the/i)).toHaveTextContent(/^Indexing runs on the CPU\.$/)
  })

  it('shows nothing until the backend has answered', () => {
    const { container } = render(<DeviceLine readiness={null} />)
    expect(container).toBeEmptyDOMElement()
  })
})
