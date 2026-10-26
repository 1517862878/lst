/**
 * 时间工具（ROADMAP §6.1 / FRONTEND-WORK §1.1）。
 * 规则：全部用 UTC ISO-8601 字符串；ISO 周计算按 Asia/Shanghai。
 */

const DAY_MS = 24 * 60 * 60 * 1000

/** 当前 ISO 周年号（如 '2026-W44'），按 Asia/Shanghai（UTC+8）计算 */
export function currentIsoWeek(now: Date = new Date()): string {
  // 北京时间 = UTC + 8
  const shanghai = new Date(now.getTime() + 8 * 3600_000)
  // ISO 周：以周四所在年份为周所属年
  const day = shanghai.getUTCDay() || 7 // 周一=1 … 周日=7
  const thursday = new Date(shanghai)
  thursday.setUTCDate(shanghai.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil(((thursday.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7)
  return `${thursday.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`
}

/**
 * 某 ISO 周的起止 UTC（Asia/Shanghai 周一 00:00 = 周日 16:00 UTC）。
 * 返回半开区间 [start, end)，用于榜单落窗（ROADMAP §6.1）。
 */
export function weekRangeUtc(isoWeek: string): { start: string; end: string } {
  const m = /^(\d{4})-W(\d{2})$/.exec(isoWeek)
  if (!m) throw new Error(`非法周编号：${isoWeek}`)
  const year = Number(m[1])
  const week = Number(m[2])
  // 1 月 4 日恒为 ISO 第 1 周内
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const jan4Day = jan4.getUTCDay() || 7
  const monday1 = new Date(jan4)
  monday1.setUTCDate(jan4.getUTCDate() + 1 - jan4Day)
  // 该周周一 00:00 北京时间 = 周日 16:00 UTC
  const start = new Date(monday1.getTime() + (week - 1) * 7 * DAY_MS - 8 * 3600_000)
  const end = new Date(start.getTime() + 7 * DAY_MS)
  return { start: start.toISOString(), end: end.toISOString() }
}

/** ISO 周往前推 n 周 */
export function addWeeks(isoWeek: string, delta: number): string {
  const m = /^(\d{4})-W(\d{2})$/.exec(isoWeek)
  if (!m) throw new Error(`非法周编号：${isoWeek}`)
  // 用第 1 周周一作为锚点换算
  const { start } = weekRangeUtc(isoWeek)
  const t = Date.parse(start) + delta * 7 * DAY_MS
  return currentIsoWeek(new Date(t - 8 * 3600_000))
}

/** 相对时间显示（"3 天前"），列表用 */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const t = Date.parse(iso)
  const diff = now.getTime() - t
  const min = Math.floor(diff / 60_000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} 小时前`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d} 天前`
  const mo = Math.floor(d / 30)
  if (mo < 12) return `${mo} 个月前`
  return `${Math.floor(mo / 12)} 年前`
}

/** 日期显示（yyyy-mm-dd），详情页/EXIF 用 */
export function formatDate(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10)
}
