/**
 * 治理 P0 全链路集成测试（P0-13 → P0-19）。
 *
 * 串起来的正是产品闭环的每一环，缺一环用户就会遇到"石沉大海"：
 *   举报 → 回执(reportId) → 我的举报 → 审核队列/详情 → 认领 → 隐藏内容 → 处罚
 *   → 裁定 → 举报人收到通知(meta.outcome) → 受罚者看到处罚与通知
 *   → 受罚者申诉 → staff 复核(驳回) → 再次申诉 → 复核(成立) → 处罚撤销
 *   → 举报人申诉 → 复核成立 → 内容恢复可见 → 审计链完整
 *
 * 断言口径：只断言**对外契约**（HTTP 形状与库内可见状态），不断言实现细节，
 * 这样将来把函数拆成多表直查也不会误报。需要读库的地方一律用 admin 连接，
 * 因为 app_user 对 reports/user_sanctions/report_appeals 没有直接权限——
 * 那是设计意图，不是测试遗漏。
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test, { after, before } from 'node:test'
import pg from 'pg'

const { Client } = pg
const ORIGIN = 'http://127.0.0.1:5173'

const ADMIN_ID = 'c8100000-0000-4000-8000-000000000001'
const REPORTER_ID = 'c8100000-0000-4000-8000-000000000002'
const AUTHOR_ID = 'c8100000-0000-4000-8000-000000000003'
const OUTSIDER_ID = 'c8100000-0000-4000-8000-000000000004'

const ADMIN_SECRET = 'moderation-admin-session-secret-long-enough-01'
const REPORTER_SECRET = 'moderation-reporter-session-secret-long-enough-02'
const AUTHOR_SECRET = 'moderation-author-session-secret-long-enough-03'
const OUTSIDER_SECRET = 'moderation-outsider-session-secret-long-enough-04'
const CSRF = 'csrf-token-for-moderation-appeals-integration'

const PHOTO_ID = 'd8100000-0000-4000-8000-000000000001'
const PHOTO_APPEAL_ID = 'd8100000-0000-4000-8000-000000000002'

let app: Awaited<ReturnType<(typeof import('../index.js'))['buildApp']>>
let admin: pg.Client

let adminSessionId = ''
let reporterSessionId = ''
let authorSessionId = ''
let outsiderSessionId = ''

/** 跨用例传递的实体 id（node:test 顶层用例按声明顺序串行执行）。 */
let reportId = ''
let sanctionId = ''
let firstAppealId = ''
let secondAppealId = ''
let reportAppealReportId = ''
let reportAppealId = ''

function tokenHash(secret: string): string {
  return createHash('sha256').update(secret).digest('base64url')
}

function headers(sessionId: string, secret: string) {
  return {
    origin: ORIGIN,
    cookie: `gk_session=${sessionId}.${secret}; gy_csrf=${CSRF}`,
    'x-csrf-token': CSRF,
  }
}

function adminHeaders() {
  return headers(adminSessionId, ADMIN_SECRET)
}

async function seedSession(userId: string, secret: string): Promise<string> {
  const result = await admin.query<{ session_id: string }>(
    `select session_id from public.api_create_session($1,$2,now() + interval '2 hours',$3,$4)`,
    [userId, tokenHash(secret), 'moderation-appeals-integration', 'integration-ip'],
  )
  return result.rows[0]!.session_id
}

async function photoStatus(id: string): Promise<string> {
  const result = await admin.query<{ status: string }>('select status from public.photos where id=$1', [id])
  return result.rows[0]!.status
}

async function sanctionStatus(id: string): Promise<{ status: string; revoked_at: Date | null }> {
  const result = await admin.query<{ status: string; revoked_at: Date | null }>(
    'select status, revoked_at from public.user_sanctions where id=$1',
    [id],
  )
  return result.rows[0]!
}

/** 从通知列表里按 meta 键值挑出目标通知；找不到返回 undefined 便于 assert.ok 报错。 */
function findNotification(items: Array<Record<string, unknown>>, key: string, value: unknown) {
  return items.find((item) => {
    const meta = item.meta
    return typeof meta === 'object' && meta !== null && (meta as Record<string, unknown>)[key] === value
  })
}

before(async () => {
  process.env.STORAGE_CLEANUP_ENABLED = 'false'
  admin = new Client({
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT ?? 5432),
    database: process.env.PGDATABASE,
    user: process.env.PGADMIN_USER ?? 'postgres',
    password: process.env.PGADMIN_PASSWORD,
  })
  await admin.connect()

  await admin.query(
    `insert into auth.users (id,email,phone,password_hash,raw_user_meta_data) values
       ($1,'mod-admin@test.local','13910000001','$2b$12$moderationintegrationplaceholderhash0000000000','{"display_name":"Mod Admin"}'),
       ($2,'mod-reporter@test.local','13910000002','$2b$12$moderationintegrationplaceholderhash0000000000','{"display_name":"Mod Reporter"}'),
       ($3,'mod-author@test.local','13910000003','$2b$12$moderationintegrationplaceholderhash0000000000','{"display_name":"Mod Author"}'),
       ($4,'mod-outsider@test.local','13910000004','$2b$12$moderationintegrationplaceholderhash0000000000','{"display_name":"Mod Outsider"}')
     on conflict (id) do update set email=excluded.email, phone=excluded.phone`,
    // auth.users.ck_auth_users_pw_len 要求 20–255 字符：给一个占位哈希（本套件不走密码登录）
    [ADMIN_ID, REPORTER_ID, AUTHOR_ID, OUTSIDER_ID],
  )
  await admin.query(
    `insert into public.profiles (id,username,display_name,role) values
       ($1,'mod_admin','Mod Admin','admin'),
       ($2,'mod_reporter','Mod Reporter','user'),
       ($3,'mod_author','Mod Author','user'),
       ($4,'mod_outsider','Mod Outsider','user')
     on conflict (id) do update set username=excluded.username, display_name=excluded.display_name,
       role=excluded.role, deleted_at=null`,
    [ADMIN_ID, REPORTER_ID, AUTHOR_ID, OUTSIDER_ID],
  )
  await admin.query(
    `insert into public.photos
       (id,author_id,title,description,category_slug,image_key,thumb_key,width,height,status,published_at,deleted_at)
     values ($1,$2,'待审核作品','用于申诉链路的说明','landscape',$3,$4,1200,800,'published',now(),null),
            ($5,$2,'误报恢复作品','举报型申诉恢复可见性用','landscape',$6,$7,1200,800,'published',now(),null)
     on conflict (id) do update set status='published', published_at=now(), deleted_at=null`,
    [
      PHOTO_ID,
      AUTHOR_ID,
      `photos/${AUTHOR_ID}/${PHOTO_ID}/display.webp`,
      `photos/${AUTHOR_ID}/${PHOTO_ID}/thumb.webp`,
      PHOTO_APPEAL_ID,
      `photos/${AUTHOR_ID}/${PHOTO_APPEAL_ID}/display.webp`,
      `photos/${AUTHOR_ID}/${PHOTO_APPEAL_ID}/thumb.webp`,
    ],
  )

  adminSessionId = await seedSession(ADMIN_ID, ADMIN_SECRET)
  reporterSessionId = await seedSession(REPORTER_ID, REPORTER_SECRET)
  authorSessionId = await seedSession(AUTHOR_ID, AUTHOR_SECRET)
  outsiderSessionId = await seedSession(OUTSIDER_ID, OUTSIDER_SECRET)

  const { buildApp } = await import('../index.js')
  app = await buildApp()
})

after(async () => {
  await app?.close()
  await admin?.end()
})

test('举报提交返回回执 { reportId, status }，同一目标重复举报幂等', async () => {
  const first = await app.inject({
    method: 'POST',
    url: '/api/reports',
    headers: headers(reporterSessionId, REPORTER_SECRET),
    payload: { targetType: 'photo', targetId: PHOTO_ID, reason: 'explicit', detail: '作品涉嫌违规内容' },
  })
  assert.equal(first.statusCode, 200, first.body)
  const receipt = first.json() as { reportId: string; status: string }
  assert.match(receipt.reportId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  assert.equal(receipt.status, 'open')
  assert.equal(Object.hasOwn(receipt, 'id'), false, '回执不应泄露后端列名 id')
  reportId = receipt.reportId

  const duplicate = await app.inject({
    method: 'POST',
    url: '/api/reports',
    headers: headers(reporterSessionId, REPORTER_SECRET),
    payload: { targetType: 'photo', targetId: PHOTO_ID, reason: 'explicit', detail: '重复提交同一条举报' },
  })
  assert.equal(duplicate.statusCode, 200, duplicate.body)
  assert.equal(duplicate.json().reportId, reportId, '未结案期间的重复举报应复用同一条举报')
})

test('我的举报：本人可见、状态与目标正确，游客 401，旁人看不到', async () => {
  const mine = await app.inject({ method: 'GET', url: '/api/reports/mine', headers: headers(reporterSessionId, REPORTER_SECRET) })
  assert.equal(mine.statusCode, 200, mine.body)
  const item = (mine.json().items as Array<Record<string, unknown>>).find((row) => row.id === reportId)
  assert.ok(item, '我的举报应包含刚提交的举报')
  assert.equal(item.targetType, 'photo')
  assert.equal(item.targetId, PHOTO_ID)
  assert.equal(item.reason, 'explicit')
  assert.equal(item.status, 'open')
  assert.equal(item.appealStatus, null)
  assert.equal(item.resolvedAt, null)
  assert.ok(typeof item.createdAt === 'string' && item.createdAt.length > 0)

  const anonymous = await app.inject({ method: 'GET', url: '/api/reports/mine' })
  assert.equal(anonymous.statusCode, 401, anonymous.body)

  const outsider = await app.inject({ method: 'GET', url: '/api/reports/mine', headers: headers(outsiderSessionId, OUTSIDER_SECRET) })
  assert.equal(outsider.statusCode, 200, outsider.body)
  assert.equal((outsider.json().items as Array<Record<string, unknown>>).some((row) => row.id === reportId), false)
})

test('审核台：队列与详情带目标上下文，非 staff 403', async () => {
  const queue = await app.inject({ method: 'GET', url: '/api/admin/reports?status=open', headers: adminHeaders() })
  assert.equal(queue.statusCode, 200, queue.body)
  const row = (queue.json() as Array<Record<string, unknown>>).find((entry) => entry.id === reportId)
  assert.ok(row, '审核队列应包含待处理举报')
  const target = row.target as Record<string, unknown>
  assert.equal(target.kind, 'photo')
  assert.equal(target.id, PHOTO_ID)
  assert.equal(target.title, '待审核作品')
  assert.equal(target.hidden, false)
  assert.equal((row.reporter as Record<string, unknown>).username, 'mod_reporter')

  const detail = await app.inject({ method: 'GET', url: `/api/admin/reports/${reportId}`, headers: adminHeaders() })
  assert.equal(detail.statusCode, 200, detail.body)
  const body = detail.json() as { report: Record<string, unknown>; target: Record<string, unknown>; actions: unknown[] }
  assert.equal(body.report.id, reportId)
  assert.equal(body.report.status, 'open')
  assert.equal(body.target.kind, 'photo')
  assert.ok(Array.isArray(body.actions))

  const missing = await app.inject({
    method: 'GET',
    url: '/api/admin/reports/e8100000-0000-4000-8000-000000000009',
    headers: adminHeaders(),
  })
  assert.equal(missing.statusCode, 404, missing.body)

  const forbiddenQueue = await app.inject({ method: 'GET', url: '/api/admin/reports', headers: headers(reporterSessionId, REPORTER_SECRET) })
  assert.equal(forbiddenQueue.statusCode, 403, forbiddenQueue.body)

  const forbiddenDetail = await app.inject({
    method: 'GET',
    url: `/api/admin/reports/${reportId}`,
    headers: headers(reporterSessionId, REPORTER_SECRET),
  })
  assert.equal(forbiddenDetail.statusCode, 403, forbiddenDetail.body)

  const badStatus = await app.inject({ method: 'GET', url: '/api/admin/reports?status=nonsense', headers: adminHeaders() })
  assert.equal(badStatus.statusCode, 400, badStatus.body)
})

test('认领 → 隐藏内容 → 处罚 → 裁定 upheld，举报人收到带 meta.outcome 的通知', async () => {
  const claim = await app.inject({ method: 'POST', url: `/api/admin/reports/${reportId}/claim`, headers: adminHeaders() })
  assert.equal(claim.statusCode, 200, claim.body)

  const hide = await app.inject({
    method: 'POST',
    url: '/api/admin/moderation/visibility',
    headers: adminHeaders(),
    payload: { targetType: 'photo', targetId: PHOTO_ID, hidden: true, reason: '确认违规，先下架', reportId },
  })
  assert.equal(hide.statusCode, 200, hide.body)
  assert.equal(hide.json().ok, true)
  assert.equal(await photoStatus(PHOTO_ID), 'hidden')

  const sanction = await app.inject({
    method: 'POST',
    url: '/api/admin/sanctions',
    headers: adminHeaders(),
    payload: {
      userId: AUTHOR_ID,
      kind: 'content_restriction',
      reasonCode: 'explicit_content',
      reasonDetail: '上传违规内容，暂停发布权限',
      reportId,
    },
  })
  assert.equal(sanction.statusCode, 200, sanction.body)
  const sanctionRow = sanction.json() as { id: string; status: string; kind: string; related_report_id: string }
  sanctionId = sanctionRow.id
  assert.equal(sanctionRow.status, 'active')
  assert.equal(sanctionRow.kind, 'content_restriction')
  assert.equal(sanctionRow.related_report_id, reportId, 'P0-19：处罚必须能追溯到来源举报')

  const resolve = await app.inject({
    method: 'POST',
    url: `/api/admin/reports/${reportId}/resolve`,
    headers: adminHeaders(),
    payload: { outcome: 'upheld', resolutionCode: 'user_warned', reviewNote: '确认违规，已下架并限制发布' },
  })
  assert.equal(resolve.statusCode, 200, resolve.body)
  assert.equal((resolve.json() as Record<string, unknown>).status, 'upheld')

  // 举报人：结论 + 回执编号都能在通知里对上（P0-17）
  const notes = await app.inject({ method: 'GET', url: '/api/me/notifications', headers: headers(reporterSessionId, REPORTER_SECRET) })
  assert.equal(notes.statusCode, 200, notes.body)
  const items = notes.json().items as Array<Record<string, unknown>>
  const verdict = findNotification(items, 'reportId', reportId)
  assert.ok(verdict, '举报人应收到裁定通知')
  assert.equal(verdict.kind, 'system')
  assert.equal(verdict.actor, null)
  const verdictMeta = verdict.meta as Record<string, unknown>
  assert.equal(verdictMeta.outcome, 'upheld')
  assert.equal(verdictMeta.resolutionCode, 'user_warned')

  // 我的举报已结案，结论码对得上
  const mine = await app.inject({ method: 'GET', url: '/api/reports/mine', headers: headers(reporterSessionId, REPORTER_SECRET) })
  const closed = (mine.json().items as Array<Record<string, unknown>>).find((entry) => entry.id === reportId)!
  assert.equal(closed.status, 'upheld')
  assert.equal(closed.resolutionCode, 'user_warned')
  assert.equal(closed.reviewNote, '确认违规，已下架并限制发布')
  assert.ok(typeof closed.resolvedAt === 'string')

  // 目标上下文里 now 显示已隐藏
  const detail = await app.inject({ method: 'GET', url: `/api/admin/reports/${reportId}`, headers: adminHeaders() })
  const detailBody = detail.json() as { target: Record<string, unknown>; actions: Array<Record<string, unknown>> }
  assert.equal(detailBody.target.hidden, true)
  const actionNames = detailBody.actions.map((action) => action.action)
  assert.ok(actionNames.includes('claim_report'), actionNames.join(','))
  assert.ok(actionNames.includes('hide_photo'), actionNames.join(','))
  assert.ok(actionNames.includes('restrict_user'), actionNames.join(','))
  assert.ok(actionNames.includes('uphold_report'), actionNames.join(','))
})

test('受罚者：看到处罚与通知，申诉被驳回后仍可再申诉，复核成立则处罚撤销', async () => {
  const sanctions = await app.inject({ method: 'GET', url: '/api/me/sanctions', headers: headers(authorSessionId, AUTHOR_SECRET) })
  assert.equal(sanctions.statusCode, 200, sanctions.body)
  const sanction = (sanctions.json().items as Array<Record<string, unknown>>).find((row) => row.id === sanctionId)
  assert.ok(sanction, '受罚者应能看到自己的处罚')
  assert.equal(sanction.kind, 'content_restriction')
  assert.equal(sanction.status, 'active')
  assert.equal(sanction.reasonCode, 'explicit_content')
  assert.equal(sanction.appealStatus, null)
  assert.equal(sanction.revokedAt, null)
  assert.ok(typeof sanction.startsAt === 'string')
  // 非 suspension/ban 的处罚不设结束时间，前端按「长期有效直至撤销」展示
  assert.equal(sanction.endsAt, null)

  const notes = await app.inject({ method: 'GET', url: '/api/me/notifications', headers: headers(authorSessionId, AUTHOR_SECRET) })
  const sanctionNotice = findNotification(notes.json().items as Array<Record<string, unknown>>, 'sanctionId', sanctionId)
  assert.ok(sanctionNotice, '处罚生效应通知被处罚者')
  assert.equal((sanctionNotice.meta as Record<string, unknown>).kind, 'content_restriction')
  assert.equal((sanctionNotice.meta as Record<string, unknown>).reportId, reportId)

  // 越权与参数边界：别人的处罚 404、太短的说明 400
  // （这里故意用 /api/me/sanctions/:id 别名探测：两条路径共用同一处理器）
  const outsiderAttempt = await app.inject({
    method: 'POST',
    url: `/api/me/sanctions/${sanctionId}/appeal`,
    headers: headers(outsiderSessionId, OUTSIDER_SECRET),
    payload: { message: '这不是我的处罚，不应该能申诉成功' },
  })
  assert.equal(outsiderAttempt.statusCode, 404, outsiderAttempt.body)

  const tooShort = await app.inject({
    method: 'POST',
    url: `/api/sanctions/${sanctionId}/appeal`,
    headers: headers(authorSessionId, AUTHOR_SECRET),
    payload: { message: '太短' },
  })
  assert.equal(tooShort.statusCode, 400, tooShort.body)

  const submitted = await app.inject({
    method: 'POST',
    url: `/api/sanctions/${sanctionId}/appeal`,
    headers: headers(authorSessionId, AUTHOR_SECRET),
    payload: { message: '作品为本人原创，处罚认定有误，申请复核' },
  })
  assert.equal(submitted.statusCode, 200, submitted.body)
  const appeal = submitted.json() as { appealId: string; status: string; createdAt: string }
  assert.equal(appeal.status, 'open')
  assert.ok(typeof appeal.createdAt === 'string')
  firstAppealId = appeal.appealId

  // 未结案期间重复申诉 → 409（P0-19：避免同一事项无限申诉）
  const duplicated = await app.inject({
    method: 'POST',
    url: `/api/sanctions/${sanctionId}/appeal`,
    headers: headers(authorSessionId, AUTHOR_SECRET),
    payload: { message: '同样的理由再提交一次，应该被拒绝' },
  })
  assert.equal(duplicated.statusCode, 409, duplicated.body)

  const myAppeals = await app.inject({ method: 'GET', url: '/api/me/appeals', headers: headers(authorSessionId, AUTHOR_SECRET) })
  assert.equal(myAppeals.statusCode, 200, myAppeals.body)
  const mine = (myAppeals.json().items as Array<Record<string, unknown>>).find((row) => row.id === firstAppealId)
  assert.ok(mine, '我的申诉应包含刚提交的申诉')
  assert.equal(mine.sanctionId, sanctionId)
  assert.equal(mine.reportId, null)
  assert.equal(mine.status, 'open')
  assert.equal(mine.reviewedAt, null)

  // 处罚列表里申诉状态同步为 open
  const sanctionsAgain = await app.inject({ method: 'GET', url: '/api/me/sanctions', headers: headers(authorSessionId, AUTHOR_SECRET) })
  const withAppeal = (sanctionsAgain.json().items as Array<Record<string, unknown>>).find((row) => row.id === sanctionId)!
  assert.equal(withAppeal.appealStatus, 'open')

  // 管理端申诉列表：带申诉人资料
  const adminAppeals = await app.inject({ method: 'GET', url: '/api/admin/appeals?status=open', headers: adminHeaders() })
  assert.equal(adminAppeals.statusCode, 200, adminAppeals.body)
  const adminRow = (adminAppeals.json().items as Array<Record<string, unknown>>).find((row) => row.id === firstAppealId)
  assert.ok(adminRow, '管理端申诉列表应包含该申诉')
  assert.equal(adminRow.appellantUsername, 'mod_author')
  assert.equal(adminRow.appellantId, AUTHOR_ID)
  assert.equal(adminRow.sanctionId, sanctionId)

  const adminSanctions = await app.inject({ method: 'GET', url: '/api/admin/sanctions?status=active', headers: adminHeaders() })
  assert.equal(adminSanctions.statusCode, 200, adminSanctions.body)
  const adminSanction = (adminSanctions.json().items as Array<Record<string, unknown>>).find((row) => row.id === sanctionId)
  assert.ok(adminSanction, '管理端处罚列表应包含该处罚')
  assert.equal(adminSanction.username, 'mod_author')
  assert.equal(adminSanction.userId, AUTHOR_ID)

  // 复核驳回：处罚维持
  const rejected = await app.inject({
    method: 'POST',
    url: `/api/admin/appeals/${firstAppealId}/review`,
    headers: adminHeaders(),
    payload: { outcome: 'rejected', note: '证据充分，维持原处罚' },
  })
  assert.equal(rejected.statusCode, 200, rejected.body)
  assert.equal(rejected.json().status, 'rejected')
  assert.equal((await sanctionStatus(sanctionId)).status, 'active')
  assert.equal(await photoStatus(PHOTO_ID), 'hidden')

  // 已复核的申诉不能重复复核
  const twice = await app.inject({
    method: 'POST',
    url: `/api/admin/appeals/${firstAppealId}/review`,
    headers: adminHeaders(),
    payload: { outcome: 'upheld', note: '重复复核' },
  })
  assert.equal(twice.statusCode, 409, twice.body)

  // 结论通知回到申诉人
  const afterReject = await app.inject({ method: 'GET', url: '/api/me/notifications', headers: headers(authorSessionId, AUTHOR_SECRET) })
  const rejectNotice = findNotification(afterReject.json().items as Array<Record<string, unknown>>, 'appealId', firstAppealId)
  assert.ok(rejectNotice, '申诉结论应通知申诉人')
  assert.equal((rejectNotice.meta as Record<string, unknown>).status, 'rejected')

  // 结案后可再次申诉；这次复核成立 → 处罚撤销（P0-19 核心）
  const second = await app.inject({
    method: 'POST',
    url: `/api/sanctions/${sanctionId}/appeal`,
    headers: headers(authorSessionId, AUTHOR_SECRET),
    payload: { message: '补充了作品原始创作文件，再次申请复核' },
  })
  assert.equal(second.statusCode, 200, second.body)
  secondAppealId = (second.json() as { appealId: string }).appealId
  assert.notEqual(secondAppealId, firstAppealId)

  const upheld = await app.inject({
    method: 'POST',
    url: `/api/admin/appeals/${secondAppealId}/review`,
    headers: adminHeaders(),
    payload: { outcome: 'upheld', note: '复核确认误判，撤销处罚' },
  })
  assert.equal(upheld.statusCode, 200, upheld.body)
  assert.equal(upheld.json().status, 'upheld')
  assert.ok(typeof upheld.json().updatedAt === 'string')

  const revoked = await sanctionStatus(sanctionId)
  assert.equal(revoked.status, 'revoked')
  assert.ok(revoked.revoked_at instanceof Date, '撤销必须写 revoked_at')

  const sanctionsFinal = await app.inject({ method: 'GET', url: '/api/me/sanctions', headers: headers(authorSessionId, AUTHOR_SECRET) })
  const revokedRow = (sanctionsFinal.json().items as Array<Record<string, unknown>>).find((row) => row.id === sanctionId)!
  assert.equal(revokedRow.status, 'revoked')
  assert.equal(revokedRow.appealStatus, 'upheld')
  assert.ok(typeof revokedRow.revokedAt === 'string')

  const upheldNotice = await app.inject({ method: 'GET', url: '/api/me/notifications', headers: headers(authorSessionId, AUTHOR_SECRET) })
  const upheldItem = findNotification(upheldNotice.json().items as Array<Record<string, unknown>>, 'appealId', secondAppealId)
  assert.ok(upheldItem, '复核成立应通知申诉人')
  assert.equal((upheldItem.meta as Record<string, unknown>).status, 'upheld')
  assert.equal((upheldItem.meta as Record<string, unknown>).restored, 'sanction')
})

test('举报型申诉：复核成立恢复内容可见性，审计链可追溯全部动作', async () => {
  // 新的误报场景：举报人误报版权 → 管理员先下架止损 → 驳回举报 → 举报人申诉 → 复核成立恢复
  const submit = await app.inject({
    method: 'POST',
    url: '/api/reports',
    headers: headers(reporterSessionId, REPORTER_SECRET),
    payload: { targetType: 'photo', targetId: PHOTO_APPEAL_ID, reason: 'copyright', detail: '疑似未经授权转载' },
  })
  assert.equal(submit.statusCode, 200, submit.body)
  reportAppealReportId = (submit.json() as { reportId: string }).reportId

  const hide = await app.inject({
    method: 'POST',
    url: '/api/admin/moderation/visibility',
    headers: adminHeaders(),
    payload: { targetType: 'photo', targetId: PHOTO_APPEAL_ID, hidden: true, reason: '疑似侵权，先下架止损', reportId: reportAppealReportId },
  })
  assert.equal(hide.statusCode, 200, hide.body)
  assert.equal(await photoStatus(PHOTO_APPEAL_ID), 'hidden')

  const rejected = await app.inject({
    method: 'POST',
    url: `/api/admin/reports/${reportAppealReportId}/resolve`,
    headers: adminHeaders(),
    payload: { outcome: 'rejected', resolutionCode: 'no_violation', reviewNote: '经核实为授权素材，不构成侵权' },
  })
  assert.equal(rejected.statusCode, 200, rejected.body)

  // 旁人不能替举报人申诉
  const outsiderAttempt = await app.inject({
    method: 'POST',
    url: `/api/reports/${reportAppealReportId}/appeal`,
    headers: headers(outsiderSessionId, OUTSIDER_SECRET),
    payload: { message: '我不是举报人，这条申诉不该成功' },
  })
  assert.equal(outsiderAttempt.statusCode, 404, outsiderAttempt.body)

  const submitted = await app.inject({
    method: 'POST',
    url: `/api/reports/${reportAppealReportId}/appeal`,
    headers: headers(reporterSessionId, REPORTER_SECRET),
    payload: { message: '本人误报，素材已获授权，请恢复内容可见性' },
  })
  assert.equal(submitted.statusCode, 200, submitted.body)
  const appeal = submitted.json() as { appealId: string; status: string }
  assert.equal(appeal.status, 'open')
  reportAppealId = appeal.appealId

  // 我的举报里 appealStatus 同步
  const mine = await app.inject({ method: 'GET', url: '/api/reports/mine', headers: headers(reporterSessionId, REPORTER_SECRET) })
  const row = (mine.json().items as Array<Record<string, unknown>>).find((entry) => entry.id === reportAppealReportId)!
  assert.equal(row.appealStatus, 'open')

  const reviewed = await app.inject({
    method: 'POST',
    url: `/api/admin/appeals/${reportAppealId}/review`,
    headers: adminHeaders(),
    payload: { outcome: 'upheld', note: '确认误报，恢复内容可见性' },
  })
  assert.equal(reviewed.statusCode, 200, reviewed.body)
  assert.equal(reviewed.json().status, 'upheld')

  assert.equal(await photoStatus(PHOTO_APPEAL_ID), 'published', '申诉成立应恢复内容可见性')

  const detail = await app.inject({ method: 'GET', url: `/api/admin/reports/${reportAppealReportId}`, headers: adminHeaders() })
  const detailBody = detail.json() as { actions: Array<Record<string, unknown>> }
  const names = detailBody.actions.map((action) => action.action)
  assert.ok(names.includes('hide_photo'), names.join(','))
  assert.ok(names.includes('reject_report'), names.join(','))
  assert.ok(names.includes('restore_photo'), names.join(','))
  assert.ok(names.includes('review_appeal'), names.join(','))

  const appealRow = detailBody.actions.find((action) => action.action === 'review_appeal')!
  assert.equal(appealRow.targetType, 'report')
  assert.equal(appealRow.targetId, reportAppealReportId)

  const notes = await app.inject({ method: 'GET', url: '/api/me/notifications', headers: headers(reporterSessionId, REPORTER_SECRET) })
  const notice = findNotification(notes.json().items as Array<Record<string, unknown>>, 'appealId', reportAppealId)
  assert.ok(notice, '举报人应收到申诉结论通知')
  assert.equal((notice.meta as Record<string, unknown>).restored, 'photo')

  const myAppeals = await app.inject({ method: 'GET', url: '/api/me/appeals', headers: headers(reporterSessionId, REPORTER_SECRET) })
  const appealItem = (myAppeals.json().items as Array<Record<string, unknown>>).find((entry) => entry.id === reportAppealId)!
  assert.equal(appealItem.reportId, reportAppealReportId)
  assert.equal(appealItem.status, 'upheld')
  assert.equal(appealItem.reviewNote, '确认误报，恢复内容可见性')
  assert.ok(typeof appealItem.reviewedAt === 'string')
})

test('权限与参数边界：非 staff 不能复核，非法 outcome/status 一律 400', async () => {
  const nonStaff = await app.inject({
    method: 'POST',
    url: `/api/admin/appeals/${secondAppealId}/review`,
    headers: headers(reporterSessionId, REPORTER_SECRET),
    payload: { outcome: 'upheld', note: '非 staff 不应通过' },
  })
  assert.equal(nonStaff.statusCode, 403, nonStaff.body)

  const anonymous = await app.inject({
    method: 'POST',
    url: `/api/admin/appeals/${secondAppealId}/review`,
    // 带来源与 CSRF 头但不带会话 cookie：这样才走到鉴权层拿到 401，
    // 否则会先被 CSRF/来源校验拦成 403，测不到"未登录"这条语义。
    headers: { origin: ORIGIN, 'x-csrf-token': CSRF },
    payload: { outcome: 'upheld', note: '游客不应通过' },
  })
  assert.equal(anonymous.statusCode, 401, anonymous.body)

  const badOutcome = await app.inject({
    method: 'POST',
    url: '/api/admin/appeals/e8100000-0000-4000-8000-000000000010/review',
    headers: adminHeaders(),
    payload: { outcome: 'maybe', note: '非法结论' },
  })
  assert.equal(badOutcome.statusCode, 400, badOutcome.body)

  const missingAppeal = await app.inject({
    method: 'POST',
    url: '/api/admin/appeals/e8100000-0000-4000-8000-000000000010/review',
    headers: adminHeaders(),
    payload: { outcome: 'upheld', note: '不存在的申诉' },
  })
  assert.equal(missingAppeal.statusCode, 404, missingAppeal.body)

  const badSanctionFilter = await app.inject({ method: 'GET', url: '/api/admin/sanctions?status=nonsense', headers: adminHeaders() })
  assert.equal(badSanctionFilter.statusCode, 400, badSanctionFilter.body)

  const badAppealFilter = await app.inject({ method: 'GET', url: '/api/admin/appeals?status=nonsense', headers: adminHeaders() })
  assert.equal(badAppealFilter.statusCode, 400, badAppealFilter.body)

  const outsiderAppeals = await app.inject({ method: 'GET', url: '/api/me/appeals', headers: headers(outsiderSessionId, OUTSIDER_SECRET) })
  assert.equal(outsiderAppeals.statusCode, 200, outsiderAppeals.body)
  assert.equal((outsiderAppeals.json().items as Array<Record<string, unknown>>).length, 0, '旁人不应看到他人申诉')

  // 举报被驳回后仍可申诉，但申诉说明超长要在路由层拦住
  const tooLong = await app.inject({
    method: 'POST',
    url: `/api/reports/${reportAppealReportId}/appeal`,
    headers: headers(reporterSessionId, REPORTER_SECRET),
    payload: { message: 'x'.repeat(2001) },
  })
  assert.equal(tooLong.statusCode, 400, tooLong.body)
})

test('边界已修复（0026）：suspension 生效后仍可登录，并能在站内读到处罚、提交申诉', async () => {
  // 历史：0015 的 api_create_session 对生效中的 suspension/ban 一律拒绝签会话，
  // 结果是被暂停/封禁的人进不了站，也就无法查看处罚、提交申诉 —— P0-18/P0-19 无法闭环。
  // 0026 把"能不能进来"与"能不能写"拆开：登录/浏览/举报/申诉永远放行，
  // 发布与互动改由 server 的写守卫按处罚分级拦截。
  // 这里把新契约固定成断言，避免日后有人以"封禁更安全"为由把登录墙加回来。
  const expectedEndsAt = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString()
  const applied = await app.inject({
    method: 'POST',
    url: '/api/admin/sanctions',
    headers: adminHeaders(),
    payload: {
      userId: OUTSIDER_ID,
      kind: 'suspension',
      reasonCode: 'abuse',
      reasonDetail: '恶意骚扰他人',
      endsAt: expectedEndsAt,
    },
  })
  assert.equal(applied.statusCode, 200, applied.body)
  const sanction = applied.json() as { id: string; ends_at: string }

  // 1) 处罚生效期间仍然签得出会话（不再抛"账号当前不可登录"）
  // 注意：会话 cookie 的 secret 必须 ≥32 字符，否则 resolveSession 的 parseCookie 直接判非法，
  // 表现成「登录态读不到」而与处罚无关（第一版用了 23 字符的 secret 才踩到）。
  const gapSecret = 'mod-outsider-gap-secret-0123456789abcdef'
  const gapSessionId = await seedSession(OUTSIDER_ID, gapSecret)
  assert.ok(gapSessionId, 'suspension 生效期间必须仍可签出新会话')

  // 2) 登录态里读得到这条暂停（前端横幅与 /me/moderation 都靠它）
  const session = await app.inject({
    method: 'GET',
    url: '/api/auth/session',
    headers: headers(gapSessionId, gapSecret),
  })
  assert.equal(session.statusCode, 200, session.body)
  const restriction = (session.json() as { restriction: Record<string, unknown> | null }).restriction
  assert.ok(restriction, '受限账号的登录态必须带 restriction')
  assert.equal(restriction.kind, 'suspension')
  assert.equal(
    Math.abs(Date.parse(String(restriction.endsAt)) - Date.parse(expectedEndsAt)) < 5000,
    true,
    'restriction.endsAt 应与处罚的结束时间一致',
  )

  // 3) 站内提交申诉 —— P0-19 的闭环入口
  const appeal = await app.inject({
    method: 'POST',
    url: `/api/me/sanctions/${sanction.id}/appeal`,
    headers: headers(gapSessionId, gapSecret),
    payload: { message: '停用期间提交的申诉：请复核本次认定的依据与证据。' },
  })
  assert.equal(appeal.statusCode, 200, appeal.body)
  assert.match((appeal.json() as { appealId: string }).appealId, /^[0-9a-f-]{36}$/)
})
