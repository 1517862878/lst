/**
 * HTTP 客户端（前端 → 后端 API）。
 *
 * 设计要点：
 *   1) 统一把后端的 { code, message } 转成前端 AppError
 *      —— 这样 hooks 里 catch 到的错误类型与 mock 实现一致，页面无需区分数据源
 *   2) 所有请求携带 HttpOnly 会话 cookie
 *   3) 非安全方法附带双提交 CSRF cookie（gy_csrf）
 */
import { AppError, ErrorCodes } from '@/data/contracts'

type ErrorCodeValue = (typeof ErrorCodes)[keyof typeof ErrorCodes]

/**
 * API 基址（构建期被 Vite 内联进产物）。
 *
 * ⚠️ 这里只写「源」，不要写路径：接口路径本身已带 /api 前缀（见 src/data/api/*.ts）。
 *
 * 生产构建绝不回退到 127.0.0.1 —— 那会让「访客的浏览器」去请求「访客自己的 localhost」，
 * 现象是全站没有数据，而且与「真的还没有数据」无法区分。这种漏配已由 vite.config.ts 的
 * 构建期断言挡在构建阶段（必须显式给 VITE_API_BASE，或显式声明同源模式
 * VITE_ALLOW_SAME_ORIGIN=1），所以运行期规则只有两条，不存在静默兜底：
 *   · 配了 VITE_API_BASE → 用它（本地联调可填 http://127.0.0.1:3001）；
 *   · 没配 → 同源模式 = 空基址，请求打向本站的 /api/*（本地由 vite dev 的代理转发）。
 */
const API_BASE = (import.meta.env.VITE_API_BASE ?? '').trim().replace(/\/+$/, '')

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const prefix = `${encodeURIComponent(name)}=`
  for (const part of document.cookie.split(';')) {
    const cookie = part.trim()
    if (cookie.startsWith(prefix)) return decodeURIComponent(cookie.slice(prefix.length))
  }
  return null
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
  /** 非 JSON 请求体（目前用于 WebP 图片上传）；与 body 互斥 */
  rawBody?: BodyInit
  contentType?: string
  signal?: AbortSignal
}

/**
 * 发起 API 请求。
 * @throws AppError 网络或业务错误统一转成 AppError
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, rawBody, contentType, signal } = options
  if (body !== undefined && rawBody !== undefined) {
    throw new AppError('VALIDATION', '请求不能同时包含 JSON 与二进制请求体')
  }

  const headers: Record<string, string> = { accept: 'application/json' }
  if (body !== undefined) headers['content-type'] = 'application/json'
  else if (rawBody !== undefined && contentType) headers['content-type'] = contentType

  if (!SAFE_METHODS.has(method)) {
    const csrfToken = readCookie('gy_csrf')
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken
  }

  let res: Response
  try {
    // exactOptionalPropertyTypes 下不能把 undefined 赋给可选属性，
    // 所以用条件展开构造 init
    const init: RequestInit = {
      method,
      headers,
      credentials: 'include',
      ...(body !== undefined
        ? { body: JSON.stringify(body) }
        : rawBody !== undefined
          ? { body: rawBody }
          : {}),
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
