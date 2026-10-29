/**
 * 治理文案映射（8.2）。
 *
 * 页面与后台都只负责排版，文案全在这一个模块里；这里把映射钉死，
 * 后端新增码值（未知码）也不必同步发版 —— 断言「原样返回」这条兜底行为。
 */
import { describe, expect, it } from 'vitest'
import {
  appealStatusLabel,
  appealStatusTone,
  reasonLabel,
  reportStatusLabel,
  reportStatusTone,
  REJECTED_RESOLUTIONS,
  REPORT_REASON_OPTIONS,
  resolutionLabel,
  sanctionKindLabel,
  sanctionStatusLabel,
  sanctionStatusTone,
  targetKindLabel,
  UPHELD_RESOLUTIONS,
} from '@/features/moderation/copy'

describe('举报理由选项', () => {
  it('五个理由，值与后端 reason 码一致且顺序固定', () => {
    expect(REPORT_REASON_OPTIONS.map((o) => o.value)).toEqual([
      'copyright',
      'explicit',
      'spam',
      'abuse',
      'other',
    ])
  })

  it('每项都有可读的中文标题与补充说明', () => {
    for (const option of REPORT_REASON_OPTIONS) {
      expect(option.label.length).toBeGreaterThan(0)
      expect(option.hint.length).toBeGreaterThan(0)
    }
  })

  it('reasonLabel 覆盖全部理由，未知值退回「其他」', () => {
    expect(reasonLabel('copyright')).toBe('侵权')
    expect(reasonLabel('spam')).toBe('垃圾广告')
    // @ts-expect-error 模拟后端新增了前端还不认识的码值
    expect(reasonLabel('unknown')).toBe('其他')
  })
})

describe('状态文案与色调', () => {
  it('举报状态：待处理/处理中/已成立/已驳回', () => {
    expect(reportStatusLabel('open')).toBe('待处理')
    expect(reportStatusLabel('reviewing')).toBe('处理中')
    expect(reportStatusLabel('upheld')).toBe('已成立')
    expect(reportStatusLabel('rejected')).toBe('已驳回')
  })

  it('申诉状态与举报状态复用同一组枚举但文案不同', () => {
    expect(appealStatusLabel('upheld')).toBe('申诉成立')
    expect(appealStatusLabel('rejected')).toBe('维持原判')
    expect(appealStatusLabel('open')).toBe('待复核')
  })

  it('色调映射：待处理警告、处理中信息、已成立危险', () => {
    expect(reportStatusTone('open')).toBe('warning')
    expect(reportStatusTone('reviewing')).toBe('info')
    expect(reportStatusTone('upheld')).toBe('danger')
    expect(reportStatusTone('rejected')).toBe('neutral')
    expect(appealStatusTone('upheld')).toBe('success')
  })

  it('处罚类型与处罚状态：未知状态原样显示，方便排查后端新码', () => {
    expect(sanctionKindLabel('warning')).toBe('警告')
    expect(sanctionKindLabel('ban')).toBe('封禁')
    expect(sanctionStatusLabel('active')).toBe('生效中')
    expect(sanctionStatusLabel('muted_by_staff')).toBe('muted_by_staff')
    expect(sanctionStatusTone('active')).toBe('danger')
    expect(sanctionStatusTone('revoked')).toBe('neutral')
  })

  it('举报对象类型文案', () => {
    expect(targetKindLabel('photo')).toBe('作品')
    expect(targetKindLabel('comment')).toBe('评论')
    expect(targetKindLabel('profile')).toBe('用户')
  })
})

describe('裁定码', () => {
  it('已知裁定码翻译成中文，未知码原样显示', () => {
    expect(resolutionLabel('content_hidden')).toBe('内容已隐藏')
    expect(resolutionLabel('brand_new_code')).toBe('brand_new_code')
    expect(resolutionLabel(null)).toBe('')
  })

  it('成立 / 驳回两组裁定码不重叠，且都含兜底路径', () => {
    expect(UPHELD_RESOLUTIONS).toContain('content_hidden')
    expect(REJECTED_RESOLUTIONS).toContain('no_violation')
    const overlap = UPHELD_RESOLUTIONS.filter((code) =>
      (REJECTED_RESOLUTIONS as readonly string[]).includes(code),
    )
    expect(overlap).toEqual([])
  })
})
