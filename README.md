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

## Integration Guide

Follow these steps when integrating this package into a new application. Each step has a clear verification point — **do not proceed to the next step until the current one passes.**

---

### Before you start

Complete these before touching any code:

1. **Create an API key** in the MS admin panel for this app. Give it the scopes it needs (see scopes table above). Note the key value — you'll only see it once.
2. **Note the MS base URL** — the deployed URL of the gateway microservice.
3. **Identify the model IDs your app uses** — every model the app passes to an assistant must exist and be enabled in the MS. Model IDs use the format `provider/model-name` (e.g. `openai/gpt-4o`). Check the MS admin panel → Models to confirm. If a model your app uses is missing, add it to the MS before proceeding — migration will fail for any assistant whose model isn't found.

---

### Step 1 — Install & configure

Add the package to `package.json`:

```json
"@wisdomcircuits/ai-gateway-client": "github:ThinK-12-Development/Assistant-Microservice-Package#v0.2.0"
```

```bash
npm install
```

Add to your environment (`.env`, Replit secrets, hosting env vars):

```
GATEWAY_URL=https://your-gateway-url
GATEWAY_API_KEY=gw_your_api_key
```

**Verify:** app starts without import errors.

---

### Step 2 — Add gateway columns to your database

Add two nullable columns to your assistants/chatbots table:

- `gateway_assistant_id` — text, nullable, no default — stores the MS assistant ID after migration
- `use_gateway` — boolean, default `false` — the cutover switch per assistant

**Do not remove or modify any existing columns.** The legacy path stays active until Step 8.

**Verify:** schema migration runs cleanly, all existing records unaffected.

---

### Step 3 — Add server-side admin endpoints

These endpoints are the plumbing your admin UI (Step 4) will call. Add all of them now so the UI is fully functional when you build it.

All endpoints must be behind your app's admin authentication middleware.

```ts
import { GatewayClient, GatewayError } from '@wisdomcircuits/ai-gateway-client';

const gateway = new GatewayClient({
  baseUrl: process.env.GATEWAY_URL!,
  apiKey: process.env.GATEWAY_API_KEY!,
});

// GET /api/admin/gateway/ping
// Confirms the gateway is reachable and the API key is valid.
app.get('/api/admin/gateway/ping', requireAdmin, async (req, res) => {
  try {
    const result = await gateway.ping();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/admin/gateway/diagnostics
// Returns key scopes, available providers, and enabled models.
// Use this to verify the key has the right scopes and the app's models are present.
app.get('/api/admin/gateway/diagnostics', requireAdmin, async (req, res) => {
  try {
    const result = await gateway.diagnostics();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Migration state — held in memory for the lifetime of the process.
// For multi-instance deployments, move this to your DB or Redis.
let migrationState: {
  status: 'idle' | 'running' | 'stopped' | 'complete';
  total: number;
  succeeded: number;
  failed: number;
  results: Array<{ sourceId: string; name: string; gatewayAssistantId: string | null; status: 'created' | 'failed'; error?: string }>;
  stopRequested: boolean;
} = { status: 'idle', total: 0, succeeded: 0, failed: 0, results: [], stopRequested: false };

const BATCH_SIZE = 5;       // assistants per batch
const BATCH_DELAY_MS = 500; // pause between batches to avoid rate limits

// POST /api/admin/gateway/migrate/start
// Begins batched migration in the background. Returns immediately.
// Safe to call multiple times — skips already migrated assistants (idempotent).
// If stopped mid-run, calling start again resumes from where it left off.
app.post('/api/admin/gateway/migrate/start', requireAdmin, async (req, res) => {
  if (migrationState.status === 'running') {
    return res.json({ ok: false, message: 'Migration already in progress.' });
  }

  const unmigrated = await getUnmigratedAssistants();
  if (unmigrated.length === 0) {
    return res.json({ ok: true, message: 'All assistants already migrated.', total: 0 });
  }

  // Reset state for this run (preserve previous results from prior runs)
  migrationState = {
    status: 'running',
    total: unmigrated.length,
    succeeded: 0,
    failed: 0,
    results: [],
    stopRequested: false,
  };

  // Respond immediately — migration runs in background
  res.json({ ok: true, message: 'Migration started.', total: unmigrated.length });

  // Background processing
  setImmediate(async () => {
    for (let i = 0; i < unmigrated.length; i += BATCH_SIZE) {
      if (migrationState.stopRequested) {
        migrationState.status = 'stopped';
        break;
      }

      const batch = unmigrated.slice(i, i + BATCH_SIZE);
      const batchResults = await gateway.migrate(
        batch.map(a => ({
          sourceId: String(a.id),
          name: a.name,
          instructions: a.instructions,
          modelId: a.modelId, // must exist in MS — check diagnostics first
          description: a.description ?? undefined,
        }))
      );

      for (const r of batchResults) {
        const assistant = batch.find(a => String(a.id) === r.sourceId)!;
        migrationState.results.push({ ...r, name: assistant.name });
        if (r.status === 'created') {
          migrationState.succeeded++;
          await updateAssistantGatewayId(Number(r.sourceId), r.gatewayAssistantId!);
        } else {
          migrationState.failed++;
        }
      }

      // Pause between batches unless this is the last one
      if (i + BATCH_SIZE < unmigrated.length && !migrationState.stopRequested) {
        await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
      }
    }

    if (migrationState.status === 'running') {
      migrationState.status = 'complete';
    }
  });
});

// POST /api/admin/gateway/migrate/stop
// Requests a graceful stop after the current batch completes.
app.post('/api/admin/gateway/migrate/stop', requireAdmin, async (req, res) => {
  if (migrationState.status !== 'running') {
    return res.json({ ok: false, message: 'No migration is currently running.' });
  }
  migrationState.stopRequested = true;
  res.json({ ok: true, message: 'Stop requested — will halt after current batch completes.' });
});

// GET /api/admin/gateway/migrate/status
// Returns current migration progress. Poll this every 2-3 seconds while migration is running.
app.get('/api/admin/gateway/migrate/status', requireAdmin, async (req, res) => {
  res.json({
    status: migrationState.status,           // idle | running | stopped | complete
    total: migrationState.total,
    succeeded: migrationState.succeeded,
    failed: migrationState.failed,
    remaining: migrationState.total - migrationState.succeeded - migrationState.failed,
    results: migrationState.results,         // per-assistant results so far
  });
});

// GET /api/admin/gateway/assistants
// Returns all assistants with their migration status for display in the admin UI.
app.get('/api/admin/gateway/assistants', requireAdmin, async (req, res) => {
  try {
    const assistants = await getAllAssistants(); // fetch from your DB
    res.json(assistants.map(a => ({
      id: a.id,
      name: a.name,
      modelId: a.modelId,
      gatewayAssistantId: a.gatewayAssistantId ?? null,
      useGateway: a.useGateway ?? false,
      migrated: !!a.gatewayAssistantId,
    })));
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// PATCH /api/admin/gateway/assistants/:id/toggle
// Flips use_gateway for a single assistant.
// This is the cutover switch — flip to true to route chat through the MS.
app.patch('/api/admin/gateway/assistants/:id/toggle', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { useGateway } = req.body;
    await updateAssistantUseGateway(Number(id), useGateway);
    res.json({ ok: true, id, useGateway });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
```

**Verify:** all five endpoints respond correctly when called directly (curl or Postman).

---

### Step 4 — Build the gateway admin UI page

Build an admin-only page in your app's UI at a path like `/admin/gateway`. This page is the control panel for the entire migration and cutover process. It must be built before you run the migration so you can monitor results and act on errors.

The page has four sections:

**1. Connection status**
Calls `GET /api/admin/gateway/ping` and `GET /api/admin/gateway/diagnostics` on load.
Display:
- Connection indicator (green/red based on `ok`)
- Latency
- Key name and scopes
- Available models list
- Any missing scopes or models shown as warnings

**2. Pre-flight model check**
Compare the models your app's assistants use against the models returned by diagnostics.
Display a table: assistant name | model it uses | present in MS (yes/no).
If any model is missing: show a red warning with the model name and instructions to add it in the MS admin panel. Block migration until all models are present.

**3. Migration panel**
Shows migration status for all assistants (calls `GET /api/admin/gateway/assistants`).
Display a table: assistant name | migrated (yes/no) | gateway assistant ID | error (if any).

Controls:
- **Start / Resume** button — calls `POST /api/admin/gateway/migrate/start`. Safe to call at any time; skips already migrated assistants. If a previous run was stopped, this resumes from where it left off.
- **Stop** button (visible only when running) — calls `POST /api/admin/gateway/migrate/stop`. Halts gracefully after the current batch of 5 completes. Does not undo completed migrations.

While running, poll `GET /api/admin/gateway/migrate/status` every 2 seconds and update:
- A progress bar: X of Y migrated
- Running counts: X succeeded, X failed, X remaining
- The per-assistant results table as each batch completes, showing success with gateway ID or failure with error message (e.g. "Model 'openai/gpt-4' not found in MS — add it to the MS admin panel and retry")

Stop polling when `status` is `complete` or `stopped`.

The Start button should be disabled if any models are missing (from Section 2).

**4. Cutover panel**
Shows all migrated assistants with their current `use_gateway` state.
A toggle per assistant calls `PATCH /api/admin/gateway/assistants/:id/toggle`.
Show clearly which assistants are live on the gateway vs still on the legacy path.
Include a "Switch all" button for final cutover once individual assistants are verified.

**Verify:** page loads, connection status shows green, model check table populates, migration panel shows all assistants with their current status.

---

### Step 5 — Verify connection & pre-flight

Using the admin UI you just built:

1. Confirm ping returns green
2. Confirm diagnostics shows the correct scopes for this app
3. Confirm all models your assistants use appear in the MS model list — if any are missing, add them in the MS admin panel before continuing

**Verify:** all models present, no scope warnings.

---

### Step 6 — Migrate existing assistants

Using the admin UI migration panel:

1. Click **Start** — migration begins in the background, processing 5 assistants per batch
2. Watch the progress bar and per-assistant results update in real time
3. If you spot a pattern in the failures (wrong model, systematic error), click **Stop** — it halts after the current batch. Fix the root cause, then click **Start** again to resume. Already migrated assistants are skipped automatically.
4. Any `failed` items show the error — most common cause is a model not found in the MS. Add the missing model in the MS admin panel and resume.
5. Migration is complete when the status shows `complete` and remaining is 0.

**Verify:** all assistants show `migrated: true` with a `gateway_assistant_id`. Confirm they appear in the MS admin panel → Assistants.

---

### Step 7 — Wire new assistant creation through the gateway

When your app creates a new assistant, also create it in the MS and store the returned ID:

```ts
// After creating the assistant in your own DB:
const created = await gateway.createAssistant({
  name: input.name,
  instructions: input.instructions,
  modelId: input.modelId, // must exist in MS
  description: input.description,
});

await updateAssistantGatewayId(newAssistant.id, created.assistantId);
```

If the model doesn't exist in the MS, `createAssistant()` will throw a `GatewayError` — surface this to the admin as "Model X not found in gateway — contact your MS administrator."

**Verify:** create a new assistant, confirm `gateway_assistant_id` is populated, confirm it appears in MS admin.

---

### Step 8 — Switch chat to gateway (per-assistant)

In your chat handler, branch on `useGateway`:

```ts
if (assistant.useGateway && assistant.gatewayAssistantId) {
  // Gateway path — thread management via MS
  const thread = await getOrCreateGatewayThread(sessionId, assistant.gatewayAssistantId);
  const result = await gateway.sendMessage(assistant.gatewayAssistantId, thread.threadId, {
    content: message,
  });
  return result.message.content;
} else {
  // Legacy path — unchanged
}
```

Thread continuity: store the MS `threadId` against the session in your DB so the same thread is reused across messages. On the first message of a new session, call `gateway.createThread()` and store the returned `threadId`.

Use the cutover panel in your admin UI to flip `use_gateway = true` on one assistant first.

**Verify:** chat works end-to-end through the gateway. Send multiple messages in the same session and confirm context is maintained (thread continuity). Check the MS admin panel → Threads to confirm threads are being created.

---

### Step 9 — Full cutover & cleanup

Once all assistants are individually verified:

1. Use "Switch all" in the admin UI cutover panel to flip all assistants to `use_gateway = true`
2. Monitor for errors over a verification period
3. Once stable, remove the legacy chat branch from your code
4. Remove the legacy AI SDK/OpenAI direct dependency
5. Drop the old `api_key` and legacy `assistant_id` columns after confirming they are no longer read anywhere

**Verify:** all assistants chat successfully through the gateway. No references to the old API remain.

---

### Integration complete checklist

- [ ] API key created in MS admin with correct scopes
- [ ] All app models confirmed present in MS
- [ ] Package installed, env vars set
- [ ] DB columns added (`gateway_assistant_id`, `use_gateway`)
- [ ] All five server-side admin endpoints added and responding
- [ ] Gateway admin UI page built with all four sections
- [ ] `ping()` returns `ok: true` in UI
- [ ] `diagnostics()` shows correct scopes and all required models
- [ ] All existing assistants migrated (start/stop/resume verified, no failures)
- [ ] New assistant creation writes `gateway_assistant_id`
- [ ] Chat handler branching on `use_gateway`
- [ ] Thread continuity verified across multi-message sessions
- [ ] All assistants on gateway path
- [ ] Legacy dependency removed

---

## Versioning

Pin to a specific tag in your `package.json` to avoid unexpected breaking changes:

```json
"@wisdomcircuits/ai-gateway-client": "github:ThinK-12-Development/Assistant-Microservice-Package#v0.2.0"
```

To upgrade, change the tag to the new version and run `npm install`. The `prepare` script rebuilds automatically.
