import { StreamChunk } from './stream.js';
import type { GatewayClientOptions, Assistant, CreateAssistantInput, UpdateAssistantInput, Thread, CreateThreadOptions, SendMessageOptions, SendMessageResult, CompleteOptions, CompleteResult, EmbedOptions, EmbedResult, GenerateImageOptions, GenerateImageResult, GatewayModel, PingResult, DiagnosticsResult, MigrateAssistantInput, MigrateAssistantResult, UploadFileOptions, UploadFileResult, BackfillFileItem, BackfillOptions, BackfillSummary, MessageImageRef, UploadThreadImageOptions } from './types.js';
export declare class GatewayClient {
    private readonly baseUrl;
    private readonly apiKey;
    constructor(options: GatewayClientOptions);
    private headers;
    private url;
    private request;
    private stream;
    listAssistants(): Promise<Assistant[]>;
    getAssistant(assistantId: string): Promise<Assistant>;
    createAssistant(input: CreateAssistantInput): Promise<Assistant>;
    updateAssistant(assistantId: string, input: UpdateAssistantInput): Promise<Assistant>;
    deleteAssistant(assistantId: string): Promise<void>;
    createThread(assistantId: string, options?: CreateThreadOptions): Promise<Thread>;
    getThread(assistantId: string, threadId: string): Promise<Thread>;
    deleteThread(assistantId: string, threadId: string): Promise<void>;
    sendMessage(_assistantId: string, threadId: string, options: SendMessageOptions): Promise<SendMessageResult>;
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
    streamMessage(assistantId: string, threadId: string, options: SendMessageOptions): AsyncIterable<StreamChunk>;
    /**
     * Stream a message and collect the full text response.
     * Convenient when you don't need chunk-by-chunk processing.
     */
    streamMessageToString(assistantId: string, threadId: string, options: SendMessageOptions): Promise<string>;
    complete(options: CompleteOptions): Promise<CompleteResult>;
    embed(options: EmbedOptions): Promise<EmbedResult>;
    generateImage(options: GenerateImageOptions): Promise<GenerateImageResult>;
    listModels(): Promise<GatewayModel[]>;
    /**
     * Confirm the gateway is reachable and the API key is valid.
     * Throws AuthError if the key is invalid, or a network error if unreachable.
     */
    ping(): Promise<PingResult>;
    /**
     * Return gateway health, key scopes, available providers and models.
     * Use this to verify a complete integration and surface configuration issues.
     */
    diagnostics(): Promise<DiagnosticsResult>;
    uploadFile(assistantId: string, options: UploadFileOptions): Promise<UploadFileResult>;
    deleteFile(assistantId: string, fileId: string): Promise<void>;
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
    uploadThreadImages(threadId: string, images: UploadThreadImageOptions[]): Promise<MessageImageRef[]>;
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
    backfillFiles(items: BackfillFileItem[], options?: BackfillOptions): Promise<BackfillSummary>;
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
    migrate(assistants: MigrateAssistantInput[]): Promise<MigrateAssistantResult[]>;
}
//# sourceMappingURL=client.d.ts.map