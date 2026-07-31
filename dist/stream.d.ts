export interface StreamChunk {
    type: 'text' | 'done';
    text?: string;
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