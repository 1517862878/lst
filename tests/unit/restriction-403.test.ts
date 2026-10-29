/**
 * 403 账号限制的请求层契约（8.2 补口）。
 *
 * 后端在受限写操作上返回 403 + details.sanctionKind / endsAt。
 * 前端必须：
 *   · 仍抛出 AppError（页面原有的错误处理不能被吞）；
 *   · 把 details 透传给调用方；
 *   · 广播一条带期限的提示（由 Shell 上的 banner 转成 toast + 去申诉入口）；
 *   · 普通权限 403（没有 sanctionKind）保持安静，不误报成「账号被限制」。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '@/data/contracts'
import { request } from '@/data/api/client'
import { parseSanctionBlock, sanctionBlockedMessage } from '@/domain/restrictions'
import { onSanctionBlocked, type SanctionBlockedNotice } from '@/lib/restrictionNotice'

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

let notices: SanctionBlockedNotice[] = []

beforeEach(() => {
  notices = []
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('parseSanctionBlock', () => {
  it('识别 403 + details.sanctionKind，并保留可解析的 endsAt', () => {
    expect(
      parseSanctionBlock(403, {
        code: 'FORBIDDEN',
        details: { sanctionKind: 'content_restriction', endsAt: '2026-11-05T10:00:00.000Z' },
      }),
    ).toEqual({ kind: 'content_restriction', endsAt: '2026-11-05T10:00:00.000Z' })
  })

  it('endsAt 缺失或非法时视为长期限制', () => {
    expect(parseSanctionBlock(403, { details: { sanctionKind: 'ban' } })).toEqual({
      kind: 'ban',
      endsAt: null,
    })
    expect(parseSanctionBlock(403, { details: { sanctionKind: 'ban', endsAt: 'not-a-date' } })).toEqual({
      kind: 'ban',
      endsAt: null,
    })
  })

  it('非 403、无 details、未知 sanctionKind 一律不识别', () => {
    expect(parseSanctionBlock(400, { details: { sanctionKind: 'ban' } })).toBeNull()
    expect(parseSanctionBlock(403, { code: 'FORBIDDEN' })).toBeNull()
    expect(parseSanctionBlock(403, { details: { sanctionKind: 'muted' } })).toBeNull()
    expect(parseSanctionBlock(403, null)).toBeNull()
  })
})

describe('sanctionBlockedMessage', () => {
  it('保留服务端的具体动作说明，并补上期限', () => {
    const message = sanctionBlockedMessage('ban', '2026-11-05T10:00:00.000Z', '账号已被封禁，暂时无法发布内容')
    expect(message).toContain('账号已被封禁，暂时无法发布内容')
    expect(message).toContain('限制至 2026-11-05')
  })

  it('服务端没给 message 时用种类兜底，长期限制写明「长期限制」', () => {
    const message = sanctionBlockedMessage('suspension', null)
    expect(message).toContain('停用')
    expect(message).toContain('长期限制')
  })
})

describe('request 对受限 403 的处理', () => {
  it('抛出带 details 的 AppError，并广播一条提示', async () => {
    const off = onSanctionBlocked((notice) => notices.push(notice))
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(403, {
          code: 'FORBIDDEN',
          message: '账号已被封禁，暂时无法发布内容',
          details: { sanctionKind: 'ban', endsAt: null },
        }),
      ),
    )

    const error = await request('/api/photos').catch((e: unknown) => e)
    off()

    expect(error).toBeInstanceOf(AppError)
    expect(error).toMatchObject({
      code: 'FORBIDDEN',
      message: '账号已被封禁，暂时无法发布内容',
      details: { sanctionKind: 'ban', endsAt: null },
    })
    expect(notices).toHaveLength(1)
    expect(notices[0]).toMatchObject({ kind: 'ban', endsAt: null })
    expect(notices[0]?.message).toContain('长期限制')
  })

  it('普通权限 403 照常抛出，但不广播账号限制提示', async () => {
    const off = onSanctionBlocked((notice) => notices.push(notice))
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(403, { code: 'FORBIDDEN', message: '仅管理员可执行该操作' }),
      ),
    )

    const error = await request('/api/admin/reports').catch((e: unknown) => e)
    off()

    expect(error).toBeInstanceOf(AppError)
    expect(error).toMatchObject({ code: 'FORBIDDEN', message: '仅管理员可执行该操作' })
    expect((error as AppError).details).toBeUndefined()
    expect(notices).toHaveLength(0)
  })

  it('details 里是不认识的 sanctionKind 时不广播，但错误仍抛给页面', async () => {
    const off = onSanctionBlocked((notice) => notices.push(notice))
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(403, {
          code: 'FORBIDDEN',
          message: '操作被拒绝',
          details: { sanctionKind: 'muted' },
        }),
      ),
    )

    const error = await request('/api/comments').catch((e: unknown) => e)
    off()

    expect(error).toMatchObject({ code: 'FORBIDDEN' })
    expect(notices).toHaveLength(0)
  })
})
