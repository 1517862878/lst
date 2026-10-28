import assert from 'node:assert/strict'
import test from 'node:test'
import type { FastifyBaseLogger } from 'fastify'
import type { StorageCleanupJob } from '../repositories/storage-cleanup.js'
import { StorageCleanupWorker, type CleanupJobRepository } from './cleanup-worker.js'
import type { ObjectStorage } from './local-disk.js'

const job: StorageCleanupJob = {
  id: '1',
  objectKey: 'photos/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/display.webp',
  leaseToken: '33333333-3333-4333-8333-333333333333',
}

const silentLogger = {
  warn() {},
  error() {},
} as unknown as FastifyBaseLogger

function repository(overrides: Partial<CleanupJobRepository> = {}): CleanupJobRepository {
  return {
    claim: async () => [job],
    complete: async () => true,
    retry: async () => true,
    ...overrides,
  }
}

test('worker 仅在对象删除成功后完成任务', async () => {
  const calls: string[] = []
  const storage: ObjectStorage = { remove: async () => { calls.push('remove') } }
  const repo = repository({
    complete: async () => { calls.push('complete'); return true },
    retry: async () => { calls.push('retry'); return true },
  })

  const worker = new StorageCleanupWorker(storage, silentLogger, repo)
  assert.equal(await worker.runOnce(), 1)
  assert.deepEqual(calls, ['remove', 'complete'])
})

test('对象存储失败时释放任务供退避重试，不错误完成', async () => {
  const calls: string[] = []
  const failure = new Error('temporary storage failure')
  const storage: ObjectStorage = { remove: async () => { calls.push('remove'); throw failure } }
  const repo = repository({
    complete: async () => { calls.push('complete'); return true },
    retry: async (_job, error) => { calls.push(error === failure ? 'retry' : 'wrong-error'); return true },
  })

  const worker = new StorageCleanupWorker(storage, silentLogger, repo)
  assert.equal(await worker.runOnce(), 1)
  assert.deepEqual(calls, ['remove', 'retry'])
})

test('并发轮询不会在同一进程重复领取', async () => {
  let releases: (() => void) | undefined
  let claims = 0
  const repo = repository({
    claim: async () => {
      claims += 1
      await new Promise<void>((resolve) => { releases = resolve })
      return []
    },
  })
  const worker = new StorageCleanupWorker({ remove: async () => undefined }, silentLogger, repo)

  const first = worker.runOnce()
  assert.equal(await worker.runOnce(), 0)
  releases?.()
  assert.equal(await first, 0)
  assert.equal(claims, 1)
})
