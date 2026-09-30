// frontend/src/App.tsx
import { FileSearchOutlined, FolderOpenOutlined, SettingOutlined } from '@ant-design/icons'
import { Button, Layout, Space, Tooltip } from 'antd'
import { Navigate, NavLink, Outlet, Route, Routes, useNavigate } from 'react-router-dom'
import { useAuth } from './app/AuthContext'
import { CHANGE_PASSWORD_PATH, PublicOnly, RequireAdmin, RequireAuth } from './app/guards'
import { LibraryProvider } from './app/LibraryContext'
import { SearchProvider } from './app/SearchContext'
import { AccountMenu } from './components/AccountMenu'
import { DocSageMark } from './components/DocSageMark'
import { AdminPage } from './pages/AdminPage'
import { ChangePasswordPage } from './pages/ChangePasswordPage'
import { DocumentsPage } from './pages/DocumentsPage'
import { ForgotPasswordPage } from './pages/ForgotPasswordPage'
import { HeroPage } from './pages/HeroPage'
import { LoginPage } from './pages/LoginPage'
import { RegisterPage } from './pages/RegisterPage'
import { SearchPage } from './pages/SearchPage'
import { SettingsPage } from './pages/SettingsPage'
import { SetupPage } from './pages/SetupPage'
import { UsersPage } from './pages/UsersPage'
import './styles.css'

const { Header, Content, Footer } = Layout

/**
 * Everything behind a login shares one library poller and one search state. They mount
 * here, not above the router, so nothing asks for documents before someone has logged
 * in, and logging out throws away the last person's results.
 */
function SignedIn() {
  return (
    <RequireAuth>
      <LibraryProvider>
        <SearchProvider>
          <Outlet />
        </SearchProvider>
      </LibraryProvider>
    </RequireAuth>
  )
}

export default function App() {
  const navigate = useNavigate()
  const { user, isAdmin } = useAuth()
  const signedIn = !!user && !user.must_change_password

  return (
    <Layout className="app-shell">
      <Header className="app-header">
        <NavLink to="/" className="brand" aria-label="DocSage, go to the start page">
          <DocSageMark size={30} />
          <span className="brand-name" aria-hidden="true">
            <span className="brand-doc">Doc</span>
            <span className="brand-sage">Sage</span>
          </span>
        </NavLink>

        {/* A landmark, so the two nav buttons are distinguishable from the identically
            named Search button on the search page itself. */}
        {user ? (
          <nav aria-label="Main">
            <Space size="small" className="app-nav">
              {signedIn ? (
                <>
                  <NavLink to="/search" className="nav-link">
                    {({ isActive }) => (
                      <Button
                        type={isActive ? 'default' : 'text'}
                        icon={<FileSearchOutlined aria-hidden="true" />}
                      >
                        Search
                      </Button>
                    )}
                  </NavLink>
                  <NavLink to="/documents" className="nav-link">
                    {({ isActive }) => (
                      <Button
                        type={isActive ? 'default' : 'text'}
                        icon={<FolderOpenOutlined aria-hidden="true" />}
                      >
                        Documents
                      </Button>
                    )}
                  </NavLink>
                  {isAdmin ? (
                    <Tooltip title="Settings">
                      <Button
                        type="text"
                        shape="circle"
                        aria-label="Settings"
                        icon={<SettingOutlined aria-hidden="true" />}
                        onClick={() => navigate('/settings')}
                      />
                    </Tooltip>
                  ) : null}
                </>
              ) : null}
              <AccountMenu />
            </Space>
          </nav>
        ) : null}
      </Header>

      <Content className="app-content">
        <Routes>
          <Route path="/login" element={<PublicOnly><LoginPage /></PublicOnly>} />
          <Route path="/register" element={<PublicOnly><RegisterPage /></PublicOnly>} />
          <Route
            path="/forgot-password"
            element={<PublicOnly><ForgotPasswordPage /></PublicOnly>}
          />
          <Route path="/setup" element={<PublicOnly setup><SetupPage /></PublicOnly>} />
          {/* Outside the signed-in layout: while a password must change, every library
              call is refused, so the poller must not start. */}
          <Route
            path={CHANGE_PASSWORD_PATH}
            element={<RequireAuth><ChangePasswordPage /></RequireAuth>}
          />

          <Route element={<SignedIn />}>
            <Route path="/" element={<HeroPage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/documents" element={<DocumentsPage />} />
            <Route path="/settings" element={<RequireAdmin><SettingsPage /></RequireAdmin>} />
            <Route path="/admin" element={<RequireAdmin><AdminPage /></RequireAdmin>} />
            <Route path="/admin/users" element={<RequireAdmin><UsersPage /></RequireAdmin>} />
          </Route>
          {/* Anything else, including the old #/indexing, lands on the hero. */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Content>

      <Footer className="app-footer">
        DocSage — find knowledge locally. Runs entirely on this machine; no document leaves it.
      </Footer>
    </Layout>
  )
}
