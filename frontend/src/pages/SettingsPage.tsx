// frontend/src/pages/SettingsPage.tsx
import { ExperimentOutlined, ReloadOutlined, TeamOutlined } from '@ant-design/icons'
import { Button, Card, Form, Popconfirm, Segmented, Select, Space, Switch, Typography } from 'antd'
import { useNavigate } from 'react-router-dom'
import { AppearanceSettings } from '../components/AppearanceSettings'
import { DeviceStatus } from '../components/DeviceStatus'
import {
  LANGUAGES,
  TOP_K_CHOICES,
  type DetailView,
  type PreviewLines,
} from '../settings/settings'
import { useSettings } from '../settings/SettingsContext'

export function SettingsPage() {
  const navigate = useNavigate()
  const { settings, update, reset } = useSettings()

  return (
    <div className="page settings-page">
      <div className="page-head">
        <Typography.Title level={3}>Settings</Typography.Title>
        <Popconfirm
          title="Reset every setting to its default?"
          okText="Reset"
          onConfirm={reset}
        >
          <Button icon={<ReloadOutlined aria-hidden="true" />}>Reset to defaults</Button>
        </Popconfirm>
      </div>

      <Card title="Appearance" className="settings-card">
        <AppearanceSettings />
      </Card>

      <Card title="Search" className="settings-card">
        <Form layout="horizontal" labelCol={{ span: 8 }} wrapperCol={{ span: 16 }} colon={false}>
          <Form.Item label="Results per search">
            <Select
              value={settings.resultsPerSearch}
              onChange={(value) => update('resultsPerSearch', value)}
              aria-label="Results per search"
              options={TOP_K_CHOICES.map((choice) => ({ value: choice, label: `${choice}` }))}
            />
          </Form.Item>

          <Form.Item label="Default language filter">
            <Select
              value={settings.defaultLanguage}
              onChange={(value) => update('defaultLanguage', value)}
              aria-label="Default language filter"
              options={LANGUAGES}
            />
          </Form.Item>

          <Form.Item
            label="Passage preview lines"
            help="Three lines is what keeps three whole result cards on screen without scrolling."
          >
            <Segmented<PreviewLines>
              value={settings.previewLines}
              onChange={(value) => update('previewLines', value)}
              options={[
                { label: '3', value: 3 },
                { label: '4', value: 4 },
                { label: '6', value: 6 },
              ]}
            />
          </Form.Item>

          <Form.Item
            label="Result detail"
            help="Auto shows the detail beside the results on a wide window, and in a drawer otherwise."
          >
            <Segmented<DetailView>
              value={settings.detailView}
              onChange={(value) => update('detailView', value)}
              options={[
                { label: 'Auto', value: 'auto' },
                { label: 'Always a drawer', value: 'drawer' },
              ]}
            />
          </Form.Item>

          <Form.Item
            label="Highlight query terms"
            help="Marks words from your query that appear in a passage. A semantic match often shares none."
          >
            <Switch
              checked={settings.highlightTerms}
              onChange={(value) => update('highlightTerms', value)}
              aria-label="Highlight query terms"
            />
          </Form.Item>
        </Form>
      </Card>

      <Card title="Administration" className="settings-card">
        <Space wrap className="settings-admin-links">
          <Button
            type="primary"
            icon={<TeamOutlined aria-hidden="true" />}
            onClick={() => navigate('/admin/users')}
          >
            Manage users
          </Button>
        </Space>
        <Typography.Paragraph type="secondary">
          Inspect the text extracted from a document, how the index is structured, and how a
          document was split into passages. Useful when a search result looks wrong and you want
          to know whether the cause is extraction, chunking, or the search itself.
        </Typography.Paragraph>
        <Space wrap>
          <Button
            icon={<ExperimentOutlined aria-hidden="true" />}
            onClick={() => navigate('/admin')}
          >
            Open the admin page
          </Button>
          <Space>
            <Switch
              checked={settings.showAdminLinks}
              onChange={(value) => update('showAdminLinks', value)}
              aria-label="Show admin links"
            />
            <Typography.Text type="secondary">
              Show “Inspect passages” on search results
            </Typography.Text>
          </Space>
        </Space>
      </Card>

      <Card title="Backend" className="settings-card">
        <Typography.Paragraph type="secondary">
          These settings are stored in this browser only. They are never sent to the search
          service, and no document or query leaves this machine.
        </Typography.Paragraph>
        <DeviceStatus />
      </Card>
    </div>
  )
}
