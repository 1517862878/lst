/**
 * 处罚分级与写接口守卫（8.2 补口后端）。
 *
 * 背景：0015 在 api_create_session 里对生效中的 suspension/ban 直接 42501，
 * 结果是"处罚 = 站内不可达"，P0-18（处罚透明）与 P0-19（申诉复核）对这两类处罚
 * 永远无法闭环 —— 用户连申诉页面都打不开。0026 把处罚从登录环节挪到这里：
 * **登录放行、浏览放行、举报与申诉放行，只拦写。**
 *
 * 分级表（.tmp/phase82-addendum.md 冻结，改动须同步文档与前端文案）：
 *
 *   kind                 | auth | report | appeal | content | interaction | notification | generic
 *   ---------------------+------+--------+--------+---------+-------------+--------------+--------
 *   warning              |  -   |   -    |   -    |    -    |      -      |      -       |    -      （不拦任何东西）
 *   content_restriction  |  -   |   -    |   -    |   拦    |      -      |      -       |    -
 *   suspension           |  -   |   -    |   -    |   拦    |      拦     |      拦      |    拦
 *   ban                  |  -   |   -    |   -    |   拦    |      拦     |      拦      |    拦
 *
 * 为什么 auth/report/appeal 三类对任何 kind 都放行：
 *   - auth：不能登录就申诉不了，处罚会变成"永久黑洞"；
 *   - report：举报他人是公共责任，不该因为自己受罚而关闭；
 *   - appeal：申诉入口必须永远可达，否则等于剥夺救济权。
 *
 * 为什么 content_restriction 不拦 interaction：内容限制的语义是"不许发布"，
 * 浏览、点赞、评论、关注仍然允许（契约 §分级表）。而 suspension 是"暂停使用"，
 * 互动一并关闭；ban 是封禁，全部写操作关闭。
 *
 * 实现要点：
 *   1) 只拦写方法。GET/HEAD/OPTIONS 一律放行 —— 读接口另有可见性规则，不在此处叠加。
 *   2) 守卫在 onRequest 阶段跑，早于 body 解析与业务校验：受限用户提交任何写请求
 *      都拿到同一个 403（带 sanctionKind/endsAt），而不是先被参数校验刷成 400，
 *      前端因此只需要一处映射就能给出稳定的"你被限制到 X"提示。
 *   3) 会话与处罚都做**请求级缓存**：守卫解析出的会话被 requireUser/currentUser 复用，
 *      处罚查询结果被 /api/auth/session 复用，一个请求最多各查一次。
 *   4) 未知 kind 按最严处理（fail closed）：DB 里只有四种 CHECK 值，真出现第五种
 *      说明数据异常或迁移漂移，此时放行写操作的风险远大于误拦。
 */
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { sessionOf } from './auth.js'
import { ApiError } from './errors.js'
import { activeRestriction, type ActiveRestriction } from '../repositories/moderation.js'

/** 与 public.user_sanctions.kind 的 CHECK 一致。 */
export type RestrictionKind = 'warning' | 'content_restriction' | 'suspension' | 'ban'

/** 写操作的语义分类。分级拦截与文案都按它走，而不是按具体路由硬编码。 */
export type WriteClass = 'auth' | 'report' | 'appeal' | 'notification' | 'content' | 'interaction' | 'generic'

/** 会话响应里的 restriction 字段（null 表示当前无生效处罚）。 */
export interface RestrictionView {
  kind: RestrictionKind
  reasonCode: string
  reasonDetail: string
  endsAt: string | null
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** 无论何种处罚都必须放行的三类（见文件头说明）。 */
const ALWAYS_ALLOWED: ReadonlySet<WriteClass> = new Set<WriteClass>(['auth', 'report', 'appeal'])

/** 访问控制类写操作：登录族 + 改密 + 会话管理 + 注销账号。 */
const AUTH_PATHS = new Set([
  '/api/me/password',
  '/api/me/sessions',
  '/api/me/account',
])

const REPORT_PATH = '/api/reports'
const APPEAL_RE = /^\/api\/(?:reports|sanctions|me\/sanctions)\/[^/]+\/appeal$/
const INTERACTION_PHOTO_RE = /^\/api\/photos\/[^/]+\/(?:like|favorite|comments)$/
const INTERACTION_PROFILE_RE = /^\/api\/profiles\/[^/]+\/(?:follow|block)$/

/**
 * 把一次写请求归到分级类别。
 *
 * @param method HTTP 方法（大小写不敏感）。安全方法也支持，返回的仍是"该路径的写类别"，
 *               便于复用与单测；是否拦截由调用方先按方法筛一次。
 * @param url    请求 URL，可带查询串（会先剥掉）。
 *
 * 归类规则（契约 §分级表 的实现）：
 *   /api/auth/**                              → auth          （登录/注册/登出/发码/改密/重置）
 *   /api/me/password、/api/me/sessions/**     → auth          （改密与会话管理同属访问控制）
 *   /api/me/account                           → auth          （注销账号：处罚不应把人锁在站内）
 *   /api/reports（POST）                      → report
 *   /api/{reports,sanctions,me/sanctions}/:id/appeal → appeal
 *   /api/me/notifications/**                  → notification  （标记已读等）
 *   /api/photos、/api/photos/:id[/publish]    → content       （发布/编辑/撤回作品）
 *   /api/photos/:id/{like,favorite,comments}  → interaction   （互动）
 *   /api/comments/**                          → interaction
 *   /api/profiles/:username/{follow,block}    → interaction   （关注/拉黑）
 *   /api/storage/**                           → content       （上传即内容生产的第一步，
 *                                                             归 content 才能让"限制发布"真的拦住上传）
 *   其余写                                    → generic       （资料/偏好/管理后台等）
 */
export function classifyWrite(method: string, url: string): WriteClass {
  void method // 方法不改变类别，只决定是否拦截；保留参数是为了调用点可读。
  const path = url.split('?')[0] ?? ''

  if (path === '/api/auth' || path.startsWith('/api/auth/')) return 'auth'
  if (AUTH_PATHS.has(path)) return 'auth'
  if (path.startsWith('/api/me/sessions/')) return 'auth'

  if (path === REPORT_PATH) return 'report'
  if (APPEAL_RE.test(path)) return 'appeal'

  if (path.startsWith('/api/me/notifications')) return 'notification'

  if (path === '/api/photos' || path.startsWith('/api/photos/')) {
    return INTERACTION_PHOTO_RE.test(path) ? 'interaction' : 'content'
  }
  if (path === '/api/comments' || path.startsWith('/api/comments/')) return 'interaction'
  if (INTERACTION_PROFILE_RE.test(path)) return 'interaction'

  if (path.startsWith('/api/storage/')) return 'content'

  return 'generic'
}

/**
 * 该处罚是否拦截该类写操作。
 *
 * @param kind   当前最严重的一条生效处罚；null/undefined 表示无处罚 → 永不拦截。
 * @param write  写类别（classifyWrite 的结果）。
 */
export function isBlocked(kind: RestrictionKind | string | null | undefined, write: WriteClass): boolean {
  if (!kind) return false
  if (ALWAYS_ALLOWED.has(write)) return false
  if (kind === 'warning') return false
  if (kind === 'content_restriction') return write === 'content'
  // suspension / ban / 未知值：除访问控制、举报、申诉外一律拦（fail closed）。
  return write === 'content' || write === 'interaction' || write === 'notification' || write === 'generic'
}

/**
 * 403 的用户可见文案。刻意说清"还能做什么"和"去哪里申诉"：
 * 处罚页与拦截提示是受限用户仅剩的出口，只说"你被禁止"会让人以为封号了。
 */
export function blockMessage(kind: RestrictionKind | string): string {
  switch (kind) {
    case 'content_restriction':
      return '你的账号当前被限制发布内容：仍可浏览、点赞、评论、举报和申诉，但暂时不能发布、编辑或撤回作品。如有异议，可在「举报与处罚」页提交申诉。'
    case 'suspension':
      return '你的账号当前被暂停使用：仍可浏览、举报和申诉，但暂时不能发布内容、互动（点赞/收藏/评论/关注/拉黑），也不能标记通知已读。如有异议，可在「举报与处罚」页提交申诉。'
    case 'ban':
      return '你的账号当前被封禁：仍可浏览、举报和申诉，但发布内容、互动与通知操作均已关闭。如有异议，可在「举报与处罚」页提交申诉。'
    default:
      // warning 不会走到这里（isBlocked 恒为 false）；保留兜底文案防未知 kind。
      return '你的账号当前受限，该操作暂不可用。如有异议，可在「举报与处罚」页提交申诉。'
  }
}

/** 会话响应里的 restriction 形状；对外只暴露前端需要的四个字段。 */
export function toRestrictionView(restriction: ActiveRestriction | null): RestrictionView | null {
  if (!restriction) return null
  return {
    kind: restriction.kind,
    reasonCode: restriction.reasonCode,
    reasonDetail: restriction.reasonDetail,
    endsAt: restriction.endsAt,
  }
}

/**
 * 请求级处罚缓存。
 *
 * 同一请求里守卫（onRequest）与 /api/auth/session 都会问"我有没有生效处罚"，
 * 缓存成 Promise 后只查一次库。用 WeakMap 挂在 request 上：请求结束即可回收，
 * 不存在跨请求串味的可能（对比：放在 app 上按 userId 做 TTL 缓存，撤销处罚后
 * 会有一段时间仍然拦截，那才是真正的问题）。
 */
const restrictionCache = new WeakMap<FastifyRequest, Promise<ActiveRestriction | null>>()

/**
 * 当前请求所属用户的生效处罚（最严重一条），无会话或无处罚返回 null。
 * 会话解析复用 sessionOf 的请求级缓存，因此不会重复解析 Cookie。
 */
export function restrictionFor(req: FastifyRequest): Promise<ActiveRestriction | null> {
  const cached = restrictionCache.get(req)
  if (cached) return cached
  const pending = (async (): Promise<ActiveRestriction | null> => {
    const session = await sessionOf(req)
    if (!session) return null
    return activeRestriction(session.userId)
  })()
  restrictionCache.set(req, pending)
  return pending
}

/**
 * 注册写操作守卫。
 *
 * 挂在 onRequest：比 body 解析和参数校验都早，受限用户的任何写请求都稳定拿 403，
 * 不会因为参数不全先变成 400。抛 ApiError 而不是直接 reply.send，是为了复用
 * index.ts 里统一的 { code, message, details } 错误信封（含日志）。
 *
 * 必须注册在 registerRequestSecurity 之后：Origin/CSRF 是零成本的纯 header 校验，
 * 先挡掉跨站请求，再花一次数据库查询判处罚。
 */
export function registerRestrictionGuard(app: FastifyInstance): void {
  app.addHook('onRequest', async (req: FastifyRequest) => {
    if (SAFE_METHODS.has(req.method)) return
    const path = req.url.split('?')[0] ?? ''
    // 非 /api/ 前缀（静态图片、健康检查等）不走业务守卫
    if (!path.startsWith('/api/')) return

    const write = classifyWrite(req.method, path)
    // 永远放行的三类不查库：登录/登出/改密本身不该产生一次处罚查询
    if (ALWAYS_ALLOWED.has(write)) return

    const restriction = await restrictionFor(req)
    if (!restriction || !isBlocked(restriction.kind, write)) return

    req.log.info(
      { userId: undefined, write, sanctionKind: restriction.kind, url: req.url },
      '写操作被处罚限制拦截',
    )
    throw new ApiError('FORBIDDEN', blockMessage(restriction.kind), {
      sanctionKind: restriction.kind,
      endsAt: restriction.endsAt,
    })
  })
}
