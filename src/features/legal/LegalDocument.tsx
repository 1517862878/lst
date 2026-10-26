/**
 * 法律页通用组件（FRONTEND-WORK §3.3 LegalDocument）。
 * 标题/版本/生效日期/正文（静态 HTML 由页面传入，纯文本安全）。
 */
import type { ReactNode } from 'react'
import { Container } from '@/components/layout/Container'
import { PageHeader } from '@/components/layout/PageHeader'

export interface LegalDocumentProps {
  title: string
  version: string
  effectiveAt: string
  children: ReactNode
}

export function LegalDocument({ title, version, effectiveAt, children }: LegalDocumentProps) {
  return (
    <Container size="md">
      <PageHeader title={title} />
      <p className="g-legal-meta">
        版本 {version} · 生效日期 {effectiveAt}
      </p>
      <div className="g-legal-body">{children}</div>
    </Container>
  )
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="g-legal-section">
      <h2 className="g-legal-section-title">{title}</h2>
      {children}
    </section>
  )
}
