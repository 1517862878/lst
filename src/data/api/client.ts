/**
 * HTTP 客户端（前端 → 后端 API）。
 *
 * 设计要点：
 *   1) 统一把后端的 { code, message } 转成前端 AppError
 *      —— 这样 hooks 里 catch 到的错误类型与 mock 实现一致，页面无需区分数据源
 *   2) 自动附带 Authorization（登录态由 auth 模块写入 localStorage）
 *   3) 对 401 做统一处理（清会话，让守卫跳登录）
 */
import { AppError, ErrorCodes } from '@/data/contracts'

type ErrorCodeValue = (typeof ErrorCodes)[keyof typeof ErrorCodes]

const API_BASE = (import.meta.env.VITE_API_BASE ?? 'http://127.0.0.1:3001').replace(/\/+$/, '')

/** 会话令牌存储键（与 auth 模块共用） */
export const TOKEN_STORAGE_KEY = 'gy:token'

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY)
  } catch {
    return null
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token)
    else localStorage.removeItem(TOKEN_STORAGE_KEY)
  } catch {
    // 隐私模式下 localStorage 可能不可用，忽略
  }
}

interface ApiErrorBody {
  code?: string
  message?: string
  details?: unknown
}

const KNOWN_CODES = new Set<string>(Object.values(ErrorCodes))

function toAppError(status: number, body: ApiErrorBody | null, fallback: string): AppError {
  const rawCode = body?.code
  const code: ErrorCodeValue =
    rawCode && KNOWN_CODES.has(rawCode) ? (rawCode as ErrorCodeValue) : fallbackCodeOf(status)

  return new AppError(code, body?.message || fallback)
}

/** 后端没给 code（或给了未知 code）时，按 HTTP 状态码兜底映射 */
function fallbackCodeOf(status: number): ErrorCodeValue {
  if (status === 404) return 'NOT_FOUND'
  if (status === 401) return 'UNAUTHORIZED'
  if (status === 403) return 'FORBIDDEN'
  if (status === 409) return 'CONFLICT'
  if (status >= 400 && status < 500) return 'VALIDATION'
  return 'STORAGE'
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?: unknown
  /** 是否附带登录令牌（默认附带） */
  auth?: boolean
  signal?: AbortSignal
}

/**
 * 发起 API 请求。
 * @throws AppError 网络或业务错误统一转成 AppError
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true, signal } = options

  const headers: Record<string, string> = { accept: 'application/json' }
  if (body !== undefined) headers['content-type'] = 'application/json'

  if (auth) {
    const token = getToken()
    if (token) headers.authorization = `Bearer ${token}`
  }

  let res: Response
  try {
    // exactOptionalPropertyTypes 下不能把 undefined 赋给可选属性，
    // 所以用条件展开构造 init
    const init: RequestInit = {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(signal ? { signal } : {}),
    }
    res = await fetch(API_BASE + path, init)
  } catch (err) {
    // 网络层失败（服务未启动、跨域被拒等）
    const msg = err instanceof Error ? err.message : String(err)
    throw new AppError('STORAGE', `无法连接服务器：${msg}`)
  }

  // 204 No Content
  if (res.status === 204) return undefined as T

  const text = await res.text()
  let parsed: unknown = null
  if (text) {
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = null
    }
  }

  if (!res.ok) {
    // 401 统一清理会话，让路由守卫接管跳登录
    if (res.status === 401) setToken(null)
    throw toAppError(res.status, parsed as ApiErrorBody | null, `请求失败（${res.status}）`)
  }

  return parsed as T
}

/** 把查询参数对象拼成 query string（忽略 undefined） */
export function qs(params: Record<string, string | number | undefined | null>): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue
    sp.set(k, String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

export { API_BASE }
