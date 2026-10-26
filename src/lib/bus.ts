/**
 * 跨标签页同步总线（FRONTEND-WORK §4.5 / ROADMAP §5.3）。
 * BroadcastChannel('gy') 广播 interaction:changed；动态期由 Realtime 取代，事件名保持不变。
 */
export const BUS_CHANNEL = 'gy'

export const BUS_EVENTS = {
  /** 互动变化（赞/藏/评）：payload = { photoId } */
  INTERACTION_CHANGED: 'interaction:changed',
  /** 会话变化（登录/登出）：payload = null */
  SESSION_CHANGED: 'session:changed',
} as const

export type BusEvent = (typeof BUS_EVENTS)[keyof typeof BUS_EVENTS]

let channel: BroadcastChannel | null = null

function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null // 极老浏览器降级
  if (!channel) channel = new BroadcastChannel(BUS_CHANNEL)
  return channel
}

/** 订阅事件；返回取消函数 */
export function onBusEvent(event: BusEvent, handler: (payload: unknown) => void): () => void {
  const ch = getChannel()
  if (!ch) return () => {}
  const listener = (e: MessageEvent) => {
    if (e.data?.event === event) handler(e.data.payload)
  }
  ch.addEventListener('message', listener)
  return () => ch.removeEventListener('message', listener)
}

/** 广播事件（跨标签页） */
export function emitBusEvent(event: BusEvent, payload: unknown = null): void {
  getChannel()?.postMessage({ event, payload })
}
