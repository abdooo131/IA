// The platform module's public interface. Other modules import only from here.
export { PlatformModule } from './platform.module';
export { DB } from './tokens';
export type { SessionUser } from './types';
export { NeedAccess } from './access/need-access.decorator';
export { Public } from './auth/public.decorator';
export { AuditService, type AuditEntry } from './audit/audit.service';
export { SettingsService, SETTING_DEFAULTS } from './settings/settings.service';
export { HomeRegistry, type AttentionItem, type HomeNumber } from './home/home.registry';
export { parse } from './validate';
