# Integration Guide

Step-by-step instructions for integrating `@wisdomcircuits/ai-gateway-client` into an application. Each step has a clear verification point — **do not proceed to the next step until the current one passes.**

---

## Before you start

Complete these before touching any code:

1. **Create an API key** in the MS admin panel for this app. Enable these scopes at minimum:
   - `threads:write`, `messages:write`, `messages:stream` — required for chat
   - `assistants:read`, `assistants:write` — required for migration and bot-update sync
   - `files:read`, `files:write` — required for content source sync

   Note the key value — you'll only see it once.

   > **Gotcha:** `messages:stream` is a separate scope from `messages:write`. Missing it causes thread creation to succeed but streaming to hang silently with no error. Always grant both.

   > **Gotcha:** `files:write` is required for content propagation (Step 10). Grant it upfront — you'll need it and forgetting it causes silent failures.

2. **Note the MS base URL** — the deployed URL of the gateway microservice.

3. **Identify the model IDs your app uses** — every model must exist and be enabled in the MS. Model IDs use the format `provider/model-name` (e.g. `openai/gpt-4o`). Check MS admin → Models. Missing models cause migration to fail per-assistant.

---

## Step 1 — Install & configure

Add the package to `package.json`, pinned to a specific git tag:

```json
"@wisdomcircuits/ai-gateway-client": "github:ThinK-12-Development/Assistant-Microservice-Package#v0.4.2"
```

```bash
npm install
```

> **Gotcha:** The package is installed from a git tag, not npm. Pushing to `main` does NOT update the installed version. You must bump the version in the package's `package.json`, create a new git tag, and update the `#tag` reference in your app's `package.json`, then re-run `npm install`. Version in `package.json` must match the tag name.

Add to your environment (`.env`, Replit secrets, hosting env vars):

```
GATEWAY_URL=https://your-gateway-url
GATEWAY_API_KEY=gw_your_api_key
```

**Verify:** app starts without import errors.

---

## Step 2 — Add gateway columns to your database

Add these nullable columns to your assistants/chatbots table:

- `gateway_assistant_id` — text, nullable — stores the MS assistant ID after migration
- `use_gateway` — boolean, default `false` — the per-assistant cutover switch

Add this column to your content sources junction table (the table linking chatbots to content sources):

- `gateway_file_id` — text, nullable — stores the MS file ID after upload

> **Critical:** Push/run your DB schema migration **before** starting the MS migration in Step 6. ORMs like Drizzle silently ignore writes to columns that don't exist in the DB yet — no error is thrown but nothing is stored.

**Verify:** migration runs cleanly. Confirm columns exist by reading the DB schema directly.

---

## Step 3 — Create a shared GatewayClient instance

Create one shared `GatewayClient` instance at module load. Do **not** instantiate it lazily inside each route handler — this causes repeated object creation and makes it harder to guard against missing env vars.

```ts
import { GatewayClient } from "@wisdomcircuits/ai-gateway-client";

const gatewayClient = process.env.GATEWAY_URL && process.env.GATEWAY_API_KEY
  ? new GatewayClient({ baseUrl: process.env.GATEWAY_URL, apiKey: process.env.GATEWAY_API_KEY })
  : null;
```

Guard every gateway call with a null check (`if (gatewayClient && ...)`) so the app starts and works even if env vars are missing.

---

## Step 4 — Add server-side admin endpoints

These endpoints are the plumbing your admin UI (Step 5) will call.

All endpoints must be behind your app's admin authentication middleware.

> **Error logging requirement:** The migration runs in a background `setImmediate` loop. Wrap the entire loop in a try/catch and log errors to the server console — failures will not surface to the UI otherwise.

```ts
// GET /api/admin/gateway/ping
app.get('/api/admin/gateway/ping', requireAdmin, async (req, res) => {
  if (!gatewayClient) return res.status(503).json({ ok: false, error: 'Gateway not configured' });
  try {
    const result = await gatewayClient.ping();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/admin/gateway/diagnostics
app.get('/api/admin/gateway/diagnostics', requireAdmin, async (req, res) => {
  if (!gatewayClient) return res.status(503).json({ ok: false, error: 'Gateway not configured' });
  try {
    const result = await gatewayClient.diagnostics();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Migration state — in-memory for single-instance deployments.
let migrationState: {
  status: 'idle' | 'running' | 'stopped' | 'complete';
  total: number;
  succeeded: number;
  failed: number;
  results: Array<{ sourceId: string; name: string; gatewayAssistantId: string | null; status: 'created' | 'failed'; error?: string }>;
  stopRequested: boolean;
} = { status: 'idle', total: 0, succeeded: 0, failed: 0, results: [], stopRequested: false };

const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 500;

// POST /api/admin/gateway/migrate/start
app.post('/api/admin/gateway/migrate/start', requireAdmin, async (req, res) => {
  if (!gatewayClient) return res.status(503).json({ ok: false, error: 'Gateway not configured' });
  if (migrationState.status === 'running') {
    return res.json({ ok: false, message: 'Migration already in progress.' });
  }

  const unmigrated = await getUnmigratedAssistants(); // only those without gateway_assistant_id
  if (unmigrated.length === 0) {
    return res.json({ ok: true, message: 'All assistants already migrated.', total: 0 });
  }

  migrationState = { status: 'running', total: unmigrated.length, succeeded: 0, failed: 0, results: [], stopRequested: false };
  res.json({ ok: true, message: 'Migration started.', total: unmigrated.length });

  setImmediate(async () => {
    try {
      for (let i = 0; i < unmigrated.length; i += BATCH_SIZE) {
        if (migrationState.stopRequested) { migrationState.status = 'stopped'; break; }

        const batch = unmigrated.slice(i, i + BATCH_SIZE);
        const batchResults = await gatewayClient!.migrate(
          batch.map(a => ({
            sourceId: String(a.id),
            name: a.name,
            instructions: a.instructions,
            modelId: a.modelId, // "provider/model-name" format e.g. "openai/gpt-4o"
            description: a.description ?? undefined,
            providerMode: 'openai_responses', // REQUIRED — omitting defaults to unbuilt internal path
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
            console.error('[migration] item failed:', r.sourceId, r.error);
          }
        }

        if (i + BATCH_SIZE < unmigrated.length && !migrationState.stopRequested) {
          await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
        }
      }
      if (migrationState.status === 'running') migrationState.status = 'complete';
    } catch (err) {
      console.error('[migration] Fatal error in background loop:', err);
      migrationState.status = 'stopped';
    }
  });
});

// POST /api/admin/gateway/migrate/stop
app.post('/api/admin/gateway/migrate/stop', requireAdmin, (req, res) => {
  if (migrationState.status !== 'running') {
    return res.json({ ok: false, message: 'No migration is currently running.' });
  }
  migrationState.stopRequested = true;
  res.json({ ok: true, message: 'Stop requested — will halt after current batch completes.' });
});

// GET /api/admin/gateway/migrate/status
// Seed from DB on restart so UI shows real state instead of blank panel.
app.get('/api/admin/gateway/migrate/status', requireAdmin, async (req, res) => {
  if (migrationState.status !== 'running' && migrationState.results.length === 0) {
    const all = await getAllAssistants();
    const migrated = all.filter(a => !!a.gatewayAssistantId);
    const unmigrated = all.filter(a => !a.gatewayAssistantId);
    if (migrated.length > 0) {
      return res.json({
        status: unmigrated.length === 0 ? 'complete' : 'idle',
        total: all.length,
        succeeded: migrated.length,
        failed: 0,
        remaining: unmigrated.length,
        results: migrated.map(a => ({ sourceId: String(a.id), name: a.name, gatewayAssistantId: a.gatewayAssistantId, status: 'created' })),
      });
    }
  }
  res.json({
    status: migrationState.status,
    total: migrationState.total,
    succeeded: migrationState.succeeded,
    failed: migrationState.failed,
    remaining: migrationState.total - migrationState.succeeded - migrationState.failed,
    results: migrationState.results,
  });
});

// GET /api/admin/gateway/assistants?page=1&limit=25&search=
app.get('/api/admin/gateway/assistants', requireAdmin, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, parseInt(req.query.limit as string) || 25);
    const search = (req.query.search as string)?.toLowerCase() ?? '';
    const offset = (page - 1) * limit;
    let assistants = await getAllAssistants();
    if (search) assistants = assistants.filter(a => a.name.toLowerCase().includes(search));
    const total = assistants.length;
    const paged = assistants.slice(offset, offset + limit);
    res.json({
      data: paged.map(a => ({ id: a.id, name: a.name, modelId: a.modelId, gatewayAssistantId: a.gatewayAssistantId ?? null, useGateway: a.useGateway ?? false, migrated: !!a.gatewayAssistantId })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// PATCH /api/admin/gateway/assistants/:id/toggle
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

**Verify:** all endpoints respond correctly when called directly.

---

## Step 5 — Build the gateway admin UI page

Build an admin-only page at `/admin/gateway`. The page has four sections:

**1. Connection status** — calls ping and diagnostics on load. Display: green/red indicator, latency, key name, scopes list, models list. Show warnings for missing scopes.

**2. Pre-flight model check** — compare assistant models against MS models. Table: assistant | model | present in MS (✅/❌). Block Start Migration if any model is missing.

**3. Migration panel** — paginated assistant list (25/page, searchable). Table: name | migrated | gateway ID | error. Controls: Start/Resume, Stop. Poll status every 2s while running.

**4. Cutover panel** — paginated table of migrated assistants with `use_gateway` toggle per row. "Switch all to Gateway" button disabled until at least one assistant has been individually verified.

**Verify:** page loads, connection is green, model check populates, all assistants listed.

---

## Step 6 — Migrate existing assistants

1. Click **Start** in the migration panel
2. Watch progress in real time
3. If failures appear, click **Stop**, fix the root cause, click **Start** again — already migrated assistants are skipped
4. Most common failure: model not in MS — add it in MS admin → Models then resume

**Verify:** all assistants show a gateway assistant ID. Confirm they appear in MS admin → Assistants.

---

## Step 7 — Wire new assistant creation through the gateway

When your app creates a new assistant, also create it in the MS immediately:

```ts
const created = await gatewayClient.createAssistant({
  name: input.name,
  instructions: input.instructions,
  modelId: `openai/${input.model}`, // "provider/model-name" format
  description: input.description,
  providerMode: 'openai_responses', // REQUIRED
});

await updateAssistantGatewayId(newAssistant.id, created.assistantId);
await updateAssistantUseGateway(newAssistant.id, true); // new bots go straight to gateway
```

**Verify:** create a new assistant, confirm `gateway_assistant_id` is populated and it appears in MS admin.

---

## Step 8 — Propagate bot updates to the MS

Every place in your app that updates a bot must also sync to the MS. This is not optional — the MS stores its own copy of the assistant's name, description, instructions, and model, and uses them on every request. If you don't sync, the MS will serve stale data.

Four update vectors to cover:

**1. Name + description** (wherever the bot's basic info is edited):
```ts
if (gatewayClient && bot.useGateway && bot.gatewayAssistantId) {
  const patch: Record<string, string> = {};
  if (name) patch.name = name;
  if (description) patch.description = description;
  if (Object.keys(patch).length > 0) {
    gatewayClient.updateAssistant(bot.gatewayAssistantId, patch)
      .catch(err => console.error('[gateway] updateAssistant failed:', err.message));
  }
}
```

**2. System instructions** (wherever instructions/prompt is edited):
```ts
if (gatewayClient && bot.useGateway && bot.gatewayAssistantId) {
  gatewayClient.updateAssistant(bot.gatewayAssistantId, { instructions: systemInstructions })
    .catch(err => console.error('[gateway] updateAssistant failed:', err.message));
}
```

> **Critical gotcha:** Do NOT fetch instructions from OpenAI before updating them. The MS uses the OpenAI Responses API which does NOT store instructions on an assistant object — instructions are passed per-request from the MS DB. Fetching from OpenAI for a gateway bot will return nothing and silently overwrite your instructions with an empty string.
>
> Gate any legacy OpenAI fetch/push behind `if (!bot.useGateway)`:
> ```ts
> if (!bot.useGateway) {
>   // legacy OpenAI path
> }
> ```

**3. Model changes** (wherever the global or per-bot model is changed):
```ts
// Model IDs in MS use "provider/model-name" format
const msModelId = `openai/${newModel}`; // adjust prefix for non-OpenAI models
for (const bot of gatewayBots) {
  gatewayClient.updateAssistant(bot.gatewayAssistantId, { modelId: msModelId })
    .catch(err => console.error('[gateway] model update failed:', err.message));
}
```

All gateway sync calls should be fire-and-forget (`.catch` logs the error but does not fail the user-facing request). The user's update succeeds even if the MS sync fails — but log it so you can detect and fix connectivity issues.

**Verify:** update name, description, instructions, and model on a gateway bot. Confirm changes appear in MS admin → the assistant's detail page.

---

## Step 9 — Wire chat to the gateway

In your chat handler, branch on `useGateway`:

```ts
if (bot.useGateway && bot.gatewayAssistantId) {
  // Thread continuity — reuse threadId across messages in the same session
  // Never call createThread() on every message — you'll lose conversation history
  let threadId = getGatewayThreadId(sessionId); // your lookup (Map, DB, Redis)
  if (!threadId) {
    const thread = await gatewayClient.createThread(bot.gatewayAssistantId);
    threadId = thread.threadId;
    saveGatewayThreadId(sessionId, threadId);
  }

  // Streaming
  let fullText = '';
  for await (const chunk of gatewayClient.streamMessage(bot.gatewayAssistantId, threadId, { content: message })) {
    if (chunk.type === 'text') {
      fullText += chunk.text;
      // write to your SSE/WebSocket stream
    }
  }
  return fullText;
} else {
  // legacy path — unchanged
}
```

Use the cutover panel to flip one bot at a time. Verify each before switching more.

**Verify:** chat works end-to-end. Send multiple messages in one session — confirm context is maintained. Check MS admin → Threads to confirm threads and messages appear.

---

## Step 10 — Propagate content source changes to the MS

When a content source (file, URL, or manual text) is attached to or removed from a bot, the MS assistant's file store must be kept in sync. The MS uses a vector store per assistant — it syncs files on the first message after upload, so there is a one-time latency cost on the first chat after a new file is added. For bots with many files added before any chat, this latency can be significant (see Troubleshooting).

**Schema requirement:** your content source junction table needs a `gateway_file_id` column (text, nullable) to track the MS file ID per mapping. Add it in Step 2 alongside the other columns.

Also add these methods to your storage layer (adapt to your ORM):
- `updateContentSourceMapping(botId, contentSourceId, { gatewayFileId })` — store the file ID after upload
- `getContentSourceMapping(botId, contentSourceId)` — retrieve a mapping (to get `gatewayFileId` before delete)
- `getChatbotContentSourceMappings(contentSourceId)` — get all mappings for a source (for cascade delete)

**On attach** (`POST /api/chatbots/:id/content-sources`):
```ts
// After the DB mapping is created:
if (gatewayClient && bot.useGateway && bot.gatewayAssistantId
    && contentSource.processingStatus === 'processed' && contentSource.content) {
  const filename = `${contentSource.contentType}-${contentSource.name.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}.txt`;
  gatewayClient.uploadFile(bot.gatewayAssistantId, {
    filename,
    content: Buffer.from(contentSource.content, 'utf-8'),
    mimeType: 'text/plain',
  }).then(result => storage.updateContentSourceMapping(bot.id, contentSource.id, { gatewayFileId: result.fileId }))
    .catch(err => console.error('[gateway] uploadFile failed:', err.message));
}
```

> **Note:** Upload only fires if `processingStatus === 'processed'` and `content` is populated. Content sources that are still pending/processing at attach time will NOT be uploaded. Backfill by detaching and re-attaching once processing completes, or retrigger scraping from the admin.

**On detach** (`DELETE /api/chatbots/:id/content-sources/:contentSourceId`):
```ts
// Before removing the DB mapping — retrieve the gatewayFileId first:
if (gatewayClient && bot.useGateway && bot.gatewayAssistantId) {
  const mapping = await storage.getContentSourceMapping(bot.id, contentSourceId);
  if (mapping?.gatewayFileId) {
    gatewayClient.deleteFile(bot.gatewayAssistantId, mapping.gatewayFileId)
      .catch(err => console.error('[gateway] deleteFile failed:', err.message));
  }
}
await storage.removeContentSourceFromChatbot(bot.id, contentSourceId);
```

**On content source delete** (`DELETE /api/content-sources/:id`):
```ts
// Cascade-delete from MS for all bots that have this source mapped:
if (gatewayClient) {
  const mappings = await storage.getChatbotContentSourceMappings(id);
  for (const m of mappings) {
    if (!m.gatewayFileId) continue;
    const bot = await storage.getChatbot(m.botId);
    if (bot?.useGateway && bot.gatewayAssistantId) {
      gatewayClient.deleteFile(bot.gatewayAssistantId, m.gatewayFileId)
        .catch(err => console.error('[gateway] deleteFile (cascade) failed:', err.message));
    }
  }
}
await storage.deleteContentSource(id);
```

**Verify:** attach a processed content source to a gateway bot. Ask the bot a question only that source would know. Confirm it answers correctly. Check MS admin → the assistant's files section — the file should appear after the first message is sent.

---

## Step 11 — Full cutover & cleanup

Once all bots are individually verified on the gateway:

1. Use "Switch all to Gateway" in the cutover panel
2. Monitor for errors
3. Once stable, remove the legacy chat branch
4. Remove the legacy AI SDK / direct OpenAI dependency
5. Drop old legacy-only columns once confirmed unused

---

## Troubleshooting

### Thread is created but chat hangs with no response
The API key is missing `messages:stream` scope. Thread creation (`threads:write`) and streaming (`messages:stream`) are separate scopes — missing the latter causes a silent 403 on the stream endpoint that manifests as a hang. Check scopes in MS admin → API Keys.

### Chat hangs even with correct scopes
The package's stream URL or SSE format may be wrong. The MS stream endpoint is `/api/v1/threads/:threadId/messages/stream` (no `/assistants/:id/` prefix). The MS SSE format is `data: {"type":"chunk","content":"..."}` / `data: {"type":"done",...}` — not the Vercel AI SDK `0:"text"` format. Verify the installed package version handles both.

### Migration panel shows blank after server restart
`migrationState` is in-memory and resets on restart. Use the DB-seeding pattern in the status endpoint (see Step 4) to read real state from `gateway_assistant_id` values.

### `gateway_assistant_id` saves silently not persisting
DB schema migration ran after migration started. Drizzle silently drops writes to columns that don't exist yet. Run `db push` **before** starting migration. Verify by reading the column directly in the DB, not through the ORM.

### Gateway bot returns stale instructions after update
The legacy path was fetching instructions from OpenAI before saving (to merge/display them). For gateway bots this fetch returns nothing — the Responses API doesn't store instructions on assistant objects. Gate any OpenAI instruction fetch/push behind `if (!bot.useGateway)`.

### Content source attached but bot doesn't know about it
Upload only fires if the content source has `processingStatus === 'processed'` and `content` populated at the moment of attach. If the source was still processing when attached, the upload was skipped. Detach and re-attach once processing is complete, or retrigger scraping from the admin panel.

### First message after new file is very slow
Expected behavior. The MS syncs files to OpenAI's vector store on the first message after a new file is uploaded, not at upload time. For bots with many files added before any chat, this can cause significant latency on that first message. It's a one-time cost per file — subsequent messages are fast. A future MS improvement will trigger the sync at upload time to eliminate this.

### Models missing from MS / migration fails with model error
Add the model in MS admin → Models before migrating. Migration sends `modelId` in `provider/model-name` format — the MS resolves it to an internal UUID. The failure mode is a `GatewayError` with code `INVALID_MODEL`.

### Bot appears in MS but `assistant.model_id` column has a string instead of a UUID
If assistants were migrated before model resolution was working correctly, the `model_id` column in the MS DB may contain `"openai/gpt-4o"` instead of the UUID. Fix with:
```sql
UPDATE assistants
SET model_id = (SELECT id FROM llm_models WHERE model_id = 'gpt-4o' LIMIT 1)
WHERE model_id = 'openai/gpt-4o';
```

### Package won't install / TypeScript build errors
The package requires `@types/node` as a dev dependency and must be built before install. If you see `Cannot find name 'Buffer'` or `Buffer is not assignable to BlobPart`, the installed package tag is missing the fix — update to `v0.4.2` or later.

---

## Integration complete checklist

- [ ] API key created with all required scopes (`threads:write`, `messages:write`, `messages:stream`, `assistants:read`, `assistants:write`, `files:read`, `files:write`)
- [ ] All app models confirmed present in MS
- [ ] Package installed and pinned to a specific git tag
- [ ] Env vars set (`GATEWAY_URL`, `GATEWAY_API_KEY`)
- [ ] DB columns added: `gateway_assistant_id`, `use_gateway` on assistants table; `gateway_file_id` on content sources junction table
- [ ] DB migration run before any MS operations
- [ ] Shared `GatewayClient` instance created (not lazy per-route)
- [ ] All admin endpoints added and responding
- [ ] Gateway admin UI built (connection, model check, migration panel, cutover panel)
- [ ] `ping()` returns `ok: true`
- [ ] `diagnostics()` shows correct scopes and all required models
- [ ] All existing assistants migrated with no failures
- [ ] New assistant creation writes `gateway_assistant_id` and sets `use_gateway: true`
- [ ] Bot update sync wired for: name/description, instructions, model
- [ ] Legacy OpenAI instruction fetch/push gated on `!useGateway`
- [ ] Chat handler branching on `use_gateway`
- [ ] Thread continuity verified across multi-message sessions
- [ ] Content source attach uploads file to MS and stores `gateway_file_id`
- [ ] Content source detach deletes file from MS
- [ ] Content source delete cascade-deletes from MS for all mapped bots
- [ ] Content knowledge verified end-to-end (bot answers from attached source)
- [ ] All bots on gateway path
- [ ] Legacy dependency removed
