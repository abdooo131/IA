import type { PhotoKind } from '@prisma/client';
import type { Db } from './client';
import { DomainError } from './domain-error';

const TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const MAX_PHOTO_BYTES = 1_500_000;

/** Stores a small proof photo (pack or delivery). The client shrinks photos before upload. */
export async function savePhoto(
  db: Db,
  input: { kind: PhotoKind; contentType: string; data: Buffer; actorUserId: string | null },
) {
  if (!TYPES.includes(input.contentType)) throw new DomainError('photo_type_not_allowed', 400);
  if (input.data.length === 0) throw new DomainError('photo_empty', 400);
  if (input.data.length > MAX_PHOTO_BYTES) throw new DomainError('photo_too_large', 400);
  const photo = await db.photo.create({
    data: {
      kind: input.kind,
      contentType: input.contentType,
      data: new Uint8Array(input.data),
      sizeBytes: input.data.length,
      createdById: input.actorUserId,
    },
    select: { id: true, kind: true, sizeBytes: true },
  });
  return photo;
}
