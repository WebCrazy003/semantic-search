// frontend/src/pages/SettingsPage.tsx
import { ExperimentOutlined, ReloadOutlined } from '@ant-design/icons'
import { Button, Card, Form, Popconfirm, Radio, Segmented, Select, Space, Switch, Typography } from 'antd'
import { useNavigate } from 'react-router-dom'
import { DeviceStatus } from '../components/DeviceStatus'
import {
  ACCENTS,
  LANGUAGES,
  TOP_K_CHOICES,
  type Density,
  type DetailView,
  type PreviewLines,
  type ThemeChoice,
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
        <Form layout="horizontal" labelCol={{ span: 8 }} wrapperCol={{ span: 16 }} colon={false}>
          <Form.Item label="Theme">
            <Segmented<ThemeChoice>
              value={settings.theme}
              onChange={(value) => update('theme', value)}
              options={[
                { label: 'System', value: 'system' },
                { label: 'Light', value: 'light' },
                { label: 'Dark', value: 'dark' },
              ]}
            />
          </Form.Item>

          <Form.Item label="Accent colour">
            <Radio.Group
              value={settings.accent}
              onChange={(event) => update('accent', event.target.value)}
              aria-label="Accent colour"
            >
              {ACCENTS.map((accent) => (
                <Radio.Button key={accent.value} value={accent.value} aria-label={accent.label}>
                  <span
                    className="accent-swatch"
                    style={{ background: accent.value }}
                    aria-hidden="true"
                  />
                  {accent.label}
                </Radio.Button>
              ))}
            </Radio.Group>
          </Form.Item>

          <Form.Item label="Density" help="Compact fits more on screen at a smaller text size.">
            <Segmented<Density>
              value={settings.density}
              onChange={(value) => update('density', value)}
              options={[
                { label: 'Comfortable', value: 'comfortable' },
                { label: 'Compact', value: 'compact' },
              ]}
            />
          </Form.Item>

          <Form.Item
            label="Animations"
            help="Off also stops the aggregation cards animating when they minimise."
          >
            <Switch
              checked={settings.animations}
              onChange={(value) => update('animations', value)}
              aria-label="Animations"
            />
          </Form.Item>
        </Form>
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
        <Typography.Paragraph type="secondary">
          Inspect the text extracted from a document, how the index is structured, and how a
          document was split into passages. Useful when a search result looks wrong and you want
          to know whether the cause is extraction, chunking, or the search itself.
        </Typography.Paragraph>
        <Space wrap>
          <Button
            type="primary"
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
