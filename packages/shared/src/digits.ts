/**
 * Digits typed on an Arabic keyboard as the Latin digits every parser expects: Arabic Indic
 * (٠ to ٩) and Eastern Arabic Indic (۰ to ۹) become 0 to 9, the Arabic decimal separator ٫
 * becomes '.', and the Arabic thousands separator ٬ is dropped. Everything else is kept.
 */
export function toLatinDigits(text: string): string {
  return text
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, '.')
    .replace(/٬/g, '');
}
