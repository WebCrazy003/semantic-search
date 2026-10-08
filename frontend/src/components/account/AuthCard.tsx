// frontend/src/components/account/AuthCard.tsx
// The frame every account dialog shares: the mark, a title, the form, a footer. The
// dialog supplies the card, so this is only what goes inside it.

import { Alert, Typography } from 'antd'
import type { ReactNode } from 'react'
import { DocSageMark } from '../DocSageMark'

export const USERNAME_HINT = '3–32 English letters, digits, dots, dashes or underscores'
export const PASSWORD_HINT = 'At least 8 characters'

export const USERNAME_RULES = [
  { required: true, message: 'Enter a username' },
  {
    pattern: /^[A-Za-z0-9][A-Za-z0-9._-]{2,31}$/,
    message: USERNAME_HINT,
  },
]

export const PASSWORD_RULES = [
  { required: true, message: 'Enter a password' },
  { min: 8, message: PASSWORD_HINT },
  { max: 128, message: 'At most 128 characters' },
]

/** antd rule: the field must equal another field, for "type it again". */
export function matches(field: string) {
  return ({ getFieldValue }: { getFieldValue: (name: string) => unknown }) => ({
    validator(_: unknown, value: unknown) {
      return !value || getFieldValue(field) === value
        ? Promise.resolve()
        : Promise.reject(new Error('The two passwords do not match'))
    },
  })
}

export function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string
  subtitle?: ReactNode
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <div className="auth-card">
      <div className="auth-card-head">
        <DocSageMark size={40} />
        <Typography.Title level={3}>{title}</Typography.Title>
        {subtitle ? (
          <Typography.Paragraph type="secondary" className="auth-subtitle">
            {subtitle}
          </Typography.Paragraph>
        ) : null}
      </div>
      {children}
      {footer ? <div className="auth-footer">{footer}</div> : null}
    </div>
  )
}

/** A form error in the style every account dialog uses. */
export function FormError({ message }: { message: string | null }) {
  return message ? <Alert type="error" showIcon message={message} className="auth-alert" /> : null
}

/** A link that switches the account dialog to another step. */
export function DialogLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="dialog-link" onClick={onClick}>
      {children}
    </button>
  )
}

export { errorText } from '../../services/api'
