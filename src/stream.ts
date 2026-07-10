import { RateLimitError, parseGatewayError } from './errors.js';

// AI SDK Data Stream Protocol: text chunks arrive as lines prefixed `0:"..."`
// where the value is a JSON-encoded string fragment.
const TEXT_CHUNK_RE = /^0:"((?:[^"\\]|\\.)*)"/;

export interface StreamChunk {
  type: 'text' | 'done';
  text?: string;
}

/**
 * Parse an AI SDK data-stream response into an async iterator of text chunks.
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

        const match = TEXT_CHUNK_RE.exec(trimmed);
        if (match) {
          // Unescape the JSON-encoded string fragment
          const text = JSON.parse(`"${match[1]}"`);
          yield { type: 'text', text };
        }
        // Ignore other data-stream line types (annotations, errors from stream, etc.)
      }
    }

    // Flush remaining buffer
    if (buffer.trim()) {
      const match = TEXT_CHUNK_RE.exec(buffer.trim());
      if (match) {
        const text = JSON.parse(`"${match[1]}"`);
        yield { type: 'text', text };
      }
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
