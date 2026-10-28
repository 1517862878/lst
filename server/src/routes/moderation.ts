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

export async function registerModerationRoutes(app: FastifyInstance) {
  app.post('/api/reports', { config:{ rateLimit:{ max:10,timeWindow:'1 hour' } } }, async req => {
    const user=await requireUser(req), b=body(req)
    const targetType=text(b,'targetType',20), reason=text(b,'reason',20)
    if (!['photo','comment','profile'].includes(targetType)) throw validation('targetType 不合法')
    if (!['copyright','explicit','spam','abuse','other'].includes(reason)) throw validation('reason 不合法')
    return moderation.submitReport(user.userId,{targetType,targetId:text(b,'targetId',36),reason,detail:typeof b.detail==='string'?b.detail.trim().slice(0,500):''})
  })
  app.get<{Querystring:{status?:string}}>('/api/admin/reports', async req => {
    const user=await requireUser(req); if (!['editor','admin'].includes(user.role)) throw forbidden('需要审核权限')
    if (req.query.status && !(REPORT_STATUSES as readonly string[]).includes(req.query.status)) throw validation('status 不合法')
    return moderation.listReports(user.userId,req.query.status)
  })
  app.post<{Params:{id:string}}>('/api/admin/reports/:id/claim', { config:{ rateLimit:ADMIN_RATE_LIMIT } }, async req => {
    const user=await requireUser(req); if (!['editor','admin'].includes(user.role)) throw forbidden('需要审核权限')
    return moderation.claimReport(user.userId,req.params.id,requestId(req))
  })
  app.post('/api/admin/moderation/visibility', { config:{ rateLimit:ADMIN_RATE_LIMIT } }, async req => {
    const user=await requireUser(req); if (!['editor','admin'].includes(user.role)) throw forbidden('需要审核权限')
    const b=body(req), targetType=text(b,'targetType',20)
    if (!['photo','comment'].includes(targetType) || typeof b.hidden!=='boolean') throw validation('可见性参数不合法')
    await moderation.setVisibility(user.userId,{targetType,targetId:text(b,'targetId',36),hidden:b.hidden,reason:text(b,'reason'),...(typeof b.reportId==='string'?{reportId:b.reportId}:{}),requestId:requestId(req)})
    return {ok:true}
  })
  app.post<{Params:{id:string}}>('/api/admin/reports/:id/resolve', { config:{ rateLimit:ADMIN_RATE_LIMIT } }, async req => {
    const user=await requireUser(req); if (!['editor','admin'].includes(user.role)) throw forbidden('需要审核权限')
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
}
