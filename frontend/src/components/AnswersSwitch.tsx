// frontend/src/components/AnswersSwitch.tsx
// Whether searches also write an answer. On the Settings page's Search tab for admins,
// and in the account menu's dialog for everyone, since regular users have no Settings
// page. Rendered inside the caller's Form, so it lines up with the fields around it.

import { Form, Switch } from 'antd'
import { useSettings } from '../settings/SettingsContext'

export function AnswersSwitch() {
  const { settings, update } = useSettings()
  return (
    <Form.Item
      label="Answer questions with AI"
      help="Writes a short answer from your documents above the results. Runs on this computer."
    >
      <Switch
        checked={settings.answersEnabled}
        onChange={(value) => update('answersEnabled', value)}
        aria-label="Answer questions with AI"
      />
    </Form.Item>
  )
}
