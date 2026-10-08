// frontend/src/components/settings/SettingsPanel.tsx
// The settings modal's body. What it shows depends on who is looking: anyone gets
// Appearance and Search, a logged-in user also System, an admin also Developer and
// Administration. Everything but the admin links is stored in this browser only.
import { ExperimentOutlined, ReloadOutlined, TeamOutlined } from '@ant-design/icons'
import { App as AntApp, Button, Form, Popconfirm, Segmented, Select, Space, Switch, Tabs, Typography } from 'antd'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../app/AuthContext'
import { clearIndex } from '../../services/api'
import { useDialogs } from '../../app/DialogsContext'
import { LANGUAGES, TOP_K_CHOICES, type PreviewLines } from '../../settings/settings'
import { useSettings } from '../../settings/SettingsContext'
import { AnswersSwitch } from '../AnswersSwitch'
import { AppearanceSettings } from '../AppearanceSettings'
import { DeviceStatus } from '../DeviceStatus'

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

// The last tab opened, so the modal reopens where it was left. Per browser, like the
// settings themselves; a private window simply starts on Appearance.
const TAB_STORAGE_KEY = 'docsage.settingsTab'

function readTab(): string | null {
  try {
    return window.localStorage.getItem(TAB_STORAGE_KEY)
  } catch {
    return null
  }
}

function writeTab(tab: TabKey): void {
  try {
    window.localStorage.setItem(TAB_STORAGE_KEY, tab)
  } catch {
    // Not fatal: the modal opens on the first tab next time.
  }
}

/** Which tabs someone sees, in order. */
export function tabsFor(signedIn: boolean, isAdmin: boolean): TabKey[] {
  return TABS.filter((key) => {
    if (key === 'developer' || key === 'administration') return isAdmin
    if (key === 'system') return signedIn
    return true
  })
}

export function SettingsPanel() {
  const navigate = useNavigate()
  const { user, isAdmin } = useAuth()
  const { close } = useDialogs()
  const { settings, update, reset } = useSettings()
  const visible = tabsFor(!!user, isAdmin)
  const [chosen, setChosen] = useState<string | null>(() => readTab())
  const tab: TabKey = visible.includes(chosen as TabKey) ? (chosen as TabKey) : visible[0]

  function go(path: string) {
    close()
    navigate(path)
  }

  const appearance = (
    <div className="settings-section">
      <AppearanceSettings />
    </div>
  )

  const search = (
    <div className="settings-section">
      <Form {...FORM_LAYOUT}>
        <AnswersSwitch />

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
    </div>
  )

  const developer = (
    <div className="settings-section">
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
    </div>
  )

  const administration = (
    <div className="settings-section">
      <Space wrap className="settings-admin-links">
        <Button
          type="primary"
          icon={<TeamOutlined aria-hidden="true" />}
          onClick={() => go('/admin/users')}
        >
          Manage users
        </Button>
      </Space>
      <Typography.Paragraph type="secondary">
        Inspect the text extracted from a document, how the index is structured, and how a
        document was split into passages. Useful when a search result looks wrong and you want
        to know whether the cause is extraction, chunking, or the search itself.
      </Typography.Paragraph>
      <Button icon={<ExperimentOutlined aria-hidden="true" />} onClick={() => go('/admin')}>
        Open the admin page
      </Button>
      <ClearIndex />
    </div>
  )

  const system = (
    <div className="settings-section">
      <Typography.Paragraph type="secondary">
        These settings are stored in this browser only. They are never sent to the search
        service, and no document or query leaves this machine.
      </Typography.Paragraph>
      <DeviceStatus />
    </div>
  )

  const panels: Record<TabKey, ReactNode> = {
    appearance,
    search,
    developer,
    administration,
    system,
  }

  return (
    <div className="settings-panel">
      <Tabs
        activeKey={tab}
        onChange={(key) => {
          setChosen(key)
          writeTab(key as TabKey)
        }}
        items={visible.map((key) => ({ key, label: TAB_LABEL[key], children: panels[key] }))}
      />
      <div className="settings-reset">
        <Popconfirm title="Reset every setting to its default?" okText="Reset" onConfirm={reset}>
          <Button icon={<ReloadOutlined aria-hidden="true" />}>Reset to defaults</Button>
        </Popconfirm>
      </div>
    </div>
  )
}

/**
 * Drop every passage and document record, for every user. Here rather than on the
 * document manager, which is everyone's page (spec 2026-10-08 §3.1).
 */
function ClearIndex() {
  const { message } = AntApp.useApp()
  const [busy, setBusy] = useState(false)

  async function clear() {
    setBusy(true)
    try {
      const result = await clearIndex()
      message.success(
        `Cleared ${result.documents_removed} documents and ${result.passages_removed} passages. The files were kept.`,
      )
    } catch (caught) {
      message.error(caught instanceof Error ? caught.message : 'Could not clear the index')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="settings-danger">
      <Typography.Title level={5}>Clear the index</Typography.Title>
      <Typography.Paragraph type="secondary">
        Removes every passage and every document record, for every user. The files, the
        folders and which documents are public are kept: index them again from the
        document manager to bring everything back.
      </Typography.Paragraph>
      <Popconfirm
        title="Clear all indexing?"
        description="Nothing will be searchable until it is indexed again."
        okText="Yes, clear it"
        okButtonProps={{ danger: true }}
        onConfirm={() => void clear()}
      >
        <Button danger loading={busy}>
          Clear all indexing
        </Button>
      </Popconfirm>
    </div>
  )
}
