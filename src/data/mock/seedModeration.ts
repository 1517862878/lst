/**
 * 8.2 治理演示数据（举报 / 处罚 / 申诉 / 审计）。
 *
 * 三条硬约束：
 *   1) 不消耗 seed.ts 里的 rand() —— 一旦消耗，已有种子（作品标题、点赞数）会整体漂移，
 *      E2E 与契约测试都按这些值断言。
 *   2) 只引用确定性 id：seed-user-N / seed-photo-NNN / seed-comment-N，全部来自
 *      buildSeedData() 的产出，不写死枚举顺序之外的假设（作者是随机挑的，
 *      所以目标的作者一律从数据里现算，而不是假设「photo-001 属于某个人」）。
 *   3) 时间戳相对「播种时刻」计算，页面上的相对时间才说得通。
 */
import type { Comment, ModerationAction, Photo, Profile, Report } from '@/domain/types'
import type { AppealRow, SanctionRow } from './db'

const HOUR = 3_600_000
const DAY = 24 * HOUR

const iso = (t: number): string => new Date(t).toISOString()

/** 可被举报者本人以外的目标：作者不等于 reporter 的第一条 */
function firstForeign<T extends { authorId: string }>(items: T[], reporterId: string): T | null {
  return items.find((item) => item.authorId !== reporterId) ?? null
}

export interface ModerationSeedResult {
  reports: Array<Report & { reporterId: string | null }>
  sanctions: SanctionRow[]
  appeals: AppealRow[]
  moderationActions: ModerationAction[]
}

export function buildModerationSeed(
  profiles: Profile[],
  photos: Photo[],
  comments: Comment[],
  now: number,
): ModerationSeedResult {
  const alice = profiles[0]!
  const bob = profiles[1]!
  const editor = profiles[2]!
  const fourth = profiles[3]!
  const fifth = profiles[4]!

  const foreignPhotoForAlice = firstForeign(photos, alice.id)
  const foreignPhotoForFourth = firstForeign(photos, fourth.id)
  const foreignCommentForBob =
    comments.find((c) => c.authorId !== bob.id && c.status === 'visible') ?? null

  const reports: Array<Report & { reporterId: string | null }> = []
  const pushReport = (
    report: Omit<Report, 'updatedAt'> & { reporterId: string | null },
  ): void => {
    reports.push({ ...report, updatedAt: report.resolvedAt ?? report.createdAt })
  }

  if (foreignPhotoForAlice) {
    pushReport({
      id: 'seed-report-1',
      reporterId: alice.id,
      targetType: 'photo',
      targetId: foreignPhotoForAlice.id,
      reason: 'copyright',
      detail: '这张图和我在图库网站上发布的作品高度相似，怀疑是未授权转载。',
      status: 'open',
      assignedTo: null,
      reviewNote: null,
      resolutionCode: null,
      createdAt: iso(now - 6 * HOUR),
      resolvedAt: null,
    })
  }

  if (foreignPhotoForFourth) {
    pushReport({
      id: 'seed-report-4',
      reporterId: fourth.id,
      targetType: 'photo',
      targetId: foreignPhotoForFourth.id,
      reason: 'spam',
      detail: '标题和描述里塞了外部推广链接。',
      status: 'open',
      assignedTo: null,
      reviewNote: null,
      resolutionCode: null,
      createdAt: iso(now - 2 * HOUR),
      resolvedAt: null,
    })
  }

  if (foreignCommentForBob) {
    pushReport({
      id: 'seed-report-2',
      reporterId: bob.id,
      targetType: 'comment',
      targetId: foreignCommentForBob.id,
      reason: 'abuse',
      detail: '评论里指名道姓地侮辱作者。',
      status: 'upheld',
      assignedTo: editor.id,
      reviewNote: '已对被举报人发出警告处罚。',
      resolutionCode: 'warning_issued',
      createdAt: iso(now - 3 * DAY),
      resolvedAt: iso(now - 2 * DAY),
    })
  }

  pushReport({
    id: 'seed-report-3',
    reporterId: alice.id,
    targetType: 'profile',
    targetId: fifth.id,
    reason: 'spam',
    detail: '主页简介里放了拉人进群的广告。',
    status: 'reviewing',
    assignedTo: editor.id,
    reviewNote: null,
    resolutionCode: null,
    createdAt: iso(now - DAY),
    resolvedAt: null,
  })

  const sanctions: SanctionRow[] = [
    {
      id: 'seed-sanction-1',
      userId: bob.id,
      createdBy: editor.id,
      kind: 'warning',
      reasonCode: 'abuse',
      reasonDetail: '评论区人身攻击（关联举报 seed-report-2）',
      status: 'active',
      startsAt: iso(now - 2 * DAY),
      endsAt: null,
      revokedAt: null,
      appealStatus: 'open',
      createdAt: iso(now - 2 * DAY),
    },
    {
      id: 'seed-sanction-2',
      userId: fourth.id,
      createdBy: editor.id,
      kind: 'content_restriction',
      reasonCode: 'spam',
      reasonDetail: '多次在作品描述里投放外部广告',
      status: 'active',
      startsAt: iso(now - 5 * DAY),
      endsAt: iso(now + 2 * DAY),
      revokedAt: null,
      appealStatus: 'reviewing',
      createdAt: iso(now - 5 * DAY),
    },
  ]

  const appeals: AppealRow[] = [
    {
      id: 'seed-appeal-1',
      appellantId: bob.id,
      sanctionId: 'seed-sanction-1',
      reportId: null,
      message: '那条评论是在回怼先骂我的人，谈不上人身攻击，希望复核。',
      status: 'open',
      reviewNote: '',
      createdAt: iso(now - DAY),
      reviewedAt: null,
    },
    {
      id: 'seed-appeal-2',
      appellantId: fourth.id,
      sanctionId: 'seed-sanction-2',
      reportId: null,
      message: '链接是摄影器材的官方参数页，不是广告。',
      status: 'reviewing',
      reviewNote: '',
      createdAt: iso(now - 4 * DAY),
      reviewedAt: null,
    },
  ]

  const moderationActions: ModerationAction[] = [
    {
      id: 'seed-action-1',
      action: 'report.claim',
      actorId: editor.id,
      targetType: 'report',
      targetId: 'seed-report-2',
      reason: '认领处理',
      createdAt: iso(now - 3 * DAY + HOUR),
    },
    {
      id: 'seed-action-2',
      action: 'report.resolve',
      actorId: editor.id,
      targetType: 'report',
      targetId: 'seed-report-2',
      reason: 'upheld / warning_issued',
      createdAt: iso(now - 2 * DAY),
    },
    {
      id: 'seed-action-3',
      action: 'sanction.create',
      actorId: editor.id,
      targetType: 'sanction',
      targetId: 'seed-sanction-1',
      reason: 'abuse',
      createdAt: iso(now - 2 * DAY),
    },
    {
      id: 'seed-action-4',
      action: 'report.claim',
      actorId: editor.id,
      targetType: 'report',
      targetId: 'seed-report-3',
      reason: '认领处理',
      createdAt: iso(now - DAY + HOUR),
    },
  ]

  return { reports, sanctions, appeals, moderationActions }
}
