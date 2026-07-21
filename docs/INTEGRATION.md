# Integration Guide

Step-by-step instructions for integrating `@wisdomcircuits/ai-gateway-client` into an application. Each step has a clear verification point — **do not proceed to the next step until the current one passes.**

---

## Before you start

Complete these before touching any code:

1. **Create an API key** in the MS admin panel for this app. At minimum, enable these scopes: `threads:write`, `messages:write`, `messages:stream`. For full gateway integration also add: `assistants:read`, `assistants:write`, `files:read`, `files:write`. Note the key value — you'll only see it once. Missing `messages:stream` is a common gotcha — thread creation will succeed but streaming will silently 403.
2. **Note the MS base URL** — the deployed URL of the gateway microservice.
3. **Identify the model IDs your app uses** — every model the app passes to an assistant must exist and be enabled in the MS. Model IDs use the format `provider/model-name` (e.g. `openai/gpt-4o`). Check the MS admin panel → Models to confirm. If a model your app uses is missing, add it to the MS before proceeding — migration will fail for any assistant whose model isn't found.

---

## Step 1 — Install & configure

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

## Step 2 — Add gateway columns to your database

Add two nullable columns to your assistants/chatbots table:

- `gateway_assistant_id` — text, nullable, no default — stores the MS assistant ID after migration
- `use_gateway` — boolean, default `false` — the cutover switch per assistant

**Do not remove or modify any existing columns.** The legacy path stays active until Step 8.

> **Critical:** Push/run your DB schema migration **before** starting the MS migration in Step 6. ORMs like Drizzle silently ignore writes to columns that don't exist in the DB yet — `gateway_assistant_id` saves will succeed with no error but nothing will be stored, and you'll have no record that assistants were migrated.

**Verify:** schema migration runs cleanly, all existing records unaffected. Confirm the new columns exist in the DB (check the table schema directly, not just the ORM model).

---

## Step 3 — Add server-side admin endpoints

These endpoints are the plumbing your admin UI (Step 4) will call. Add all of them before building the UI.

All endpoints must be behind your app's admin authentication middleware.

> **Error logging requirement:** The migration runs in a background `setImmediate` loop. Wrap the entire loop in a try/catch and log errors to the server console — failures will not surface to the UI otherwise. See [Troubleshooting](./TROUBLESHOOTING.md) for the logging pattern.

```ts
import { GatewayClient } from '@wisdomcircuits/ai-gateway-client';

const gateway = new GatewayClient({
  baseUrl: process.env.GATEWAY_URL!,
  apiKey: process.env.GATEWAY_API_KEY!,
});

// GET /api/admin/gateway/ping
app.get('/api/admin/gateway/ping', requireAdmin, async (req, res) => {
  try {
    const result = await gateway.ping();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/admin/gateway/diagnostics
app.get('/api/admin/gateway/diagnostics', requireAdmin, async (req, res) => {
  try {
    const result = await gateway.diagnostics();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Migration state — in-memory for single-instance deployments.
// For multi-instance deployments, move to your DB or Redis.
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
// Starts batched migration in the background. Returns immediately.
// Idempotent — skips already migrated assistants. Resume after stop by calling again.
app.post('/api/admin/gateway/migrate/start', requireAdmin, async (req, res) => {
  if (migrationState.status === 'running') {
    return res.json({ ok: false, message: 'Migration already in progress.' });
  }

  const unmigrated = await getUnmigratedAssistants();
  if (unmigrated.length === 0) {
    return res.json({ ok: true, message: 'All assistants already migrated.', total: 0 });
  }

  migrationState = {
    status: 'running',
    total: unmigrated.length,
    succeeded: 0,
    failed: 0,
    results: [],
    stopRequested: false,
  };

  res.json({ ok: true, message: 'Migration started.', total: unmigrated.length });

  setImmediate(async () => {
    try {
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
            // modelId: pass as "provider/model-name" (e.g. "openai/gpt-4o") — MS resolves
            // it to the internal UUID automatically. Must exist in MS — verify via diagnostics first.
            modelId: a.modelId,
            description: a.description ?? undefined,
            providerMode: 'openai_responses', // required — defaults to unbuilt "internal" path if omitted
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

      if (migrationState.status === 'running') {
        migrationState.status = 'complete';
      }
    } catch (err) {
      console.error('[migration] Fatal error in background loop:', err);
      migrationState.status = 'stopped';
      migrationState.results.push({
        sourceId: 'unknown',
        name: 'unknown',
        gatewayAssistantId: null,
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
});

// POST /api/admin/gateway/migrate/stop
// Graceful halt — completes current batch then stops.
app.post('/api/admin/gateway/migrate/stop', requireAdmin, (req, res) => {
  if (migrationState.status !== 'running') {
    return res.json({ ok: false, message: 'No migration is currently running.' });
  }
  migrationState.stopRequested = true;
  res.json({ ok: true, message: 'Stop requested — will halt after current batch completes.' });
});

// GET /api/admin/gateway/migrate/status
// Poll every 2 seconds while migration is running.
// On server restart migrationState resets to idle/empty — seed from DB so the admin UI
// shows real state instead of a blank panel.
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
        results: migrated.map(a => ({
          sourceId: String(a.id),
          name: a.name,
          gatewayAssistantId: a.gatewayAssistantId,
          status: 'created',
        })),
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
// Paginated assistant list with migration status.
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
      data: paged.map(a => ({
        id: a.id,
        name: a.name,
        modelId: a.modelId,
        gatewayAssistantId: a.gatewayAssistantId ?? null,
        useGateway: a.useGateway ?? false,
        migrated: !!a.gatewayAssistantId,
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// PATCH /api/admin/gateway/assistants/:id/toggle
// Per-assistant cutover switch.
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

**Verify:** all seven endpoints respond correctly when called directly.

---

## Step 4 — Build the gateway admin UI page

Build an admin-only page at `/admin/gateway` (or wherever admin pages live in this app). Build it before running migration — you need it to monitor progress and act on errors.

The page has four sections:

**1. Connection status**
Calls `GET /api/admin/gateway/ping` and `GET /api/admin/gateway/diagnostics` on load.
Display: connection indicator (green/red), latency, key name, scopes list, available models list. Show warnings for any missing scopes.

**2. Pre-flight model check**
Compare the models your app's assistants use against the models from diagnostics.
Table: assistant name | model it uses | present in MS (✅/❌).
If any model is missing: red warning with model name and instruction to add it in the MS admin panel. Block the Start Migration button until all models are present.

**3. Migration panel**
Calls `GET /api/admin/gateway/assistants?page=1&limit=25` — paginated with search. Do not load all at once; apps may have 150+ assistants.
Table: name | migrated (✅/❌) | gateway assistant ID | error if failed.

Controls:
- **Start / Resume** — calls `POST /api/admin/gateway/migrate/start`. Skips already migrated assistants. Disabled if any models are missing.
- **Stop** — calls `POST /api/admin/gateway/migrate/stop`. Visible only while status is `running`. Halts after current batch.

While running, poll `GET /api/admin/gateway/migrate/status` every 2 seconds. Update: progress bar (X of Y), counts (succeeded / failed / remaining), per-assistant results table as batches complete. Stop polling when status is `complete` or `stopped`.

**4. Cutover panel**
Paginated table (25/page, searchable) of migrated assistants with their `use_gateway` state.
Summary: "X of Y assistants on gateway."
Each row has a toggle button — "Switch to Gateway" / "Switch to Legacy" — calling `PATCH /api/admin/gateway/assistants/:id/toggle`. Updates only that row without reload.
"Switch all to Gateway" button — disabled until at least one assistant has been individually toggled on. This prevents accidental bulk cutover before any testing.

**Verify:** page loads, connection shows green, model check populates, migration panel shows all assistants.

---

## Step 5 — Verify connection & pre-flight

Using the admin UI:

1. Confirm ping returns green
2. Confirm diagnostics shows correct scopes
3. Confirm all models your assistants use appear in the MS model list — add any missing ones before continuing

**Verify:** all models present, no warnings.

---

## Step 6 — Migrate existing assistants

Using the migration panel:

1. Click **Start** — migration begins in background, 5 assistants per batch
2. Watch progress update in real time
3. If you spot a pattern in failures, click **Stop** — halts after current batch. Fix the root cause, then **Start** again to resume. Already migrated assistants are skipped.
4. Failed items show the error — most common cause is a model not found in the MS. Add the model and resume.

**Verify:** all assistants show migrated with a gateway assistant ID. Confirm they appear in MS admin panel → Assistants.

---

## Step 7 — Wire new assistant creation through the gateway

When your app creates a new assistant, also create it in the MS:

```ts
const created = await gateway.createAssistant({
  name: input.name,
  instructions: input.instructions,
  modelId: input.modelId, // "provider/model-name" format — MS resolves to internal UUID
  description: input.description,
  providerMode: 'openai_responses', // required — omitting defaults to unbuilt internal path
});

await updateAssistantGatewayId(newAssistant.id, created.assistantId);
```

If the model doesn't exist in the MS, `createAssistant()` throws a `GatewayError` — surface this to the admin as "Model X not found in gateway — add it in the MS admin panel."

**Verify:** create a new assistant, confirm `gateway_assistant_id` is populated and it appears in MS admin.

---

## Step 8 — Switch chat to gateway (per-assistant)

In your chat handler, branch on `useGateway`. Use streaming for chat UIs:

```ts
if (assistant.useGateway && assistant.gatewayAssistantId) {
  // Thread continuity — look up existing threadId for this session, or create one.
  // Store threadId in your DB (or a server-side Map for single-instance apps) keyed
  // by sessionId. Never call createThread() on every message — you'll lose history.
  let threadId = await getGatewayThreadId(sessionId); // your lookup
  if (!threadId) {
    const thread = await gateway.createThread(assistant.gatewayAssistantId);
    threadId = thread.threadId;
    await saveGatewayThreadId(sessionId, threadId); // your storage
  }

  // Streaming — chunk-by-chunk for progressive UI rendering
  let fullText = '';
  for await (const chunk of gateway.streamMessage(assistant.gatewayAssistantId, threadId, {
    content: message,
  })) {
    if (chunk.type === 'text') {
      fullText += chunk.text;
      // write to your SSE/WebSocket stream here
    }
  }
  return fullText;
} else {
  // Legacy path — unchanged
}
```

> **Note on thread IDs:** MS threads are scoped to an assistant — `threadId` alone is enough to send messages (the MS resolves the assistant from the thread). The `assistantId` parameter passed to `streamMessage` is used for routing only and does not need to match the original creator; the thread's stored `assistantId` is the authority.

Use the cutover panel to flip one assistant first. Verify that assistant before touching others.

**Verify:** chat works end-to-end through the gateway. Send multiple messages in the same session — confirm context is maintained across turns. Check MS admin panel → Threads to confirm threads are being created and messages appear inside them.

---

## Step 9 — Full cutover & cleanup

Once all assistants are individually verified:

1. Use "Switch all to Gateway" in the cutover panel
2. Monitor for errors over a verification period
3. Once stable, remove the legacy chat branch
4. Remove the legacy AI SDK / direct OpenAI dependency
5. Drop the old `api_key` and legacy `assistant_id` columns once confirmed unused

**Verify:** all assistants chat successfully through the gateway. No references to the old API remain.

---

## Troubleshooting

### Thread is created but chat hangs with no response
Most likely cause: the API key is missing the `messages:stream` scope. Thread creation requires `threads:write`; streaming requires the separate `messages:stream` scope. Check the key's scopes in the MS admin panel. A 403 from the stream endpoint will manifest as a hang or empty response in the UI, not an obvious error.

### Migration panel shows blank after server restart
`migrationState` is in-memory and resets on restart. Implement the DB-seeding pattern in the status endpoint (see Step 3 above) — it reads real state from `gateway_assistant_id` values in your DB and returns that when in-memory state is empty.

### `gateway_assistant_id` saves silently not persisting
Your DB schema migration ran after the MS migration. Drizzle and similar ORMs silently drop writes to columns that don't exist in the DB yet — no error is thrown. Run `db push` / `db migrate` **before** starting the MS migration, then re-run migration for the affected assistants. Verify by reading `gateway_assistant_id` directly from the DB, not through the ORM.

### Assistant responds with "not properly configured" error
The MS `assistants.model_id` column stores an internal UUID, not the string model ID. If assistants were created before the MS's `createAssistant` handler resolved model IDs (or via a raw DB insert), rows may have stored `"openai/gpt-4o"` instead of the UUID. Fix with:
```sql
UPDATE assistants
SET model_id = (SELECT id FROM llm_models WHERE model_id = 'gpt-4o' LIMIT 1)
WHERE model_id = 'openai/gpt-4o';
```
Run the equivalent for any other mis-stored model strings.

### Chat works in MS UI but not through the gateway client
MS threads are tied to assistants. If the `gatewayAssistantId` in your app is stale (from a deleted and re-migrated assistant), thread creation will fail or target the wrong assistant. Re-run migration for the affected assistants to get fresh IDs, and clear any cached `threadId` values in your session store.

### Models missing from MS / migration fails with model error
Add the model in MS admin panel → Models before migrating. Migration sends `modelId` in `provider/model-name` format (e.g. `openai/gpt-4o`) — the MS resolves this to an internal UUID automatically. If you pass a UUID directly it also works. The failure mode is a `GatewayError` with code `INVALID_MODEL`.

---

## Integration complete checklist

- [ ] API key created in MS admin with correct scopes
- [ ] All app models confirmed present in MS
- [ ] Package installed, env vars set
- [ ] DB columns added (`gateway_assistant_id`, `use_gateway`)
- [ ] All seven server-side admin endpoints added and responding
- [ ] Gateway admin UI page built with all four sections
- [ ] `ping()` returns `ok: true`
- [ ] `diagnostics()` shows correct scopes and all required models
- [ ] All existing assistants migrated (start/stop/resume verified, no failures)
- [ ] New assistant creation writes `gateway_assistant_id`
- [ ] Chat handler branching on `use_gateway`
- [ ] Thread continuity verified across multi-message sessions
- [ ] All assistants on gateway path
- [ ] Legacy dependency removed
