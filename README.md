# @wisdomcircuits/ai-gateway-client

TypeScript HTTP client for the Wisdom Circuits AI Gateway microservice.

## Installation

Add as a git dependency in your project's `package.json`:

```json
{
  "dependencies": {
    "@wisdomcircuits/ai-gateway-client": "github:ThinK-12-Development/assistant-microservice-package#v0.1.0"
  }
}
```

Then:

```bash
npm install
# or
yarn install
```

The `prepare` script runs `tsc` automatically — no separate build step needed.

## Quick Start

```ts
import { GatewayClient, RateLimitError } from '@wisdomcircuits/ai-gateway-client';

const client = new GatewayClient({
  baseUrl: 'https://your-gateway-url',
  apiKey: 'gw_your_api_key',
});
```

## Usage

### Non-streaming message

```ts
const thread = await client.createThread('asst_abc123');

const result = await client.sendMessage('asst_abc123', thread.threadId, {
  content: 'What is the capital of France?',
});

console.log(result.message.content);
console.log(result.usage.totalTokens);
```

### Streaming message (chunk-by-chunk)

```ts
try {
  for await (const chunk of client.streamMessage('asst_abc123', thread.threadId, {
    content: 'Tell me a story.',
  })) {
    if (chunk.type === 'text') {
      process.stdout.write(chunk.text!);
    }
  }
} catch (err) {
  if (err instanceof RateLimitError) {
    console.error(`Rate limited. Retry in ${err.retryAfterSeconds}s.`);
    // Show err.message to the user — it's already human-friendly
  }
}
```

### Streaming message (full string)

```ts
const text = await client.streamMessageToString('asst_abc123', thread.threadId, {
  content: 'Summarise this document.',
  settings: { context: documentText },
});
```

### One-shot completion (no thread)

```ts
const result = await client.complete({
  prompt: 'Translate "hello" to Spanish.',
  modelId: 'openai/gpt-4o-mini',
});
console.log(result.text); // "Hola"
```

### Embeddings

```ts
const result = await client.embed({ input: 'Search query text' });
const vector = result.embeddings[0].embedding;
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

## Error Handling

All errors extend `GatewayError` and include `.status`, `.code`, and `.message`.

| Class | HTTP | When |
|---|---|---|
| `AuthError` | 401 | Invalid or missing API key |
| `ForbiddenError` | 403 | Key lacks the required scope |
| `NotFoundError` | 404 | Assistant or thread not found |
| `ValidationError` | 422 | Invalid request payload |
| `RateLimitError` | 429 | Assistant rate limit exceeded |

`RateLimitError` additionally exposes `.retryAfterSeconds` and a user-friendly `.message` — display both in your UI.

```ts
import { GatewayError, RateLimitError, AuthError } from '@wisdomcircuits/ai-gateway-client';

try {
  await client.sendMessage(...);
} catch (err) {
  if (err instanceof RateLimitError) {
    showToast(err.message, { retryIn: err.retryAfterSeconds });
  } else if (err instanceof AuthError) {
    redirectToLogin();
  } else if (err instanceof GatewayError) {
    logError(err.code, err.status, err.message);
  }
}
```

## Assistant Rate Limiting

Rate limits are enforced by the gateway on a rolling 60-minute window per assistant:

- **API key** sets the default req/hr limit for all assistants under it
- **Assistant** can override with its own limit; `null` inherits from the API key
- On limit exceeded, the gateway returns 429 with a friendly message; the client surfaces it as `RateLimitError`

## Versioning

Pin to a specific tag in your `package.json` to avoid breaking changes:

```json
"@wisdomcircuits/ai-gateway-client": "github:ThinK-12-Development/assistant-microservice-package#v0.1.0"
```

When the gateway ships new features, update the tag and run `npm install` to pick them up.
