// frontend/src/__tests__/IndexingPage.test.tsx
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IndexingPage } from '../pages/IndexingPage'
import { makeDocument, makeJob, makeLibrary, makeStatus } from './fixtures'

function pdf(name: string): File {
  return new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], name, { type: 'application/pdf' })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('importing PDFs', () => {
  it('imports the chosen files', async () => {
    const library = makeLibrary()
    render(<IndexingPage library={library} />)

    await userEvent.upload(screen.getByLabelText(/pdf files to import/i), [
      pdf('one.pdf'),
      pdf('two.pdf'),
    ])
    await userEvent.click(screen.getByRole('button', { name: /import 2 files and index/i }))

    expect(library.importFiles).toHaveBeenCalledTimes(1)
    const files = (library.importFiles as unknown as { mock: { calls: File[][][] } }).mock.calls[0][0]
    expect(files.map((file) => file.name)).toEqual(['one.pdf', 'two.pdf'])
  })

  it('cannot import before any file is chosen', () => {
    render(<IndexingPage library={makeLibrary()} />)
    expect(screen.getByRole('button', { name: /import and index/i })).toBeDisabled()
  })

  it('lists the chosen files before importing', async () => {
    render(<IndexingPage library={makeLibrary()} />)
    await userEvent.upload(screen.getByLabelText(/pdf files to import/i), [pdf('manual.pdf')])
    expect(screen.getByText(/manual.pdf/)).toBeInTheDocument()
  })

  it('reports what was imported and what was refused', () => {
    const library = makeLibrary({
      lastUpload: {
        saved: ['good.pdf'],
        rejected: [{ filename: 'notes.txt', reason: 'not a .pdf file' }],
        directory: '/documents',
      },
    })
    render(<IndexingPage library={library} />)
    expect(screen.getByText(/imported 1 file: good.pdf/i)).toBeInTheDocument()
    expect(screen.getByText(/not a .pdf file/i)).toBeInTheDocument()
  })

  it('states which PDFs can be searched', () => {
    render(<IndexingPage library={makeLibrary()} />)
    expect(screen.getByText(/which pdfs can be searched/i)).toBeInTheDocument()
    expect(screen.getByText(/scanned pages and photographs/i)).toBeInTheDocument()
    expect(screen.getByText(/password-protected pdfs/i)).toBeInTheDocument()
  })

  it('blocks importing while a job runs, so only one job exists at a time', async () => {
    const library = makeLibrary({ status: makeStatus({ status: 'running' }) })
    render(<IndexingPage library={library} />)
    await userEvent.upload(screen.getByLabelText(/pdf files to import/i), [pdf('one.pdf')])
    expect(screen.getByRole('button', { name: /import and index/i })).toBeDisabled()
    expect(screen.getByText(/a job is running/i)).toBeInTheDocument()
  })
})

describe('job progress', () => {
  it('starts a folder scan', async () => {
    const library = makeLibrary()
    render(<IndexingPage library={library} />)
    await userEvent.click(screen.getByRole('button', { name: /index documents folder/i }))
    expect(library.runIndexing).toHaveBeenCalled()
  })

  it('shows progress while a run is under way', () => {
    const library = makeLibrary({
      status: makeStatus({
        status: 'running',
        total_documents: 10,
        processed_documents: 4,
        current_file: '05_软件测试.pdf',
        indexed_documents: 4,
        total_chunks: 120,
      }),
    })
    render(<IndexingPage library={library} />)

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40')
    expect(screen.getByText(/4 of 10 files/)).toBeInTheDocument()
    expect(screen.getByText(/05_软件测试.pdf/)).toBeInTheDocument()
  })

  it('does not claim completion before discovery finishes', () => {
    const library = makeLibrary({
      status: makeStatus({ status: 'running', total_documents: 0, processed_documents: 0 }),
    })
    render(<IndexingPage library={library} />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0')
  })

  it('shows the result when the run has finished', () => {
    const library = makeLibrary({
      status: makeStatus({
        status: 'completed',
        total_documents: 10,
        processed_documents: 10,
        indexed_documents: 9,
        unsupported_documents: 1,
        total_chunks: 279,
        trigger: 'upload',
      }),
    })
    render(<IndexingPage library={library} />)

    const panel = screen.getByRole('heading', { name: /indexing job/i }).closest('section')!
    expect(within(panel).getByText('completed')).toBeInTheDocument()
    expect(within(panel).getByText('279')).toBeInTheDocument()
    expect(within(panel).getByText('import')).toBeInTheDocument()
  })

  it('lists the files a run could not read', () => {
    const library = makeLibrary({
      status: makeStatus({
        status: 'completed',
        failures: [
          {
            filename: 'broken.pdf',
            filepath: '/documents/broken.pdf',
            error_type: 'PdfExtractionError',
            error_message: 'cannot open broken.pdf',
            timestamp: '2026-09-20T12:00:00Z',
          },
        ],
      }),
    })
    render(<IndexingPage library={library} />)
    expect(screen.getByText(/cannot open broken.pdf/)).toBeInTheDocument()
  })

  it('cannot start a second run while one is in progress', () => {
    const library = makeLibrary({ status: makeStatus({ status: 'running' }) })
    render(<IndexingPage library={library} />)
    expect(screen.getByRole('button', { name: /^indexing…$/i })).toBeDisabled()
  })
})

describe('job history', () => {
  it('says so when nothing has run', () => {
    render(<IndexingPage library={makeLibrary()} />)
    expect(screen.getByText(/no jobs have run yet/i)).toBeInTheDocument()
  })

  it('lists past runs with their outcome and duration', () => {
    const library = makeLibrary({
      jobs: [
        makeJob(),
        makeJob({
          job_id: 'job-0',
          trigger: 'upload',
          indexed: 2,
          chunks: 40,
          started_at: '2026-09-20T11:00:00Z',
          finished_at: '2026-09-20T11:00:04Z',
        }),
      ],
    })
    render(<IndexingPage library={library} />)

    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('row')).toHaveLength(3) // header plus two runs
    expect(within(table).getByText('39.0 s')).toBeInTheDocument()
    expect(within(table).getByText('import')).toBeInTheDocument()
  })
})

describe('clearing the index', () => {
  it('asks for confirmation first', async () => {
    const library = makeLibrary({ documents: [makeDocument()] })
    render(<IndexingPage library={library} />)

    await userEvent.click(screen.getByRole('button', { name: /clear all indexing/i }))
    expect(library.clearAll).not.toHaveBeenCalled()
    expect(screen.getByText(/1 document will stop being searchable/i)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /yes, clear it/i }))
    expect(library.clearAll).toHaveBeenCalled()
  })

  it('can be cancelled', async () => {
    const library = makeLibrary({ documents: [makeDocument()] })
    render(<IndexingPage library={library} />)
    await userEvent.click(screen.getByRole('button', { name: /clear all indexing/i }))
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(library.clearAll).not.toHaveBeenCalled()
  })

  it('promises that the PDF files are kept', () => {
    render(<IndexingPage library={makeLibrary()} />)
    expect(screen.getByText(/your pdfs stay in the documents folder/i)).toBeInTheDocument()
  })

  it('reports what the clear removed', () => {
    const library = makeLibrary({
      lastClear: { documents_removed: 10, passages_removed: 279, files_kept: true },
    })
    render(<IndexingPage library={library} />)
    expect(screen.getByText(/cleared 10 documents and 279 passages/i)).toBeInTheDocument()
  })

  it('cannot clear while a job is running', () => {
    const library = makeLibrary({ status: makeStatus({ status: 'running' }) })
    render(<IndexingPage library={library} />)
    expect(screen.getByRole('button', { name: /clear all indexing/i })).toBeDisabled()
  })
})

describe('live progress detail', () => {
  it('counts a part-finished file towards the bar', () => {
    const library = makeLibrary({
      status: makeStatus({
        status: 'running',
        total_documents: 10,
        processed_documents: 4,
        current_file_progress: 0.5,
      }),
    })
    render(<IndexingPage library={library} />)
    // 4 whole files plus half of the fifth, out of ten.
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '45')
  })

  it('names the stage the current file is in', () => {
    const library = makeLibrary({
      status: makeStatus({
        status: 'running',
        total_documents: 3,
        processed_documents: 1,
        current_file: '05_软件测试.pdf',
        current_stage: 'embedding',
      }),
    })
    render(<IndexingPage library={library} />)
    expect(screen.getByText(/embedding/)).toBeInTheDocument()
  })

  it('shows an indeterminate bar until the file count is known', () => {
    const library = makeLibrary({
      status: makeStatus({ status: 'running', total_documents: 0, processed_documents: 0 }),
    })
    render(<IndexingPage library={library} />)
    expect(screen.getByRole('progressbar').className).toContain('indeterminate')
  })

  it('shows the passage count as it climbs', () => {
    const library = makeLibrary({
      status: makeStatus({ status: 'running', total_chunks: 137, total_documents: 10 }),
    })
    render(<IndexingPage library={library} />)
    const passages = screen.getByText('Passages').closest('div')!
    expect(passages.className).toContain('live')
    expect(passages).toHaveTextContent('137')
  })
})

describe('what the file count means', () => {
  it('says files were checked, not imported, while running', () => {
    const library = makeLibrary({
      status: makeStatus({ status: 'running', total_documents: 21, processed_documents: 3 }),
    })
    render(<IndexingPage library={library} />)
    expect(screen.getByText(/3 of 21 files checked/)).toBeInTheDocument()
  })

  it('separates what was indexed from what was already up to date', () => {
    const library = makeLibrary({
      status: makeStatus({
        status: 'completed',
        trigger: 'upload',
        total_documents: 21,
        processed_documents: 21,
        indexed_documents: 1,
        skipped_documents: 20,
      }),
    })
    render(<IndexingPage library={library} />)

    const panel = screen.getByRole('heading', { name: /indexing job/i }).closest('section')!
    expect(panel.textContent).toContain('checked 21 files in the folder')
    expect(panel.textContent).toContain('indexed 1')
    expect(panel.textContent).toContain('20 already up to date')
  })

  it('labels the skipped counter as unchanged', () => {
    const library = makeLibrary({
      status: makeStatus({ status: 'completed', skipped_documents: 20 }),
    })
    render(<IndexingPage library={library} />)
    expect(screen.getByText('Unchanged').closest('div')).toHaveTextContent('20')
  })

  it('explains that importing copies, and that a folder does not', () => {
    render(<IndexingPage library={makeLibrary()} />)
    expect(screen.getAllByText(/nothing is copied/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/for one-off files/i)).toBeInTheDocument()
  })
})
