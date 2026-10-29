/**
 * 内容治理数据访问层（0015 举报/审核/处罚 + 0025 回执/通知/申诉）。
 *
 * 约定（与 0022 social 一致）：
 *   1) 每一次读写都走 withRls(userId, ...) —— auth.uid() 读的是事务级 app.user_id，
 *      事务外调用会退化成匿名，写操作直接 42501；
 *   2) report_appeals / notifications / moderation_actions 对 app_user 完全关闭
 *      （无表级权限 + RLS 无 policy），所以只能经 SECURITY DEFINER 函数访问；
 *      管理端列表/详情同样走函数（api_admin_*），函数内部再判 is_editor_or_admin，
 *      这样"路由层判角色"不是唯一的防线；
 *   3) 对外的 JSON 契约是 camelCase（前端 domain 类型），映射逐个字段显式写出，
 *      不用 `...row` 懒省事 —— 否则快照 / 内部 id 会顺着响应漏出去。
 */
import type pg from 'pg'
import { withRls } from '../lib/db.js'
import { notFound } from '../lib/errors.js'
// 只引类型：类型在编译期被擦除，运行期不会和 lib/restrictions.ts 形成循环依赖
// （restrictions.ts 反过来 import 本模块的 activeRestriction）。
import type { RestrictionKind } from '../lib/restrictions.js'

// ---------------------------------------------------------------------------
// 时间/文本归一：pg 的 timestamptz 默认解析成 Date，手工拼接口时统一成 ISO
// ---------------------------------------------------------------------------
function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value)
}
function isoOrNull(value: unknown): string | null {
  return value == null ? null : iso(value)
}
function text(value: unknown): string {
  return value == null ? '' : String(value)
}
function textOrNull(value: unknown): string | null {
  return value == null ? null : String(value)
}

export type AppealStatus = 'open' | 'reviewing' | 'upheld' | 'rejected'
export const APPEAL_STATUSES: readonly AppealStatus[] = ['open', 'reviewing', 'upheld', 'rejected']
export const SANCTION_STATUSES = ['active', 'revoked'] as const

/** 我的举报（冻结契约 MyReport）：appealStatus 是本人最近一条申诉的状态，用于按钮可用性。 */
export interface MyReport {
  id: string
  targetType: string
  targetId: string
  reason: string
  detail: string
  status: string
  resolutionCode: string | null
  reviewNote: string
  appealStatus: AppealStatus | null
  createdAt: string
  resolvedAt: string | null
}

/** 我的申诉（冻结契约 Appeal）。 */
export interface Appeal {
  id: string
  reportId: string | null
  sanctionId: string | null
  message: string
  status: AppealStatus
  reviewNote: string
  createdAt: string
  reviewedAt: string | null
}

/** 我的处罚（冻结契约 MySanction）。 */
export interface MySanction {
  id: string
  kind: string
  reasonCode: string
  reasonDetail: string
  status: string
  startsAt: string
  endsAt: string | null
  revokedAt: string | null
  appealStatus: AppealStatus | null
  createdAt: string
}

/** 举报（冻结契约 Report）。 */
export interface Report {
  id: string
  targetType: string
  targetId: string
  reason: string
  detail: string
  status: string
  assignedTo: string | null
  reviewNote: string
  resolutionCode: string | null
  createdAt: string
  updatedAt: string
  resolvedAt: string | null
}

/** 举报目标投影（冻结契约 ReportTarget）。 */
export interface ReportTarget {
  kind: 'photo' | 'comment' | 'profile'
  id: string
  title: string
  excerpt: string
  authorId: string | null
  authorUsername: string
  authorDisplayName: string
  hidden: boolean
}

/** 举报人摘要（审核队列用；不属于冻结契约，纯附加字段）。 */
export interface ReportReporter {
  id: string
  username: string
  displayName: string
}

/** 审核审计（冻结契约 ModerationAction）。 */
export interface ModerationAction {
  id: string
  action: string
  actorId: string | null
  targetType: string
  targetId: string
  reason: string
  createdAt: string
}

/** 管理端处罚行 = MySanction + 被处罚者资料（冻结契约 AdminSanction）。 */
export interface AdminSanction extends MySanction {
  userId: string
  username: string
  displayName: string
}

/** 管理端申诉行 = Appeal + 申诉人资料（冻结契约 AdminAppeal）。 */
export interface AdminAppeal extends Appeal {
  appellantId: string
  appellantUsername: string
  appellantDisplayName: string
}

/** 管理端举报行 = Report + 举报人 + 目标摘要（附加字段，便于队列一屏看完）。 */
export interface AdminReport extends Report {
  reporter: ReportReporter | null
  target: ReportTarget | null
}

export interface ReportDetail {
  report: Report
  target: ReportTarget | null
  actions: ModerationAction[]
}

export interface SubmitReportInput {
  targetType: string
  targetId: string
  reason: string
  detail: string
}

// ---------------------------------------------------------------------------
// 行类型 + 映射
// ---------------------------------------------------------------------------
interface ReportRow {
  id: string
  target_type: string
  target_id: string
  reason: string
  detail: string
  status: string
  assigned_to: string | null
  review_note: string | null
  resolution_code: string | null
  created_at: unknown
  updated_at: unknown
  resolved_at: unknown
}

function mapReport(row: ReportRow): Report {
  return {
    id: row.id,
    targetType: row.target_type,
    targetId: row.target_id,
    reason: row.reason,
    detail: text(row.detail),
    status: row.status,
    assignedTo: textOrNull(row.assigned_to),
    reviewNote: text(row.review_note),
    resolutionCode: textOrNull(row.resolution_code),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    resolvedAt: isoOrNull(row.resolved_at),
  }
}

function mapTarget(value: unknown): ReportTarget | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  const kind = v.kind
  return {
    kind: kind === 'photo' || kind === 'comment' || kind === 'profile' ? kind : 'photo',
    id: text(v.id),
    title: text(v.title),
    excerpt: text(v.excerpt),
    authorId: textOrNull(v.authorId),
    authorUsername: text(v.authorUsername),
    authorDisplayName: text(v.authorDisplayName),
    hidden: v.hidden === true,
  }
}

function mapReporter(value: unknown): ReportReporter | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  if (v.id == null) return null
  return { id: text(v.id), username: text(v.username), displayName: text(v.displayName) }
}

function mapAction(value: Record<string, unknown>): ModerationAction {
  return {
    id: text(value.id),
    action: text(value.action),
    actorId: textOrNull(value.actorId),
    targetType: text(value.targetType),
    targetId: text(value.targetId),
    reason: text(value.reason),
    createdAt: iso(value.createdAt),
  }
}

function mapActions(value: unknown): ModerationAction[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((v): v is Record<string, unknown> => typeof v === 'object' && v !== null)
    .map(mapAction)
}

function mapAppealStatus(value: unknown): AppealStatus | null {
  return typeof value === 'string' && (APPEAL_STATUSES as readonly string[]).includes(value)
    ? (value as AppealStatus)
    : null
}

// ---------------------------------------------------------------------------
// 既有端点（0015）—— 语义与响应形状保持不变
// ---------------------------------------------------------------------------

/**
 * 提交举报。0025 起对外统一成回执形状 { reportId, status }：
 * 前端只关心"我拿到了哪条举报、它现在是什么状态"，不需要整行内部字段。
 * 同一目标重复举报时 api_submit_report 走 on conflict，返回的是已存在的那条（幂等）。
 */
export async function submitReport(userId: string, input: SubmitReportInput): Promise<{ reportId: string; status: string }> {
  const row = await withRls(userId, async (c) => {
    const r = await c.query('select * from public.api_submit_report($1,$2,$3,$4)', [
      input.targetType,
      input.targetId,
      input.reason,
      input.detail,
    ])
    return r.rows[0] as { id?: string; status?: string } | undefined
  })
  if (!row || !row.id) throw notFound('举报提交失败')
  return { reportId: row.id, status: text(row.status) }
}

/** 审核队列：经 0025 的 api_admin_list_reports 读，一并带出举报人与目标摘要。 */
export async function listReports(userId: string, status?: string): Promise<AdminReport[]> {
  return withRls(userId, async (c) => {
    const r = await c.query<ReportRow & { reporter: unknown; target: unknown }>(
      'select * from public.api_admin_list_reports($1::text)',
      [status ?? null],
    )
    return r.rows.map((row) => ({ ...mapReport(row), reporter: mapReporter(row.reporter), target: mapTarget(row.target) }))
  })
}

export async function claimReport(userId: string, reportId: string, requestId?: string) {
  return withRls(userId, (c: pg.PoolClient) =>
    c.query('select * from public.api_claim_report($1,$2)', [reportId, requestId ?? null]).then((r) => r.rows[0]),
  )
}

export async function setVisibility(
  userId: string,
  input: { targetType: string; targetId: string; hidden: boolean; reason: string; reportId?: string; requestId?: string },
) {
  await withRls(userId, (c) =>
    c.query('select public.api_set_content_visibility($1,$2,$3,$4,$5,$6)', [
      input.targetType,
      input.targetId,
      input.hidden,
      input.reason,
      input.reportId ?? null,
      input.requestId ?? null,
    ]),
  )
}

export async function resolveReport(
  userId: string,
  input: { reportId: string; outcome: string; resolutionCode: string; reviewNote: string; requestId?: string },
) {
  return withRls(userId, (c) =>
    c
      .query('select * from public.api_resolve_report($1,$2,$3,$4,$5)', [
        input.reportId,
        input.outcome,
        input.resolutionCode,
        input.reviewNote,
        input.requestId ?? null,
      ])
      .then((r) => r.rows[0]),
  )
}

export async function applySanction(
  userId: string,
  input: {
    targetUserId: string
    kind: string
    reasonCode: string
    reasonDetail: string
    endsAt?: string
    reportId?: string
    requestId?: string
  },
) {
  return withRls(userId, (c) =>
    c
      .query('select * from public.api_apply_sanction($1,$2,$3,$4,$5,$6,$7)', [
        input.targetUserId,
        input.kind,
        input.reasonCode,
        input.reasonDetail,
        input.endsAt ?? null,
        input.reportId ?? null,
        input.requestId ?? null,
      ])
      .then((r) => r.rows[0]),
  )
}

export async function revokeSanction(userId: string, sanctionId: string, reason: string, requestId?: string) {
  return withRls(userId, (c) =>
    c.query('select * from public.api_revoke_sanction($1,$2,$3)', [sanctionId, reason, requestId ?? null]).then((r) => r.rows[0]),
  )
}

// ---------------------------------------------------------------------------
// 0025 用户侧：举报回执、我的申诉、我的处罚
// ---------------------------------------------------------------------------

interface MyReportRow {
  id: string
  target_type: string
  target_id: string
  reason: string
  detail: string
  status: string
  resolution_code: string | null
  review_note: string | null
  appeal_status: string | null
  created_at: unknown
  resolved_at: unknown
}

function mapMyReport(row: MyReportRow): MyReport {
  return {
    id: row.id,
    targetType: row.target_type,
    targetId: row.target_id,
    reason: row.reason,
    detail: text(row.detail),
    status: row.status,
    resolutionCode: textOrNull(row.resolution_code),
    reviewNote: text(row.review_note),
    appealStatus: mapAppealStatus(row.appeal_status),
    createdAt: iso(row.created_at),
    resolvedAt: isoOrNull(row.resolved_at),
  }
}

export async function myReports(userId: string): Promise<MyReport[]> {
  return withRls(userId, async (c) => {
    const r = await c.query<MyReportRow>('select * from public.api_my_reports()')
    return r.rows.map(mapMyReport)
  })
}

interface AppealRow {
  id: string
  report_id: string | null
  sanction_id: string | null
  message: string
  status: string
  review_note: string | null
  created_at: unknown
  reviewed_at: unknown
}

function mapAppeal(row: AppealRow): Appeal {
  return {
    id: row.id,
    reportId: textOrNull(row.report_id),
    sanctionId: textOrNull(row.sanction_id),
    message: text(row.message),
    status: (mapAppealStatus(row.status) ?? 'open') as AppealStatus,
    reviewNote: text(row.review_note),
    createdAt: iso(row.created_at),
    reviewedAt: isoOrNull(row.reviewed_at),
  }
}

/** 提交申诉。服务端只做参数整形；"是否属于本人 / 是否重复"由函数在库内判定。 */
export async function submitAppeal(
  userId: string,
  input: { reportId?: string; sanctionId?: string; message: string },
): Promise<{ appealId: string; status: AppealStatus; createdAt: string }> {
  const row = await withRls(userId, async (c) => {
    const r = await c.query('select * from public.api_submit_appeal($1::uuid,$2::uuid,$3::text)', [
      input.reportId ?? null,
      input.sanctionId ?? null,
      input.message,
    ])
    return r.rows[0] as { appeal_id?: string; status?: string; created_at?: unknown } | undefined
  })
  if (!row || !row.appeal_id) throw notFound('申诉提交失败')
  return {
    appealId: row.appeal_id,
    status: (mapAppealStatus(row.status) ?? 'open') as AppealStatus,
    createdAt: iso(row.created_at),
  }
}

export async function myAppeals(userId: string): Promise<Appeal[]> {
  return withRls(userId, async (c) => {
    const r = await c.query<AppealRow>('select * from public.api_my_appeals()')
    return r.rows.map(mapAppeal)
  })
}

interface MySanctionRow {
  id: string
  kind: string
  reason_code: string
  reason_detail: string
  status: string
  starts_at: unknown
  ends_at: unknown
  revoked_at: unknown
  appeal_status: string | null
  created_at: unknown
}

function mapMySanction(row: MySanctionRow): MySanction {
  return {
    id: row.id,
    kind: row.kind,
    reasonCode: row.reason_code,
    reasonDetail: text(row.reason_detail),
    status: row.status,
    startsAt: iso(row.starts_at),
    endsAt: isoOrNull(row.ends_at),
    revokedAt: isoOrNull(row.revoked_at),
    appealStatus: mapAppealStatus(row.appeal_status),
    createdAt: iso(row.created_at),
  }
}

export async function mySanctions(userId: string): Promise<MySanction[]> {
  return withRls(userId, async (c) => {
    const r = await c.query<MySanctionRow>('select * from public.api_my_sanctions()')
    return r.rows.map(mapMySanction)
  })
}

// ---------------------------------------------------------------------------
// 0026 生效处罚（写守卫用它决定拦什么，/api/auth/session 用它给前端提示）
// ---------------------------------------------------------------------------

/**
 * 当前最严重的一条生效处罚。endsAt=null 表示长期有效。
 * 与 MySanction 分开：守卫只要四个字段 + 创建时间，不需要申诉状态，
 * 也不该为了一个 403 去 join 申诉表。
 */
export interface ActiveRestriction {
  kind: RestrictionKind
  reasonCode: string
  reasonDetail: string
  endsAt: string | null
  createdAt: string
}

const RESTRICTION_KINDS: readonly RestrictionKind[] = ['warning', 'content_restriction', 'suspension', 'ban']

function isRestrictionKind(value: unknown): value is RestrictionKind {
  return typeof value === 'string' && (RESTRICTION_KINDS as readonly string[]).includes(value)
}

interface ActiveRestrictionRow {
  kind: string
  reason_code: string
  reason_detail: string
  ends_at: unknown
  created_at: unknown
}

/**
 * 读 0026 的 api_my_active_restriction()：auth.uid() 生效中的处罚里取最严重一条。
 *
 * 未知 kind 一律返回 null（放行），而不是当最严处理：这里返回 null 只表示
 * "本次没有可识别的处罚"，守卫因此不拦；如果 DB 真出现第五种 kind，那是迁移
 * 与代码漂移，应当在迁移自检阶段炸掉，不该让线上写接口静默变成全锁。
 * （守卫自身的 fail closed 分支针对的是 kind 已识别但组合未知的情况。）
 */
export async function activeRestriction(userId: string): Promise<ActiveRestriction | null> {
  return withRls(userId, async (c) => {
    const r = await c.query<ActiveRestrictionRow>('select * from public.api_my_active_restriction()')
    const row = r.rows[0]
    if (!row || !isRestrictionKind(row.kind)) return null
    return {
      kind: row.kind,
      reasonCode: row.reason_code,
      reasonDetail: text(row.reason_detail),
      endsAt: isoOrNull(row.ends_at),
      createdAt: iso(row.created_at),
    }
  })
}

// ---------------------------------------------------------------------------
// 0025 管理端：举报详情、处罚列表、申诉列表、申诉复核
// ---------------------------------------------------------------------------

interface ReportDetailRow extends ReportRow {
  target: unknown
  actions: unknown
}

/** 举报详情 = 举报 + 目标投影 + 该举报的完整审计链（P0-16 审核详情页）。 */
export async function adminReportDetail(userId: string, reportId: string): Promise<ReportDetail> {
  const row = await withRls(userId, async (c) => {
    const r = await c.query<ReportDetailRow>('select * from public.api_admin_report_detail($1::uuid)', [reportId])
    return r.rows[0]
  })
  if (!row) throw notFound('举报不存在')
  return { report: mapReport(row), target: mapTarget(row.target), actions: mapActions(row.actions) }
}

interface AdminSanctionRow extends MySanctionRow {
  user_id: string
  username: string | null
  display_name: string | null
}

export async function adminListSanctions(userId: string, status?: string): Promise<AdminSanction[]> {
  return withRls(userId, async (c) => {
    const r = await c.query<AdminSanctionRow>('select * from public.api_admin_list_sanctions($1::text)', [status ?? null])
    return r.rows.map((row) => ({
      ...mapMySanction(row),
      userId: row.user_id,
      username: text(row.username),
      displayName: text(row.display_name),
    }))
  })
}

interface AdminAppealRow extends AppealRow {
  appellant_id: string
  appellant_username: string | null
  appellant_display_name: string | null
}

export async function adminListAppeals(userId: string, status?: string): Promise<AdminAppeal[]> {
  return withRls(userId, async (c) => {
    const r = await c.query<AdminAppealRow>('select * from public.api_admin_list_appeals($1::text)', [status ?? null])
    return r.rows.map((row) => ({
      ...mapAppeal(row),
      appellantId: row.appellant_id,
      appellantUsername: text(row.appellant_username),
      appellantDisplayName: text(row.appellant_display_name),
    }))
  })
}

/**
 * 申诉复核（P0-19）。upheld = 申诉成立，库内同事务撤销处罚 / 恢复内容可见性；
 * rejected = 维持原判。两种情况都会写 moderation_actions 审计并通知申诉人。
 */
export async function reviewAppeal(
  userId: string,
  input: { appealId: string; outcome: 'upheld' | 'rejected'; note: string; requestId?: string },
): Promise<{ appealId: string; status: AppealStatus; updatedAt: string }> {
  const row = await withRls(userId, async (c) => {
    const r = await c.query('select * from public.api_review_appeal($1::uuid,$2::text,$3::text,$4::text)', [
      input.appealId,
      input.outcome,
      input.note,
      input.requestId ?? null,
    ])
    return r.rows[0] as { appeal_id?: string; status?: string; updated_at?: unknown } | undefined
  })
  if (!row || !row.appeal_id) throw notFound('申诉不存在')
  return {
    appealId: row.appeal_id,
    status: (mapAppealStatus(row.status) ?? 'open') as AppealStatus,
    updatedAt: iso(row.updated_at),
  }
}
