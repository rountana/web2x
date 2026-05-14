import type { ErrorHandler } from 'hono';
import type { ApiError } from '@web2x/shared';

export const errorMiddleware: ErrorHandler = (err, c) => {
  console.error('[ERROR]', err);

  if (err instanceof ValidationError) {
    return c.json<ApiError>({ error: err.message, code: 'VALIDATION_ERROR' }, 400);
  }

  if (err instanceof NotFoundError) {
    return c.json<ApiError>({ error: err.message, code: 'NOT_FOUND' }, 404);
  }

  return c.json<ApiError>({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500);
};

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends Error {
  constructor(resource: string) {
    super(`${resource} not found`);
    this.name = 'NotFoundError';
  }
}
