export class GatewayError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'GatewayError';
  }
}

export class AuthError extends GatewayError {
  constructor(message = 'Invalid or missing API key', details?: unknown) {
    super(message, 401, 'UNAUTHORIZED', details);
    this.name = 'AuthError';
  }
}

export class ForbiddenError extends GatewayError {
  constructor(message = 'Insufficient scope for this operation', details?: unknown) {
    super(message, 403, 'FORBIDDEN', details);
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends GatewayError {
  constructor(message = 'Resource not found', details?: unknown) {
    super(message, 404, 'NOT_FOUND', details);
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends GatewayError {
  constructor(message = 'Invalid request data', details?: unknown) {
    super(message, 422, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
  }
}

export class RateLimitError extends GatewayError {
  constructor(
    public readonly retryAfterSeconds: number,
    message = "We're experiencing high usage volume. Please try again in a few minutes.",
    details?: unknown,
  ) {
    super(message, 429, 'RATE_LIMIT_EXCEEDED', details);
    this.name = 'RateLimitError';
  }
}

export function parseGatewayError(status: number, body: unknown): GatewayError {
  const msg =
    typeof body === 'object' && body !== null && 'message' in body
      ? String((body as Record<string, unknown>).message)
      : 'An unexpected error occurred';

  const details =
    typeof body === 'object' && body !== null && 'details' in body
      ? (body as Record<string, unknown>).details
      : undefined;

  if (status === 401) return new AuthError(msg, details);
  if (status === 403) return new ForbiddenError(msg, details);
  if (status === 404) return new NotFoundError(msg, details);
  if (status === 422) return new ValidationError(msg, details);

  if (status === 429) {
    const retryAfter =
      typeof body === 'object' && body !== null && 'retryAfterSeconds' in body
        ? Number((body as Record<string, unknown>).retryAfterSeconds)
        : 3600;
    return new RateLimitError(retryAfter, msg, details);
  }

  return new GatewayError(msg, status, 'GATEWAY_ERROR', details);
}
