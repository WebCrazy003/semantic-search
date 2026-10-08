// frontend/src/components/account/RegisterForm.tsx
import { Alert, Button, Form, Input } from 'antd'
import { useState } from 'react'
import { useAuth } from '../../app/AuthContext'
import { useDialogs } from '../../app/DialogsContext'
import {
  AuthCard,
  DialogLink,
  FormError,
  PASSWORD_HINT,
  PASSWORD_RULES,
  USERNAME_HINT,
  USERNAME_RULES,
  errorText,
  matches,
} from './AuthCard'

interface Values {
  username: string
  password: string
  confirm: string
}

export function RegisterForm() {
  const { register, registrationOpen } = useAuth()
  const { show } = useDialogs()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(values: Values) {
    setBusy(true)
    setError(null)
    try {
      await register(values.username.trim(), values.password)
    } catch (caught) {
      setError(errorText(caught, 'Could not create the account'))
      setBusy(false)
    }
  }

  const footer = (
    <span>
      Already have an account? <DialogLink onClick={() => show('login')}>Log in</DialogLink>
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
