// frontend/src/components/AccountMenu.tsx
// The top-right corner of every screen: settings, and either a Log in button or the
// account avatar with its menu (spec 2026-10-08 §1.1, §1.2).
import {
  ExperimentOutlined,
  ExportOutlined,
  FolderOpenOutlined,
  KeyOutlined,
  LogoutOutlined,
  SettingOutlined,
  TeamOutlined,
} from '@ant-design/icons'
import { Avatar, Badge, Button, Dropdown, Space, Tag, Tooltip, type MenuProps } from 'antd'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../app/AuthContext'
import { useDialogs } from '../app/DialogsContext'

// Saturated enough for white text in both themes, and distinct from one another.
const AVATAR_COLOURS = ['#1a73e8', '#188038', '#c5221f', '#e37400', '#8430ce', '#007b83', '#5f6368']

/** A stable colour per username, so the same person always gets the same circle. */
export function avatarColour(username: string): string {
  let hash = 0
  for (const char of username) hash = (hash * 31 + char.codePointAt(0)!) >>> 0
  return AVATAR_COLOURS[hash % AVATAR_COLOURS.length]
}

/** Where the document manager opens: its own tab, sharing this one's session cookie. */
export function openDocumentManager(): void {
  window.open(`${window.location.pathname}#/drive`, '_blank', 'noopener')
}

export function TopActions() {
  const { show } = useDialogs()
  return (
    <Space size={4} className="top-actions">
      <Tooltip title="Settings">
        <Button
          type="text"
          shape="circle"
          size="large"
          aria-label="Settings"
          icon={<SettingOutlined aria-hidden="true" />}
          onClick={() => show('settings')}
        />
      </Tooltip>
      <AccountMenu />
    </Space>
  )
}

export function AccountMenu() {
  const { user, isAdmin, pendingResetRequests, logout } = useAuth()
  const { show } = useDialogs()
  const navigate = useNavigate()

  if (!user) {
    return (
      <Button type="primary" shape="round" onClick={() => show('login')} className="login-button">
        Log in
      </Button>
    )
  }

  const items: MenuProps['items'] = [
    {
      key: 'who',
      disabled: true,
      label: (
        <span className="account-who">
          {user.username} <Tag color={isAdmin ? 'gold' : 'default'}>{isAdmin ? 'Admin' : 'User'}</Tag>
        </span>
      ),
    },
    { type: 'divider' },
    {
      key: 'documents',
      icon: <FolderOpenOutlined />,
      label: (
        <span className="account-item-external">
          Manage documents <ExportOutlined aria-label="opens in a new tab" />
        </span>
      ),
    },
    { key: 'password', icon: <KeyOutlined />, label: 'Change password' },
    ...(isAdmin
      ? [
          {
            key: 'users',
            icon: <TeamOutlined />,
            label: (
              <span>
                Users{' '}
                {pendingResetRequests > 0 ? (
                  <Badge count={pendingResetRequests} size="small" title="Password reset requests" />
                ) : null}
              </span>
            ),
          },
          { key: 'admin', icon: <ExperimentOutlined />, label: 'Admin tools' },
        ]
      : []),
    { type: 'divider' },
    { key: 'logout', icon: <LogoutOutlined />, label: 'Log out' },
  ]

  const onClick: MenuProps['onClick'] = ({ key }) => {
    if (key === 'documents') openDocumentManager()
    if (key === 'password') show('password')
    if (key === 'users') navigate('/admin/users')
    if (key === 'admin') navigate('/admin')
    // Stay on the same screen: a results page refreshes to public documents only.
    if (key === 'logout') void logout()
  }

  return (
    <Dropdown menu={{ items, onClick }} trigger={['click']} placement="bottomRight">
      <Badge count={isAdmin ? pendingResetRequests : 0} size="small" offset={[-4, 4]}>
        <button type="button" className="avatar-button" aria-label={`Account: ${user.username}`}>
          <Avatar style={{ backgroundColor: avatarColour(user.username) }} size={34}>
            {user.username.charAt(0).toUpperCase()}
          </Avatar>
        </button>
      </Badge>
    </Dropdown>
  )
}
