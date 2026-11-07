// Egyptian mobile numbers, stored as +20 followed by 10 digits.
export function normalizeEgyptPhone(input: string): string | null {
  const digits = input.replace(/[\s()+-]/g, '');
  let local: string;
  if (/^0020\d{10}$/.test(digits)) local = '0' + digits.slice(4);
  else if (/^20\d{10}$/.test(digits)) local = '0' + digits.slice(2);
  else if (/^0\d{10}$/.test(digits)) local = digits;
  else if (/^1\d{9}$/.test(digits)) local = '0' + digits;
  else return null;
  if (!/^01[0125]\d{8}$/.test(local)) return null;
  return '+20' + local.slice(1);
}
