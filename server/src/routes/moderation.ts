import type { FastifyInstance } from 'fastify'
import { requireUser } from '../lib/auth.js'
import { forbidden, validation } from '../lib/errors.js'
import * as moderation from '../repositories/moderation.js'

function body(req: { body?: unknown }): Record<string, unknown> {
  return typeof req.body === 'object' && req.body !== null ? req.body as Record<string,unknown> : {}
}
function text(b: Record<string,unknown>, key: string, max=1000): string {
  const v=typeof b[key]==='string' ? String(b[key]).trim() : ''
  if (!v || v.length>max) throw validation(`${key} 不合法`)
  return v
}
function requestId(req: { id: string | number }) { return String(req.id).slice(0,128) }

const REPORT_STATUSES = ['open','reviewing','upheld','rejected'] as const
const ADMIN_RATE_LIMIT = { max:30,timeWindow:'1 minute' } as const

function isStaff(role: unknown): boolean { return role === 'editor' || role === 'admin' }

/**
 * 申诉正文：冻结契约 10–2000 字。这里先拦一道给出可读错误，
 * 库内 ck_report_appeals_message_len 仍是最终防线（23514 → VALIDATION）。
 */
function appealMessage(b: Record<string,unknown>): string {
  const v = typeof b.message === 'string' ? b.message.trim() : ''
  if (v.length < 10 || v.length > 2000) throw validation('申诉说明需 10–2000 字')
  return v
}

/** 列表筛选参数白名单：不认识的状态直接 400，避免把脏值带进 SQL 白名单分支。 */
function statusFilter(value: string | undefined, allowed: readonly string[], label='status'): string | undefined {
  if (!value) return undefined
  if (!allowed.includes(value)) throw validation(`${label} 不合法`)
  return value
}

export async function registerModerationRoutes(app: FastifyInstance) {
  app.post('/api/reports', { config:{ rateLimit:{ max:10,timeWindow:'1 hour' } } }, async req => {
    const user=await requireUser(req), b=body(req)
    const targetType=text(b,'targetType',20), reason=text(b,'reason',20)
    if (!['photo','comment','profile'].includes(targetType)) throw validation('targetType 不合法')
    if (!['copyright','explicit','spam','abuse','other'].includes(reason)) throw validation('reason 不合法')
    // 响应已被仓库层收敛成回执形状 { reportId, status }（前端用它展示回执编号）。
    return moderation.submitReport(user.userId,{targetType,targetId:text(b,'targetId',36),reason,detail:typeof b.detail==='string'?b.detail.trim().slice(0,500):''})
  })

  // -------------------------------------------------------------------------
  // 用户侧（P0-17 举报回执 / P0-18 我的处罚 / P0-19 申诉）
  // -------------------------------------------------------------------------

  /** 我的举报：含本人对该举报的最新申诉状态，用于决定"申诉"按钮是否可点。 */
  app.get('/api/reports/mine', async req => {
    const user=await requireUser(req)
    return { items: await moderation.myReports(user.userId) }
  })

  /** 就某条举报提交申诉（驳回后申诉的主路径）。 */
  app.post<{Params:{id:string}}>('/api/reports/:id/appeal', { config:{ rateLimit:{ max:5,timeWindow:'1 hour' } } }, async req => {
    const user=await requireUser(req)
    const appeal = await moderation.submitAppeal(user.userId,{reportId:req.params.id,message:appealMessage(body(req))})
    return appeal
  })

  /**
   * 就某项处罚提交申诉。
   * 冻结契约的 8 个端点只给了 /api/reports/:id/appeal，但处罚的承担者并不是举报人，
   * 走举报入口必然 P0002；P0-19 要求"每项处罚可追溯对应申诉"，故补这一条最小路由，
   * 语义与 api_submit_appeal 的 sanction 分支完全一致（归属与去重仍在库内判定）。
   *
   * 同时挂 /api/sanctions/:id 与 /api/me/sanctions/:id 两个路径：
   * 前端仓储按"与举报对称"的命名用了前者，/api/me 前缀则与 /api/me/sanctions 列表同族，
   * 两者指向同一个处理器，避免因为一个字符串让整套申诉流程不可用。
   */
  const submitSanctionAppeal = async (userId: string, sanctionId: string, raw: unknown) =>
    moderation.submitAppeal(userId, { sanctionId, message: appealMessage(body({ body: raw })) })

  app.post<{Params:{id:string}}>('/api/sanctions/:id/appeal', { config:{ rateLimit:{ max:5,timeWindow:'1 hour' } } }, async req => {
    const user = await requireUser(req)
    return submitSanctionAppeal(user.userId, req.params.id, req.body)
  })
  app.post<{Params:{id:string}}>('/api/me/sanctions/:id/appeal', { config:{ rateLimit:{ max:5,timeWindow:'1 hour' } } }, async req => {
    const user = await requireUser(req)
    return submitSanctionAppeal(user.userId, req.params.id, req.body)
  })

  app.get('/api/me/appeals', async req => {
    const user=await requireUser(req)
    return { items: await moderation.myAppeals(user.userId) }
  })

  app.get('/api/me/sanctions', async req => {
    const user=await requireUser(req)
    return { items: await moderation.mySanctions(user.userId) }
  })

  // -------------------------------------------------------------------------
  // 管理端
  // -------------------------------------------------------------------------

  app.get<{Querystring:{status?:string}}>('/api/admin/reports', async req => {
    const user=await requireUser(req); if (!isStaff(user.role)) throw forbidden('需要审核权限')
    return moderation.listReports(user.userId,statusFilter(req.query.status,REPORT_STATUSES))
  })

  /** 举报详情：举报 + 目标上下文 + 审计时间线，一次请求喂满审核详情面板。 */
  app.get<{Params:{id:string}}>('/api/admin/reports/:id', async req => {
    const user=await requireUser(req); if (!isStaff(user.role)) throw forbidden('需要审核权限')
    return moderation.adminReportDetail(user.userId,req.params.id)
  })

  app.post<{Params:{id:string}}>('/api/admin/reports/:id/claim', { config:{ rateLimit:ADMIN_RATE_LIMIT } }, async req => {
    const user=await requireUser(req); if (!isStaff(user.role)) throw forbidden('需要审核权限')
    return moderation.claimReport(user.userId,req.params.id,requestId(req))
  })
  app.post('/api/admin/moderation/visibility', { config:{ rateLimit:ADMIN_RATE_LIMIT } }, async req => {
    const user=await requireUser(req); if (!isStaff(user.role)) throw forbidden('需要审核权限')
    const b=body(req), targetType=text(b,'targetType',20)
    if (!['photo','comment'].includes(targetType) || typeof b.hidden!=='boolean') throw validation('可见性参数不合法')
    await moderation.setVisibility(user.userId,{targetType,targetId:text(b,'targetId',36),hidden:b.hidden,reason:text(b,'reason'),...(typeof b.reportId==='string'?{reportId:b.reportId}:{}),requestId:requestId(req)})
    return {ok:true}
  })
  app.post<{Params:{id:string}}>('/api/admin/reports/:id/resolve', { config:{ rateLimit:ADMIN_RATE_LIMIT } }, async req => {
    const user=await requireUser(req); if (!isStaff(user.role)) throw forbidden('需要审核权限')
    const b=body(req), outcome=text(b,'outcome',20)
    if (!['upheld','rejected'].includes(outcome)) throw validation('outcome 不合法')
    return moderation.resolveReport(user.userId,{reportId:req.params.id,outcome,resolutionCode:text(b,'resolutionCode',40),reviewNote:typeof b.reviewNote==='string'?b.reviewNote.slice(0,2000):'',requestId:requestId(req)})
  })
  app.post('/api/admin/sanctions', { config:{ rateLimit:ADMIN_RATE_LIMIT } }, async req => {
    const user=await requireUser(req); if (user.role!=='admin') throw forbidden('仅管理员可处罚账号')
    const b=body(req), kind=text(b,'kind',30)
    if (!['warning','content_restriction','suspension','ban'].includes(kind)) throw validation('kind 不合法')
    return moderation.applySanction(user.userId,{targetUserId:text(b,'userId',36),kind,reasonCode:text(b,'reasonCode',64),reasonDetail:typeof b.reasonDetail==='string'?b.reasonDetail.slice(0,1000):'',...(typeof b.endsAt==='string'?{endsAt:b.endsAt}:{}),...(typeof b.reportId==='string'?{reportId:b.reportId}:{}),requestId:requestId(req)})
  })
  app.post<{Params:{id:string}}>('/api/admin/sanctions/:id/revoke', { config:{ rateLimit:ADMIN_RATE_LIMIT } }, async req => {
    const user=await requireUser(req); if (user.role!=='admin') throw forbidden('仅管理员可撤销处罚')
    return moderation.revokeSanction(user.userId,req.params.id,text(body(req),'reason',500),requestId(req))
  })

  app.get<{Querystring:{status?:string}}>('/api/admin/sanctions', async req => {
    const user=await requireUser(req); if (!isStaff(user.role)) throw forbidden('需要审核权限')
    return { items: await moderation.adminListSanctions(user.userId,statusFilter(req.query.status,moderation.SANCTION_STATUSES)) }
  })

  app.get<{Querystring:{status?:string}}>('/api/admin/appeals', async req => {
    const user=await requireUser(req); if (!isStaff(user.role)) throw forbidden('需要审核权限')
    return { items: await moderation.adminListAppeals(user.userId,statusFilter(req.query.status,moderation.APPEAL_STATUSES)) }
  })

  /**
   * 申诉复核。upheld = 申诉成立（库内同事务撤销处罚 / 恢复内容可见性），
   * rejected = 维持原判；两种情况都写 moderation_actions 并通知申诉人。
   */
  app.post<{Params:{id:string}}>('/api/admin/appeals/:id/review', { config:{ rateLimit:ADMIN_RATE_LIMIT } }, async req => {
    const user=await requireUser(req); if (!isStaff(user.role)) throw forbidden('需要审核权限')
    const b=body(req), outcome=text(b,'outcome',20)
    if (!['upheld','rejected'].includes(outcome)) throw validation('outcome 不合法')
    const note = typeof b.note === 'string' ? b.note.trim() : ''
    if (note.length > 2000) throw validation('note 过长')
    return moderation.reviewAppeal(user.userId,{appealId:req.params.id,outcome:outcome as 'upheld'|'rejected',note,requestId:requestId(req)})
  })
}
