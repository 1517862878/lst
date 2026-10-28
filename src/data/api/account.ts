import type { PhotoLicense } from '@/domain/types'
import { request } from './client'

export interface AccountLink {
  label: string
  url: string
}

export interface NotificationPreferences {
  accountSecurity: boolean
  productUpdates: boolean
  [key: string]: boolean
}

export interface AccountSettings {
  id: string
  username: string
  displayName: string
  avatarKey: string | null
  bio: string
  role: string
  phone: string | null
  links: AccountLink[]
  licensePreference: PhotoLicense
  visibility: 'public' | 'private'
  showLikes: boolean
  showFavorites: boolean
  discoverable: boolean
  notificationPreferences: NotificationPreferences
  createdAt: string
  updatedAt: string
}

export interface AccountSession {
  id: string
  currentSession: boolean
  userAgent: string | null
  createdAt: string
  lastSeenAt: string
  expiresAt: string
}

export interface PasswordChangeResult {
  ok: true
  reloginRequired: true
}

export const accountApi = {
  get: () => request<AccountSettings>('/api/me/account'),
  updateProfile: (input: Pick<AccountSettings, 'displayName' | 'bio' | 'links' | 'licensePreference' | 'avatarKey'>) =>
    request<AccountSettings>('/api/me/profile', { method: 'PUT', body: input }),
  updatePreferences: (input: Pick<AccountSettings, 'visibility' | 'showLikes' | 'showFavorites' | 'discoverable' | 'notificationPreferences'>) =>
    request<AccountSettings>('/api/me/preferences', { method: 'PUT', body: input }),
  listSessions: () => request<AccountSession[]>('/api/me/sessions'),
  revokeSession: (id: string) => request<void>(`/api/me/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  changePassword: (oldPassword: string, newPassword: string) =>
    request<PasswordChangeResult>('/api/me/password', { method: 'PATCH', body: { oldPassword, newPassword } }),
  deleteAccount: (password: string, reason: string) =>
    request<void>('/api/me/account', { method: 'DELETE', body: { password, reason, confirm: '注销账号' } }),
}
