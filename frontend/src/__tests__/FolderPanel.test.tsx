// frontend/src/__tests__/FolderPanel.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IndexingPage } from '../pages/IndexingPage'
import { makeFolder, makeLibrary, makeStatus } from './fixtures'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('folders indexed in place', () => {
  it('says that nothing is copied', () => {
    render(<IndexingPage library={makeLibrary()} />)
    expect(screen.getAllByText(/nothing is copied/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/including the ones in subfolders/i)).toBeInTheDocument()
  })

  it('adds a folder by path', async () => {
    const library = makeLibrary()
    render(<IndexingPage library={library} />)

    await userEvent.type(
      screen.getByLabelText(/folder path/i),
      '/Users/you/Documents/manuals',
    )
    await userEvent.click(screen.getByRole('button', { name: /add folder/i }))

    expect(library.addLibraryFolder).toHaveBeenCalledWith('/Users/you/Documents/manuals')
  })

  it('adds on Enter as well', async () => {
    const library = makeLibrary()
    render(<IndexingPage library={library} />)
    await userEvent.type(screen.getByLabelText(/folder path/i), '/data/pdfs{Enter}')
    expect(library.addLibraryFolder).toHaveBeenCalledWith('/data/pdfs')
  })

  it('cannot add an empty path', () => {
    render(<IndexingPage library={makeLibrary()} />)
    expect(screen.getByRole('button', { name: /add folder/i })).toBeDisabled()
  })

  it('clears the box once the folder is accepted', async () => {
    const library = makeLibrary()
    render(<IndexingPage library={library} />)
    const input = screen.getByLabelText(/folder path/i)
    await userEvent.type(input, '/data/pdfs{Enter}')
    expect(input).toHaveValue('')
  })

  it('keeps the path when it was rejected, so it can be corrected', async () => {
    const library = makeLibrary({ addLibraryFolder: vi.fn().mockResolvedValue(false) })
    render(<IndexingPage library={library} />)
    const input = screen.getByLabelText(/folder path/i)
    await userEvent.type(input, '/typo{Enter}')
    expect(input).toHaveValue('/typo')
  })

  it('lists each folder with what it holds', () => {
    const library = makeLibrary({
      folders: [
        makeFolder({
          path: '/documents',
          is_default: true,
          document_count: 3,
          indexed_documents: 3,
        }),
        makeFolder({ path: '/Users/you/manuals', document_count: 40, indexed_documents: 38 }),
      ],
    })
    render(<IndexingPage library={library} />)

    expect(screen.getByText('/Users/you/manuals')).toBeInTheDocument()
    expect(screen.getByText(/40 documents on disk · 38 indexed/)).toBeInTheDocument()
    expect(screen.getByText('default')).toBeInTheDocument()
  })

  it('flags a folder it can no longer read', () => {
    const library = makeLibrary({
      folders: [makeFolder({ path: '/Volumes/usb/manuals', readable: false, exists: false })],
    })
    render(<IndexingPage library={library} />)
    expect(screen.getByText(/not readable/i)).toBeInTheDocument()
  })

  it('does not offer to remove the default folder', () => {
    const library = makeLibrary({ folders: [makeFolder({ path: '/documents', is_default: true })] })
    render(<IndexingPage library={library} />)
    expect(screen.queryByRole('button', { name: /stop indexing/i })).toBeNull()
  })

  it('confirms before removing a folder, and says what it costs', async () => {
    const library = makeLibrary({
      folders: [makeFolder({ path: '/Users/you/manuals', indexed_documents: 38 })],
    })
    render(<IndexingPage library={library} />)

    await userEvent.click(screen.getByRole('button', { name: /stop indexing/i }))
    expect(library.removeLibraryFolder).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: /remove 38 from the index/i }))
    expect(library.removeLibraryFolder).toHaveBeenCalledWith('/Users/you/manuals')
  })

  it('cannot add or remove while a job runs', () => {
    const library = makeLibrary({
      status: makeStatus({ status: 'running' }),
      folders: [makeFolder({ path: '/Users/you/manuals' })],
    })
    render(<IndexingPage library={library} />)
    expect(screen.getByRole('button', { name: /stop indexing/i })).toBeDisabled()
  })
})
