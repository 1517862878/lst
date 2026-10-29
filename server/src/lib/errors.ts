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
  /** 配额上限（0028：收藏夹 30 个 / 单夹 500 件）。语义上不是「参数不合法」，所以单列 422。 */
  LIMIT_EXCEEDED: 'LIMIT_EXCEEDED',
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
  LIMIT_EXCEEDED: 422,
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
export const limitExceeded = (msg: string) => new ApiError('LIMIT_EXCEEDED', msg)
export const conflict = (msg: string) => new ApiError('CONFLICT', msg)
export const rateLimited = (msg = '操作过于频繁') => new ApiError('RATE_LIMIT', msg)

/**
 * 0024 的「拉黑阻断」标记：数据库用 42501 抛拉黑导致的禁止，
 * 消息形如 `BLOCKED_BY_RELATION:对方不可关注`。
 *
 * 为什么要标记，而不是直接透传 42501 的消息：42501 同时是 RLS 的拒绝码，
 * 那种消息是 PostgreSQL 的英文样板（"new row violates row-level security
 * policy for table ..."），不该出现在面向用户的中文界面里。只有带标记的消息
 * 才是 0024 有意写给用户看的业务原因（契约 §1.1 要求前端能显示
 * 「对方不可关注」这类可操作文案，而「你无权操作」等于什么都没说）。
 */
export const BLOCKED_BY_RELATION_PREFIX = 'BLOCKED_BY_RELATION:'

/** 是 0024 的拉黑阻断吗？是则返回去掉标记的业务文案，否则返回 null。 */
export function blockedByRelationMessage(err: unknown): string | null {
  if (!(err instanceof Error)) return null
  if ((err as { code?: string }).code !== '42501') return null
  return err.message.startsWith(BLOCKED_BY_RELATION_PREFIX)
    ? err.message.slice(BLOCKED_BY_RELATION_PREFIX.length)
    : null
}

/**
 * 把数据库错误翻译成业务错误。
 *
 * 为什么需要：RLS 拒绝在数据库层表现为 42501（权限不足），
 * 如果直接 500 抛出，用户看到"服务器错误"，而实际是"你无权操作"。
 */
export function translateDbError(err: unknown): ApiError | null {
  if (!(err instanceof Error)) return null
  const e = err as Error & { code?: string; constraint?: string; detail?: string }

  // 迁移里的写入函数用 P0002 表示「目标资源不存在或当前状态不允许」。
  // 不能让它落到 500：对客户端而言这是稳定、可处理的资源状态错误。
  if (e.code === 'P0002') {
    return new ApiError('NOT_FOUND', e.message || '资源不存在或当前状态不允许')
  }

  switch (e.code) {
    case '42501': // insufficient_privilege：RLS 拦截，或 0024 的拉黑阻断
      // 带标记的才是 0024 有意写给用户的业务文案，其余仍是 RLS 的英文样板。
      return new ApiError(
        'FORBIDDEN',
        blockedByRelationMessage(e) ?? '无权执行该操作（被行级安全策略拒绝）',
        e.detail,
      )
    case '23505': // unique_violation
      return new ApiError('CONFLICT', '数据已存在（唯一约束冲突）', e.detail)
    case '23503': // foreign_key_violation
      return new ApiError('VALIDATION', '关联数据不存在', e.detail)
    case '23514': {
      // check_violation。表约束撞车时 PostgreSQL 给的是英文样板
      // （new row for relation "photos" violates check constraint ...），
      // 迁移里 `raise exception '只能收藏已发布作品' using errcode='23514'` 的
      // 中文文案才是该给用户看的，所以只有前者才替换成通用文案。
      const boilerplate = /^(new row for relation|insert or update on table|value for domain|.*violates check constraint)/i
      const message = e.message && !boilerplate.test(e.message) ? e.message : '数据不符合约束要求'
      return new ApiError('VALIDATION', message, e.detail)
    }
    case '53400': // configuration_limit_exceeded：0028 的配额上限（422 而不是 400）
      return new ApiError('LIMIT_EXCEEDED', e.message || '已达上限')
    case '55000': // object_not_in_prerequisite_state：目标对象当前状态不允许该操作
      // 治理链路里「申诉已复核」「已撤销的处罚再撤销」这类都是状态冲突，
      // 对客户端是 409 的可重试无意义错误，透传数据库写好的中文文案。
      return new ApiError('CONFLICT', e.message || '当前状态不允许该操作', e.detail)
    case '22P02': // invalid_text_representation
    case '22023': // invalid_parameter_value
      return new ApiError('VALIDATION', e.message || '参数格式不正确')
    default:
      return null
  }
}
