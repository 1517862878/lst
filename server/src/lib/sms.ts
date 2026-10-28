import { createHmac, randomUUID } from 'node:crypto'

export interface SmsSendInput {
  phone: string
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
    console.info(`[sms:console] 验证码 ${code} → ${phone}（用途 ${purpose}，${ttlSeconds} 秒内有效）`)
  },
}

function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}
function utcTimestamp(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
}

const aliyunSender: SmsSender = {
  name: 'aliyun',
  async send({ phone, code, purpose, ttlSeconds }) {
    const keyId=process.env.ALIYUN_SMS_ACCESS_KEY_ID?.trim() ?? ''
    const keySecret=process.env.ALIYUN_SMS_ACCESS_KEY_SECRET?.trim() ?? ''
    const signName=process.env.ALIYUN_SMS_SIGN_NAME?.trim() ?? ''
    const templateCode=process.env.ALIYUN_SMS_TEMPLATE_CODE?.trim() ?? ''
    if (!keyId || !keySecret || !signName || !templateCode) throw new Error('阿里云短信环境变量不完整')
    const params: Record<string,string> = {
      AccessKeyId:keyId, Action:'SendSms', Format:'JSON', PhoneNumbers:phone,
      SignatureMethod:'HMAC-SHA1', SignatureNonce:randomUUID(), SignatureVersion:'1.0',
      SignName:signName, TemplateCode:templateCode,
      TemplateParam:JSON.stringify({ code, purpose, ttl:Math.ceil(ttlSeconds/60) }),
      Timestamp:utcTimestamp(), Version:'2017-05-25',
    }
    const canonical=Object.entries(params).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${percentEncode(k)}=${percentEncode(v)}`).join('&')
    const stringToSign=`GET&%2F&${percentEncode(canonical)}`
    params.Signature=createHmac('sha1',`${keySecret}&`).update(stringToSign).digest('base64')
    const query=Object.entries(params).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${percentEncode(k)}=${percentEncode(v)}`).join('&')
    const response=await fetch(`https://dysmsapi.aliyuncs.com/?${query}`,{signal:AbortSignal.timeout(5000)})
    const result=(await response.json()) as { Code?:string; Message?:string }
    if (!response.ok || result.Code!=='OK') throw new Error(`阿里云短信发送失败：${result.Code ?? response.status} ${result.Message ?? ''}`.trim())
  },
}

const provider=process.env.SMS_PROVIDER?.trim() || 'console'
if (process.env.NODE_ENV==='production' && provider!=='aliyun') throw new Error('生产环境必须设置 SMS_PROVIDER=aliyun')
export const smsSender: SmsSender = provider==='aliyun' ? aliyunSender : consoleSender
