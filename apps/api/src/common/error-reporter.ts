import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Turns unexpected failures (a crashed request, a background job that threw) into an admin
 * alert, so problems on the live server are seen on the Alerts page and not only in a log.
 * The same problem raises one alert that counts repeats until admin marks it handled.
 * Request bodies and query strings are never stored, so no secret or personal data ends up
 * in an alert.
 */
@Injectable()
export class ErrorReporter {
  private readonly log = new Logger('Errors');

  constructor(private readonly prisma: PrismaService) {}

  async report(source: string, error: unknown) {
    const message = (error instanceof Error ? error.message : String(error))
      .replace(/\s+/g, ' ')
      .slice(0, 300);
    this.log.error(`${source}: ${message}`, error instanceof Error ? error.stack : undefined);
    const key = `${source}|${message.slice(0, 120)}`;
    const now = new Date().toISOString();
    try {
      const open = await this.prisma.alert.findFirst({
        where: { type: 'server_error', resolvedAt: null, data: { path: ['key'], equals: key } },
      });
      if (open) {
        const data = (open.data ?? {}) as Record<string, unknown>;
        await this.prisma.alert.update({
          where: { id: open.id },
          data: { data: { ...data, count: Number(data.count ?? 1) + 1, lastAt: now } },
        });
      } else {
        await this.prisma.alert.create({
          data: { type: 'server_error', data: { key, source, message, count: 1, lastAt: now } },
        });
      }
    } catch (failure) {
      // The database itself may be the problem; the log line above is all we can do.
      this.log.error(`Could not record the alert: ${(failure as Error).message}`);
    }
  }
}

@Global()
@Module({ providers: [ErrorReporter], exports: [ErrorReporter] })
export class ErrorReporterModule {}
