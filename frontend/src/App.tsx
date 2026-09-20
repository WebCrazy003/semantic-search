// frontend/src/App.tsx
import { useState } from 'react'
import { DocumentsPage } from './pages/DocumentsPage'
import { SearchPage } from './pages/SearchPage'
import './styles.css'

type Tab = 'search' | 'documents'

export default function App() {
  const [tab, setTab] = useState<Tab>('search')

  return (
    <div className="app">
      <header>
        <h1>Semantic PDF Search</h1>
        <nav>
          <button
            type="button"
            className={tab === 'search' ? 'active' : ''}
            onClick={() => setTab('search')}
          >
            Search
          </button>
          <button
            type="button"
            className={tab === 'documents' ? 'active' : ''}
            onClick={() => setTab('documents')}
          >
            Documents
          </button>
        </nav>
      </header>
      <main>{tab === 'search' ? <SearchPage /> : <DocumentsPage />}</main>
      <footer>Runs entirely on this machine. No document leaves it.</footer>
    </div>
  )
}
