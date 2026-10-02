import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

type InlineHandler = (jobName: string, data: unknown) => Promise<void>;

@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private connection: IORedis | null = null;
  private queues = new Map<string, Queue>();
  private disabled = false;
  private checked = false;
  private inline = new Map<string, InlineHandler>();

  /** Регистрация обработчика на случай отсутствия Redis (локальный/dev режим). */
  registerInlineHandler(queueName: string, handler: InlineHandler) {
    this.inline.set(queueName, handler);
  }

  private async ensureRedis(): Promise<IORedis | null> {
    if (this.disabled) return null;
    if (this.connection && this.connection.status === 'ready') return this.connection;

    if (!this.connection) {
      this.connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
        maxRetriesPerRequest: null,
        enableReadyCheck: true,
        lazyConnect: true,
        retryStrategy: () => null,
        reconnectOnError: () => false,
        connectTimeout: 1500,
      });
      this.connection.on('error', () => {
        /* silenced after disable */
      });
    }

    if (!this.checked) {
      this.checked = true;
      try {
        await this.connection.connect();
        await this.connection.ping();
        this.logger.log('Redis connected');
      } catch (e: any) {
        this.disabled = true;
        this.logger.warn(
          `Redis unavailable — inline job mode (${e.message || e})`,
        );
        try {
          this.connection.disconnect();
        } catch {
          /* noop */
        }
        this.connection = null;
        return null;
      }
    }

    return this.disabled ? null : this.connection;
  }

  getQueue(name: string): Queue | null {
    if (this.disabled || !this.connection) return null;
    if (!this.queues.has(name)) {
      this.queues.set(name, new Queue(name, { connection: this.connection }));
    }
    return this.queues.get(name)!;
  }

  async enqueue(name: string, jobName: string, data: unknown, opts?: Record<string, unknown>) {
    const conn = await this.ensureRedis();
    if (conn) {
      try {
        const q = this.getQueue(name);
        if (q) {
          return await q.add(jobName, data as any, {
            removeOnComplete: 1000,
            removeOnFail: 5000,
            attempts: 5,
            backoff: { type: 'exponential', delay: 3000 },
            ...(opts || {}),
          });
        }
      } catch (e: any) {
        this.logger.warn(`enqueue failed, falling back to inline: ${e.message}`);
        this.disabled = true;
      }
    }

    const handler = this.inline.get(name);
    if (handler) {
      setImmediate(() => {
        handler(jobName, data).catch((err) =>
          this.logger.error(`inline ${name}/${jobName}: ${err?.message || err}`),
        );
      });
      return { id: `inline-${Date.now()}`, inline: true } as any;
    }

    this.logger.warn(`Queue ${name} skipped (no redis, no inline): ${jobName}`);
    return null;
  }

  async onModuleDestroy() {
    for (const q of this.queues.values()) await q.close().catch(() => undefined);
    if (this.connection) await this.connection.quit().catch(() => undefined);
  }
}

export const QUEUES = {
  deposits: 'deposits',
  payouts: 'payouts',
  sweeps: 'sweeps',
  cryptobot: 'cryptobot',
  notify: 'notify',
} as const;
