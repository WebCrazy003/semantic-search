// frontend/src/__tests__/DocumentList.test.tsx
// Paging and sorting used to be a hand-written Pagination component and a sort header;
// both are now Ant Design's Table. The behaviour tested here is the same, and the old
// components were deleted rather than left unused.

import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentList } from '../components/DocumentList'
import { JobHistory } from '../components/JobHistory'
import { makeDocument, makeJob } from './fixtures'
import { renderWithProviders } from './helpers'

const many = Array.from({ length: 23 }, (_, index) =>
  makeDocument({
    document_id: `doc-${index}`,
    filename: `manual_${String(index).padStart(2, '0')}.pdf`,
    chunks: index * 10,
    pages: index + 1,
  }),
)

afterEach(() => {
  vi.restoreAllMocks()
})

function rows() {
  const table = screen.getAllByRole('table')[0]
  return within(table).getAllByRole('row').slice(1) // drop the header row
}

describe('paging', () => {
  it('shows only the first page', () => {
    renderWithProviders(<DocumentList documents={many} />)
    expect(rows()).toHaveLength(10)
    expect(screen.getByRole('link', { name: /manual_00\.pdf/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /manual_10\.pdf/ })).not.toBeInTheDocument()
  })

  it('moves to the next page', async () => {
    renderWithProviders(<DocumentList documents={many} />)
    await userEvent.click(screen.getByTitle('2'))
    expect(screen.getByRole('link', { name: /manual_10\.pdf/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /manual_00\.pdf/ })).not.toBeInTheDocument()
  })

  it('jumps to the last page, which may be partly full', async () => {
    renderWithProviders(<DocumentList documents={many} />)
    await userEvent.click(screen.getByTitle('3'))
    expect(rows()).toHaveLength(3)
  })

  it('does not page a list that fits on one page', () => {
    renderWithProviders(<DocumentList documents={many.slice(0, 4)} />)
    expect(rows()).toHaveLength(4)
    expect(screen.queryByTitle('2')).not.toBeInTheDocument()
  })

  it('pages the job history too', async () => {
    const jobs = Array.from({ length: 12 }, (_, index) =>
      makeJob({ job_id: `job-${index}`, chunks: index }),
    )
    renderWithProviders(<JobHistory jobs={jobs} />)
    expect(rows()).toHaveLength(10)
    await userEvent.click(screen.getByTitle('2'))
    expect(rows()).toHaveLength(2)
  })
})

describe('sorting', () => {
  it('sorts numerically by passages, not alphabetically', async () => {
    renderWithProviders(<DocumentList documents={many} />)
    await userEvent.click(screen.getByRole('columnheader', { name: /passages/i }))
    const first = within(rows()[0]).getByRole('link')
    expect(first).toHaveAccessibleName(/manual_00\.pdf/)
  })

  it('reverses when the same column is clicked again', async () => {
    renderWithProviders(<DocumentList documents={many} />)
    const header = screen.getByRole('columnheader', { name: /passages/i })
    await userEvent.click(header)
    await userEvent.click(header)
    const first = within(rows()[0]).getByRole('link')
    expect(first).toHaveAccessibleName(/manual_22\.pdf/)
  })

  it('marks the sorted column for assistive technology', async () => {
    renderWithProviders(<DocumentList documents={many} />)
    const header = screen.getByRole('columnheader', { name: /passages/i })
    await userEvent.click(header)
    expect(header).toHaveAttribute('aria-sort', 'ascending')
  })
})

describe('what a row shows', () => {
  it('marks a Word file and its approximate page count', () => {
    renderWithProviders(
      <DocumentList
        documents={[makeDocument({ file_type: 'docx', pages_approximate: true, pages: 3 })]}
      />,
    )
    expect(screen.getByText('DOCX')).toBeInTheDocument()
    expect(screen.getByText('~3')).toBeInTheDocument()
  })

  it('does not link a file that could not be read', () => {
    renderWithProviders(
      <DocumentList
        documents={[makeDocument({ status: 'failed', error_message: 'damaged file' })]}
      />,
    )
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByText('damaged file')).toBeInTheDocument()
  })

  it('confirms before removing a document', async () => {
    const onRemove = vi.fn()
    renderWithProviders(<DocumentList documents={[makeDocument()]} onRemove={onRemove} />)
    await userEvent.click(screen.getByRole('button', { name: /remove manual_zh\.pdf/i }))
    expect(onRemove).not.toHaveBeenCalled()
    await userEvent.click(await screen.findByRole('button', { name: /^remove$/i }))
    expect(onRemove).toHaveBeenCalledWith('a'.repeat(64))
  })
})
