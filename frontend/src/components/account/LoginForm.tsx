// frontend/src/components/account/LoginForm.tsx
import { LockOutlined, UserOutlined } from '@ant-design/icons'
import { Button, Form, Input, Space } from 'antd'
import { useState } from 'react'
import { useAuth } from '../../app/AuthContext'
import { useDialogs } from '../../app/DialogsContext'
import { AuthCard, DialogLink, FormError, errorText } from './AuthCard'

interface Values {
  username: string
  password: string
}

/** Log in. On success the dialog closes by itself and the screen behind refreshes. */
export function LoginForm() {
  const { login, registrationOpen } = useAuth()
  const { show } = useDialogs()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(values: Values) {
    setBusy(true)
    setError(null)
    try {
      await login(values.username.trim(), values.password)
    } catch (caught) {
      setError(errorText(caught, 'Could not log in'))
      setBusy(false)
    }
  }

  return (
    <AuthCard
      title="Log in to DocSage"
      footer={
        <Space direction="vertical" size={4}>
          <DialogLink onClick={() => show('forgot')}>Forgot your password?</DialogLink>
          {registrationOpen ? (
            <span>
              New here?{' '}
              <DialogLink onClick={() => show('register')}>Create an account</DialogLink>
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
