// frontend/src/App.tsx
import { FileSearchOutlined, FolderOpenOutlined, SettingOutlined } from '@ant-design/icons'
import { Button, Layout, Space, Tooltip, Typography } from 'antd'
import { Navigate, NavLink, Route, Routes, useNavigate } from 'react-router-dom'
import { AdminPage } from './pages/AdminPage'
import { DocumentsPage } from './pages/DocumentsPage'
import { HeroPage } from './pages/HeroPage'
import { SearchPage } from './pages/SearchPage'
import { SettingsPage } from './pages/SettingsPage'
import './styles.css'

const { Header, Content, Footer } = Layout

export default function App() {
  const navigate = useNavigate()

  return (
    <Layout className="app-shell">
      <Header className="app-header">
        <NavLink to="/" className="brand">
          <FileSearchOutlined aria-hidden="true" />
          <Typography.Text strong className="brand-name">
            Semantic Document Search
          </Typography.Text>
        </NavLink>

        {/* A landmark, so the two nav buttons are distinguishable from the identically
            named Search button on the search page itself. */}
        <nav aria-label="Main">
          <Space size="small" className="app-nav">
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
            <Tooltip title="Settings">
              <Button
                type="text"
                shape="circle"
                aria-label="Settings"
                icon={<SettingOutlined aria-hidden="true" />}
                onClick={() => navigate('/settings')}
              />
            </Tooltip>
          </Space>
        </nav>
      </Header>

      <Content className="app-content">
        <Routes>
          <Route path="/" element={<HeroPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/documents" element={<DocumentsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/admin" element={<AdminPage />} />
          {/* Anything else, including the old #/indexing, lands on the hero. */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Content>

      <Footer className="app-footer">Runs entirely on this machine. No document leaves it.</Footer>
    </Layout>
  )
}
