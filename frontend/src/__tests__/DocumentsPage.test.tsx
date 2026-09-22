// frontend/src/__tests__/DocumentsPage.test.tsx
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentsPage } from '../pages/DocumentsPage'
import { makeDocument, makeLibrary, makeStatus } from './fixtures'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('DocumentsPage', () => {
  it('invites the user to import when nothing is indexed', () => {
    render(<DocumentsPage library={makeLibrary()} />)
    expect(screen.getByText(/no documents indexed yet/i)).toBeInTheDocument()
  })

  it('lists every stored detail of a document', () => {
    const library = makeLibrary({ documents: [makeDocument()] })
    render(<DocumentsPage library={library} />)

    const row = within(screen.getByRole('table')).getAllByRole('row')[1]
    expect(within(row).getByRole('link', { name: /manual_zh\.pdf/ })).toBeInTheDocument()
    expect(within(row).getByText('手册')).toBeInTheDocument()
    expect(within(row).getByText('102')).toBeInTheDocument()
    expect(within(row).getByText('430')).toBeInTheDocument()
    expect(within(row).getByText('zh')).toBeInTheDocument()
    expect(within(row).getByText('indexed')).toBeInTheDocument()
    expect(within(row).getByText('2.3 MB')).toBeInTheDocument()
  })

  it('labels a Word file and marks its page count as approximate', () => {
    const library = makeLibrary({
      documents: [
        makeDocument({
          filename: 'manual_ko.docx',
          file_type: 'docx',
          pages: 7,
          pages_approximate: true,
        }),
      ],
    })
    render(<DocumentsPage library={library} />)

    const row = within(screen.getByRole('table')).getAllByRole('row')[1]
    expect(within(row).getByText('DOCX')).toBeInTheDocument()
    expect(within(row).getByText('~7')).toBeInTheDocument()
  })

  it('shows why an unsupported document is not searchable', () => {
    const library = makeLibrary({
      documents: [
        makeDocument({
          document_id: 'b'.repeat(64),
          filename: 'scan.pdf',
          status: 'unsupported',
          pages: 0,
          chunks: 0,
          language: null,
          title: null,
          error_message: 'scan.pdf has no extractable text; it is probably scanned',
        }),
      ],
    })
    render(<DocumentsPage library={library} />)
    expect(screen.getByText(/probably scanned/i)).toBeInTheDocument()
  })

  it('counts documents, searchable documents, and passages', () => {
    const library = makeLibrary({
      documents: [
        makeDocument(),
        makeDocument({ document_id: 'b'.repeat(64), filename: 'two.pdf', chunks: 70 }),
        makeDocument({ document_id: 'c'.repeat(64), filename: 'scan.pdf', status: 'unsupported', chunks: 0 }),
      ],
    })
    render(<DocumentsPage library={library} />)
    const summary = screen.getByText(/documents known/i).closest('div')!
    expect(within(summary).getByText('3')).toBeInTheDocument()
    expect(within(summary).getByText('2')).toBeInTheDocument()
    expect(within(summary).getByText('500')).toBeInTheDocument()
  })

  it('asks for confirmation before removing a document', async () => {
    const library = makeLibrary({ documents: [makeDocument()] })
    render(<DocumentsPage library={library} />)

    await userEvent.click(screen.getByRole('button', { name: /remove manual_zh.pdf/i }))
    expect(library.remove).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: /confirm/i }))
    expect(library.remove).toHaveBeenCalledWith('a'.repeat(64))
  })

  it('cancelling leaves the document alone', async () => {
    const library = makeLibrary({ documents: [makeDocument()] })
    render(<DocumentsPage library={library} />)

    await userEvent.click(screen.getByRole('button', { name: /remove manual_zh.pdf/i }))
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(library.remove).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /remove manual_zh.pdf/i })).toBeInTheDocument()
  })

  it('says that removing keeps the file on disk', () => {
    render(<DocumentsPage library={makeLibrary({ documents: [makeDocument()] })} />)
    expect(screen.getByText(/the file stays in the documents folder/i)).toBeInTheDocument()
  })

  it('disables removal while a job is running', () => {
    const library = makeLibrary({
      documents: [makeDocument()],
      status: makeStatus({ status: 'running' }),
    })
    render(<DocumentsPage library={library} />)
    expect(screen.getByRole('button', { name: /remove manual_zh.pdf/i })).toBeDisabled()
  })

  it('surfaces a backend error', () => {
    render(<DocumentsPage library={makeLibrary({ error: 'Cannot reach the backend' })} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Cannot reach the backend')
  })

  it('refreshes on demand', async () => {
    const library = makeLibrary()
    render(<DocumentsPage library={library} />)
    await userEvent.click(screen.getByRole('button', { name: /refresh/i }))
    expect(library.refresh).toHaveBeenCalled()
  })
})

describe('opening a document from the table', () => {
  it('links the filename to the stored PDF', () => {
    render(<DocumentsPage library={makeLibrary({ documents: [makeDocument()] })} />)
    const link = screen.getByRole('link', { name: /manual_zh\.pdf/ })
    expect(link).toHaveAttribute('href', `/api/documents/${'a'.repeat(64)}/file`)
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('does not link a file that could not be read', () => {
    const library = makeLibrary({
      documents: [makeDocument({ status: 'failed', error_message: 'cannot open' })],
    })
    render(<DocumentsPage library={library} />)
    expect(screen.queryByRole('link', { name: /manual_zh\.pdf/ })).toBeNull()
  })
})
