/**
 * 标题 → 文章 slug（纯函数，单独放一个文件）。
 *
 * 为什么不能放在 ArticleWritePage.tsx 里：路由用 lazyNamed 按导出名取组件，
 * 那个工具对「模块里还有其它非组件导出」是类型错误的（TS2322）。
 * 拆出来之后页面文件只导出组件，函数也能被单测直接引用。
 *
 * 中文标题没法直接转 slug（要拼音表，项目不允许为此加依赖），所以：
 *   · 标题里已有 ASCII 字母数字 → 保留并规范成小写连字符；
 *   · 纯中文标题 → 用带随机后缀的占位 slug，作者可以自己改。
 * 不追求漂亮，只追求「唯一且合法」—— URL 好不好看不该挡住作者发文。
 */
export function slugFromTitle(title: string): string {
  const ascii = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  if (ascii.length >= 2) return ascii
  return `article-${Math.random().toString(36).slice(2, 8)}`
}
