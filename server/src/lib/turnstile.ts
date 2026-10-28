import {
  TURNSTILE_PROVIDER,
  TURNSTILE_SECRET,
  TURNSTILE_SITEVERIFY_URL,
  TURNSTILE_TIMEOUT_MS,
} from './config.js'
import { forbidden, validation } from './errors.js'

export interface BotVerifier {
  verify(input: { token: string; remoteIp?: string; action: string }): Promise<void>
}

class OffBotVerifier implements BotVerifier {
  async verify(): Promise<void> {}
}

class CloudflareTurnstileVerifier implements BotVerifier {
  async verify(input: { token: string; remoteIp?: string; action: string }): Promise<void> {
    if (!input.token) throw validation('请完成人机验证')
    const body = new URLSearchParams({ secret: TURNSTILE_SECRET, response: input.token })
    if (input.remoteIp) body.set('remoteip', input.remoteIp)
    let response: Response
    try {
      response = await fetch(TURNSTILE_SITEVERIFY_URL, {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(TURNSTILE_TIMEOUT_MS),
      })
    } catch {
      throw forbidden('人机验证服务暂不可用，请稍后重试')
    }
    const result = (await response.json()) as { success?: boolean; action?: string }
    if (!response.ok || !result.success || (result.action && result.action !== input.action)) {
      throw forbidden('人机验证失败，请重试')
    }
  }
}

export const botVerifier: BotVerifier = TURNSTILE_PROVIDER === 'cloudflare'
  ? new CloudflareTurnstileVerifier()
  : new OffBotVerifier()
