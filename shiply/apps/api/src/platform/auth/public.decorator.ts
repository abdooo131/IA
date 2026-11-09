import { SetMetadata } from '@nestjs/common';

export const PUBLIC = 'shiply:public';
/** The route needs no session (login, refresh, health). */
export const Public = () => SetMetadata(PUBLIC, true);
