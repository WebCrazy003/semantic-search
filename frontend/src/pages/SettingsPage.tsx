// frontend/src/pages/SettingsPage.tsx
import { ExperimentOutlined, ReloadOutlined, TeamOutlined } from '@ant-design/icons'
import { Button, Card, Form, Popconfirm, Segmented, Select, Space, Switch, Tabs, Typography } from 'antd'
import type { ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AppearanceSettings } from '../components/AppearanceSettings'
import { DeviceStatus } from '../components/DeviceStatus'
import { LANGUAGES, TOP_K_CHOICES, type PreviewLines } from '../settings/settings'
import { useSettings } from '../settings/SettingsContext'

const TABS = ['appearance', 'search', 'developer', 'administration', 'system'] as const
type TabKey = (typeof TABS)[number]

const TAB_LABEL: Record<TabKey, string> = {
  appearance: 'Appearance',
  search: 'Search',
  developer: 'Developer',
  administration: 'Administration',
  system: 'System',
}

const FORM_LAYOUT = {
  layout: 'horizontal' as const,
  labelCol: { span: 8 },
  wrapperCol: { span: 16 },
  colon: false,
}

export function SettingsPage() {
  const navigate = useNavigate()
  const { settings, update, reset } = useSettings()
  // The open tab is in the URL, so a link can land on it and Back returns to it.
  const [params, setParams] = useSearchParams()
  const requested = params.get('tab')
  const tab: TabKey = TABS.includes(requested as TabKey) ? (requested as TabKey) : 'appearance'

  const appearance = (
    <Card className="settings-card">
      <AppearanceSettings />
    </Card>
  )

  const search = (
    <Card className="settings-card">
      <Form {...FORM_LAYOUT}>
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
          help="Three lines is what keeps three whole results on screen without scrolling."
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
          label="Highlight query terms"
          help="Marks words from your query that appear in a passage, coloured by how close the match is. A semantic match often shares none."
        >
          <Switch
            checked={settings.highlightTerms}
            onChange={(value) => update('highlightTerms', value)}
            aria-label="Highlight query terms"
          />
        </Form.Item>
      </Form>
    </Card>
  )

  const developer = (
    <Card className="settings-card">
      <Form {...FORM_LAYOUT}>
        <Form.Item
          label="Developer mode"
          help="Shows each result's passage number, language, owner and file path."
        >
          <Switch
            checked={settings.developerMode}
            onChange={(value) => update('developerMode', value)}
            aria-label="Developer mode"
          />
        </Form.Item>

        <Form.Item
          label="Inspect passages link"
          help="Adds “Inspect passages” to a result, opening it on the admin page."
        >
          <Switch
            checked={settings.showAdminLinks}
            onChange={(value) => update('showAdminLinks', value)}
            aria-label="Show admin links"
          />
        </Form.Item>
      </Form>
    </Card>
  )

  const administration = (
    <Card className="settings-card">
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
      <Button icon={<ExperimentOutlined aria-hidden="true" />} onClick={() => navigate('/admin')}>
        Open the admin page
      </Button>
    </Card>
  )

  const system = (
    <Card className="settings-card">
      <Typography.Paragraph type="secondary">
        These settings are stored in this browser only. They are never sent to the search
        service, and no document or query leaves this machine.
      </Typography.Paragraph>
      <DeviceStatus />
    </Card>
  )

  const panels: Record<TabKey, ReactNode> = {
    appearance,
    search,
    developer,
    administration,
    system,
  }

  return (
    <div className="page settings-page">
      <div className="page-head">
        <Typography.Title level={3}>Settings</Typography.Title>
        <Popconfirm title="Reset every setting to its default?" okText="Reset" onConfirm={reset}>
          <Button icon={<ReloadOutlined aria-hidden="true" />}>Reset to defaults</Button>
        </Popconfirm>
      </div>

      <Tabs
        activeKey={tab}
        onChange={(key) => setParams({ tab: key }, { replace: true })}
        items={TABS.map((key) => ({ key, label: TAB_LABEL[key], children: panels[key] }))}
      />
    </div>
  )
}
