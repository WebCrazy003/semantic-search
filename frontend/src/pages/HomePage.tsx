// frontend/src/pages/HomePage.tsx
// The first screen, laid out like google.com: the wordmark, one search box, and only
// settings and the account at the top right (spec 2026-10-08 §1.1). Enter goes to the
// results page with the query in the URL.
import { useNavigate } from 'react-router-dom'
import { TopActions } from '../components/AccountMenu'
import { SearchBar } from '../components/SearchBar'
import { searchPath } from './searchPath'

export function HomePage() {
  const navigate = useNavigate()

  return (
    <div className="home">
      <header className="home-top">
        <TopActions />
      </header>

      <main className="home-main">
        <h1 className="wordmark" aria-label="DocSage">
          <span className="brand-doc">Doc</span>
          <span className="brand-sage">Sage</span>
        </h1>
        <SearchBar variant="home" autoFocus onSearch={(query) => navigate(searchPath(query))} />
      </main>

      <footer className="home-footer">
        DocSage finds knowledge locally. It runs entirely on this machine; no document leaves
        it.
      </footer>
    </div>
  )
}
