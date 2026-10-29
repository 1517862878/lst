/**
 * Mock 治理仓储（8.2：举报 / 审核 / 处罚 / 申诉）。
 *
 * 与 api 实现共用同一份契约与同一套状态机规则：
 *   open → reviewing（认领） → upheld | rejected（裁定）
 *   同一举报人 + 同一目标，未结案时不能重复提交（CONFLICT）—— 页面上「已受理」
 *   的回执才不会变成同一单被刷成几十条的假象。
 */
import {
  AppError,
  ErrorCodes,
  type AdminReportDetail,
  type AdminSanction,
  type AdminAppeal,
  type Appeal,
  type AppealReceipt,
  type AppealStatus,
  type ModerationRepository,
  type MyReport,
  type MySanction,
  type ReportReceipt,
  type ReportStatus,
  type ResolveReportInput,
  type SubmitAppealInput,
  type SubmitReportInput,
  type VisibilityInput,
} from '@/data/contracts'
import type {
  Comment,
  ModerationAction,
  Photo,
  Profile,
  Report,
  ReportTarget,
} from '@/domain/types'
import { getDb, type AppealRow, type SanctionRow } from '../db'
import { mockAuthRepository } from './auth'

type ReportRow = Report & { reporterId: string | null }
type Session = Awaited<ReturnType<typeof mockAuthRepository.getSession>>

const nowIso = (): string => new Date().toISOString()

/** 生成 id：优先用 crypto.randomUUID（浏览器与 Node 18+ 都有） */
function newId(prefix: string): string {
  const uuid =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  return `${prefix}-${uuid}`
}

async function requireSession(): Promise<NonNullable<Session>> {
  const session = await mockAuthRepository.getSession()
  if (!session) throw new AppError(ErrorCodes.UNAUTHORIZED, '请先登录后再操作')
  return session
}

async function requireStaff(): Promise<NonNullable<Session>> {
  const session = await requireSession()
  if (session.role !== 'editor' && session.role !== 'admin') {
    throw new AppError(ErrorCodes.FORBIDDEN, '需要审核员或管理员权限')
  }
  return session
}

const byCreatedAtDesc = <T extends { createdAt: string }>(rows: T[]): T[] =>
  [...rows].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))

/** 目标快照：后台详情面板要看到「被举报的是什么、谁发的、现在隐藏没有」 */
async function loadTarget(
  targetType: Report['targetType'],
  targetId: string,
): Promise<ReportTarget> {
  const db = await getDb()
  if (targetType === 'photo') {
    const photo = await db.get('photos', targetId)
    if (!photo) throw new AppError(ErrorCodes.NOT_FOUND, '被举报的作品已不存在')
    const author = await db.get('profiles', photo.authorId)
    return {
      kind: 'photo',
      id: photo.id,
      title: photo.title,
      excerpt: photo.description,
      authorId: photo.authorId,
      authorUsername: author?.username ?? null,
      authorDisplayName: author?.displayName ?? null,
      hidden: photo.status === 'hidden' || photo.status === 'removed',
    }
  }
  if (targetType === 'comment') {
    const comment = await db.get('comments', targetId)
    if (!comment) throw new AppError(ErrorCodes.NOT_FOUND, '被举报的评论已不存在')
    const author = await db.get('profiles', comment.authorId)
    return {
      kind: 'comment',
      id: comment.id,
      title: `评论 · ${(await db.get('photos', comment.photoId))?.title ?? '作品'}`,
      excerpt: comment.body,
      authorId: comment.authorId,
      authorUsername: author?.username ?? null,
      authorDisplayName: author?.displayName ?? null,
      hidden: comment.status !== 'visible',
    }
  }
  const profile = await db.get('profiles', targetId)
  if (!profile) throw new AppError(ErrorCodes.NOT_FOUND, '被举报的用户不存在')
  return {
    kind: 'profile',
    id: profile.id,
    title: profile.displayName,
    excerpt: profile.bio,
    authorId: profile.id,
    authorUsername: profile.username,
    authorDisplayName: profile.displayName,
    hidden: profile.deletedAt !== null,
  }
}

/** 举报目标的作者 id（判断「不能举报自己」用） */
async function targetAuthorId(targetType: Report['targetType'], targetId: string): Promise<string | null> {
  const db = await getDb()
  if (targetType === 'photo') return (await db.get('photos', targetId))?.authorId ?? null
  if (targetType === 'comment') return (await db.get('comments', targetId))?.authorId ?? null
  return (await db.get('profiles', targetId))?.id ?? null
}

/** 最新一条申诉的状态（按目标），没有则 null */
function latestAppealStatus(
  appeals: AppealRow[],
  predicate: (a: AppealRow) => boolean,
): AppealStatus | null {
  const hits = byCreatedAtDesc(appeals.filter(predicate))
  return hits[0]?.status ?? null
}

async function appendAction(
  action: Omit<ModerationAction, 'id' | 'createdAt'>,
): Promise<void> {
  const db = await getDb()
  await db.put('moderationActions', { ...action, id: newId('act'), createdAt: nowIso() })
}

async function getReportRow(id: string): Promise<ReportRow> {
  const db = await getDb()
  const row = await db.get('reports', id)
  if (!row) throw new AppError(ErrorCodes.NOT_FOUND, '举报不存在')
  return row
}

/** 出库前剥掉存储层字段 */
function toMyReport(report: ReportRow, appealStatus: AppealStatus | null): MyReport {
  const { reporterId: _reporterId, assignedTo: _assignedTo, updatedAt: _updatedAt, ...rest } = report
  return { ...rest, appealStatus }
}

function toAppeal(row: AppealRow): Appeal {
  const { appellantId: _appellantId, ...rest } = row
  return rest
}

function toMySanction(row: SanctionRow, appealStatus: AppealStatus | null): MySanction {
  const { userId: _userId, createdBy: _createdBy, appealStatus: _ignored, ...rest } = row
  return { ...rest, appealStatus }
}

export const mockModerationRepository: ModerationRepository = {
  async submitReport(input: SubmitReportInput): Promise<ReportReceipt> {
    const session = await requireSession()
    const detail = input.detail.trim()
    if (detail.length > 500) throw new AppError(ErrorCodes.VALIDATION, '补充说明最多 500 字')

    const authorId = await targetAuthorId(input.targetType, input.targetId)
    if (!authorId) throw new AppError(ErrorCodes.NOT_FOUND, '被举报的内容不存在')
    if (authorId === session.userId) throw new AppError(ErrorCodes.VALIDATION, '不能举报自己的内容')

    const db = await getDb()
    const mine = (await db.getAllFromIndex('reports', 'reporterId', session.userId)).filter(
      (r) => r.targetType === input.targetType && r.targetId === input.targetId,
    )
    const dup = mine.find((r) => r.status === 'open' || r.status === 'reviewing')
    if (dup) throw new AppError(ErrorCodes.CONFLICT, '这条内容你已经举报过，我们正在处理')

    const createdAt = nowIso()
    const row: ReportRow = {
      id: newId('rep'),
      reporterId: session.userId,
      targetType: input.targetType,
      targetId: input.targetId,
      reason: input.reason,
      detail,
      status: 'open',
      assignedTo: null,
      reviewNote: null,
      resolutionCode: null,
      createdAt,
      updatedAt: createdAt,
      resolvedAt: null,
    }
    await db.put('reports', row)
    return { reportId: row.id, status: row.status }
  },

  async myReports(): Promise<MyReport[]> {
    const session = await requireSession()
    const db = await getDb()
    const [mine, appeals] = await Promise.all([
      db.getAllFromIndex('reports', 'reporterId', session.userId),
      db.getAll('appeals'),
    ])
    return byCreatedAtDesc(mine).map((report) =>
      toMyReport(
        report,
        latestAppealStatus(appeals, (a) => a.reportId === report.id),
      ),
    )
  },

  async submitAppeal(input: SubmitAppealInput): Promise<AppealReceipt> {
    const session = await requireSession()
    const message = input.message.trim()
    if (message.length < 10) throw new AppError(ErrorCodes.VALIDATION, '申诉说明至少 10 个字')
    if (message.length > 2000) throw new AppError(ErrorCodes.VALIDATION, '申诉说明最多 2000 字')
    const hasReport = Boolean(input.reportId)
    const hasSanction = Boolean(input.sanctionId)
    if (hasReport === hasSanction) {
      throw new AppError(ErrorCodes.VALIDATION, '申诉必须且只能关联一条举报或一次处罚')
    }

    const db = await getDb()
    const appeals = await db.getAll('appeals')

    if (input.reportId) {
      const report = await db.get('reports', input.reportId)
      if (!report) throw new AppError(ErrorCodes.NOT_FOUND, '举报不存在')
      if (report.reporterId !== session.userId) {
        throw new AppError(ErrorCodes.FORBIDDEN, '只能对自己的举报提起申诉')
      }
      const open = appeals.find(
        (a) => a.reportId === input.reportId && (a.status === 'open' || a.status === 'reviewing'),
      )
      if (open) throw new AppError(ErrorCodes.CONFLICT, '这条举报已经在申诉中，请等待复核')
    } else if (input.sanctionId) {
      const sanction = await db.get('sanctions', input.sanctionId)
      if (!sanction) throw new AppError(ErrorCodes.NOT_FOUND, '处罚不存在')
      if (sanction.userId !== session.userId) {
        throw new AppError(ErrorCodes.FORBIDDEN, '只能对自己的处罚提起申诉')
      }
      const open = appeals.find(
        (a) => a.sanctionId === input.sanctionId && (a.status === 'open' || a.status === 'reviewing'),
      )
      if (open) throw new AppError(ErrorCodes.CONFLICT, '这次处罚已经在申诉中，请等待复核')
    }

    const createdAt = nowIso()
    const row: AppealRow = {
      id: newId('apl'),
      appellantId: session.userId,
      reportId: input.reportId ?? null,
      sanctionId: input.sanctionId ?? null,
      message,
      status: 'open',
      reviewNote: '',
      createdAt,
      reviewedAt: null,
    }
    await db.put('appeals', row)
    return { appealId: row.id, status: row.status, createdAt }
  },

  async myAppeals(): Promise<Appeal[]> {
    const session = await requireSession()
    const db = await getDb()
    const rows = await db.getAllFromIndex('appeals', 'appellantId', session.userId)
    return byCreatedAtDesc(rows).map(toAppeal)
  },

  async mySanctions(): Promise<MySanction[]> {
    const session = await requireSession()
    const db = await getDb()
    const [rows, appeals] = await Promise.all([
      db.getAllFromIndex('sanctions', 'userId', session.userId),
      db.getAll('appeals'),
    ])
    return byCreatedAtDesc(rows).map((row) =>
      toMySanction(
        row,
        latestAppealStatus(appeals, (a) => a.sanctionId === row.id),
      ),
    )
  },

  async listReports(status?: ReportStatus): Promise<Report[]> {
    await requireStaff()
    const db = await getDb()
    const rows = status
      ? await db.getAllFromIndex('reports', 'status', status)
      : await db.getAll('reports')
    return byCreatedAtDesc(rows).map(({ reporterId: _reporterId, ...rest }) => rest)
  },

  async reportDetail(id: string): Promise<AdminReportDetail> {
    await requireStaff()
    const row = await getReportRow(id)
    const target = await loadTarget(row.targetType, row.targetId)
    const db = await getDb()
    const actions = await db.getAll('moderationActions')
    return {
      report: (({ reporterId: _reporterId, ...rest }) => rest)(row),
      target,
      actions: byCreatedAtDesc(
        actions.filter(
          (a) =>
            (a.targetType === 'report' && a.targetId === row.id) ||
            (a.targetType === row.targetType && a.targetId === row.targetId),
        ),
      ),
    }
  },

  async claimReport(id: string): Promise<void> {
    const staff = await requireStaff()
    const row = await getReportRow(id)
    if (row.assignedTo === staff.userId) return
    if (row.assignedTo) throw new AppError(ErrorCodes.CONFLICT, '这条举报已被其他审核员认领')
    if (row.status !== 'open' && row.status !== 'reviewing') {
      throw new AppError(ErrorCodes.VALIDATION, '已结案的举报不能认领')
    }
    const db = await getDb()
    await db.put('reports', {
      ...row,
      assignedTo: staff.userId,
      status: 'reviewing',
      updatedAt: nowIso(),
    })
    await appendAction({
      action: 'report.claim',
      actorId: staff.userId,
      targetType: 'report',
      targetId: row.id,
      reason: '认领处理',
    })
  },

  async setVisibility(input: VisibilityInput): Promise<void> {
    const staff = await requireStaff()
    const db = await getDb()
    const reason = input.reason.trim() || (input.hidden ? '内容隐藏' : '内容恢复')
    if (input.reason.trim().length === 0) {
      throw new AppError(ErrorCodes.VALIDATION, '请填写处理理由')
    }

    if (input.targetType === 'photo') {
      const photo = await db.get('photos', input.targetId)
      if (!photo) throw new AppError(ErrorCodes.NOT_FOUND, '作品不存在')
      const next: Photo = {
        ...photo,
        status: input.hidden ? 'hidden' : 'published',
        updatedAt: nowIso(),
      }
      await db.put('photos', next)
    } else if (input.targetType === 'comment') {
      const comment = await db.get('comments', input.targetId)
      if (!comment) throw new AppError(ErrorCodes.NOT_FOUND, '评论不存在')
      const next: Comment = {
        ...comment,
        status: input.hidden ? 'hidden' : 'visible',
      }
      await db.put('comments', next)
    } else {
      // 个人主页没有「隐藏」概念：封禁要走处罚（有期限、可申诉、可撤销）
      throw new AppError(ErrorCodes.VALIDATION, '个人主页不支持隐藏，请用处罚处理')
    }

    await appendAction({
      action: input.hidden ? 'content.hide' : 'content.restore',
      actorId: staff.userId,
      targetType: input.targetType,
      targetId: input.targetId,
      reason,
    })
  },

  async resolveReport(id: string, input: ResolveReportInput): Promise<void> {
    const staff = await requireStaff()
    const row = await getReportRow(id)
    if (row.status === 'upheld' || row.status === 'rejected') {
      throw new AppError(ErrorCodes.VALIDATION, '这条举报已经结案')
    }
    if (input.reviewNote.trim().length === 0) {
      throw new AppError(ErrorCodes.VALIDATION, '请填写审核备注')
    }
    const db = await getDb()
    const resolvedAt = nowIso()
    const next: ReportRow = {
      ...row,
      status: input.status,
      resolutionCode: input.resolutionCode,
      reviewNote: input.reviewNote.trim(),
      assignedTo: row.assignedTo ?? staff.userId,
      resolvedAt,
      updatedAt: resolvedAt,
    }
    await db.put('reports', next)
    await appendAction({
      action: 'report.resolve',
      actorId: staff.userId,
      targetType: 'report',
      targetId: row.id,
      reason: `${input.status} / ${input.resolutionCode}`,
    })
  },

  async listSanctions(status?: string): Promise<AdminSanction[]> {
    await requireStaff()
    const db = await getDb()
    const rows = status
      ? await db.getAllFromIndex('sanctions', 'status', status)
      : await db.getAll('sanctions')
    const profiles = await db.getAll('profiles')
    const appeals = await db.getAll('appeals')
    const byId = new Map<string, Profile>(profiles.map((p) => [p.id, p]))
    return byCreatedAtDesc(rows).map((row) => {
      const user = byId.get(row.userId)
      return {
        ...toMySanction(row, latestAppealStatus(appeals, (a) => a.sanctionId === row.id)),
        userId: row.userId,
        username: user?.username ?? row.userId,
        displayName: user?.displayName ?? row.userId,
      }
    })
  },

  async revokeSanction(id: string, reason: string): Promise<void> {
    const staff = await requireStaff()
    if (reason.trim().length === 0) throw new AppError(ErrorCodes.VALIDATION, '请填写撤销理由')
    const db = await getDb()
    const row = await db.get('sanctions', id)
    if (!row) throw new AppError(ErrorCodes.NOT_FOUND, '处罚不存在')
    if (row.status === 'revoked') throw new AppError(ErrorCodes.CONFLICT, '这次处罚已经撤销')
    const revokedAt = nowIso()
    await db.put('sanctions', { ...row, status: 'revoked', revokedAt })
    await appendAction({
      action: 'sanction.revoke',
      actorId: staff.userId,
      targetType: 'sanction',
      targetId: id,
      reason: reason.trim(),
    })
  },

  async listAppeals(status?: AppealStatus): Promise<AdminAppeal[]> {
    await requireStaff()
    const db = await getDb()
    const rows = status
      ? await db.getAllFromIndex('appeals', 'status', status)
      : await db.getAll('appeals')
    const profiles = await db.getAll('profiles')
    const byId = new Map<string, Profile>(profiles.map((p) => [p.id, p]))
    return byCreatedAtDesc(rows).map((row) => {
      const user = byId.get(row.appellantId)
      return {
        ...toAppeal(row),
        appellantId: row.appellantId,
        appellantUsername: user?.username ?? row.appellantId,
        appellantDisplayName: user?.displayName ?? row.appellantId,
      }
    })
  },

  async reviewAppeal(
    id: string,
    input: { outcome: Extract<AppealStatus, 'upheld' | 'rejected'>; note: string },
  ): Promise<{ appealId: string; status: AppealStatus; updatedAt: string }> {
    const staff = await requireStaff()
    if (input.note.trim().length === 0) throw new AppError(ErrorCodes.VALIDATION, '请填写复核意见')
    const db = await getDb()
    const row = await db.get('appeals', id)
    if (!row) throw new AppError(ErrorCodes.NOT_FOUND, '申诉不存在')
    if (row.status === 'upheld' || row.status === 'rejected') {
      throw new AppError(ErrorCodes.CONFLICT, '这条申诉已经复核过')
    }
    const reviewedAt = nowIso()
    await db.put('appeals', {
      ...row,
      status: input.outcome,
      reviewNote: input.note.trim(),
      reviewedAt,
    })

    // 申诉成立 = 原处理有误：关联处罚随之撤销（举报申诉则由服务端恢复内容，本地无内容可恢复）
    if (input.outcome === 'upheld' && row.sanctionId) {
      const sanction = await db.get('sanctions', row.sanctionId)
      if (sanction && sanction.status !== 'revoked') {
        await db.put('sanctions', { ...sanction, status: 'revoked', revokedAt: reviewedAt })
        await appendAction({
          action: 'sanction.revoke',
          actorId: staff.userId,
          targetType: 'sanction',
          targetId: sanction.id,
          reason: `申诉 ${id} 成立`,
        })
      }
    }

    await appendAction({
      action: 'appeal.review',
      actorId: staff.userId,
      targetType: 'appeal',
      targetId: id,
      reason: `${input.outcome} / ${input.note.trim()}`,
    })

    return { appealId: id, status: input.outcome, updatedAt: reviewedAt }
  },
}
