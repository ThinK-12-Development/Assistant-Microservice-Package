export declare class GatewayError extends Error {
    readonly status: number;
    readonly code: string;
    readonly details?: unknown | undefined;
    constructor(message: string, status: number, code: string, details?: unknown | undefined);
}
export declare class AuthError extends GatewayError {
    constructor(message?: string, details?: unknown);
}
export declare class ForbiddenError extends GatewayError {
    constructor(message?: string, details?: unknown);
}
export declare class NotFoundError extends GatewayError {
    constructor(message?: string, details?: unknown);
}
export declare class ValidationError extends GatewayError {
    constructor(message?: string, details?: unknown);
}
export declare class RateLimitError extends GatewayError {
    readonly retryAfterSeconds: number;
    constructor(retryAfterSeconds: number, message?: string, details?: unknown);
}
export declare function parseGatewayError(status: number, body: unknown): GatewayError;
//# sourceMappingURL=errors.d.ts.map