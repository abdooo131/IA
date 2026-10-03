import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';

/** Turns database rule violations (frozen pricing, bank lock, uniqueness) into readable 4xx errors. */
@Catch(Prisma.PrismaClientKnownRequestError, Prisma.PrismaClientUnknownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  catch(err: Prisma.PrismaClientKnownRequestError | Prisma.PrismaClientUnknownRequestError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const msg = err.message.split('\n').filter(Boolean).pop() ?? 'Database error';
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2002') return res.status(HttpStatus.CONFLICT).json({ statusCode: 409, message: 'Already exists' });
      if (err.code === 'P2025') return res.status(HttpStatus.NOT_FOUND).json({ statusCode: 404, message: 'Not found' });
    }
    const dbRule = /append only|frozen|can only be changed|row-level security/i.exec(msg);
    if (dbRule) return res.status(HttpStatus.UNPROCESSABLE_ENTITY).json({ statusCode: 422, message: msg.replace(/^.*?ERROR:\s*/, '') });
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ statusCode: 500, message: 'Database error' });
  }
}
