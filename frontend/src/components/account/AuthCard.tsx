// frontend/src/components/AuthCard.tsx
// The frame every account page shares: the mark, a title, one card.

import { Card, Typography } from 'antd'
import type { ReactNode } from 'react'
import { DocSageMark } from './DocSageMark'

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
    <div className="auth-page">
      <Card className="auth-card">
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
      </Card>
    </div>
  )
}

export function errorText(caught: unknown, fallback: string): string {
  return caught instanceof Error ? caught.message : fallback
}
