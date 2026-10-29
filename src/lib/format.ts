/**
 * 数字格式化（8.3d：/me 的创作数据）。
 *
 * 为什么不用 `toLocaleString()`：分组符号取决于运行环境的 locale（de-DE 是
 * `1.234`、fr-FR 是 `1 234`、ar-EG 还会换成阿拉伯数字），同一个页面在不同机器上
 * 长得不一样，单测也没法写死断言。这里固定「三位一组、逗号分隔」，与项目里
 * 其它写死的展示文本一样，是可预测的。
 */
export function formatNumber(value: number): string {
  // 非数字/非有限值统一显示 0：统计卡上出现 NaN 比显示 0 更让人怀疑数据坏了
  if (typeof value !== 'number' || !Number.isFinite(value)) return '0'
  const rounded = Math.trunc(value)
  const negative = rounded < 0
  const digits = String(Math.abs(rounded))
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return negative ? `-${grouped}` : grouped
}
