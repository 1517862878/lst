import { useEffect, useId, useRef } from 'react'

declare global {
  interface Window {
    turnstile?: {
      render(element: HTMLElement, options: Record<string, unknown>): string
      remove(widgetId: string): void
      reset(widgetId: string): void
    }
  }
}

let loader: Promise<void> | null = null
function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve()
  if (loader) return loader
  loader = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-turnstile-loader]')
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error('人机验证加载失败')), { once: true })
      return
    }
    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    script.defer = true
    script.dataset.turnstileLoader = 'true'
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('人机验证加载失败'))
    document.head.append(script)
  })
  return loader
}

export interface TurnstileWidgetProps {
  action: 'register_code' | 'login'
  onToken(token: string): void
  onError(message: string): void
}

export function TurnstileWidget({ action, onToken, onError }: TurnstileWidgetProps) {
  const siteKey = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined)?.trim()
  const ref = useRef<HTMLDivElement>(null)
  const id = useId()
  useEffect(() => {
    if (!siteKey || !ref.current) return
    let widgetId: string | undefined
    let cancelled = false
    loadTurnstile().then(() => {
      if (cancelled || !ref.current || !window.turnstile) return
      widgetId = window.turnstile.render(ref.current, {
        sitekey: siteKey,
        action,
        callback: (token: string) => onToken(token),
        'expired-callback': () => onToken(''),
        'error-callback': () => onError('人机验证失败，请重试'),
        language: 'zh-cn',
      })
    }).catch((error: unknown) => onError(error instanceof Error ? error.message : '人机验证加载失败'))
    return () => { cancelled = true; if (widgetId && window.turnstile) window.turnstile.remove(widgetId) }
  }, [action, onError, onToken, siteKey])
  if (!siteKey) return null
  return <div id={`turnstile-${id}`} ref={ref} className="g-turnstile" aria-label="人机验证" />
}
