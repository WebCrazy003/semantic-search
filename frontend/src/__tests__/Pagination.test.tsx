// frontend/src/__tests__/Pagination.test.tsx
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentList } from '../components/DocumentList'
import { JobHistory } from '../components/JobHistory'
import { makeDocument, makeJob } from './fixtures'

function documents(count: number) {
  return Array.from({ length: count }, (_, index) =>
    makeDocument({
      document_id: String(index).padStart(64, '0'),
      filename: `doc-${String(index).padStart(3, '0')}.pdf`,
      chunks: index,
      file_size: (index + 1) * 100_000,
    }),
  )
}

function rowNames(): string[] {
  const table = screen.getByRole('table')
  return within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[0].textContent ?? '')
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('document table paging', () => {
  it('shows only the first page', () => {
    render(<DocumentList documents={documents(25)} />)
    expect(rowNames()).toHaveLength(10)
    expect(screen.getByText('1–10 of 25 documents')).toBeInTheDocument()
  })

  it('moves to the next page', async () => {
    render(<DocumentList documents={documents(25)} />)
    await userEvent.click(screen.getByRole('button', { name: /next page/i }))
    expect(rowNames()[0]).toContain('doc-010.pdf')
    expect(screen.getByText('11–20 of 25 documents')).toBeInTheDocument()
  })

  it('jumps to the last page, which may be partly full', async () => {
    render(<DocumentList documents={documents(25)} />)
    await userEvent.click(screen.getByRole('button', { name: /last page/i }))
    expect(rowNames()).toHaveLength(5)
    expect(screen.getByText(/page 3 of 3/i)).toBeInTheDocument()
  })

  it('disables the ends when there is nowhere to go', async () => {
    render(<DocumentList documents={documents(25)} />)
    expect(screen.getByRole('button', { name: /previous page/i })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: /last page/i }))
    expect(screen.getByRole('button', { name: /next page/i })).toBeDisabled()
  })

  it('changing the page size returns to the first page', async () => {
    render(<DocumentList documents={documents(25)} />)
    await userEvent.click(screen.getByRole('button', { name: /next page/i }))
    await userEvent.selectOptions(screen.getByLabelText(/documents per page/i), '25')
    expect(rowNames()).toHaveLength(25)
    expect(screen.getByText(/page 1 of 1/i)).toBeInTheDocument()
  })

  it('does not page a list that fits on one page', () => {
    render(<DocumentList documents={documents(3)} />)
    expect(screen.getByText('1–3 of 3 documents')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /next page/i })).toBeDisabled()
  })

  it('pages the job history too', async () => {
    const jobs = Array.from({ length: 12 }, (_, index) =>
      makeJob({ job_id: `job-${index}`, indexed: index }),
    )
    render(<JobHistory jobs={jobs} />)
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(11)
    await userEvent.click(screen.getByRole('button', { name: /next page/i }))
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(3)
  })
})

describe('document table sorting', () => {
  it('sorts by filename ascending to begin with', () => {
    render(<DocumentList documents={documents(12).reverse()} />)
    expect(rowNames()[0]).toContain('doc-000.pdf')
  })

  it('reverses when the same column is clicked again', async () => {
    render(<DocumentList documents={documents(12)} />)
    await userEvent.click(screen.getByRole('button', { name: /^file/i }))
    expect(rowNames()[0]).toContain('doc-011.pdf')
  })

  it('sorts numerically by passages', async () => {
    render(<DocumentList documents={documents(12)} />)
    await userEvent.click(screen.getByRole('button', { name: /^passages/i }))
    const cells = within(screen.getByRole('table')).getAllByRole('row')[1]
    expect(within(cells).getAllByRole('cell')[3]).toHaveTextContent('0')

    await userEvent.click(screen.getByRole('button', { name: /^passages/i }))
    const reversed = within(screen.getByRole('table')).getAllByRole('row')[1]
    expect(within(reversed).getAllByRole('cell')[3]).toHaveTextContent('11')
  })

  it('marks the sorted column for assistive technology', async () => {
    render(<DocumentList documents={documents(4)} />)
    await userEvent.click(screen.getByRole('button', { name: /^pages/i }))
    const header = screen.getAllByRole('columnheader').find((cell) => cell.textContent?.startsWith('Pages'))
    expect(header).toHaveAttribute('aria-sort', 'ascending')
  })
})
