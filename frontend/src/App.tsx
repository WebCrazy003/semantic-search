// frontend/src/App.tsx
import { Alert, Button } from 'antd'
import { Link, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from './app/AuthContext'
import { DIALOG_PARAM, DialogsProvider, type DialogName } from './app/DialogsContext'
import { RequireAdmin, RequireAuth } from './app/guards'
import { LibraryProvider } from './app/LibraryContext'
import { SearchProvider, useSearchContext } from './app/SearchContext'
import { TopActions } from './components/AccountMenu'
import { SearchBar } from './components/SearchBar'
import { AdminPage } from './pages/AdminPage'
import { DrivePage } from './pages/DrivePage'
import { HomePage } from './pages/HomePage'
import { SearchPage } from './pages/SearchPage'
import { searchPath } from './pages/searchPath'
import { UsersPage } from './pages/UsersPage'
import { ViewerPage } from './pages/ViewerPage'
import './styles.css'

/** The header's search box: it shows the query in the URL and searches by navigating. */
function HeaderSearch() {
  const navigate = useNavigate()
  const location = useLocation()
  const { run, busy } = useSearchContext()
  const q = new URLSearchParams(location.search).get('q') ?? ''
  return (
    <SearchBar
      // A new ?q (Back, or a search from elsewhere) resets what the box shows.
      key={q}
      initialValue={q}
      busy={busy}
      onSearch={(query) => {
        // The same query again re-runs it; the URL would not change, so nothing else would.
        if (query === q) void run(query)
        else navigate(searchPath(query))
      }}
    />
  )
}

/**
 * Every screen but the home page: a slim header with the wordmark, the search box on
 * the results page, and the same top-right buttons the home page has.
 */
function Shell() {
  const location = useLocation()
  const onResults = location.pathname === '/search'
  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="brand" aria-label="DocSage, go to the start page">
          <span className="brand-doc">Doc</span>
          <span className="brand-sage">Sage</span>
        </Link>
        <div className="topbar-center">{onResults ? <HeaderSearch /> : null}</div>
        <TopActions />
      </header>
      <main className="shell-content">
        <Outlet />
      </main>
    </div>
  )
}

/** Shown over any screen when the backend cannot be reached at all. */
function OfflineBanner() {
  const { phase, error, refresh } = useAuth()
  if (phase !== 'offline') return null
  return (
    <Alert
      type="warning"
      banner
      message={error ?? 'DocSage is not reachable'}
      action={
        <Button size="small" onClick={() => void refresh()}>
          Try again
        </Button>
      }
    />
  )
}

/** An old page route, now a dialog over the home page. */
function DialogRedirect({ dialog }: { dialog: DialogName }) {
  return <Navigate to={`/?${DIALOG_PARAM}=${dialog}`} replace />
}

export default function App() {
  return (
    <DialogsProvider>
      <SearchProvider>
        <OfflineBanner />
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route element={<Shell />}>
            <Route path="/search" element={<SearchPage />} />
            <Route path="/view/:documentId" element={<ViewerPage />} />
            <Route
              path="/drive"
              element={
                <RequireAuth what="manage your documents">
                  <LibraryProvider>
                    <DrivePage />
                  </LibraryProvider>
                </RequireAuth>
              }
            />
            <Route
              path="/admin"
              element={
                <RequireAuth what="use the admin tools">
                  <RequireAdmin>
                    <LibraryProvider>
                      <AdminPage />
                    </LibraryProvider>
                  </RequireAdmin>
                </RequireAuth>
              }
            />
            <Route
              path="/admin/users"
              element={
                <RequireAuth what="manage users">
                  <RequireAdmin>
                    <UsersPage />
                  </RequireAdmin>
                </RequireAuth>
              }
            />
          </Route>

          {/* Old page routes, kept for bookmarks: each opens its dialog instead. */}
          <Route path="/login" element={<DialogRedirect dialog="login" />} />
          <Route path="/register" element={<DialogRedirect dialog="register" />} />
          <Route path="/forgot-password" element={<DialogRedirect dialog="forgot" />} />
          <Route path="/settings" element={<DialogRedirect dialog="settings" />} />
          <Route path="/account/password" element={<DialogRedirect dialog="password" />} />
          <Route path="/setup" element={<Navigate to="/" replace />} />
          <Route path="/documents" element={<Navigate to="/drive" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </SearchProvider>
    </DialogsProvider>
  )
}
