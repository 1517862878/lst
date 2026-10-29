/**
 * 403 账号限制提示的进程内事件桥（8.2 补口）。
 *
 * 为什么需要它：统一的 403 处理发生在 `src/data/api/client.ts` 的纯函数里，
 * 那里既不能调用 React hook，也不该反向 import 组件/页面。客户端只负责
 * 「识别并广播」，真正弹 toast 的是挂在 Shell 上的 RestrictionBanner。
 *
 * 监听方异常不能中断请求：emit 里逐个 try/catch，把 UI 的 bug 隔离在 UI 侧。
 */
import type { SanctionBlock } from '@/domain/restrictions'

export interface SanctionBlockedNotice extends SanctionBlock {
  /** 已经拼好期限的完整提示文案 */
  message: string
}

type Listener = (notice: SanctionBlockedNotice) => void

const listeners = new Set<Listener>()

/** 返回取消订阅函数，供 useEffect 清理；多次挂载互不影响 */
export function onSanctionBlocked(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function emitSanctionBlocked(notice: SanctionBlockedNotice): void {
  for (const listener of [...listeners]) {
    try {
      listener(notice)
    } catch {
      // 提示失败不能把一次本应抛给页面的 403 变成未捕获异常
    }
  }
}
