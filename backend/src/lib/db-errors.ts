import { QueryFailedError } from 'typeorm';

interface PgDriverError {
  code?: string;
  constraint?: string;
}

function pgError(err: unknown): PgDriverError | undefined {
  return err instanceof QueryFailedError ? (err.driverError as PgDriverError) : undefined;
}

/** 23505 unique_violation, optionally for a specific constraint. */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const pg = pgError(err);
  return pg?.code === '23505' && (!constraint || pg.constraint === constraint);
}

/** 23514 check_violation, e.g. CHK_products_stock_non_negative. */
export function isCheckViolation(err: unknown, constraint?: string): boolean {
  const pg = pgError(err);
  return pg?.code === '23514' && (!constraint || pg.constraint === constraint);
}
