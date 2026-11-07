import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { Response } from 'express';

/** A business rule said no. The message is safe to show to the person using the app. */
/** An HTTP error, so Shiply Now's error handler answers with { error, message } as the network always did. */
export class DomainError extends HttpException {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super({ error: code, message }, status);
    this.message = message;
  }
}

export const notFound = (what: string) => new DomainError('not_found', `${what} not found`, 404);
export const forbidden = (message = 'You cannot do this') => new DomainError('forbidden', message, 403);

@Catch()
export class ErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (error instanceof DomainError) {
      res.status(error.status).json({ error: error.code, message: error.message });
      return;
    }
    if (error instanceof HttpException) {
      const status = error.getStatus();
      const body = error.getResponse();
      const message = typeof body === 'string' ? body : ((body as { message?: unknown }).message ?? error.message);
      res.status(status).json({ error: 'http_error', message: Array.isArray(message) ? message.join(', ') : String(message) });
      return;
    }
    console.error(error);
    res.status(500).json({ error: 'internal', message: 'Something went wrong. Please try again.' });
  }
}
