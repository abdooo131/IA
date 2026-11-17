import { DomainError, getEmployeePhoto } from '@shiplynow/db';
import { documentUploadSchema } from '@shiplynow/shared';
import type { Request, Response } from 'express';
import type { PrismaService } from '../prisma/prisma.service';

/** Sends a stored document: photos and PDFs open in the browser unless a download is asked. */
export function sendDocument(
  res: Response,
  doc: {
    type: { code: string };
    contentType: string;
    data: Uint8Array;
    id: string;
    version: number;
  },
  download = false,
) {
  const ext = doc.contentType === 'application/pdf' ? 'pdf' : doc.contentType.split('/')[1];
  res.setHeader('content-type', doc.contentType);
  res.setHeader(
    'content-disposition',
    `${download ? 'attachment' : 'inline'}; filename="${doc.type.code}-v${doc.version}.${ext}"`,
  );
  res.setHeader('cache-control', 'private, no-store');
  // The web app shows PDFs in a frame of its own pages: allow that one ancestor only.
  res.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.send(Buffer.from(doc.data));
}

/** Sends a person's photo (the address carries its version, so it may be cached a while). */
export async function sendPhoto(
  prisma: PrismaService,
  res: Response,
  employeeId: string,
  versioned = true,
) {
  const photo = await getEmployeePhoto(prisma, employeeId);
  res.setHeader('content-type', photo.contentType);
  // Versioned addresses (?v=) change with the photo; the account menu's plain one must not stick.
  res.setHeader('cache-control', versioned ? 'private, max-age=86400' : 'private, no-cache');
  res.send(Buffer.from(photo.data));
}

/** The query and raw body of a document upload. */
export function readUpload(query: Record<string, string>, req: Request) {
  const parsed = documentUploadSchema.safeParse({
    typeId: query.typeId,
    title: query.title || undefined,
    issuedOn: query.issuedOn || undefined,
    expiresOn: query.expiresOn || undefined,
    replacesId: query.replacesId || undefined,
  });
  if (!parsed.success) throw new DomainError('validation_failed', 400);
  if (!Buffer.isBuffer(req.body)) throw new DomainError('document_type_not_allowed', 400);
  const contentType = (req.headers['content-type'] ?? '').split(';')[0]!.trim();
  return { ...parsed.data, contentType, data: req.body };
}
