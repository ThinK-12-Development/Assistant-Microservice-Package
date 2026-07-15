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

export interface SendMessageOptions {
  content: string;
  settings?: CircuitSettings;
  maxTokens?: number;
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
