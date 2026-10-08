// frontend/src/main.tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './app/AuthContext'
import { SettingsProvider } from './settings/SettingsContext'
import { ThemeProvider } from './settings/ThemeProvider'

// HashRouter, not BrowserRouter: in production the backend serves the built assets with
// StaticFiles(html=True), which 404s on an unknown path like /admin. Hash routes need no
// server-side fallback, so reloading and bookmarking #/admin work as they are.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SettingsProvider>
      <ThemeProvider>
        {/* The search state mounts inside App for everyone; the library poller only on
            the pages that need a login. */}
        <AuthProvider>
          <HashRouter>
            <App />
          </HashRouter>
        </AuthProvider>
      </ThemeProvider>
    </SettingsProvider>
  </StrictMode>,
)
