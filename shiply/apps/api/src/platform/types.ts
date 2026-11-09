import type { AppId, Level } from '@shiply/shared';

export interface SessionUser {
  id: string;
  kind: string;
  access: Record<AppId, Level>;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}
