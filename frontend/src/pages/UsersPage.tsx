// frontend/src/pages/UsersPage.tsx
// Administration of accounts: password reset requests waiting for a decision, every
// user with what they own, and whether anyone may sign up.

import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import {
  Alert,
  App as AntApp,
  Badge,
  Button,
  Card,
  Checkbox,
  Dropdown,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Radio,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  type MenuProps,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../app/AuthContext'
import { PASSWORD_HINT, PASSWORD_RULES, USERNAME_HINT, USERNAME_RULES } from '../components/AuthCard'
import * as api from '../services/api'
import type { ResetRequestView, Role, UserAdminView } from '../services/api'

function when(iso: string | null): string {
  if (!iso) return 'never'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString()
}

function failure(caught: unknown, fallback: string): string {
  return caught instanceof Error ? caught.message : fallback
}

export function UsersPage() {
  const { user: me, refresh: refreshMe } = useAuth()
  const { message } = AntApp.useApp()
  const [users, setUsers] = useState<UserAdminView[]>([])
  const [requests, setRequests] = useState<ResetRequestView[]>([])
  const [registrationOpen, setRegistrationOpen] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [resetting, setResetting] = useState<UserAdminView | null>(null)
  const [shownPassword, setShownPassword] = useState<{ username: string; password: string } | null>(
    null,
  )

  const load = useCallback(async () => {
    try {
      const [nextUsers, nextRequests, settings] = await Promise.all([
        api.listUsers(),
        api.listResetRequests(),
        api.getAuthSettings(),
      ])
      setUsers(nextUsers)
      setRequests(nextRequests)
      setRegistrationOpen(settings.registration_open)
      setError(null)
    } catch (caught) {
      setError(failure(caught, 'Could not load the users'))
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  /** Run an admin action, report how it went, and reload. */
  const act = useCallback(
    async (action: () => Promise<unknown>, done: string) => {
      try {
        await action()
        message.success(done)
      } catch (caught) {
        message.error(failure(caught, 'That did not work'))
      }
      await load()
      // The header badge counts pending requests; bring it up to date too.
      void refreshMe()
    },
    [load, message, refreshMe],
  )

  const requestColumns: ColumnsType<ResetRequestView> = [
    {
      title: 'User',
      dataIndex: 'username',
      render: (name: string, row) => (
        <Space size={4}>
          <Typography.Text strong>{name}</Typography.Text>
          {row.user_disabled ? <Tag color="error">Disabled</Tag> : null}
        </Space>
      ),
    },
    { title: 'Requested', dataIndex: 'created_at', render: when },
    { title: 'From', dataIndex: 'client_ip', render: (ip: string | null) => ip ?? 'unknown' },
    { title: 'Expires', dataIndex: 'expires_at', render: when },
    {
      title: 'Decision',
      key: 'decision',
      render: (_: unknown, row) => (
        <Space>
          <Popconfirm
            title={`Approve the password reset for ${row.username}?`}
            description="Whoever made this request will be able to set a new password for this account. Approve only a request you were expecting."
            okText="Approve"
            onConfirm={() =>
              void act(() => api.approveResetRequest(row.request_id), `Approved for ${row.username}`)
            }
            disabled={row.user_id === me?.user_id}
          >
            <Button
              type="primary"
              size="small"
              disabled={row.user_id === me?.user_id}
              title={
                row.user_id === me?.user_id
                  ? 'Another administrator has to approve a reset of your own account'
                  : undefined
              }
            >
              Approve
            </Button>
          </Popconfirm>
          <Button
            size="small"
            danger
            onClick={() =>
              void act(() => api.denyResetRequest(row.request_id), `Denied for ${row.username}`)
            }
          >
            Deny
          </Button>
        </Space>
      ),
    },
  ]

  const userColumns: ColumnsType<UserAdminView> = [
    {
      title: 'User',
      dataIndex: 'username',
      sorter: (left, right) => left.username.localeCompare(right.username),
      defaultSortOrder: 'ascend',
      render: (name: string, row) => (
        <Space size={4} wrap>
          <Typography.Text strong>{name}</Typography.Text>
          {row.user_id === me?.user_id ? <Tag>You</Tag> : null}
          <Tag color={row.role === 'admin' ? 'gold' : 'default'}>
            {row.role === 'admin' ? 'Admin' : 'User'}
          </Tag>
          {row.disabled ? <Tag color="error">Disabled</Tag> : null}
          {row.must_change_password ? <Tag color="warning">Must change password</Tag> : null}
        </Space>
      ),
    },
    { title: 'Documents', dataIndex: 'documents', align: 'right' },
    { title: 'Public', dataIndex: 'public_documents', align: 'right' },
    { title: 'Passages', dataIndex: 'passages', align: 'right' },
    { title: 'Last login', dataIndex: 'last_login_at', render: when },
    { title: 'Created', dataIndex: 'created_at', render: when },
    {
      title: 'Actions',
      key: 'actions',
      render: (_: unknown, row) =>
        row.user_id === me?.user_id ? (
          <Typography.Text type="secondary">Use the account menu</Typography.Text>
        ) : (
          <UserActions
            user={row}
            onReset={() => setResetting(row)}
            onAct={(action, done) => void act(action, done)}
          />
        ),
    },
  ]

  return (
    <div className="page users-page">
      <div className="page-head">
        <Typography.Title level={3}>Users</Typography.Title>
        <Space wrap>
          <Button icon={<ReloadOutlined aria-hidden="true" />} onClick={() => void load()}>
            Refresh
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined aria-hidden="true" />}
            onClick={() => setCreating(true)}
          >
            Create user
          </Button>
        </Space>
      </div>

      {error ? <Alert type="error" showIcon message={error} className="page-alert" /> : null}

      {requests.length > 0 ? (
        <Card
          className="settings-card"
          title={
            <Space>
              Password reset requests <Badge count={requests.length} />
            </Space>
          }
        >
          <Typography.Paragraph type="secondary">
            Approving lets whoever made the request choose a new password for that account. Check
            with the person first: approve a request you were expecting, and deny one you were
            not.
          </Typography.Paragraph>
          <Table
            size="small"
            rowKey="request_id"
            columns={requestColumns}
            dataSource={requests}
            pagination={false}
            scroll={{ x: 'max-content' }}
          />
        </Card>
      ) : null}

      <Card title="Accounts" className="settings-card">
        <Table
          size="small"
          rowKey="user_id"
          columns={userColumns}
          dataSource={users}
          loading={!loaded}
          locale={{ emptyText: <Empty description="No users yet" /> }}
          pagination={{ pageSize: 25, hideOnSinglePage: true }}
          scroll={{ x: 'max-content' }}
        />
      </Card>

      <Card title="Sign-up" className="settings-card">
        <Space>
          <Switch
            checked={registrationOpen}
            aria-label="Anyone can create an account"
            onChange={(open) =>
              void act(
                () => api.setRegistrationOpen(open),
                open ? 'Sign-up is open' : 'Sign-up is closed',
              )
            }
          />
          <Typography.Text>
            Anyone who can reach DocSage can create an account
          </Typography.Text>
        </Space>
        <Typography.Paragraph type="secondary" className="settings-note">
          When this is off, only an administrator can create accounts, with Create user.
        </Typography.Paragraph>
      </Card>

      <CreateUserModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(username, password) => {
          setCreating(false)
          setShownPassword({ username, password })
          void load()
        }}
      />

      <ResetPasswordModal
        user={resetting}
        onClose={() => setResetting(null)}
        onDone={(username, password) => {
          setResetting(null)
          if (password) setShownPassword({ username, password })
          else message.success(`Password changed for ${username}`)
          void load()
        }}
      />

      <Modal
        title="Pass this password on"
        open={!!shownPassword}
        onOk={() => setShownPassword(null)}
        onCancel={() => setShownPassword(null)}
        cancelButtonProps={{ style: { display: 'none' } }}
        okText="Done"
      >
        {shownPassword ? (
          <>
            <Typography.Paragraph>
              The password for <strong>{shownPassword.username}</strong> is shown once. Give it to
              them in person.
            </Typography.Paragraph>
            <Typography.Paragraph
              copyable={{ text: shownPassword.password }}
              className="temporary-password"
              code
            >
              {shownPassword.password}
            </Typography.Paragraph>
          </>
        ) : null}
      </Modal>
    </div>
  )
}

function UserActions({
  user,
  onReset,
  onAct,
}: {
  user: UserAdminView
  onReset: () => void
  onAct: (action: () => Promise<unknown>, done: string) => void
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const otherRole: Role = user.role === 'admin' ? 'user' : 'admin'

  const items: MenuProps['items'] = [
    { key: 'role', label: otherRole === 'admin' ? 'Make admin' : 'Make regular user' },
    { key: 'disable', label: user.disabled ? 'Enable' : 'Disable' },
    { type: 'divider' },
    { key: 'delete', label: 'Delete…', danger: true },
  ]

  const onClick: MenuProps['onClick'] = ({ key }) => {
    if (key === 'role') {
      onAct(() => api.updateUser(user.user_id, { role: otherRole }), `${user.username} is now ${otherRole === 'admin' ? 'an admin' : 'a regular user'}`)
    }
    if (key === 'disable') {
      onAct(
        () => api.updateUser(user.user_id, { disabled: !user.disabled }),
        `${user.username} is ${user.disabled ? 'enabled' : 'disabled'}`,
      )
    }
    if (key === 'delete') setConfirmDelete(true)
  }

  return (
    <Space>
      <Button size="small" onClick={onReset}>
        Reset password
      </Button>
      <Dropdown menu={{ items, onClick }} trigger={['click']}>
        <Button size="small" aria-label={`More actions for ${user.username}`}>
          More
        </Button>
      </Dropdown>
      <Modal
        title={`Delete ${user.username}?`}
        open={confirmDelete}
        okText="Delete account and documents"
        okButtonProps={{ danger: true }}
        onCancel={() => setConfirmDelete(false)}
        onOk={() => {
          setConfirmDelete(false)
          onAct(() => api.deleteUser(user.user_id), `Deleted ${user.username}`)
        }}
      >
        <Typography.Paragraph>
          This deletes the account and everything it owns: {user.documents} document
          {user.documents === 1 ? '' : 's'}, {user.passages} passages, and the uploaded files. It
          cannot be undone.
        </Typography.Paragraph>
      </Modal>
    </Space>
  )
}

function CreateUserModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (username: string, password: string) => void
}) {
  const [form] = Form.useForm<{ username: string; role: Role }>()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    const values = await form.validateFields()
    setBusy(true)
    setError(null)
    try {
      const created = await api.createUser(values.username.trim(), values.role)
      form.resetFields()
      onCreated(created.user.username, created.temporary_password)
    } catch (caught) {
      setError(failure(caught, 'Could not create the user'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Create user"
      open={open}
      onCancel={onClose}
      onOk={() => void submit()}
      okText="Create"
      confirmLoading={busy}
      destroyOnHidden
    >
      {error ? <Alert type="error" showIcon message={error} className="auth-alert" /> : null}
      <Form form={form} layout="vertical" initialValues={{ role: 'user' }} requiredMark={false}>
        <Form.Item label="Username" name="username" rules={USERNAME_RULES} extra={USERNAME_HINT}>
          <Input autoFocus />
        </Form.Item>
        <Form.Item label="Role" name="role">
          <Radio.Group
            options={[
              { label: 'User', value: 'user' },
              { label: 'Admin', value: 'admin' },
            ]}
          />
        </Form.Item>
      </Form>
      <Typography.Paragraph type="secondary">
        A password is generated and shown once. They choose their own at the first login.
      </Typography.Paragraph>
    </Modal>
  )
}

function ResetPasswordModal({
  user,
  onClose,
  onDone,
}: {
  user: UserAdminView | null
  onClose: () => void
  onDone: (username: string, generated: string | null) => void
}) {
  const [form] = Form.useForm<{ mode: 'generate' | 'type'; password?: string; mustChange: boolean }>()
  const mode = Form.useWatch('mode', form)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!user) return
    const values = await form.validateFields()
    setBusy(true)
    setError(null)
    try {
      const result = await api.adminResetPassword(
        user.user_id,
        values.mode === 'type' ? (values.password ?? null) : null,
        values.mustChange,
      )
      form.resetFields()
      onDone(user.username, result.temporary_password)
    } catch (caught) {
      setError(failure(caught, 'Could not reset the password'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={user ? `Reset the password of ${user.username}` : 'Reset password'}
      open={!!user}
      onCancel={onClose}
      onOk={() => void submit()}
      okText="Reset password"
      confirmLoading={busy}
      destroyOnHidden
    >
      {error ? <Alert type="error" showIcon message={error} className="auth-alert" /> : null}
      <Form
        form={form}
        layout="vertical"
        initialValues={{ mode: 'generate', mustChange: true }}
        requiredMark={false}
      >
        <Form.Item name="mode">
          <Radio.Group>
            <Space direction="vertical">
              <Radio value="generate">Generate one and show it to me once</Radio>
              <Radio value="type">Type a new password</Radio>
            </Space>
          </Radio.Group>
        </Form.Item>
        {mode === 'type' ? (
          <Form.Item label="New password" name="password" rules={PASSWORD_RULES} extra={PASSWORD_HINT}>
            <Input.Password autoComplete="new-password" />
          </Form.Item>
        ) : null}
        <Form.Item name="mustChange" valuePropName="checked">
          <Checkbox>They must change it at their next login</Checkbox>
        </Form.Item>
      </Form>
      <Typography.Paragraph type="secondary">
        They are logged out everywhere, and any open reset request of theirs is cancelled.
      </Typography.Paragraph>
    </Modal>
  )
}
