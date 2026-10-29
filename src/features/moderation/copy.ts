/**
 * 治理文案与状态映射（8.2）。
 *
 * 单独抽成纯函数模块的原因：文案是**唯一**被页面、后台、单测同时依赖的东西。
 * 三处各自写一遍 switch，测试就只能测到页面里的那一份；抽出来以后
 * `tests/unit/moderation-copy.test.ts` 能直接把映射钉死，页面只负责排版。
 */
import type { AppealStatus, ReportReason, ReportStatus, ReportTargetType } from '@/domain/types'

/** 处罚种类中文名与限流层共用同一份（src/domain/restrictions.ts），避免两处文案漂移 */
export { sanctionKindLabel } from '@/domain/restrictions'

/** 举报理由（与后端 reason 码一一对应，顺序即单选顺序） */
export interface ReportReasonOption {
  value: ReportReason
  label: string
  hint: string
}

export const REPORT_REASON_OPTIONS: readonly ReportReasonOption[] = [
  { value: 'copyright', label: '侵权', hint: '盗用他人作品、未经授权转载' },
  { value: 'explicit', label: '色情低俗', hint: '裸露、性暗示或低俗内容' },
  { value: 'spam', label: '垃圾广告', hint: '推广链接、刷屏、无意义内容' },
  { value: 'abuse', label: '骚扰辱骂', hint: '人身攻击、歧视、威胁' },
  { value: 'other', label: '其他', hint: '不属于以上类别的问题' },
] as const

const REASON_LABEL: Record<ReportReason, string> = {
  copyright: '侵权',
  explicit: '色情低俗',
  spam: '垃圾广告',
  abuse: '骚扰辱骂',
  other: '其他',
}

export function reasonLabel(reason: ReportReason): string {
  return REASON_LABEL[reason] ?? '其他'
}

/** 举报 / 申诉共用的状态集合，但文案不同：举报「成立」，申诉「成立」都指 upheld */
const REPORT_STATUS_LABEL: Record<ReportStatus, string> = {
  open: '待处理',
  reviewing: '处理中',
  upheld: '已成立',
  rejected: '已驳回',
}

const APPEAL_STATUS_LABEL: Record<AppealStatus, string> = {
  open: '待复核',
  reviewing: '复核中',
  upheld: '申诉成立',
  rejected: '维持原判',
}

export function reportStatusLabel(status: ReportStatus): string {
  return REPORT_STATUS_LABEL[status] ?? status
}

export function appealStatusLabel(status: AppealStatus): string {
  return APPEAL_STATUS_LABEL[status] ?? status
}

/** Badge 色调（g-badge-* 类名后缀）；未知状态退到 neutral，不抛错 */
export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

export function reportStatusTone(status: ReportStatus): BadgeTone {
  switch (status) {
    case 'open':
      return 'warning'
    case 'reviewing':
      return 'info'
    case 'upheld':
      return 'danger'
    case 'rejected':
      return 'neutral'
    default:
      return 'neutral'
  }
}

export function appealStatusTone(status: AppealStatus): BadgeTone {
  switch (status) {
    case 'open':
      return 'warning'
    case 'reviewing':
      return 'info'
    case 'upheld':
      return 'success'
    case 'rejected':
      return 'neutral'
    default:
      return 'neutral'
  }
}

const TARGET_KIND_LABEL: Record<ReportTargetType, string> = {
  photo: '作品',
  comment: '评论',
  profile: '用户',
}

export function targetKindLabel(kind: ReportTargetType): string {
  return TARGET_KIND_LABEL[kind] ?? kind
}

const SANCTION_STATUS_LABEL: Record<string, string> = {
  active: '生效中',
  expired: '已到期',
  revoked: '已撤销',
}

/** user_sanctions.status 是 text（不是枚举），未知值原样显示，方便排查 */
export function sanctionStatusLabel(status: string): string {
  return SANCTION_STATUS_LABEL[status] ?? status
}

export function sanctionStatusTone(status: string): BadgeTone {
  if (status === 'active') return 'danger'
  if (status === 'revoked') return 'neutral'
  if (status === 'expired') return 'neutral'
  return 'warning'
}

/** 裁定码 → 中文；未知码原样显示（后端加码时前端不需要同步发版） */
const RESOLUTION_LABEL: Record<string, string> = {
  content_hidden: '内容已隐藏',
  warning_issued: '已发出警告',
  no_violation: '未发现违规',
  account_restricted: '账号已限制',
  appeal_upheld: '申诉成立，已纠正',
}

export function resolutionLabel(code: string | null): string {
  if (!code) return ''
  return RESOLUTION_LABEL[code] ?? code
}

/** 后台裁定时可选的裁定码（upheld 与 rejected 各一组） */
export const UPHELD_RESOLUTIONS = ['content_hidden', 'warning_issued', 'account_restricted'] as const
export const REJECTED_RESOLUTIONS = ['no_violation'] as const
