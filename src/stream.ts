import { RateLimitError, parseGatewayError } from './errors.js';

// Vercel AI SDK Data Stream Protocol: text chunks arrive as lines prefixed `0:"..."`
const TEXT_CHUNK_RE = /^0:"((?:[^"\\]|\\.)*)"/;

export interface StreamChunk {
  type: 'text' | 'done';
  text?: string;
}

function parseLine(trimmed: string): string | null {
  // Bridge SSE format: data: {"type":"chunk","content":"..."}
  if (trimmed.startsWith('data: ')) {
    const payload = trimmed.slice(6);
    try {
      const parsed = JSON.parse(payload) as Record<string, unknown>;
      if (parsed.type === 'chunk' && typeof parsed.content === 'string') {
        return parsed.content;
      }
    } catch {}
    return null;
  }

  // Vercel AI SDK format: 0:"..."
  const match = TEXT_CHUNK_RE.exec(trimmed);
  if (match) {
    return JSON.parse(`"${match[1]}"`);
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
        const text = parseLine(trimmed);
        if (text !== null) yield { type: 'text', text };
      }
    }

    // Flush remaining buffer
    if (buffer.trim()) {
      const text = parseLine(buffer.trim());
      if (text !== null) yield { type: 'text', text };
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
