/**
 * 账号限制的纯逻辑与文案（8.2 补口）。
 *
 * 为什么单独成模块而不是写进页面或 features/moderation：
 *   · mock 仓储要从 user_sanctions 推导「当前生效的最重处罚」；
 *   · HTTP 客户端要把 403 的 details 翻译成提示；
 *   · 全站 banner 要渲染同一套种类/期限文案。
 * 三处都在数据层或更底层，不能反向依赖 features（ESLint 已禁止），
 * 所以把「哪些算生效」「哪个最重」「怎么说」集中在这里，页面只负责排版。
 */
import { formatDate } from '@/lib/time'
import type { IsoDate, SanctionKind, SessionRestriction } from './types'

export type { SessionRestriction }

export const SANCTION_KINDS = ['warning', 'content_restriction', 'suspension', 'ban'] as const

/** 未知取值一律视为「不是处罚」，避免后端加码时前端把普通错误当成限制 */
export function isSanctionKind(value: unknown): value is SanctionKind {
  return typeof value === 'string' && (SANCTION_KINDS as readonly string[]).includes(value)
}

/** 越重越大；用于在同一次处罚叠加时挑出 banner 要展示的那条 */
const SEVERITY: Record<SanctionKind, number> = {
  warning: 0,
  content_restriction: 1,
  suspension: 2,
  ban: 3,
}

const SANCTION_KIND_LABEL: Record<SanctionKind, string> = {
  warning: '警告',
  content_restriction: '内容限制',
  suspension: '停用',
  ban: '封禁',
}

export function sanctionKindLabel(kind: SanctionKind): string {
  return SANCTION_KIND_LABEL[kind] ?? kind
}

const RESTRICTION_TITLE: Record<SanctionKind, string> = {
  warning: '账号收到一次警告',
  content_restriction: '内容发布受限',
  suspension: '账号已停用',
  ban: '账号已封禁',
}

export function restrictionTitle(kind: SanctionKind): string {
  return RESTRICTION_TITLE[kind] ?? '账号受限'
}

const RESTRICTION_SCOPE: Record<SanctionKind, string> = {
  warning: '本次警告不影响浏览、发布与互动；请留意社区规范，避免再次违规。',
  content_restriction: '暂时无法发布、编辑或撤回作品；浏览、点赞、评论与申诉不受影响。',
  suspension: '暂时无法发布内容、互动或读取通知；浏览、举报与申诉不受影响。',
  ban: '暂时无法进行发布、互动与通知等写操作；浏览、举报与申诉不受影响。',
}

export function restrictionScope(kind: SanctionKind): string {
  return RESTRICTION_SCOPE[kind] ?? '部分操作暂时不可用，浏览与申诉不受影响。'
}

/** 「长期有效」与「到期时间：yyyy-mm-dd」；非法日期按长期处理，避免显示 NaN */
export function restrictionExpiryText(endsAt: IsoDate | null): string {
  if (!endsAt || Number.isNaN(Date.parse(endsAt))) return '长期有效'
  return `到期时间：${formatDate(endsAt)}`
}

/** 提示里的期限短语，比 banner 更短 */
function expiryPhrase(endsAt: IsoDate | null): string {
  if (!endsAt || Number.isNaN(Date.parse(endsAt))) return '长期限制'
  return `限制至 ${formatDate(endsAt)}`
}

/**
 * 403 拦截提示。优先用服务端 message（它知道具体被拦的是哪个动作），
 * 前端只补上期限，避免出现「账号受限」这种什么也没说的提示。
 */
export function sanctionBlockedMessage(
  kind: SanctionKind,
  endsAt: IsoDate | null,
  serverMessage?: string,
): string {
  const base =
    serverMessage?.trim() ||
    `账号当前受限（${sanctionKindLabel(kind)}），暂时无法完成该操作`
  return `${base}（${expiryPhrase(endsAt)}）`
}

/** 从 user_sanctions 行里推导会话限制所需的形状（mock 与单测共用） */
export interface RestrictionCandidate {
  kind: SanctionKind
  reasonCode: string
  reasonDetail: string
  status: string
  endsAt: IsoDate | null
}

export function isRestrictionActive(row: RestrictionCandidate, now = Date.now()): boolean {
  if (row.status !== 'active') return false
  if (row.endsAt === null) return true
  const ends = Date.parse(row.endsAt)
  return Number.isNaN(ends) || ends > now
}

/**
 * 当前生效的处罚里最重的一条。
 *
 * 同 severity 时保持入参顺序（JS 的 sort 自 ES2019 起稳定），
 * 这样 mock 与测试对「先查到哪条」有确定预期。
 */
export function pickActiveRestriction(
  rows: readonly RestrictionCandidate[],
  now = Date.now(),
): SessionRestriction | null {
  const active = rows.filter((row) => isSanctionKind(row.kind) && isRestrictionActive(row, now))
  if (active.length === 0) return null
  const top = [...active].sort((a, b) => SEVERITY[b.kind] - SEVERITY[a.kind])[0]!
  return {
    kind: top.kind,
    reasonCode: top.reasonCode,
    reasonDetail: top.reasonDetail,
    endsAt: top.endsAt,
  }
}

/** 403 响应里能识别出的处罚信息；仅 details.sanctionKind 是合法枚举时才算 */
export interface SanctionBlock {
  kind: SanctionKind
  endsAt: IsoDate | null
}

export function parseSanctionBlock(status: number, body: unknown): SanctionBlock | null {
  if (status !== 403 || typeof body !== 'object' || body === null) return null
  const details = (body as { details?: unknown }).details
  if (typeof details !== 'object' || details === null) return null
  const kind = (details as { sanctionKind?: unknown }).sanctionKind
  if (!isSanctionKind(kind)) return null
  const rawEndsAt = (details as { endsAt?: unknown }).endsAt
  const endsAt =
    typeof rawEndsAt === 'string' && !Number.isNaN(Date.parse(rawEndsAt)) ? rawEndsAt : null
  return { kind, endsAt }
}
