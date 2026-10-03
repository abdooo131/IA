import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';

type Handler = (data: any) => Promise<unknown>;

/**
 * Background jobs. Uses BullMQ on Redis when REDIS_URL is set; otherwise runs jobs in process
 * right after the request (tests and simple local runs). Handlers are registered by feature services.
 */
@Injectable()
export class JobsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Jobs');
  private readonly handlers = new Map<string, Handler>();
  private queue: Queue | null = null;
  private worker: Worker | null = null;
  private readonly schedules: { name: string; pattern: string; tz: string }[] = [];

  register(name: string, handler: Handler) {
    this.handlers.set(name, handler);
  }

  /** Repeating job (cron pattern) registered once per name; BullMQ keeps a single schedule across instances. */
  async schedule(name: string, pattern: string, tz: string) {
    this.schedules.push({ name, pattern, tz });
    if (this.queue) await this.queue.upsertJobScheduler(name, { pattern, tz }, { name });
  }

  get usingRedis() {
    return !!this.queue;
  }

  async onModuleInit() {
    const url = process.env.REDIS_URL;
    if (!url) {
      this.log.log('REDIS_URL not set: jobs run in process');
      return;
    }
    const connection = { url, maxRetriesPerRequest: null as null };
    this.queue = new Queue('shiply', { connection });
    this.worker = new Worker(
      'shiply',
      async (job) => {
        const h = this.handlers.get(job.name);
        if (!h) throw new Error(`No handler for job ${job.name}`);
        return h(job.data);
      },
      { connection, concurrency: 2 },
    );
    this.worker.on('failed', (job, err) => this.log.error(`Job ${job?.name} failed: ${err.message}`));
    for (const s of this.schedules) await this.queue.upsertJobScheduler(s.name, { pattern: s.pattern, tz: s.tz }, { name: s.name });
  }

  async enqueue(name: string, data: unknown) {
    if (this.queue) {
      await this.queue.add(name, data, { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 100, removeOnFail: 500 });
      return;
    }
    const h = this.handlers.get(name);
    if (!h) throw new Error(`No handler for job ${name}`);
    setImmediate(() => h(data).catch((e) => this.log.error(`Job ${name} failed: ${(e as Error).message}`)));
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
  }
}
