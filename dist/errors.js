"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RateLimitError = exports.ValidationError = exports.NotFoundError = exports.ForbiddenError = exports.AuthError = exports.GatewayError = void 0;
exports.parseGatewayError = parseGatewayError;
class GatewayError extends Error {
    constructor(message, status, code, details) {
        super(message);
        this.status = status;
        this.code = code;
        this.details = details;
        this.name = 'GatewayError';
    }
}
exports.GatewayError = GatewayError;
class AuthError extends GatewayError {
    constructor(message = 'Invalid or missing API key', details) {
        super(message, 401, 'UNAUTHORIZED', details);
        this.name = 'AuthError';
    }
}
exports.AuthError = AuthError;
class ForbiddenError extends GatewayError {
    constructor(message = 'Insufficient scope for this operation', details) {
        super(message, 403, 'FORBIDDEN', details);
        this.name = 'ForbiddenError';
    }
}
exports.ForbiddenError = ForbiddenError;
class NotFoundError extends GatewayError {
    constructor(message = 'Resource not found', details) {
        super(message, 404, 'NOT_FOUND', details);
        this.name = 'NotFoundError';
    }
}
exports.NotFoundError = NotFoundError;
class ValidationError extends GatewayError {
    constructor(message = 'Invalid request data', details) {
        super(message, 422, 'VALIDATION_ERROR', details);
        this.name = 'ValidationError';
    }
}
exports.ValidationError = ValidationError;
class RateLimitError extends GatewayError {
    constructor(retryAfterSeconds, message = "We're experiencing high usage volume. Please try again in a few minutes.", details) {
        super(message, 429, 'RATE_LIMIT_EXCEEDED', details);
        this.retryAfterSeconds = retryAfterSeconds;
        this.name = 'RateLimitError';
    }
}
exports.RateLimitError = RateLimitError;
function parseGatewayError(status, body) {
    const b = typeof body === 'object' && body !== null ? body : {};
    const nested = typeof b.error === 'object' && b.error !== null ? b.error : null;
    const msg = nested?.message
        ? String(nested.message)
        : b.message
            ? String(b.message)
            : 'An unexpected error occurred';
    const details = typeof body === 'object' && body !== null && 'details' in body
        ? body.details
        : undefined;
    if (status === 401)
        return new AuthError(msg, details);
    if (status === 403)
        return new ForbiddenError(msg, details);
    if (status === 404)
        return new NotFoundError(msg, details);
    if (status === 422)
        return new ValidationError(msg, details);
    if (status === 429) {
        const retryAfter = typeof body === 'object' && body !== null && 'retryAfterSeconds' in body
            ? Number(body.retryAfterSeconds)
            : 3600;
        return new RateLimitError(retryAfter, msg, details);
    }
    return new GatewayError(msg, status, 'GATEWAY_ERROR', details);
}
//# sourceMappingURL=errors.js.map