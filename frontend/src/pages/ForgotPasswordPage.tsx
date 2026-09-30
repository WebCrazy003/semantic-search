// frontend/src/pages/ForgotPasswordPage.tsx
// Forgot password: ask with a username, wait for an administrator to approve, then set a
// new password in this same browser.
//
// The request token never appears on screen. It is kept in this browser's storage, so
// closing the tab and coming back resumes the request, and only this browser can finish
// it. Storage can be missing or refuse (a private window); the page then still works for
// as long as it stays open.

import { ClockCircleOutlined } from '@ant-design/icons'
import { Alert, Button, Form, Input, Result, Space, Spin, Typography } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../app/AuthContext'
import { FormError } from '../app/guards'
import { AuthCard, PASSWORD_HINT, PASSWORD_RULES, errorText, matches } from '../components/AuthCard'
import * as api from '../services/api'
import type { ResetState } from '../services/api'

export const RESET_STORAGE_KEY = 'docsage.resetRequest'
const POLL_MS = 15_000

interface Stored {
  username: string
  token: string
  expiresAt: string
}

function readStored(): Stored | null {
  try {
    const raw = window.localStorage.getItem(RESET_STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Stored) : null
  } catch {
    return null
  }
}

function writeStored(value: Stored | null): void {
  try {
    if (value) window.localStorage.setItem(RESET_STORAGE_KEY, JSON.stringify(value))
    else window.localStorage.removeItem(RESET_STORAGE_KEY)
  } catch {
    // Not fatal: the request still works while this page stays open.
  }
}

function lapsed(request: Stored): boolean {
  return new Date(request.expiresAt).getTime() <= Date.now()
}

export function ForgotPasswordPage() {
  const [request, setRequest] = useState<Stored | null>(() => readStored())
  const [state, setState] = useState<ResetState | null>(null)

  const forget = useCallback(() => {
    writeStored(null)
    setRequest(null)
    setState(null)
  }, [])

  useEffect(() => {
    if (!request) return
    let cancelled = false
    const check = async () => {
      if (lapsed(request)) {
        setState('expired')
        return
      }
      try {
        const { status } = await api.getResetStatus(request.token)
        if (!cancelled) setState(status)
      } catch {
        // Keep the last known state; the next poll tries again.
      }
    }
    void check()
    const timer = window.setInterval(() => void check(), POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [request])

  if (!request) {
    return (
      <RequestForm
        onRequested={(stored) => {
          writeStored(stored)
          setState('pending')
          setRequest(stored)
        }}
      />
    )
  }
  if (state === 'approved') return <NewPasswordForm request={request} onDone={forget} />
  if (state === null) {
    return (
      <AuthCard title="Reset your password">
        <div className="auth-loading">
          <Spin />
        </div>
      </AuthCard>
    )
  }
  if (state === 'pending') return <Waiting request={request} onCancel={forget} />
  return <Ended state={state} onRestart={forget} />
}

function RequestForm({ onRequested }: { onRequested: (stored: Stored) => void }) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit({ username }: { username: string }) {
    setBusy(true)
    setError(null)
    try {
      const created = await api.requestPasswordReset(username.trim())
      onRequested({
        username: username.trim(),
        token: created.request_token,
        expiresAt: created.expires_at,
      })
    } catch (caught) {
      setError(errorText(caught, 'Could not send the request'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthCard
      title="Reset your password"
      subtitle="Enter your username. An administrator will be asked to approve the reset."
      footer={<Link to="/login">Back to log in</Link>}
    >
      <FormError message={error} />
      <Form layout="vertical" onFinish={(values) => void submit(values)} requiredMark={false}>
        <Form.Item
          label="Username"
          name="username"
          rules={[{ required: true, message: 'Enter your username' }]}
        >
          <Input autoComplete="username" autoFocus />
        </Form.Item>
        <Button type="primary" htmlType="submit" block loading={busy}>
          Request a reset
        </Button>
      </Form>
    </AuthCard>
  )
}

function Waiting({ request, onCancel }: { request: Stored; onCancel: () => void }) {
  return (
    <AuthCard
      title="Waiting for an administrator"
      footer={<Link to="/login">Back to log in</Link>}
    >
      <Result
        icon={<ClockCircleOutlined />}
        title={`Your request for ${request.username} was sent`}
        subTitle={
          <Space direction="vertical" size={4}>
            <span>
              Once an administrator approves it, this page lets you set a new password. You can
              close it and come back later in this browser.
            </span>
            <span>
              The request expires on {new Date(request.expiresAt).toLocaleString()}. If nothing
              happens, check the username is spelled correctly.
            </span>
          </Space>
        }
        extra={<Button onClick={onCancel}>Cancel this request</Button>}
      />
    </AuthCard>
  )
}

function Ended({ state, onRestart }: { state: ResetState; onRestart: () => void }) {
  const message =
    state === 'denied'
      ? 'An administrator declined this request.'
      : state === 'completed'
        ? 'This request has already been used to set a new password.'
        : state === 'superseded'
          ? 'A newer request replaced this one.'
          : 'This request expired before it was approved.'
  return (
    <AuthCard title="Reset your password" footer={<Link to="/login">Back to log in</Link>}>
      <Result
        status="warning"
        title={message}
        extra={
          <Button type="primary" onClick={onRestart}>
            Make a new request
          </Button>
        }
      />
    </AuthCard>
  )
}

function NewPasswordForm({ request, onDone }: { request: Stored; onDone: () => void }) {
  const { adopt } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit({ password }: { password: string; confirm: string }) {
    setBusy(true)
    setError(null)
    try {
      const me = await api.completePasswordReset(request.token, password)
      onDone()
      adopt(me.user)
      navigate('/', { replace: true })
    } catch (caught) {
      setError(errorText(caught, 'Could not set the new password'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthCard title="Set a new password" subtitle={`for ${request.username}`}>
      <Alert
        type="success"
        showIcon
        message="An administrator approved your request."
        className="auth-alert"
      />
      <FormError message={error} />
      <Form layout="vertical" onFinish={(values) => void submit(values)} requiredMark={false}>
        <Form.Item label="New password" name="password" rules={PASSWORD_RULES} extra={PASSWORD_HINT}>
          <Input.Password autoComplete="new-password" autoFocus />
        </Form.Item>
        <Form.Item
          label="New password again"
          name="confirm"
          dependencies={['password']}
          rules={[{ required: true, message: 'Type the password again' }, matches('password')]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Button type="primary" htmlType="submit" block loading={busy}>
          Set password and log in
        </Button>
      </Form>
      <Typography.Paragraph type="secondary" className="auth-note">
        Every other place you were logged in will be logged out.
      </Typography.Paragraph>
    </AuthCard>
  )
}
