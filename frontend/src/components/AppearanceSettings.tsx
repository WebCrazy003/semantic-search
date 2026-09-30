// frontend/src/components/AppearanceSettings.tsx
// Theme, accent, density and motion. Everyone can change these: they are this browser's
// preferences, kept in localStorage and never sent anywhere. Shown on the Settings page
// for admins and in the account menu's Appearance dialog for everyone.

import { Form, Radio, Segmented, Switch } from 'antd'
import { ACCENTS, type Density, type ThemeChoice } from '../settings/settings'
import { useSettings } from '../settings/SettingsContext'

export function AppearanceSettings() {
  const { settings, update } = useSettings()

  return (
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
  )
}
