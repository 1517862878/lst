import { API_BASE } from '@/data/api/client'

const ABSOLUTE_URL = /^(?:https?:|blob:|data:)/i

export function accountImageUrl(key: string | null | undefined): string | null {
  const value = key?.trim()
  if (!value) return null
  if (ABSOLUTE_URL.test(value)) return value
  const path = value.replace(/^\/+/, '')
  if (path.startsWith('images/')) return `${API_BASE}/${path}`
  return `${API_BASE}/images/${path.split('/').map(encodeURIComponent).join('/')}`
}

export function errorMessage(error: unknown, fallback = '操作失败，请稍后重试。'): string {
  return error instanceof Error && error.message ? error.message : fallback
}

export function isSafeProfileLink(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}
