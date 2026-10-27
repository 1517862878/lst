/**
 * 密码哈希（argon2id）。
 *
 * 为什么必须引依赖、不能自己写：
 *   CONTRIBUTING §依赖 要求「新增依赖须说明为什么不能自己写 20 行」。
 *   密码哈希恰好是"不能自己写"的典型——要内存硬化、抗 GPU/ASIC 爆破，
 *   而且实现里错一个字节（比较不是常量时间、salt 复用）就是安全漏洞。
 *
 * 选 @node-rs/argon2 而不是 argon2：前者有预编译产物（含 linux-x64），
 * 上云不需要 node-gyp 编译链——《上云优化方案》§2.2 已定。
 *
 * 参数取 OWASP 推荐下限：m=19456(19MiB), t=2, p=1。
 * 本机实测 hash≈14ms / verify≈31ms，登录体验无感。
 */
import { randomBytes } from 'node:crypto'
import { hash, verify } from '@node-rs/argon2'

const OPTIONS = {
  // 2 = Argon2id。这里用字面量而不是包的 Algorithm 枚举：
  // 已实测产出 `$argon2id$v=19$...` 前缀，确认取值正确。
  algorithm: 2,
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTIONS)
}

/**
 * 用户不存在时用来空跑一次的哈希。
 * 惰性生成：密码随机，永远不可能匹配成功。
 */
let dummyHashPromise: Promise<string> | null = null
function dummyHash(): Promise<string> {
  dummyHashPromise ??= hash(randomBytes(32).toString('hex'), OPTIONS)
  return dummyHashPromise
}

/**
 * 校验密码。
 *
 * 两个刻意的设计：
 *   1) storedHash 为 null（用户不存在）时也跑一次同开销的校验。
 *      否则「响应快 = 用户不存在」，攻击者能靠计时枚举出注册过的用户名。
 *   2) 存量占位哈希（如 seed 里的 PLACEHOLDER_WILL_BE_REPL…）不是合法 argon2
 *      字符串，verify 会抛异常 —— 这里吞掉返回 false，而不是让 500 泄露内部状态。
 */
export async function verifyPassword(storedHash: string | null, plain: string): Promise<boolean> {
  if (!storedHash) {
    try {
      await verify(await dummyHash(), plain)
    } catch {
      // 仅为抹平时间差，结果无所谓
    }
    return false
  }

  try {
    return await verify(storedHash, plain)
  } catch {
    return false
  }
}
