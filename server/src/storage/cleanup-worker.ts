import type { FastifyBaseLogger } from 'fastify'
import {
  claimStorageCleanupJobs,
  completeStorageCleanupJob,
  retryStorageCleanupJob,
  type StorageCleanupJob,
} from '../repositories/storage-cleanup.js'
import type { ObjectStorage } from './local-disk.js'

export interface CleanupJobRepository {
  claim(limit: number, leaseSeconds: number): Promise<StorageCleanupJob[]>
  complete(job: StorageCleanupJob): Promise<boolean>
  retry(job: StorageCleanupJob, error: unknown): Promise<boolean>
}

export interface StorageCleanupWorkerOptions {
  batchSize?: number
  leaseSeconds?: number
  intervalMs?: number
}

const databaseRepository: CleanupJobRepository = {
  claim: claimStorageCleanupJobs,
  complete: completeStorageCleanupJob,
  retry: retryStorageCleanupJob,
}

export class StorageCleanupWorker {
  private readonly batchSize: number
  private readonly leaseSeconds: number
  private readonly intervalMs: number
  private timer: NodeJS.Timeout | undefined
  private running = false
  private stopped = true

  constructor(
    private readonly storage: ObjectStorage,
    private readonly log: FastifyBaseLogger,
    private readonly repository: CleanupJobRepository = databaseRepository,
    options: StorageCleanupWorkerOptions = {},
  ) {
    this.batchSize = options.batchSize ?? 20
    this.leaseSeconds = options.leaseSeconds ?? 300
    this.intervalMs = options.intervalMs ?? 30_000
  }

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    void this.tick()
  }

  stop(): void {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
  }

  async runOnce(): Promise<number> {
    if (this.running) return 0
    this.running = true
    try {
      const jobs = await this.repository.claim(this.batchSize, this.leaseSeconds)
      for (const job of jobs) await this.process(job)
      return jobs.length
    } finally {
      this.running = false
    }
  }

  private async process(job: StorageCleanupJob): Promise<void> {
    try {
      await this.storage.remove(job.objectKey)
      const completed = await this.repository.complete(job)
      if (!completed) this.log.warn({ cleanupJobId: job.id }, '图片已删除，但任务租约已失效')
    } catch (error) {
      const released = await this.repository.retry(job, error).catch((releaseError: unknown) => {
        this.log.error({ err: releaseError, cleanupJobId: job.id }, '图片清理失败且任务重试状态写入失败')
        return false
      })
      this.log.warn({ err: error, cleanupJobId: job.id, released }, '图片清理失败，任务将按退避策略重试')
    }
  }

  private async tick(): Promise<void> {
    try {
      await this.runOnce()
    } catch (error) {
      this.log.error({ err: error }, '图片清理 worker 轮询失败')
    } finally {
      if (!this.stopped) this.timer = setTimeout(() => void this.tick(), this.intervalMs)
    }
  }
}
