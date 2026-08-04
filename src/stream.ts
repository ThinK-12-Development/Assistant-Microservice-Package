import { RateLimitError, parseGatewayError } from './errors.js';
import type { Message, MessageImageRef } from './types.js';

// Vercel AI SDK Data Stream Protocol: text chunks arrive as lines prefixed `0:"..."`
const TEXT_CHUNK_RE = /^0:"((?:[^"\\]|\\.)*)"/;

export interface StreamChunk {
  type: 'text' | 'image_generated' | 'message' | 'done';
  text?: string;
  /** Present when type === 'image_generated'. Emitted as soon as the MS finishes generating an image, before the text response completes. */
  image?: MessageImageRef;
  /** Present when type === 'message'. The persisted assistant message, including `images` if the MS generated one for this turn. Yielded just before the final `done` chunk. */
  message?: Message;
}

/**
 * The MS stores `messages.images` as a JSON-serialized TEXT column and returns it
 * as-is (a raw string, not an array) on every endpoint — REST and streaming alike.
 * Normalize it here so `Message.images` actually matches its declared type instead
 * of leaking the raw storage encoding to callers.
 */
export function normalizeMessageImages(raw: unknown): MessageImageRef[] | undefined {
  if (Array.isArray(raw)) return raw as MessageImageRef[];
  if (typeof raw !== 'string' || raw.length === 0) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as MessageImageRef[]) : undefined;
  } catch {
    return undefined;
  }
}

function normalizeMessage(raw: Record<string, unknown>): Message {
  return { ...raw, images: normalizeMessageImages(raw.images) } as Message;
}

function parseEvent(trimmed: string): StreamChunk | null {
  // Bridge SSE format: data: {"type":"...","...":...}
  if (trimmed.startsWith('data: ')) {
    const payload = trimmed.slice(6);
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(payload) as Record<string, unknown>;
    } catch {
      return null;
    }

    switch (parsed.type) {
      case 'chunk':
        return typeof parsed.content === 'string' ? { type: 'text', text: parsed.content } : null;
      case 'image_generated':
        return parsed.image ? { type: 'image_generated', image: parsed.image as MessageImageRef } : null;
      case 'done':
        return parsed.message
          ? { type: 'message', message: normalizeMessage(parsed.message as Record<string, unknown>) }
          : null;
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
export async function* parseDataStream(response: Response): AsyncIterable<StreamChunk> {
  if (response.status === 429) {
    const retryAfter = Number(response.headers.get('Retry-After') ?? '3600');
    const body = await response.json().catch(() => ({}));
    throw new RateLimitError(
      retryAfter,
      (body as Record<string, unknown>)['message'] as string | undefined,
    );
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw parseGatewayError(response.status, body);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('Response body is not readable');

  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const chunk = parseEvent(trimmed);
        if (chunk !== null) yield chunk;
      }
    }

    // Flush remaining buffer
    if (buffer.trim()) {
      const chunk = parseEvent(buffer.trim());
      if (chunk !== null) yield chunk;
    }
  } finally {
    reader.releaseLock();
  }

  yield { type: 'done' };
}

/**
 * Collect a full data-stream response into a single string.
 */
export async function collectStream(response: Response): Promise<string> {
  let result = '';
  for await (const chunk of parseDataStream(response)) {
    if (chunk.type === 'text' && chunk.text) {
      result += chunk.text;
    }
  }
  return result;
}
