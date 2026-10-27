import { type ArgumentsHost, Catch, HttpException } from '@nestjs/common';
import { BaseExceptionFilter, type HttpAdapterHost } from '@nestjs/core';
import { DomainError, StockError } from '@shiplynow/db';
import type { Request, Response } from 'express';
import type { ErrorReporter } from './error-reporter';

/**
 * Every error a request can end with. Business rule refusals become clean JSON ({ error:
 * code }); HTTP errors keep Nest's usual answer; anything unexpected answers 500 and raises
 * an admin alert.
 */
@Catch()
export class AppErrorFilter extends BaseExceptionFilter {
  constructor(
    adapter: HttpAdapterHost['httpAdapter'],
    private readonly reporter: ErrorReporter,
  ) {
    super(adapter);
  }

  override catch(error: unknown, host: ArgumentsHost) {
    if (error instanceof DomainError || error instanceof StockError) {
      const status = error instanceof DomainError ? error.status : 409;
      host.switchToHttp().getResponse<Response>().status(status).json({ error: error.code });
      return;
    }
    if (!(error instanceof HttpException)) {
      const req = host.switchToHttp().getRequest<Request>();
      // Only the method and the path: query strings can carry signatures and codes.
      void this.reporter.report(`${req.method} ${req.path}`, error);
    }
    super.catch(error, host);
  }
}
