// frontend/src/components/AccountMenu.tsx
// The header's account button: who you are, Appearance, Change password, Log out, and
// for admins a count of password reset requests waiting on them.

import {
  BgColorsOutlined,
  KeyOutlined,
  LogoutOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { Badge, Button, Dropdown, Modal, Tag, type MenuProps } from 'antd'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../app/AuthContext'
import { AppearanceSettings } from './AppearanceSettings'

export function AccountMenu() {
  const { user, isAdmin, pendingResetRequests, logout } = useAuth()
  const navigate = useNavigate()
  const [appearance, setAppearance] = useState(false)

  if (!user) return null

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
    { key: 'appearance', icon: <BgColorsOutlined />, label: 'Appearance' },
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
        ]
      : []),
    { type: 'divider' },
    { key: 'logout', icon: <LogoutOutlined />, label: 'Log out' },
  ]

  const onClick: MenuProps['onClick'] = ({ key }) => {
    if (key === 'appearance') setAppearance(true)
    if (key === 'password') navigate('/account/password')
    if (key === 'users') navigate('/admin/users')
    if (key === 'logout') void logout().then(() => navigate('/login', { replace: true }))
  }

  return (
    <>
      <Dropdown menu={{ items, onClick }} trigger={['click']} placement="bottomRight">
        <Badge count={isAdmin ? pendingResetRequests : 0} size="small" offset={[-4, 4]}>
          <Button
            type="text"
            icon={<UserOutlined aria-hidden="true" />}
            aria-label={`Account: ${user.username}`}
            className="account-button"
          >
            <span className="account-name">{user.username}</span>
          </Button>
        </Badge>
      </Dropdown>
      <Modal
        title="Appearance"
        open={appearance}
        onCancel={() => setAppearance(false)}
        footer={null}
        destroyOnHidden
      >
        <AppearanceSettings />
      </Modal>
    </>
  )
}
