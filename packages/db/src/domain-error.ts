/** A business rule refused the request. Nothing was written. */
export class DomainError extends Error {
  constructor(
    readonly code: string,
    readonly status: 400 | 403 | 404 | 409 = 409,
  ) {
    super(code);
    this.name = 'DomainError';
  }
}
