import { parseGatewayError } from './errors.js';
import { parseDataStream, collectStream, StreamChunk } from './stream.js';
import type {
  GatewayClientOptions,
  Assistant,
  CreateAssistantInput,
  UpdateAssistantInput,
  Thread,
  CreateThreadOptions,
  SendMessageOptions,
  SendMessageResult,
  CompleteOptions,
  CompleteResult,
  EmbedOptions,
  EmbedResult,
  GenerateImageOptions,
  GenerateImageResult,
  GatewayModel,
} from './types.js';

export class GatewayClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(options: GatewayClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.apiKey = options.apiKey;
  }

  // ---------------------------------------------------------------------------
  // Internal fetch helpers
  // ---------------------------------------------------------------------------

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
      ...extra,
    };
  }

  private url(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(this.url(path), {
      method,
      headers: this.headers(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw parseGatewayError(res.status, json);
    return json as T;
  }

  private async stream(path: string, body?: unknown): Promise<Response> {
    const res = await fetch(this.url(path), {
      method: 'POST',
      headers: this.headers({ Accept: 'text/event-stream' }),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return res;
  }

  // ---------------------------------------------------------------------------
  // Assistants
  // ---------------------------------------------------------------------------

  async listAssistants(): Promise<Assistant[]> {
    return this.request<Assistant[]>('GET', '/api/v1/assistants');
  }

  async getAssistant(assistantId: string): Promise<Assistant> {
    return this.request<Assistant>('GET', `/api/v1/assistants/${assistantId}`);
  }

  async createAssistant(input: CreateAssistantInput): Promise<Assistant> {
    return this.request<Assistant>('POST', '/api/v1/assistants', input);
  }

  async updateAssistant(assistantId: string, input: UpdateAssistantInput): Promise<Assistant> {
    return this.request<Assistant>('PATCH', `/api/v1/assistants/${assistantId}`, input);
  }

  async deleteAssistant(assistantId: string): Promise<void> {
    await this.request<void>('DELETE', `/api/v1/assistants/${assistantId}`);
  }

  // ---------------------------------------------------------------------------
  // Threads
  // ---------------------------------------------------------------------------

  async createThread(assistantId: string, options?: CreateThreadOptions): Promise<Thread> {
    return this.request<Thread>('POST', `/api/v1/assistants/${assistantId}/threads`, options ?? {});
  }

  async getThread(assistantId: string, threadId: string): Promise<Thread> {
    return this.request<Thread>('GET', `/api/v1/assistants/${assistantId}/threads/${threadId}`);
  }

  async deleteThread(assistantId: string, threadId: string): Promise<void> {
    await this.request<void>('DELETE', `/api/v1/assistants/${assistantId}/threads/${threadId}`);
  }

  // ---------------------------------------------------------------------------
  // Messages (non-streaming)
  // ---------------------------------------------------------------------------

  async sendMessage(
    assistantId: string,
    threadId: string,
    options: SendMessageOptions,
  ): Promise<SendMessageResult> {
    return this.request<SendMessageResult>(
      'POST',
      `/api/v1/assistants/${assistantId}/threads/${threadId}/messages`,
      options,
    );
  }

  // ---------------------------------------------------------------------------
  // Messages (streaming)
  // ---------------------------------------------------------------------------

  /**
   * Stream a message response as an async iterator of text chunks.
   * Each yielded object has `{ type: 'text', text: string }`.
   * The final yield is `{ type: 'done' }`.
   *
   * Throws `RateLimitError` on 429 — handle it in your UI layer.
   *
   * @example
   * ```ts
   * for await (const chunk of client.streamMessage(assistantId, threadId, { content: 'Hello' })) {
   *   if (chunk.type === 'text') process.stdout.write(chunk.text!);
   * }
   * ```
   */
  streamMessage(
    assistantId: string,
    threadId: string,
    options: SendMessageOptions,
  ): AsyncIterable<StreamChunk> {
    const self = this;
    return {
      [Symbol.asyncIterator]() {
        let streamPromise: Promise<AsyncIterable<StreamChunk>> | null = null;
        return {
          async next() {
            if (!streamPromise) {
              streamPromise = self
                .stream(
                  `/api/v1/assistants/${assistantId}/threads/${threadId}/messages/stream`,
                  options,
                )
                .then((res) => parseDataStream(res));
            }
            const iterable = await streamPromise;
            const iter = iterable[Symbol.asyncIterator]();
            return iter.next();
          },
        } as AsyncIterator<StreamChunk>;
      },
    };
  }

  /**
   * Stream a message and collect the full text response.
   * Convenient when you don't need chunk-by-chunk processing.
   */
  async streamMessageToString(
    assistantId: string,
    threadId: string,
    options: SendMessageOptions,
  ): Promise<string> {
    const res = await this.stream(
      `/api/v1/assistants/${assistantId}/threads/${threadId}/messages/stream`,
      options,
    );
    return collectStream(res);
  }

  // ---------------------------------------------------------------------------
  // Completions (one-shot, no thread)
  // ---------------------------------------------------------------------------

  async complete(options: CompleteOptions): Promise<CompleteResult> {
    return this.request<CompleteResult>('POST', '/api/v1/complete', options);
  }

  // ---------------------------------------------------------------------------
  // Embeddings
  // ---------------------------------------------------------------------------

  async embed(options: EmbedOptions): Promise<EmbedResult> {
    return this.request<EmbedResult>('POST', '/api/v1/embed', options);
  }

  // ---------------------------------------------------------------------------
  // Image generation
  // ---------------------------------------------------------------------------

  async generateImage(options: GenerateImageOptions): Promise<GenerateImageResult> {
    return this.request<GenerateImageResult>('POST', '/api/v1/images/generate', options);
  }

  // ---------------------------------------------------------------------------
  // Discovery
  // ---------------------------------------------------------------------------

  async listModels(): Promise<GatewayModel[]> {
    return this.request<GatewayModel[]>('GET', '/api/v1/models');
  }
}
