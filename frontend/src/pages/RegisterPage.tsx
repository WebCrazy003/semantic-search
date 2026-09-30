// frontend/src/pages/RegisterPage.tsx
import { Alert, Button, Form, Input } from 'antd'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../app/AuthContext'
import { FormError } from '../app/guards'
import {
  AuthCard,
  PASSWORD_HINT,
  PASSWORD_RULES,
  USERNAME_HINT,
  USERNAME_RULES,
  errorText,
  matches,
} from '../components/AuthCard'

interface Values {
  username: string
  password: string
  confirm: string
}

export function RegisterPage() {
  const { register, registrationOpen } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(values: Values) {
    setBusy(true)
    setError(null)
    try {
      await register(values.username.trim(), values.password)
      navigate('/', { replace: true })
    } catch (caught) {
      setError(errorText(caught, 'Could not create the account'))
    } finally {
      setBusy(false)
    }
  }

  const footer = (
    <span>
      Already have an account? <Link to="/login">Log in</Link>
    </span>
  )

  if (!registrationOpen) {
    return (
      <AuthCard title="Create an account" footer={footer}>
        <Alert
          type="info"
          showIcon
          message="Registration is closed. Ask an administrator for an account."
        />
      </AuthCard>
    )
  }

  return (
    <AuthCard
      title="Create an account"
      subtitle="Your documents are private to you. An administrator can also see them."
      footer={footer}
    >
      <FormError message={error} />
      <Form<Values> layout="vertical" onFinish={(values) => void submit(values)} requiredMark={false}>
        <Form.Item label="Username" name="username" rules={USERNAME_RULES} extra={USERNAME_HINT}>
          <Input autoComplete="username" autoFocus />
        </Form.Item>
        <Form.Item label="Password" name="password" rules={PASSWORD_RULES} extra={PASSWORD_HINT}>
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Form.Item
          label="Password again"
          name="confirm"
          dependencies={['password']}
          rules={[{ required: true, message: 'Type the password again' }, matches('password')]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Button type="primary" htmlType="submit" block loading={busy}>
          Create account
        </Button>
      </Form>
    </AuthCard>
  )
}
