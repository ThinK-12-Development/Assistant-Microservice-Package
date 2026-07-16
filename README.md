# @wisdomcircuit/ai-gateway-client

TypeScript HTTP client for the Wisdom Circuits AI Gateway microservice. Provides a typed, promise-based interface for all gateway endpoints — assistants, threads, messages (streaming and non-streaming), completions, embeddings, and image generation.

Distributed as a private git dependency. No npm registry needed.

---

## What is this?

The AI Gateway is an internal microservice that acts as a unified proxy to multiple AI providers (OpenAI, Anthropic, etc.). It handles:

- **Assistants** — persistent, configured AI agents with their own instructions, model, and settings
- **Threads** — conversation histories tied to a specific assistant
- **Messages** — sending prompts and receiving responses (streaming or non-streaming)
- **Completions** — one-shot prompts without a thread
- **Embeddings** — vector embeddings for semantic search
- **Image generation** — text-to-image via configured providers

This package is the client you drop into any application to talk to that gateway. It handles authentication, error parsing (including rate limit errors with retry timing), and streaming response parsing.

---

## Requirements

- Node.js 18+ (uses native `fetch` and `ReadableStream`)
- TypeScript 5+ (if using in a TS project)
- A valid gateway API key — obtain from the MS admin panel

---

## Installation

Add to your project's `package.json` as a git dependency, pinned to a specific release tag:

```json
{
  "dependencies": {
    "@wisdomcircuits/ai-gateway-client": "github:ThinK-12-Development/Assistant-Microservice-Package#v0.1.0"
  }
}
```

Then install:

```bash
npm install
# or
yarn install
```

The `prepare` script compiles TypeScript automatically on install — no separate build step, no registry, no publish workflow. Upgrading is just changing the tag and re-running install.

---

## Setup

```ts
import { GatewayClient } from '@wisdomcircuits/ai-gateway-client';

const client = new GatewayClient({
  baseUrl: process.env.GATEWAY_URL!,      // base URL of your MS deployment
  apiKey: process.env.GATEWAY_API_KEY!,   // API key from the MS admin panel
});
```

Get your API key and base URL from the MS admin panel. Always load them from environment variables — never hardcode.

---

## Usage

### Non-streaming message

Best for server-side use or when you don't need progressive rendering.

```ts
// Create a thread for the conversation
const thread = await client.createThread('asst_abc123');

// Send a message and get the full response
const result = await client.sendMessage('asst_abc123', thread.threadId, {
  content: 'What is the capital of France?',
});

console.log(result.message.content); // "The capital of France is Paris."
console.log(result.usage.totalTokens);
console.log(result.latencyMs);
```

### Streaming message (chunk-by-chunk)

Use for chat UIs where you want text to appear progressively as it's generated.

```ts
import { RateLimitError } from '@wisdomcircuits/ai-gateway-client';

try {
  for await (const chunk of client.streamMessage('asst_abc123', thread.threadId, {
    content: 'Tell me a story.',
  })) {
    if (chunk.type === 'text') {
      process.stdout.write(chunk.text!); // or append to your UI state
    }
  }
} catch (err) {
  if (err instanceof RateLimitError) {
    // err.message is already human-friendly — show it directly in your UI
    console.error(`${err.message} (retry in ${err.retryAfterSeconds}s)`);
  }
}
```

### Streaming message (collect to string)

When you want a streaming request but don't need chunk-by-chunk processing:

```ts
const text = await client.streamMessageToString('asst_abc123', thread.threadId, {
  content: 'Summarise this document.',
  settings: { context: documentText },
});
```

### Passing settings (persona, context, rules)

The `settings` field is passed through to the assistant on every message — use it to inject runtime context:

```ts
await client.sendMessage('asst_abc123', thread.threadId, {
  content: 'How do I reset my password?',
  settings: {
    persona: 'You are a friendly support agent for Acme Corp.',
    context: `User account: ${userEmail}`,
    rules: ['Always end with "Is there anything else I can help you with?"'],
  },
});
```

### One-shot completion (no thread)

For prompts that don't need conversation history:

```ts
const result = await client.complete({
  prompt: 'Translate "hello" to Spanish.',
  modelId: 'openai/gpt-4o-mini',
  maxTokens: 50,
});
console.log(result.text); // "Hola"
```

### Embeddings

```ts
const result = await client.embed({ input: 'Search query text' });
const vector = result.embeddings[0].embedding; // number[]
console.log(result.dimension);                  // e.g. 1536

// Embed multiple strings in one call:
const batch = await client.embed({ input: ['text one', 'text two'] });
```

### Image generation

```ts
const result = await client.generateImage({
  prompt: 'A peaceful mountain landscape at sunrise',
  modelId: 'openai/dall-e-3',
  size: '1024x1024',
});
console.log(result.url);
```

### Managing assistants and threads

```ts
// List all assistants accessible with this API key
const assistants = await client.listAssistants();

// Get a specific assistant
const assistant = await client.getAssistant('asst_abc123');

// Create a thread with optional title/metadata
const thread = await client.createThread('asst_abc123', {
  title: 'Support session',
  metadata: { userId: '42' },
});

// Delete a thread when the session is over
await client.deleteThread('asst_abc123', thread.threadId);
```

### Listing available models

```ts
const models = await client.listModels();
// [{ id, modelId, name, providerName, supportsImages, supportsImageGeneration }]
```

---

## Error Handling

All errors thrown by the client extend `GatewayError` and include `.status`, `.code`, and `.message`.

| Class | HTTP | When |
|---|---|---|
| `AuthError` | 401 | Invalid or missing API key |
| `ForbiddenError` | 403 | Key lacks the required scope for this operation |
| `NotFoundError` | 404 | Assistant or thread not found |
| `ValidationError` | 422 | Invalid request payload |
| `RateLimitError` | 429 | Assistant rate limit exceeded |

`RateLimitError` additionally exposes `.retryAfterSeconds` and a user-friendly `.message` — present both in your UI rather than a generic error.

```ts
import { GatewayError, RateLimitError, AuthError, ForbiddenError } from '@wisdomcircuits/ai-gateway-client';

try {
  await client.sendMessage(assistantId, threadId, { content });
} catch (err) {
  if (err instanceof RateLimitError) {
    showBanner(err.message, { retryIn: err.retryAfterSeconds });
  } else if (err instanceof AuthError) {
    redirectToLogin();
  } else if (err instanceof ForbiddenError) {
    showError('Your API key does not have permission for this action.');
  } else if (err instanceof GatewayError) {
    logError({ code: err.code, status: err.status, message: err.message });
  } else {
    throw err;
  }
}
```

---

## Rate Limiting

Rate limits are enforced by the gateway per assistant on a rolling 60-minute window:

- The **API key** sets a default req/hr limit for all assistants under it
- An **assistant** can override that limit; if left unset it inherits from the key
- When the limit is exceeded the gateway returns 429 and the client throws `RateLimitError`
- The error's `.message` is intentionally user-friendly — present it directly in your UI

---

## Available API scopes

Your API key must have the appropriate scope for each operation. Scopes are configured in the MS admin panel.

| Scope | Operations |
|---|---|
| `assistants:read` | listAssistants, getAssistant, listModels |
| `assistants:write` | createAssistant, updateAssistant, deleteAssistant, migrate |
| `threads:write` | createThread, deleteThread |
| `messages:write` | sendMessage |
| `messages:stream` | streamMessage, streamMessageToString |
| `completions:write` | complete |
| `embeddings:read` | embed |
| `images:write` | generateImage |

`ping` and `diagnostics` require only a valid API key — no specific scope.

---

## Integrating into a new app

Integrating this package into an application for the first time? See the **[Integration Guide](docs/INTEGRATION.md)** for a step-by-step walkthrough covering DB setup, server endpoints, admin UI, migration, chat handler changes, and cutover.

---

## Versioning

Pin to a specific tag in your `package.json` to avoid unexpected breaking changes:

```json
"@wisdomcircuits/ai-gateway-client": "github:ThinK-12-Development/Assistant-Microservice-Package#v0.2.0"
```

To upgrade, change the tag to the new version and run `npm install`. The `prepare` script rebuilds automatically.
