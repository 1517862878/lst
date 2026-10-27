/**
 * 短信发送（可插拔）。
 *
 * 当前阶段（用户已确认"方案一"）：SMS_PROVIDER 未设或为 console 时，
 * 验证码只打到服务端日志，不接真实短信通道，避免在没有短信资质时阻塞开发。
 * 上云后换阿里云：实现 SmsSender + 设 SMS_PROVIDER=aliyun，业务代码零改动。
 *
 * 职责边界：本模块只负责"发出去"。
 * 验证码的哈希、过期、尝试次数、冷却全部由数据库（phone_verifications + 0013 的函数）负责，
 * 因为那些是安全属性，必须落在服务端权威存储上，不能交给无状态的 Node 进程。
 */
export interface SmsSendInput {
  phone: string
  /** 明文验证码（只在内存里短暂存在，数据库只存哈希） */
  code: string
  purpose: string
  ttlSeconds: number
}

export interface SmsSender {
  readonly name: string
  send(input: SmsSendInput): Promise<void>
}

const consoleSender: SmsSender = {
  name: 'console',
  async send({ phone, code, purpose, ttlSeconds }) {
    // 开发期唯一可见渠道，故意打得显眼
    console.info(
      `[sms:console] 验证码 ${code} → ${phone}（用途 ${purpose}，${ttlSeconds} 秒内有效）`,
    )
  },
}

const aliyunSender: SmsSender = {
  name: 'aliyun',
  async send() {
    throw new Error(
      '阿里云短信通道尚未接入：请实现 SmsSender 并配置 AccessKey / 签名 / 模板 ID',
    )
  },
}

/** 由环境变量选择通道；默认 console（开发友好，且不会意外产生短信费用） */
export const smsSender: SmsSender =
  process.env.SMS_PROVIDER === 'aliyun' ? aliyunSender : consoleSender
