// frontend/src/main.tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import { LibraryProvider } from './app/LibraryContext'
import { SearchProvider } from './app/SearchContext'
import { SettingsProvider } from './settings/SettingsContext'
import { ThemeProvider } from './settings/ThemeProvider'

// HashRouter, not BrowserRouter: in production the backend serves the built assets with
// StaticFiles(html=True), which 404s on an unknown path like /admin. Hash routes need no
// server-side fallback, so reloading and bookmarking #/admin work as they are.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SettingsProvider>
      <ThemeProvider>
        <LibraryProvider>
          <SearchProvider>
            <HashRouter>
              <App />
            </HashRouter>
          </SearchProvider>
        </LibraryProvider>
      </ThemeProvider>
    </SettingsProvider>
  </StrictMode>,
)
