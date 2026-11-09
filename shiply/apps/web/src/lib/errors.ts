import { ApiError } from './api';

type T = { (key: string): string; has(key: string): boolean };

/** The words for an API error: the module's own text when it has one, else "try again". */
export function errorText(t: T, err: unknown, ns: string): string {
  const code = err instanceof ApiError ? err.body.error : undefined;
  return code && t.has(`${ns}.errors.${code}`) ? t(`${ns}.errors.${code}`) : t('common.failed');
}
