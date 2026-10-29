/**
 * 治理 hooks（8.2：举报 / 处罚 / 申诉 / 后台审核）。
 *
 * 约定同其它 hooks：页面只调这里，不直接碰 createRepositories()，查询键全部走 queryKeys。
 * 写操作统一失效前缀 ['moderation'] —— 举报 / 裁定 / 撤销之间会互相影响（举报结案 →
 * 处罚出现；申诉成立 → 处罚撤销），按前缀失效比逐个列键更不容易漏。
 */
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { createRepositories } from '@/data'
import type {
  ResolveReportInput,
  SubmitAppealInput,
  SubmitReportInput,
  VisibilityInput,
} from '@/data/contracts'
import type { AppealStatus, ReportStatus } from '@/domain/types'
import { queryKeys } from './queryKeys'

const repos = () => createRepositories()

/** 我的举报（登录后才请求） */
export function useMyReports(enabled = true) {
  return useQuery({
    queryKey: queryKeys.myReports(),
    queryFn: () => repos().moderation.myReports(),
    enabled,
  })
}

/** 我的处罚 */
export function useMySanctions(enabled = true) {
  return useQuery({
    queryKey: queryKeys.mySanctions(),
    queryFn: () => repos().moderation.mySanctions(),
    enabled,
  })
}

/** 我的申诉 */
export function useMyAppeals(enabled = true) {
  return useQuery({
    queryKey: queryKeys.myAppeals(),
    queryFn: () => repos().moderation.myAppeals(),
    enabled,
  })
}

/** 提交举报：成功后只失效「我的举报」，回执由调用方用 mutation 结果渲染 */
export function useSubmitReport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: SubmitReportInput) => repos().moderation.submitReport(input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.myReports() }),
  })
}

/** 提交申诉 */
export function useSubmitAppeal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: SubmitAppealInput) => repos().moderation.submitAppeal(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['moderation'] })
    },
  })
}

// ===== 后台 =====

/** 后台举报队列；status 传 'all' 表示不过滤（契约里省略 = 全部，但 queryKey 需要稳定字符串） */
export function useAdminReports(status: ReportStatus | 'all', enabled = true) {
  return useQuery({
    queryKey: queryKeys.adminReports(status),
    queryFn: () => repos().moderation.listReports(status === 'all' ? undefined : status),
    enabled,
  })
}

/** 后台举报详情（目标上下文 + 审计时间线）；未选中任何一条时不请求 */
export function useAdminReportDetail(id: string) {
  return useQuery({
    queryKey: queryKeys.adminReportDetail(id),
    queryFn: () => repos().moderation.reportDetail(id),
    enabled: Boolean(id),
  })
}

export function useClaimReport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => repos().moderation.claimReport(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['moderation'] })
    },
  })
}

export function useSetVisibility() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: VisibilityInput) => repos().moderation.setVisibility(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['moderation'] })
      // 内容可见性变了，作品 / 评论列表也要重取，否则后台隐藏完回前台还看得到
      void qc.invalidateQueries({ queryKey: ['photos'] })
      void qc.invalidateQueries({ queryKey: ['comments'] })
    },
  })
}

export function useResolveReport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ResolveReportInput }) =>
      repos().moderation.resolveReport(id, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['moderation'] })
      // 裁定可能新增/加重处罚：让当前账号的会话限制横幅跟着刷新（8.2 补口）
      void qc.invalidateQueries({ queryKey: queryKeys.session() })
    },
  })
}

export function useAdminSanctions(status: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.adminSanctions(status),
    queryFn: () => repos().moderation.listSanctions(status === 'all' ? undefined : status),
    enabled,
  })
}

export function useRevokeSanction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      repos().moderation.revokeSanction(id, reason),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['moderation'] })
      // 撤销后 banner 要立刻消失，不能等用户手动刷新
      void qc.invalidateQueries({ queryKey: queryKeys.session() })
    },
  })
}

export function useAdminAppeals(status: AppealStatus | 'all', enabled = true) {
  return useQuery({
    queryKey: queryKeys.adminAppeals(status),
    queryFn: () => repos().moderation.listAppeals(status === 'all' ? undefined : status),
    enabled,
  })
}

export function useReviewAppeal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      outcome,
      note,
    }: {
      id: string
      outcome: Extract<AppealStatus, 'upheld' | 'rejected'>
      note: string
    }) => repos().moderation.reviewAppeal(id, { outcome, note }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['moderation'] })
      // 申诉成立可能同时撤销处罚，banner 依赖的会话也要重取
      void qc.invalidateQueries({ queryKey: queryKeys.session() })
    },
  })
}
