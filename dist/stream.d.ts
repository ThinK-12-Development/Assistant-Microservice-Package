import type { Message, MessageImageRef } from './types.js';
export interface StreamChunk {
    type: 'text' | 'image_generated' | 'message' | 'done';
    text?: string;
    /** Present when type === 'image_generated'. Emitted as soon as the MS finishes generating an image, before the text response completes. */
    image?: MessageImageRef;
    /** Present when type === 'message'. The persisted assistant message, including `images` if the MS generated one for this turn. Yielded just before the final `done` chunk. */
    message?: Message;
}
/**
 * Parse an SSE stream response into an async iterator of text chunks.
 * Handles both the MS bridge format (data: {"type":"chunk","content":"..."})
 * and the Vercel AI SDK format (0:"...").
 * Throws GatewayError subclasses on non-2xx responses.
 */
export declare function parseDataStream(response: Response): AsyncIterable<StreamChunk>;
/**
 * Collect a full data-stream response into a single string.
 */
export declare function collectStream(response: Response): Promise<string>;
//# sourceMappingURL=stream.d.ts.map