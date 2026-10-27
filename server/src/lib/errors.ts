/**
 * 统一错误模型（与前端 src/data/contracts 的 AppError 对齐）。
 *
 * 为什么要对齐：前端 hooks 依赖 error.code 判断行为
 * （比如 NOT_FOUND 显示空态、UNAUTHORIZED 跳登录）。
 * 后端返回结构不一致，前端就得写两套判断。
 */
export const ErrorCodes = {
  NOT_FOUND: 'NOT_FOUND',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  VALIDATION: 'VALIDATION',
  CONFLICT: 'CONFLICT',
  STORAGE: 'STORAGE',
  INTERNAL: 'INTERNAL',
  RATE_LIMIT: 'RATE_LIMIT',
} as const

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes]

const STATUS_OF: Record<ErrorCode, number> = {
  NOT_FOUND: 404,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  VALIDATION: 400,
  CONFLICT: 409,
  STORAGE: 500,
  INTERNAL: 500,
  RATE_LIMIT: 429,
}

export class ApiError extends Error {
  readonly code: ErrorCode
  readonly status: number
  readonly details?: unknown

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = STATUS_OF[code]
    this.details = details
  }
}

/** 常用快捷构造 */
export const notFound = (msg = '资源不存在') => new ApiError('NOT_FOUND', msg)
export const unauthorized = (msg = '请先登录') => new ApiError('UNAUTHORIZED', msg)
export const forbidden = (msg = '无权访问') => new ApiError('FORBIDDEN', msg)
export const validation = (msg: string, details?: unknown) =>
  new ApiError('VALIDATION', msg, details)
export const conflict = (msg: string) => new ApiError('CONFLICT', msg)
export const rateLimited = (msg = '操作过于频繁') => new ApiError('RATE_LIMIT', msg)

/**
 * 把数据库错误翻译成业务错误。
 *
 * 为什么需要：RLS 拒绝在数据库层表现为 42501（权限不足），
 * 如果直接 500 抛出，用户看到"服务器错误"，而实际是"你无权操作"。
 */
export function translateDbError(err: unknown): ApiError | null {
  if (!(err instanceof Error)) return null
  const e = err as Error & { code?: string; constraint?: string; detail?: string }

  switch (e.code) {
    case '42501': // insufficient_privilege：RLS 拦截
      return new ApiError('FORBIDDEN', '无权执行该操作（被行级安全策略拒绝）')
    case '23505': // unique_violation
      return new ApiError('CONFLICT', '数据已存在（唯一约束冲突）', e.detail)
    case '23503': // foreign_key_violation
      return new ApiError('VALIDATION', '关联数据不存在', e.detail)
    case '23514': // check_violation
      return new ApiError('VALIDATION', '数据不符合约束要求', e.detail)
    case '22P02': // invalid_text_representation
      return new ApiError('VALIDATION', '参数格式不正确')
    default:
      return null
  }
}
