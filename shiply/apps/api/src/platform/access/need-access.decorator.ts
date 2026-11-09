import { SetMetadata } from '@nestjs/common';
import type { AppId, Level } from '@shiply/shared';

export const NEED_ACCESS = 'shiply:need-access';
export const NeedAccess = (app: AppId, level: Level) => SetMetadata(NEED_ACCESS, { app, level });
