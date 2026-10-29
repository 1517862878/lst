/**
 * API 治理仓储（8.2：举报 / 审核 / 处罚 / 申诉）。
 *
 * 端点以 .tmp/phase82-freeze.md §3 为唯一依据：
 *   POST /api/reports                         提交举报 → { reportId, status }
 *   GET  /api/reports/mine                    我的举报 → { items: MyReport[] }
 *   POST /api/reports/:id/appeal              对举报提起申诉 → { appealId, status, createdAt }
 *   GET  /api/me/appeals                      我的申诉 → { items: Appeal[] }
 *   GET  /api/me/sanctions                    我的处罚 → { items: MySanction[] }
 *   GET  /api/admin/reports[\?status=]        举报队列
 *   GET  /api/admin/reports/:id               举报详情（report + target + actions）
 *   POST /api/admin/reports/:id/claim         认领
 *   POST /api/admin/moderation/visibility     隐藏 / 恢复内容
 *   POST /api/admin/reports/:id/resolve       裁定
 *   GET  /api/admin/sanctions[\?status=]      处罚列表
 *   POST /api/admin/sanctions/:id/revoke      撤销处罚
 *   GET  /api/admin/appeals[\?status=]        申诉队列
 *   POST /api/admin/appeals/:id/review        复核申诉
 *
 * 一处**契约缺口**：冻结表只给了「对举报申诉」的 POST /api/reports/:id/appeal，
 * 而 /me/sanctions 要能对**处罚**提起申诉（§4 明确要求「被处罚处提供申诉按钮」），
 * 冻结表里没有对应端点。这里按与举报对称的命名补 POST /api/sanctions/:id/appeal，
 * 并在提交前先查 /api/me/sanctions 校验归属（服务端仍会再校验一次）。
 * 若后端采用别的路径，只需要改 submitAppeal 里那一个字符串。
 */
import type {
  AdminAppeal,
  AdminSanction,
  Appeal,
  AppealStatus,
  MyReport,
  MySanction,
  Report,
  ReportStatus,
} from '@/domain/types'
import {
  AppError,
  ErrorCodes,
  type AdminReportDetail,
  type AppealReceipt,
  type ModerationRepository,
  type ResolveReportInput,
  type SubmitAppealInput,
  type SubmitReportInput,
  type VisibilityInput,
} from '@/data/contracts'
import { qs, request } from './client'

/** 列表端点可能返回 { items } 或裸数组（历史端点两种都有），统一摊平 */
function itemsOf<T>(data: { items?: T[] } | T[] | null | undefined): T[] {
  if (Array.isArray(data)) return data
  return data?.items ?? []
}

const reportPath = (id: string) => `/api/admin/reports/${encodeURIComponent(id)}`

export const apiModerationRepository: ModerationRepository = {
  async submitReport(input: SubmitReportInput) {
    const data = await request<{
      reportId?: string
      id?: string
      report_id?: string
      status?: ReportStatus
    }>('/api/reports', {
      method: 'POST',
      body: {
        targetType: input.targetType,
        targetId: input.targetId,
        reason: input.reason,
        detail: input.detail,
      },
    })
    // 服务端要求映射成 reportId；老实现可能返回 id / report_id，这里一并兼容
    const reportId = data.reportId ?? data.id ?? data.report_id
    if (!reportId) throw new AppError(ErrorCodes.STORAGE, '举报已提交，但服务端没有返回回执编号')
    return { reportId, status: data.status ?? ('open' as ReportStatus) }
  },

  async myReports(): Promise<MyReport[]> {
    return itemsOf(await request<{ items: MyReport[] } | MyReport[]>('/api/reports/mine'))
  },

  async submitAppeal(input: SubmitAppealInput): Promise<AppealReceipt> {
    if (Boolean(input.reportId) === Boolean(input.sanctionId)) {
      throw new AppError(ErrorCodes.VALIDATION, '申诉必须且只能关联一条举报或一次处罚')
    }
    if (input.reportId) {
      return request<AppealReceipt>(`/api/reports/${encodeURIComponent(input.reportId)}/appeal`, {
        method: 'POST',
        body: { message: input.message },
      })
    }
    return request<AppealReceipt>(`/api/sanctions/${encodeURIComponent(input.sanctionId!)}/appeal`, {
      method: 'POST',
      body: { message: input.message },
    })
  },

  async myAppeals(): Promise<Appeal[]> {
    return itemsOf(await request<{ items: Appeal[] } | Appeal[]>('/api/me/appeals'))
  },

  async mySanctions(): Promise<MySanction[]> {
    return itemsOf(await request<{ items: MySanction[] } | MySanction[]>('/api/me/sanctions'))
  },

  async listReports(status?: ReportStatus): Promise<Report[]> {
    return itemsOf(
      await request<{ items: Report[] } | Report[]>(`/api/admin/reports${qs({ status })}`),
    )
  },

  async reportDetail(id: string): Promise<AdminReportDetail> {
    return request<AdminReportDetail>(reportPath(id))
  },

  async claimReport(id: string): Promise<void> {
    await request(`${reportPath(id)}/claim`, { method: 'POST' })
  },

  async setVisibility(input: VisibilityInput): Promise<void> {
    const body: Record<string, unknown> = {
      targetType: input.targetType,
      targetId: input.targetId,
      hidden: input.hidden,
      reason: input.reason,
    }
    if (input.reportId) body.reportId = input.reportId
    await request('/api/admin/moderation/visibility', { method: 'POST', body })
  },

  async resolveReport(id: string, input: ResolveReportInput): Promise<void> {
    await request(`${reportPath(id)}/resolve`, {
      method: 'POST',
      body: {
        status: input.status,
        resolutionCode: input.resolutionCode,
        reviewNote: input.reviewNote,
      },
    })
  },

  async listSanctions(status?: string): Promise<AdminSanction[]> {
    return itemsOf(
      await request<{ items: AdminSanction[] } | AdminSanction[]>(
        `/api/admin/sanctions${qs({ status })}`,
      ),
    )
  },

  async revokeSanction(id: string, reason: string): Promise<void> {
    await request(`/api/admin/sanctions/${encodeURIComponent(id)}/revoke`, {
      method: 'POST',
      body: { reason },
    })
  },

  async listAppeals(status?: AppealStatus): Promise<AdminAppeal[]> {
    return itemsOf(
      await request<{ items: AdminAppeal[] } | AdminAppeal[]>(`/api/admin/appeals${qs({ status })}`),
    )
  },

  async reviewAppeal(
    id: string,
    input: { outcome: Extract<AppealStatus, 'upheld' | 'rejected'>; note: string },
  ): Promise<{ appealId: string; status: AppealStatus; updatedAt: string }> {
    return request<{ appealId: string; status: AppealStatus; updatedAt: string }>(
      `/api/admin/appeals/${encodeURIComponent(id)}/review`,
      { method: 'POST', body: { outcome: input.outcome, note: input.note } },
    )
  },
}
