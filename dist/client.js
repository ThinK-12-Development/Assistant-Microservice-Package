"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GatewayClient = void 0;
const errors_js_1 = require("./errors.js");
const stream_js_1 = require("./stream.js");
class GatewayClient {
    constructor(options) {
        this.baseUrl = options.baseUrl.replace(/\/$/, '');
        this.apiKey = options.apiKey;
    }
    // ---------------------------------------------------------------------------
    // Internal fetch helpers
    // ---------------------------------------------------------------------------
    headers(extra) {
        return {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
            ...extra,
        };
    }
    url(path) {
        return `${this.baseUrl}${path}`;
    }
    async request(method, path, body) {
        const res = await fetch(this.url(path), {
            method,
            headers: this.headers(),
            body: body !== undefined ? JSON.stringify(body) : undefined,
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok)
            throw (0, errors_js_1.parseGatewayError)(res.status, json);
        return json.data;
    }
    async stream(path, body) {
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
    async listAssistants() {
        return this.request('GET', '/api/v1/assistants');
    }
    async getAssistant(assistantId) {
        return this.request('GET', `/api/v1/assistants/${assistantId}`);
    }
    async createAssistant(input) {
        return this.request('POST', '/api/v1/assistants', input);
    }
    async updateAssistant(assistantId, input) {
        return this.request('PATCH', `/api/v1/assistants/${assistantId}`, input);
    }
    async deleteAssistant(assistantId) {
        await this.request('DELETE', `/api/v1/assistants/${assistantId}`);
    }
    // ---------------------------------------------------------------------------
    // Threads
    // ---------------------------------------------------------------------------
    async createThread(assistantId, options) {
        return this.request('POST', `/api/v1/assistants/${assistantId}/threads`, options ?? {});
    }
    async getThread(assistantId, threadId) {
        return this.request('GET', `/api/v1/assistants/${assistantId}/threads/${threadId}`);
    }
    async deleteThread(assistantId, threadId) {
        await this.request('DELETE', `/api/v1/assistants/${assistantId}/threads/${threadId}`);
    }
    // ---------------------------------------------------------------------------
    // Messages (non-streaming)
    // ---------------------------------------------------------------------------
    async sendMessage(_assistantId, threadId, options) {
        // NOTE: the MS resolves the assistant from the thread itself — the route is
        // /threads/:threadId/messages, not nested under /assistants/:assistantId/.
        // assistantId is kept as a parameter for API-shape symmetry with sendMessage's siblings.
        return this.request('POST', `/api/v1/threads/${threadId}/messages`, options);
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
    streamMessage(assistantId, threadId, options) {
        const self = this;
        return {
            [Symbol.asyncIterator]() {
                let streamPromise = null;
                return {
                    async next() {
                        if (!streamPromise) {
                            streamPromise = self
                                .stream(`/api/v1/threads/${threadId}/messages/stream`, options)
                                .then((res) => (0, stream_js_1.parseDataStream)(res));
                        }
                        const iterable = await streamPromise;
                        const iter = iterable[Symbol.asyncIterator]();
                        return iter.next();
                    },
                };
            },
        };
    }
    /**
     * Stream a message and collect the full text response.
     * Convenient when you don't need chunk-by-chunk processing.
     */
    async streamMessageToString(assistantId, threadId, options) {
        const res = await this.stream(`/api/v1/threads/${threadId}/messages/stream`, options);
        return (0, stream_js_1.collectStream)(res);
    }
    // ---------------------------------------------------------------------------
    // Completions (one-shot, no thread)
    // ---------------------------------------------------------------------------
    async complete(options) {
        return this.request('POST', '/api/v1/complete', options);
    }
    // ---------------------------------------------------------------------------
    // Embeddings
    // ---------------------------------------------------------------------------
    async embed(options) {
        return this.request('POST', '/api/v1/embed', options);
    }
    // ---------------------------------------------------------------------------
    // Image generation
    // ---------------------------------------------------------------------------
    async generateImage(options) {
        return this.request('POST', '/api/v1/images/generate', options);
    }
    // ---------------------------------------------------------------------------
    // Discovery
    // ---------------------------------------------------------------------------
    async listModels() {
        return this.request('GET', '/api/v1/models');
    }
    // ---------------------------------------------------------------------------
    // Connectivity
    // ---------------------------------------------------------------------------
    /**
     * Confirm the gateway is reachable and the API key is valid.
     * Throws AuthError if the key is invalid, or a network error if unreachable.
     */
    async ping() {
        const start = Date.now();
        const res = await fetch(this.url('/api/v1/ping'), {
            method: 'GET',
            headers: this.headers(),
        });
        const latencyMs = Date.now() - start;
        const json = await res.json().catch(() => ({}));
        if (!res.ok)
            throw (0, errors_js_1.parseGatewayError)(res.status, json);
        return { ok: true, latencyMs, timestamp: json.timestamp ?? new Date().toISOString() };
    }
    /**
     * Return gateway health, key scopes, available providers and models.
     * Use this to verify a complete integration and surface configuration issues.
     */
    async diagnostics() {
        const start = Date.now();
        const res = await fetch(this.url('/api/v1/diagnostics'), {
            method: 'GET',
            headers: this.headers(),
        });
        const latencyMs = Date.now() - start;
        const json = await res.json().catch(() => ({}));
        if (!res.ok)
            throw (0, errors_js_1.parseGatewayError)(res.status, json);
        return { ...json, latencyMs };
    }
    // ---------------------------------------------------------------------------
    // Files
    // ---------------------------------------------------------------------------
    async uploadFile(assistantId, options) {
        const form = new FormData();
        const blob = options.content instanceof Blob
            ? options.content
            : new Blob([new Uint8Array(options.content)], { type: options.mimeType ?? 'text/plain' });
        form.append('file', blob, options.filename);
        const res = await fetch(this.url(`/api/v1/assistants/${assistantId}/files`), {
            method: 'POST',
            headers: { Authorization: `Bearer ${this.apiKey}` },
            body: form,
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok)
            throw (0, errors_js_1.parseGatewayError)(res.status, json);
        return json.data.file;
    }
    async deleteFile(assistantId, fileId) {
        await this.request('DELETE', `/api/v1/assistants/${assistantId}/files/${fileId}`);
    }
    /**
     * Upload one or more images to a thread before sending a message.
     * Returns `MessageImageRef` objects — pass them in `SendMessageOptions.images`.
     *
     * Requires `files:write` scope on the API key.
     * Maximum 10 images per call; 20 MB per image.
     *
     * @example
     * ```ts
     * const refs = await client.uploadThreadImages(threadId, [
     *   { content: imageBuffer, filename: 'screenshot.png', mimeType: 'image/png' },
     * ]);
     * for await (const chunk of client.streamMessage(assistantId, threadId, {
     *   content: 'What do you see in this image?',
     *   images: refs,
     * })) { ... }
     * ```
     */
    async uploadThreadImages(threadId, images) {
        const form = new FormData();
        for (const img of images) {
            const blob = img.content instanceof Blob
                ? img.content
                : new Blob([new Uint8Array(img.content)], { type: img.mimeType });
            form.append('images', blob, img.filename);
        }
        const res = await fetch(this.url(`/api/v1/threads/${threadId}/images`), {
            method: 'POST',
            headers: { Authorization: `Bearer ${this.apiKey}` },
            body: form,
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok)
            throw (0, errors_js_1.parseGatewayError)(res.status, json);
        return json.data.images;
    }
    /**
     * Upload a targeted set of content source mappings to the MS in controlled batches.
     *
     * Your app is responsible for querying which items need backfill (e.g. WHERE gateway_file_id IS NULL,
     * filtered by bot, by content source, or by processing status). This method handles the upload
     * mechanics, batching, rate limiting, progress callbacks, and stop/resume.
     *
     * Update `gateway_file_id` in your DB inside `onProgress` per item — not in bulk after completion —
     * so progress is preserved if the backfill is stopped or crashes mid-run.
     *
     * @example
     * ```ts
     * const items = unmigrated.map(m => ({
     *   sourceId: `${m.botId}:${m.contentSourceId}`,
     *   assistantId: m.gatewayAssistantId,
     *   filename: `${m.contentType}-${m.name}.txt`,
     *   content: Buffer.from(m.content, 'utf-8'),
     * }));
     *
     * const summary = await client.backfillFiles(items, {
     *   batchSize: 5,
     *   delayMs: 500,
     *   stopSignal: () => stopRequested,
     *   onProgress: async (completed, total, result) => {
     *     if (result.status === 'uploaded') {
     *       const [botId, contentSourceId] = result.sourceId.split(':').map(Number);
     *       await storage.updateContentSourceMapping(botId, contentSourceId, { gatewayFileId: result.fileId! });
     *     }
     *     console.log(`[backfill] ${completed}/${total} — ${result.status}`);
     *   },
     * });
     * ```
     */
    async backfillFiles(items, options = {}) {
        const { batchSize = 5, delayMs = 500, onProgress, stopSignal } = options;
        const results = [];
        let uploaded = 0;
        let failed = 0;
        let stopped = false;
        for (let i = 0; i < items.length; i += batchSize) {
            if (stopSignal?.()) {
                stopped = true;
                break;
            }
            const batch = items.slice(i, i + batchSize);
            for (const item of batch) {
                let result;
                try {
                    const file = await this.uploadFile(item.assistantId, {
                        filename: item.filename,
                        content: item.content,
                        mimeType: item.mimeType,
                    });
                    result = { sourceId: item.sourceId, fileId: file.fileId, status: 'uploaded' };
                    uploaded++;
                }
                catch (err) {
                    result = {
                        sourceId: item.sourceId,
                        fileId: null,
                        status: 'failed',
                        error: err instanceof Error ? err.message : String(err),
                    };
                    failed++;
                }
                results.push(result);
                if (onProgress)
                    await onProgress(results.length, items.length, result);
            }
            if (i + batchSize < items.length && !stopSignal?.()) {
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }
        }
        return { total: items.length, uploaded, failed, stopped, results };
    }
    // ---------------------------------------------------------------------------
    // Migration
    // ---------------------------------------------------------------------------
    /**
     * Create gateway assistants from an array of existing assistants.
     * Each item carries a `sourceId` (your local DB id or legacy assistant id)
     * which is echoed back in the result so you know which record to update.
     *
     * Failures are per-item — a single failure does not abort the batch.
     *
     * @example
     * ```ts
     * const results = await client.migrate(
     *   chatbots.map(b => ({
     *     sourceId: String(b.id),
     *     name: b.name,
     *     instructions: b.instructions,
     *     modelId: 'openai/gpt-4o',
     *   }))
     * );
     * for (const r of results) {
     *   if (r.status === 'created') {
     *     await db.update(chatbots).set({ gatewayAssistantId: r.gatewayAssistantId }).where(eq(chatbots.id, Number(r.sourceId)));
     *   }
     * }
     * ```
     */
    async migrate(assistants) {
        const results = [];
        for (const input of assistants) {
            const { sourceId, ...createInput } = input;
            try {
                const created = await this.createAssistant(createInput);
                results.push({ sourceId, gatewayAssistantId: created.assistantId, status: 'created' });
            }
            catch (err) {
                results.push({
                    sourceId,
                    gatewayAssistantId: null,
                    status: 'failed',
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        }
        return results;
    }
}
exports.GatewayClient = GatewayClient;
//# sourceMappingURL=client.js.map