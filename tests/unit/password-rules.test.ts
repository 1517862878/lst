/**
 * 密码规则统一（2026-11）。
 *
 * 曾经三条入口各写一套（注册 6 / 改密 8 / 重置 6），同一个账号换个入口
 * 就被不同规则拦下。这里把这套规则钉死在测试里，防止以后又被改回去。
 *
 * 重点验证的是**边界**与「登录不受新规则影响」这两件事：
 * 前者是用户最容易踩的坑，后者是会直接锁住老用户的风险点。
 */
import { describe, expect, it } from 'vitest'
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  loginSchema,
  passwordSchema,
  registerSchema,
} from '@/domain/schemas'

describe('密码规则', () => {
  it('下限是 8 位', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(8)
  })

  it('7 位被拒绝，8 位通过（边界）', () => {
    expect(passwordSchema.safeParse('abcdefg').success).toBe(false)
    expect(passwordSchema.safeParse('abcdefgh').success).toBe(true)
  })

  it('超过 64 位被拒绝', () => {
    expect(passwordSchema.safeParse('a'.repeat(PASSWORD_MAX_LENGTH)).success).toBe(true)
    expect(passwordSchema.safeParse('a'.repeat(PASSWORD_MAX_LENGTH + 1)).success).toBe(false)
  })

  it('注册表单用同一套密码规则', () => {
    const base = {
      username: 'tester',
      displayName: '测试',
      phone: '13800000000',
      code: '123456',
      termsAccepted: true,
      privacyAccepted: true,
    }
    expect(registerSchema.safeParse({ ...base, password: 'abcdef' }).success).toBe(false)
    expect(registerSchema.safeParse({ ...base, password: 'abcdefgh' }).success).toBe(true)
  })

  /**
   * 登录**必须**不受 8 位限制影响。
   *
   * 老用户里存在 6–7 位密码；如果登录也套 passwordSchema，
   * 他们会在前端就被拦住，永远登不进来（这是最容易被顺手写错的一行）。
   */
  it('登录不校验密码长度（6 位老密码仍可提交）', () => {
    const result = loginSchema.safeParse({ username: 'tester', password: 'abcdef' })
    expect(result.success).toBe(true)
  })

  it('登录仍要求密码非空', () => {
    const result = loginSchema.safeParse({ username: 'tester', password: '' })
    expect(result.success).toBe(false)
  })
})
