import { createTranslator } from 'next-intl';

/**
 * A translator in a given language whatever the reader's own: getTranslations({ locale }) goes
 * through the request config, which always loads the reader's messages (the locale is a
 * cookie), so a page offering an Arabic PDF to an English reader loads the Arabic messages
 * itself.
 */
export async function translatorIn(locale: 'en' | 'ar', namespace: string) {
  const messages = (await import(`../../messages/${locale}.json`)).default;
  // The namespace is a runtime string, so the translator is typed loosely.
  return createTranslator({ locale, messages, namespace } as never) as unknown as {
    (key: string, values?: Record<string, string | number | Date>): string;
    has: (key: string) => boolean;
  };
}
