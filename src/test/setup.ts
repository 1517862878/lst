import '@testing-library/jest-dom/vitest'

/*
 * window.matchMedia 测试桩。
 *
 * 为什么要自己装：jsdom 对 matchMedia 要么没实现（直接 TypeError），要么给一个
 * matches 恒为 false 的桩 —— 两种情况都拿不到「相对于当前视口宽度」的真实判断，
 * 而组件确实在用它：
 *   · Header.tsx:37               —— (min-width: 861px) 判断是否回到桌面档
 *   · PixelStarsBackground.tsx:67 —— (prefers-reduced-motion: reduce) 降级为静态星场
 * 所以这里无条件覆盖，而不是只在缺失时兜底。
 *
 * 实现范围：matches 按查询条件求值（min-width / max-width 对着 window.innerWidth，
 * jsdom 默认 1024），监听器为 no-op。
 * 需要在测试里模拟「窗口变宽/变窄」时，改 window.innerWidth 后重渲染即可；
 * 若要触发 'change' 回调，需要在这里补一个监听器注册表。
 */
function evaluateQuery(query: string): boolean {
  const minWidth = /\(min-width:\s*(\d+)px\)/.exec(query)
  if (minWidth) return window.innerWidth >= Number(minWidth[1])

  const maxWidth = /\(max-width:\s*(\d+)px\)/.exec(query)
  if (maxWidth) return window.innerWidth <= Number(maxWidth[1])

  // 'reduce' 等其余查询一律返回 false = 不声明该偏好，组件走默认分支
  return false
}

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  configurable: true,
  value: (query: string) =>
    ({
      matches: evaluateQuery(query),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => true,
    }) as unknown as MediaQueryList,
})
