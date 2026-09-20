// frontend/src/App.tsx
import { useState } from 'react'
import { useLibrary } from './hooks/useLibrary'
import { DocumentsPage } from './pages/DocumentsPage'
import { IndexingPage } from './pages/IndexingPage'
import { SearchPage } from './pages/SearchPage'
import './styles.css'

type Tab = 'search' | 'documents' | 'indexing'

const TABS: { id: Tab; label: string }[] = [
  { id: 'search', label: 'Search' },
  { id: 'documents', label: 'Documents' },
  { id: 'indexing', label: 'Indexing' },
]

export default function App() {
  const [tab, setTab] = useState<Tab>('search')
  const library = useLibrary()

  return (
    <div className="app">
      <header>
        <h1>Semantic PDF Search</h1>
        <nav>
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={tab === entry.id ? 'active' : ''}
              aria-current={tab === entry.id ? 'page' : undefined}
              onClick={() => setTab(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </nav>
      </header>

      {/*
        Every tab stays mounted and is hidden rather than unmounted, so a search and its
        results, a chosen file, or a scroll position all survive switching tabs.
      */}
      <main>
        <div hidden={tab !== 'search'}>
          <SearchPage />
        </div>
        <div hidden={tab !== 'documents'}>
          <DocumentsPage library={library} />
        </div>
        <div hidden={tab !== 'indexing'}>
          <IndexingPage library={library} />
        </div>
      </main>

      <footer>Runs entirely on this machine. No document leaves it.</footer>
    </div>
  )
}
