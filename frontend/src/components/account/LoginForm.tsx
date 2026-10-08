// frontend/src/pages/LoginPage.tsx
import { LockOutlined, UserOutlined } from '@ant-design/icons'
import { Button, Form, Input, Space } from 'antd'
import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../app/AuthContext'
import { FormError, nextPath } from '../app/guards'
import { AuthCard, errorText } from '../components/AuthCard'

interface Values {
  username: string
  password: string
}

export function LoginPage() {
  const { login, registrationOpen } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(values: Values) {
    setBusy(true)
    setError(null)
    try {
      await login(values.username.trim(), values.password)
      navigate(nextPath(location.search), { replace: true })
    } catch (caught) {
      setError(errorText(caught, 'Could not log in'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthCard
      title="Log in to DocSage"
      footer={
        <Space direction="vertical" size={4}>
          <Link to="/forgot-password">Forgot your password?</Link>
          {registrationOpen ? (
            <span>
              New here? <Link to="/register">Create an account</Link>
            </span>
          ) : null}
        </Space>
      }
    >
      <FormError message={error} />
      <Form<Values> layout="vertical" onFinish={(values) => void submit(values)} requiredMark={false}>
        <Form.Item label="Username" name="username" rules={[{ required: true, message: 'Enter your username' }]}>
          <Input prefix={<UserOutlined aria-hidden="true" />} autoComplete="username" autoFocus />
        </Form.Item>
        <Form.Item label="Password" name="password" rules={[{ required: true, message: 'Enter your password' }]}>
          <Input.Password prefix={<LockOutlined aria-hidden="true" />} autoComplete="current-password" />
        </Form.Item>
        <Button type="primary" htmlType="submit" block loading={busy}>
          Log in
        </Button>
      </Form>
    </AuthCard>
  )
}
