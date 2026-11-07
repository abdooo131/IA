/** A business rule refused the request. Nothing was written. */
export class DomainError extends Error {
  constructor(
    readonly code: string,
    readonly status: 400 | 403 | 404 | 409 = 409,
    /** Plain values the answer carries next to the code, for example a distance */
    readonly details?: Record<string, string | number | boolean | null>,
  ) {
    super(code);
    this.name = 'DomainError';
  }
}
