import { type ArgumentsHost, Catch, type ExceptionFilter } from '@nestjs/common';
import { DomainError, StockError } from '@shiplynow/db';
import type { Response } from 'express';

/** Turns business rule refusals into clean JSON errors: { error: code }. */
@Catch(DomainError, StockError)
export class DomainErrorFilter implements ExceptionFilter {
  catch(error: DomainError | StockError, host: ArgumentsHost) {
    const status = error instanceof DomainError ? error.status : 409;
    host.switchToHttp().getResponse<Response>().status(status).json({ error: error.code });
  }
}
