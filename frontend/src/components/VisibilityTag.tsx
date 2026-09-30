// frontend/src/components/VisibilityTag.tsx
// Public or private. Admins get a switch; everyone else a tag.

import { GlobalOutlined, LockOutlined } from '@ant-design/icons'
import { Switch, Tag, Tooltip } from 'antd'
import type { Visibility } from '../services/api'

export function VisibilityTag({ visibility }: { visibility?: Visibility }) {
  return visibility === 'public' ? (
    <Tooltip title="Every user can find this document">
      <Tag icon={<GlobalOutlined />} color="blue">
        Public
      </Tag>
    </Tooltip>
  ) : (
    <Tag icon={<LockOutlined />}>Private</Tag>
  )
}

export function VisibilitySwitch({
  filename,
  visibility,
  disabled,
  onChange,
}: {
  filename: string
  visibility?: Visibility
  disabled?: boolean
  onChange: (visibility: Visibility) => void
}) {
  const isPublic = visibility === 'public'
  return (
    <Tooltip title={isPublic ? 'Every user can find it. Turn off to make it private.' : 'Only its owner and admins can find it. Turn on to make it public.'}>
      <Switch
        size="small"
        checked={isPublic}
        disabled={disabled}
        checkedChildren="Public"
        unCheckedChildren="Private"
        aria-label={`${filename} is ${isPublic ? 'public' : 'private'}`}
        onChange={(checked) => onChange(checked ? 'public' : 'private')}
      />
    </Tooltip>
  )
}
