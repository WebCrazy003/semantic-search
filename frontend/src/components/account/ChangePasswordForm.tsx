// frontend/src/pages/ChangePasswordPage.tsx
// Change your own password. Also the screen someone is held on when an administrator
// set their password and asked them to choose their own.

import { Alert, Button, Form, Input, Space } from 'antd'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../app/AuthContext'
import { FormError } from '../app/guards'
import { AuthCard, PASSWORD_HINT, PASSWORD_RULES, errorText, matches } from '../components/AuthCard'
import { changePassword } from '../services/api'

interface Values {
  current: string
  password: string
  confirm: string
}

export function ChangePasswordPage() {
  const { user, refresh, logout } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const forced = !!user?.must_change_password

  async function submit(values: Values) {
    setBusy(true)
    setError(null)
    try {
      await changePassword(values.current, values.password)
      await refresh()
      navigate('/', { replace: true })
    } catch (caught) {
      setError(errorText(caught, 'Could not change the password'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthCard
      title={forced ? 'Choose your own password' : 'Change your password'}
      subtitle={user ? `for ${user.username}` : undefined}
      footer={
        forced ? (
          <Button type="link" onClick={() => void logout()}>
            Log out instead
          </Button>
        ) : null
      }
    >
      {forced ? (
        <Alert
          type="info"
          showIcon
          message="An administrator set your password. Choose your own before you continue."
          className="auth-alert"
        />
      ) : null}
      <FormError message={error} />
      <Form<Values> layout="vertical" onFinish={(values) => void submit(values)} requiredMark={false}>
        <Form.Item
          label={forced ? 'Password you were given' : 'Current password'}
          name="current"
          rules={[{ required: true, message: 'Enter your current password' }]}
        >
          <Input.Password autoComplete="current-password" autoFocus />
        </Form.Item>
        <Form.Item label="New password" name="password" rules={PASSWORD_RULES} extra={PASSWORD_HINT}>
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Form.Item
          label="New password again"
          name="confirm"
          dependencies={['password']}
          rules={[{ required: true, message: 'Type the password again' }, matches('password')]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Space direction="vertical" style={{ width: '100%' }}>
          <Button type="primary" htmlType="submit" block loading={busy}>
            Change password
          </Button>
          {!forced ? (
            <Button block onClick={() => navigate(-1)}>
              Cancel
            </Button>
          ) : null}
        </Space>
      </Form>
    </AuthCard>
  )
}
