/**
 * 标签页路径构造（8.3a）。
 *
 * 单独一个模块而不是挂在 TagLink.tsx 上：Fast Refresh 要求组件文件只导出组件，
 * 把常量/纯函数放这里，组件文件才能保持「只有组件导出」的状态。
 */

/** 标签总览页 */
export const TAGS_PATH = '/tags'

/**
 * 单个标签的详情页路径。
 * 必须编码：标签里可能出现空格（"long exposure"）、斜杠（"a/b"）、井号等，
 * 直接拼进 URL 会被路由/浏览器当成分隔符。
 */
export function tagPath(tag: string): string {
  return `${TAGS_PATH}/${encodeURIComponent(tag)}`
}
