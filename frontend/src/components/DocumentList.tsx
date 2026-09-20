// frontend/src/components/DocumentList.tsx
import type { DocumentSummary } from '../services/api'

interface Props {
  documents: DocumentSummary[]
}

export function DocumentList({ documents }: Props) {
  if (documents.length === 0) {
    return <p className="hint">No documents indexed yet. Put PDFs in the documents folder.</p>
  }
  return (
    <table className="documents">
      <thead>
        <tr>
          <th>File</th>
          <th>Pages</th>
          <th>Passages</th>
          <th>Language</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {documents.map((document) => (
          <tr key={document.document_id}>
            <td title={document.filepath}>{document.filename}</td>
            <td>{document.pages}</td>
            <td>{document.chunks}</td>
            <td>{document.language ?? '-'}</td>
            <td>{document.status}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
