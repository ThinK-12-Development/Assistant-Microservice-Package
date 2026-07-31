// ---------------------------------------------------------------------------
// Client configuration
// ---------------------------------------------------------------------------

export interface GatewayClientOptions {
  baseUrl: string;
  apiKey: string;
}

// ---------------------------------------------------------------------------
// Assistant
// ---------------------------------------------------------------------------

export interface Assistant {
  id: string;
  assistantId: string;
  name: string;
  description: string | null;
  instructions: string;
  modelId: string;
  productId: string | null;
  productName: string | null;
  temperature: number;
  maxTokens: number;
  fileSearch: boolean;
  responseFormat: string;
  status: 'active' | 'inactive' | 'archived';
  providerMode: string;
  rateLimit: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAssistantInput {
  name: string;
  description?: string;
  instructions: string;
  modelId: string;
  productId?: string;
  productName?: string;
  temperature?: number;
  maxTokens?: number;
  fileSearch?: boolean;
  responseFormat?: 'text' | 'json_object' | 'json_schema';
  status?: 'active' | 'inactive' | 'archived';
}

export type UpdateAssistantInput = Partial<CreateAssistantInput>;

// ---------------------------------------------------------------------------
// Thread
// ---------------------------------------------------------------------------

export interface Thread {
  id: string;
  threadId: string;
  assistantId: string;
  title: string | null;
  metadata: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateThreadOptions {
  title?: string;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export interface Message {
  id: string;
  threadId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface Retrieval {
  chunksRetrieved: number;
  contextInjected: boolean;
  correlationId: string;
}

export interface SendMessageResult {
  message: Message;
  usage: Usage;
  retrieval: Retrieval;
  latencyMs: number;
}

// ---------------------------------------------------------------------------
// Circuit settings — passed through to the MS on every message
// ---------------------------------------------------------------------------

export interface CircuitSettings {
  persona?: string;
  context?: string;
  rules?: string[];
  temperature?: number;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Images — chat message attachments
// ---------------------------------------------------------------------------

/**
 * A reference to an image that has been uploaded to the gateway via `uploadThreadImage()`.
 * Pass one or more of these in `SendMessageOptions.images` to attach them to a message.
 */
export interface MessageImageRef {
  id: string;
  s3Key: string;
  mimeType: string;
  filename?: string;
}

export interface UploadThreadImageOptions {
  /** Image file content as a Buffer or Blob. */
  content: Buffer | Blob;
  /** Filename including extension (e.g. "photo.jpg"). */
  filename: string;
  /** MIME type of the image (e.g. "image/jpeg"). */
  mimeType: string;
}

export interface SendMessageOptions {
  content: string;
  settings?: CircuitSettings;
  maxTokens?: number;
  /**
   * Images to attach to this message. Upload each image first with `uploadThreadImage()`
   * and pass the returned `MessageImageRef` objects here.
   * Only supported on models where `supportsImages: true`.
   */
  images?: MessageImageRef[];
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

export interface CompleteOptions {
  prompt: string;
  modelId: string;
  system?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface CompleteResult {
  text: string;
  model: string;
  usage: Usage;
  latencyMs: number;
}

export interface EmbedOptions {
  input: string | string[];
  providerId?: string;
  model?: string;
}

export interface EmbedResult {
  embeddings: Array<{ index: number; embedding: number[] }>;
  model: string;
  provider: string;
  dimension: number;
  usage: { tokensUsed: number };
  latencyMs: number;
}

export interface GenerateImageOptions {
  prompt: string;
  modelId: string;
  size?: '256x256' | '512x512' | '1024x1024' | '1792x1024' | '1024x1792';
}

export interface GenerateImageResult {
  imageId: string;
  url: string | null;
  mimeType: string;
  size: string;
  model: string;
  prompt: string;
  latencyMs: number;
  warning?: string;
}

// ---------------------------------------------------------------------------
// Ping / Diagnostics
// ---------------------------------------------------------------------------

export interface PingResult {
  ok: boolean;
  latencyMs: number;
  timestamp: string;
}

export interface DiagnosticsResult {
  ok: boolean;
  latencyMs: number;
  timestamp: string;
  key: {
    name: string | null;
    scopes: string[];
    rateLimit: number | null;
  };
  providers: {
    total: number;
    types: string[];
  };
  models: {
    total: number;
    ids: string[];
  };
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

export interface MigrateAssistantInput {
  sourceId: string;
  name: string;
  instructions: string;
  modelId: string;
  description?: string;
  temperature?: number;
  maxTokens?: number;
  fileSearch?: boolean;
  responseFormat?: 'text' | 'json_object' | 'json_schema';
}

export interface MigrateAssistantResult {
  sourceId: string;
  gatewayAssistantId: string | null;
  status: 'created' | 'failed';
  error?: string;
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

export interface GatewayModel {
  id: string;
  modelId: string;
  name: string;
  providerName: string;
  providerType: string;
  supportsImages: boolean;
  supportsImageGeneration: boolean;
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

export interface BackfillFileItem {
  /** Your local composite key (e.g. `"${botId}:${contentSourceId}"`) — echoed back in results so you know which DB row to update. */
  sourceId: string;
  /** MS assistant ID to upload the file to. */
  assistantId: string;
  /** Filename including extension — determines how the MS processes the content. */
  filename: string;
  /** File content as a Buffer or Blob. */
  content: Buffer | Blob;
  /** MIME type. Defaults to 'text/plain'. */
  mimeType?: string;
}

export interface BackfillFileResult {
  sourceId: string;
  /** MS file ID — store this as `gateway_file_id` in your DB. Null on failure. */
  fileId: string | null;
  status: 'uploaded' | 'failed';
  error?: string;
}

export interface BackfillOptions {
  /** Files to process per batch. Default: 5. Keep low to avoid overwhelming the MS. */
  batchSize?: number;
  /** Milliseconds to wait between batches. Default: 500. */
  delayMs?: number;
  /**
   * Called after each individual file is processed (success or failure).
   * Update `gateway_file_id` in your DB here — update per item, not in bulk,
   * so a stop or crash doesn't lose progress already made.
   * May be async — awaited before the next item starts.
   */
  onProgress?: (completed: number, total: number, result: BackfillFileResult) => void | Promise<void>;
  /**
   * Return true to stop processing after the current batch completes.
   * Wire this to your admin stop control so large backfills can be safely halted.
   */
  stopSignal?: () => boolean;
}

export interface BackfillSummary {
  total: number;
  uploaded: number;
  failed: number;
  /** True if stopSignal() returned true before all items were processed. */
  stopped: boolean;
  results: BackfillFileResult[];
}

export interface UploadFileResult {
  fileId: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  status: string;
}

export interface UploadFileOptions {
  /** Filename including extension — determines MIME type on the MS side. */
  filename: string;
  /** Raw file content as a Buffer or Blob. */
  content: Buffer | Blob;
  /** MIME type of the file. Defaults to 'text/plain'. */
  mimeType?: string;
}
