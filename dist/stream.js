"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseDataStream = parseDataStream;
exports.collectStream = collectStream;
const errors_js_1 = require("./errors.js");
// Vercel AI SDK Data Stream Protocol: text chunks arrive as lines prefixed `0:"..."`
const TEXT_CHUNK_RE = /^0:"((?:[^"\\]|\\.)*)"/;
function parseEvent(trimmed) {
    // Bridge SSE format: data: {"type":"...","...":...}
    if (trimmed.startsWith('data: ')) {
        const payload = trimmed.slice(6);
        let parsed;
        try {
            parsed = JSON.parse(payload);
        }
        catch {
            return null;
        }
        switch (parsed.type) {
            case 'chunk':
                return typeof parsed.content === 'string' ? { type: 'text', text: parsed.content } : null;
            case 'image_generated':
                return parsed.image ? { type: 'image_generated', image: parsed.image } : null;
            case 'done':
                return parsed.message ? { type: 'message', message: parsed.message } : null;
            default:
                return null;
        }
    }
    // Vercel AI SDK format: 0:"..."
    const match = TEXT_CHUNK_RE.exec(trimmed);
    if (match) {
        return { type: 'text', text: JSON.parse(`"${match[1]}"`) };
    }
    return null;
}
/**
 * Parse an SSE stream response into an async iterator of text chunks.
 * Handles both the MS bridge format (data: {"type":"chunk","content":"..."})
 * and the Vercel AI SDK format (0:"...").
 * Throws GatewayError subclasses on non-2xx responses.
 */
async function* parseDataStream(response) {
    if (response.status === 429) {
        const retryAfter = Number(response.headers.get('Retry-After') ?? '3600');
        const body = await response.json().catch(() => ({}));
        throw new errors_js_1.RateLimitError(retryAfter, body['message']);
    }
    if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw (0, errors_js_1.parseGatewayError)(response.status, body);
    }
    const reader = response.body?.getReader();
    if (!reader)
        throw new Error('Response body is not readable');
    const decoder = new TextDecoder();
    let buffer = '';
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed)
                    continue;
                const chunk = parseEvent(trimmed);
                if (chunk !== null)
                    yield chunk;
            }
        }
        // Flush remaining buffer
        if (buffer.trim()) {
            const chunk = parseEvent(buffer.trim());
            if (chunk !== null)
                yield chunk;
        }
    }
    finally {
        reader.releaseLock();
    }
    yield { type: 'done' };
}
/**
 * Collect a full data-stream response into a single string.
 */
async function collectStream(response) {
    let result = '';
    for await (const chunk of parseDataStream(response)) {
        if (chunk.type === 'text' && chunk.text) {
            result += chunk.text;
        }
    }
    return result;
}
//# sourceMappingURL=stream.js.map