import type pg from 'pg'
import { withRls } from '../lib/db.js'

export async function submitReport(userId: string, input: { targetType: string; targetId: string; reason: string; detail: string }) {
  return withRls(userId, async (c) => {
    const r = await c.query('select * from public.api_submit_report($1,$2,$3,$4)', [input.targetType,input.targetId,input.reason,input.detail])
    return r.rows[0]
  })
}

export async function listReports(userId: string, status?: string) {
  return withRls(userId, async (c) => {
    const r = await c.query(
      `select id,target_type as "targetType",target_id as "targetId",reason,detail,status,
              assigned_to as "assignedTo",review_note as "reviewNote",resolution_code as "resolutionCode",
              created_at as "createdAt",updated_at as "updatedAt",resolved_at as "resolvedAt"
         from public.reports
        where ($1::text is null or status=$1)
        order by created_at desc limit 100`,
      [status ?? null],
    )
    return r.rows
  })
}

export async function claimReport(userId: string, reportId: string, requestId?: string) {
  return withRls(userId, (c: pg.PoolClient) => c.query('select * from public.api_claim_report($1,$2)', [reportId,requestId ?? null]).then(r=>r.rows[0]))
}
export async function setVisibility(userId: string, input: { targetType:string; targetId:string; hidden:boolean; reason:string; reportId?:string; requestId?:string }) {
  await withRls(userId, c => c.query('select public.api_set_content_visibility($1,$2,$3,$4,$5,$6)', [input.targetType,input.targetId,input.hidden,input.reason,input.reportId ?? null,input.requestId ?? null]))
}
export async function resolveReport(userId: string, input: { reportId:string; outcome:string; resolutionCode:string; reviewNote:string; requestId?:string }) {
  return withRls(userId, c => c.query('select * from public.api_resolve_report($1,$2,$3,$4,$5)', [input.reportId,input.outcome,input.resolutionCode,input.reviewNote,input.requestId ?? null]).then(r=>r.rows[0]))
}
export async function applySanction(userId: string, input: { targetUserId:string; kind:string; reasonCode:string; reasonDetail:string; endsAt?:string; reportId?:string; requestId?:string }) {
  return withRls(userId, c => c.query('select * from public.api_apply_sanction($1,$2,$3,$4,$5,$6,$7)', [input.targetUserId,input.kind,input.reasonCode,input.reasonDetail,input.endsAt ?? null,input.reportId ?? null,input.requestId ?? null]).then(r=>r.rows[0]))
}
export async function revokeSanction(userId: string, sanctionId: string, reason: string, requestId?: string) {
  return withRls(userId, c => c.query('select * from public.api_revoke_sanction($1,$2,$3)', [sanctionId,reason,requestId ?? null]).then(r=>r.rows[0]))
}
