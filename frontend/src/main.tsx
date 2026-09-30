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
        {/* The library poller and the search state mount inside App's signed-in
            layout, so they exist only while someone is logged in. */}
        <AuthProvider>
          <HashRouter>
            <App />
          </HashRouter>
        </AuthProvider>
      </ThemeProvider>
    </SettingsProvider>
  </StrictMode>,
)
