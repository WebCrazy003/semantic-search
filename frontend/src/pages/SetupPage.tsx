// frontend/src/pages/SetupPage.tsx
import { Button, Form, Input } from 'antd'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
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

/** The first account, an administrator. Only accepted from the computer DocSage runs on. */
export function SetupPage() {
  const { setup } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(values: Values) {
    setBusy(true)
    setError(null)
    try {
      await setup(values.username.trim(), values.password)
      navigate('/', { replace: true })
    } catch (caught) {
      setError(errorText(caught, 'Could not finish setup'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthCard
      title="Set up DocSage"
      subtitle={
        <>
          Create the administrator account. Do this on the computer DocSage is installed on;
          it cannot be done from another computer on the network.
        </>
      }
    >
      <FormError message={error} />
      <Form<Values> layout="vertical" onFinish={(values) => void submit(values)} requiredMark={false}>
        <Form.Item label="Administrator username" name="username" rules={USERNAME_RULES} extra={USERNAME_HINT}>
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
          Create administrator
        </Button>
      </Form>
    </AuthCard>
  )
}
