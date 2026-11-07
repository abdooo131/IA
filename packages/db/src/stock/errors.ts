export type StockErrorCode =
  | 'invalid_quantity'
  | 'bin_not_found'
  | 'bin_inactive'
  | 'bin_wrong_store'
  | 'bin_not_pickable'
  | 'bin_not_allowed'
  | 'same_bin'
  | 'insufficient_stock'
  | 'insufficient_bin_stock'
  | 'insufficient_reserved'
  | 'would_break_reservations';

/** A stock rule refused the change. Nothing was written. */
export class StockError extends Error {
  constructor(
    readonly code: StockErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'StockError';
  }
}
