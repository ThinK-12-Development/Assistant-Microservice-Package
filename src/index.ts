export { GatewayClient } from './client.js';

export {
  GatewayError,
  AuthError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  RateLimitError,
} from './errors.js';

export type { StreamChunk } from './stream.js';

export type {
  GatewayClientOptions,
  Assistant,
  CreateAssistantInput,
  UpdateAssistantInput,
  Thread,
  CreateThreadOptions,
  Message,
  Usage,
  Retrieval,
  SendMessageResult,
  SendMessageOptions,
  CircuitSettings,
  CompleteOptions,
  CompleteResult,
  EmbedOptions,
  EmbedResult,
  GenerateImageOptions,
  GenerateImageResult,
  GatewayModel,
} from './types.js';
