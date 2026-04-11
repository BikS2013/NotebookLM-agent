# Investigation Report: LLM Proxy Plugin

**Date**: 2026-04-11  
**Status**: Complete  
**Scope**: Research the ADK BasePlugin API, callback signatures, data availability, streaming behavior, and serialization strategies for implementing an LLM traffic monitoring plugin.

---

## Problem Statement

The NotebookLM agent, built on Google ADK (Agent Development Kit), abstracts away the raw LLM request/response traffic flowing between the agent and the Gemini model. Developers have no way to inspect:

- The exact system instruction, conversation history, and tool schemas sent to the LLM
- The structure of responses (content, function calls, token usage, finish reason)
- How many LLM round trips occur during a single user interaction
- Whether the agent sends redundant data or exceeds token budgets

The goal is to implement an observational ADK plugin that captures all agent-to-LLM traffic without modifying any data, and writes structured logs for developer inspection.

---

## Approach Analysis

### Recommended Approach: ADK BasePlugin Subclass

**Confidence: High.** The ADK plugin system is explicitly designed for this use case. The `BasePlugin` abstract class provides all the hooks needed for full traffic interception:

1. **First-class support**: The plugin mechanism is built into the ADK runner. `InMemoryRunner` accepts a `plugins?: BasePlugin[]` parameter. No monkey-patching or middleware hacking required.

2. **Complete lifecycle coverage**: The plugin callbacks span the entire invocation lifecycle:
   - `beforeRunCallback` / `afterRunCallback` — bracket the entire interaction
   - `beforeModelCallback` / `afterModelCallback` — bracket each LLM round trip
   - `beforeToolCallback` / `afterToolCallback` — bracket each tool execution
   - `onModelErrorCallback` / `onToolErrorCallback` — capture errors
   - `onEventCallback` — observe every event yielded by the runner

3. **Existing reference implementation**: ADK ships a `LoggingPlugin` class that demonstrates exactly how to access request/response data in each callback. This validates that the data we need is accessible.

4. **Zero-modification guarantee**: All callbacks have a return-`undefined` path that leaves data untouched. The base class default implementations already return `undefined`.

5. **No new dependencies**: The plugin extends an existing ADK class. Only Node.js built-ins are needed for file I/O and serialization.

### Alternative Approaches Considered

| Approach | Why Rejected |
|----------|-------------|
| HTTP proxy (intercept Gemini API calls at network level) | Requires TLS interception, certificate management, and URL configuration. Fragile, complex, and misses internal ADK metadata. |
| Monkey-patching the LLM connection class | Brittle across ADK versions, no type safety, and violates the project's clean coding conventions. |
| Agent-level callbacks (`beforeModelCallback` on `LlmAgent`) | Only applies to one agent, not globally. The plugin approach is the global equivalent and is architecturally cleaner. |
| Event stream post-processing (enhanced `/last` command) | Events contain processed/summarized data, not the raw LLM request payloads. Missing system instructions, tool schemas, and generation config. |

---

## ADK Plugin API Details

### BasePlugin Abstract Class

**Source**: `@google/adk/dist/types/plugins/base_plugin.d.ts`  
**Runtime**: `@google/adk/dist/esm/plugins/base_plugin.js`

The `BasePlugin` class requires a `name: string` passed to the constructor. All callback methods have default implementations that return `undefined` (no-op). Subclasses override only the callbacks they need.

### Complete Callback Reference

#### 1. `onUserMessageCallback`
```typescript
async onUserMessageCallback(params: {
  invocationContext: InvocationContext;
  userMessage: Content;
}): Promise<Content | undefined>
```
- **When called**: First callback in the lifecycle, when a user message is received before the invocation starts.
- **Data available**: Full `InvocationContext` (invocationId, session, userId, appName, agent), user's `Content` message.
- **Return**: `undefined` to proceed; returning a `Content` replaces the user message.
- **Proxy use**: Record interaction start, capture user message text.

#### 2. `beforeRunCallback`
```typescript
async beforeRunCallback(params: {
  invocationContext: InvocationContext;
}): Promise<Content | undefined>
```
- **When called**: After `onUserMessageCallback`, before the agent starts executing.
- **Data available**: `InvocationContext` with invocationId, session, agent.
- **Return**: `undefined` to proceed; returning `Content` short-circuits the entire run.
- **Proxy use**: Initialize interaction tracking, generate interaction ID, record start timestamp.

#### 3. `beforeModelCallback`
```typescript
async beforeModelCallback(params: {
  callbackContext: Context;
  llmRequest: LlmRequest;
}): Promise<LlmResponse | undefined>
```
- **When called**: After all request processors have run, just before the LLM API call. Called once per LLM round trip.
- **Data available**:
  - `callbackContext.agentName` — the agent making the call
  - `callbackContext.invocationId` — correlates to the interaction
  - `callbackContext.invocationContext` — full invocation context
  - `llmRequest.model` — model name (e.g., `"gemini-2.0-flash"`)
  - `llmRequest.contents` — full conversation history as `Content[]` array
  - `llmRequest.config` — `GenerateContentConfig` containing:
    - `systemInstruction` — the full resolved system instruction (type `ContentUnion`, which is `string | Content | Part[]`)
    - `tools` — tool declarations (type `ToolListUnion`)
    - `temperature`, `topP`, `topK`, `maxOutputTokens`, `safetySettings`, etc.
    - `labels` — user-defined metadata labels
  - `llmRequest.toolsDict` — `{ [key: string]: BaseTool }` — **NON-SERIALIZABLE** tool instances; use `Object.keys()` to get tool names
  - `llmRequest.liveConnectConfig` — live connection config (not relevant for standard requests)
- **Return**: `undefined` to proceed; returning `LlmResponse` skips the actual LLM call (caching use case).
- **Proxy use**: Capture full request payload. This is the primary capture point for request data.

#### 4. `afterModelCallback`
```typescript
async afterModelCallback(params: {
  callbackContext: Context;
  llmResponse: LlmResponse;
}): Promise<LlmResponse | undefined>
```
- **When called**: After each response chunk from the LLM. **In streaming mode (SSE), called once per streamed chunk**, not once per round trip.
- **Data available**:
  - `llmResponse.content` — response content (`Content` with text/functionCall/functionResponse parts)
  - `llmResponse.usageMetadata` — token counts (`promptTokenCount`, `candidatesTokenCount`, `totalTokenCount`)
  - `llmResponse.finishReason` — e.g., `"STOP"`, `"MAX_TOKENS"`, `"SAFETY"`
  - `llmResponse.partial` — `true` for streaming partial chunks, `false`/`undefined` for final
  - `llmResponse.turnComplete` — `true` when the model's turn is complete
  - `llmResponse.errorCode`, `llmResponse.errorMessage` — error information
  - `llmResponse.groundingMetadata` — grounding/citation data
  - `llmResponse.citationMetadata` — citation information
  - `llmResponse.customMetadata` — custom key-value pairs (JSON-serializable)
- **Return**: `undefined` to proceed; returning `LlmResponse` replaces the response.
- **Proxy use**: Capture response data. Must handle streaming: accumulate partial responses, finalize on `turnComplete` or non-partial response.

#### 5. `onModelErrorCallback`
```typescript
async onModelErrorCallback(params: {
  callbackContext: Context;
  llmRequest: LlmRequest;
  error: Error;
}): Promise<LlmResponse | undefined>
```
- **When called**: When the LLM call throws an error.
- **Data available**: The original request and the `Error` object.
- **Return**: `undefined` to propagate the error; returning `LlmResponse` provides a fallback response.
- **Proxy use**: Log the error with the request that triggered it.

#### 6. `beforeToolCallback`
```typescript
async beforeToolCallback(params: {
  tool: BaseTool;
  toolArgs: Record<string, unknown>;
  toolContext: Context;
}): Promise<Record<string, unknown> | undefined>
```
- **When called**: Before a tool is executed.
- **Data available**:
  - `tool.name` — tool name string
  - `toolArgs` — full argument dictionary (JSON-serializable `Record<string, unknown>`)
  - `toolContext.agentName` — the agent that invoked the tool
  - `toolContext.functionCallId` — the function call ID from the LLM response
- **Return**: `undefined` to proceed; returning a dict short-circuits the tool and uses that dict as the result.
- **Proxy use**: Record tool invocation start time, tool name, and arguments.

#### 7. `afterToolCallback`
```typescript
async afterToolCallback(params: {
  tool: BaseTool;
  toolArgs: Record<string, unknown>;
  toolContext: Context;
  result: Record<string, unknown>;
}): Promise<Record<string, unknown> | undefined>
```
- **When called**: After a tool returns its result.
- **Data available**: Same as `beforeToolCallback` plus `result` (the tool's return value as a dictionary).
- **Return**: `undefined` to proceed; returning a dict replaces the tool result.
- **Proxy use**: Record tool result and compute duration (from beforeTool timestamp to afterTool timestamp).

#### 8. `onToolErrorCallback`
```typescript
async onToolErrorCallback(params: {
  tool: BaseTool;
  toolArgs: Record<string, unknown>;
  toolContext: Context;
  error: Error;
}): Promise<Record<string, unknown> | undefined>
```
- **When called**: When a tool throws an error.
- **Data available**: Tool, args, context, and the `Error` object.
- **Return**: `undefined` to propagate; returning a dict provides a fallback result.
- **Proxy use**: Log tool errors with context.

#### 9. `onEventCallback`
```typescript
async onEventCallback(params: {
  invocationContext: InvocationContext;
  event: Event;
}): Promise<Event | undefined>
```
- **When called**: After every event yielded by the runner (before it reaches the consumer/TUI/CLI).
- **Data available**: Full `Event` object with `id`, `author`, `content`, `actions`, `partial` flag.
- **Return**: `undefined` to proceed; returning an `Event` replaces the yielded event.
- **Proxy use**: Optional — could track event flow, but the model/tool callbacks provide richer data.

#### 10. `afterRunCallback`
```typescript
async afterRunCallback(params: {
  invocationContext: InvocationContext;
}): Promise<void>
```
- **When called**: After the entire invocation completes (all events yielded, all tools executed).
- **Data available**: `InvocationContext`.
- **Return**: `void` — no short-circuit possible.
- **Proxy use**: Finalize interaction record, flush log buffer, compute total duration, optionally print summary to stderr.

### PluginManager Execution Model

**Source**: `@google/adk/dist/esm/plugins/plugin_manager.js`

Key behavior:
- Plugins are called in registration order.
- **Early exit**: If any plugin returns a non-`undefined` value, subsequent plugins and agent callbacks are skipped for that event.
- The proxy must always return `undefined` to avoid interfering with other plugins or agent callbacks.
- The `PluginManager` is stored on `InvocationContext.pluginManager` and is shared across the entire invocation.

### InMemoryRunner Constructor

```typescript
class InMemoryRunner extends Runner {
  constructor({ agent, appName, plugins }: {
    agent: BaseAgent;
    appName?: string;
    plugins?: BasePlugin[];
  })
}
```

The `plugins` array is passed directly to the `Runner` base class, which creates a `PluginManager`:
```typescript
this.pluginManager = new PluginManager(plugins);
```

---

## Implementation Architecture

### Component Overview

```
notebooklm_agent/
  proxy/
    llm-proxy-plugin.ts    ← BasePlugin subclass (core)
    proxy-types.ts         ← Interaction, RoundTrip, ToolCall, LogEntry types
    proxy-logger.ts        ← Async NDJSON file writer with rotation
    proxy-buffer.ts        ← Circular buffer for /inspect
    proxy-config.ts        ← Env var validation (separate from agent config)
    proxy-serializer.ts    ← Safe JSON serialization utilities
    proxy-factory.ts       ← Conditional instantiation
    format-inspect.ts      ← /inspect command formatter
```

### Data Flow

```
User Message
  │
  ▼
onUserMessageCallback ──→ Start interaction, capture user message
  │
  ▼
beforeRunCallback ──→ Initialize interaction record
  │
  ▼
┌─ LLM Round Trip 1 ──────────────────────────────────┐
│ beforeModelCallback ──→ Capture LlmRequest           │
│   │                                                   │
│   ▼ (LLM call happens)                               │
│                                                       │
│ afterModelCallback (×N if streaming) ──→ Accumulate   │
│   │                        partial responses          │
│   ▼                                                   │
│ [If function calls in response]                       │
│   beforeToolCallback ──→ Capture tool name + args     │
│     │                                                 │
│     ▼ (tool executes)                                 │
│                                                       │
│   afterToolCallback ──→ Capture result + duration     │
└───────────────────────────────────────────────────────┘
  │
  ▼ (repeat for additional round trips)
  │
afterRunCallback ──→ Finalize interaction, flush logs,
                     optionally print summary to stderr
```

### Key Design Decisions

1. **Interaction boundary**: `onUserMessageCallback` starts a new interaction; `afterRunCallback` ends it. The `invocationId` from `InvocationContext` serves as the interaction ID (no need to generate our own).

2. **Round trip tracking**: Each `beforeModelCallback` call increments a round trip counter within the current interaction. The `beforeModelCallback` → `afterModelCallback` pair (potentially with multiple streaming chunks) constitutes one round trip.

3. **Streaming accumulation**: The `afterModelCallback` fires for each streamed chunk. The plugin must:
   - Track when `partial === true`: accumulate text content
   - Detect completion: when `turnComplete === true` or `partial` is `false`/`undefined`
   - Only the final accumulated response (or the last chunk with `usageMetadata`) should be logged as the round trip's response
   - Token usage (`usageMetadata`) is typically only present on the final chunk

4. **Plugin registration**: The proxy plugin is the only plugin, so there are no ordering concerns. It is registered via `InMemoryRunner({ ..., plugins: [proxyPlugin] })`.

---

## Serialization Strategy

### Non-Serializable Fields

| Field | Type | Problem | Solution |
|-------|------|---------|----------|
| `llmRequest.toolsDict` | `{ [key: string]: BaseTool }` | `BaseTool` instances with methods, circular refs | Extract `Object.keys(toolsDict)` for tool names only |
| `llmRequest.config.systemInstruction` | `ContentUnion` (string or Content or Part[]) | `Content` objects may have complex nesting | Serialize as-is; also extract flattened text |
| `llmRequest.config.tools` | `ToolListUnion` | Tool declaration objects with schemas | Serialize full declarations on first round trip; names only on subsequent |
| `llmRequest.config.abortSignal` | `AbortSignal` | Not serializable | Skip this field |
| `llmRequest.liveConnectConfig` | `LiveConnectConfig` | Not relevant for standard calls | Skip if empty/undefined |
| `tool` param in tool callbacks | `BaseTool` instance | Not serializable | Extract `tool.name` only |
| `callbackContext` | `Context` instance | Complex object with services, session refs | Extract `agentName`, `invocationId`, `functionCallId` only |

### Serialization Implementation

```typescript
function safeSerialize(obj: unknown, maxSize: number = 50 * 1024): string {
  const seen = new WeSet<object>();
  return JSON.stringify(obj, (key, value) => {
    // Skip known non-serializable fields
    if (key === 'abortSignal' || key === 'httpOptions') return undefined;
    // Handle circular references
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return '[Circular]';
      seen.add(value);
    }
    // Handle functions
    if (typeof value === 'function') return '[Function]';
    // Handle BigInt
    if (typeof value === 'bigint') return value.toString();
    return value;
  });
}
```

The serializer must also truncate large payloads:
- Tool results > 50KB: truncate with `[truncated at 50KB]` marker
- Full payload size check after serialization

### What to Serialize from Each Callback

**`beforeModelCallback` → request log entry:**
```json
{
  "event": "llm_request",
  "timestamp": "ISO-8601",
  "interactionId": "invocation-uuid",
  "roundTrip": 1,
  "agentName": "root_agent",
  "model": "gemini-2.0-flash",
  "systemInstruction": { /* Content object as-is */ },
  "systemInstructionText": "flattened text for quick reading",
  "contentsCount": 12,
  "contents": [ /* Content[] array */ ],
  "toolNames": ["search_youtube", "list_notebooks", ...],
  "toolDeclarations": [ /* full schemas, first round trip only */ ],
  "generationConfig": {
    "temperature": 0.7,
    "maxOutputTokens": 8192,
    /* other config fields */
  }
}
```

**`afterModelCallback` → response log entry (after accumulation):**
```json
{
  "event": "llm_response",
  "timestamp": "ISO-8601",
  "interactionId": "invocation-uuid",
  "roundTrip": 1,
  "agentName": "root_agent",
  "content": { /* Content object */ },
  "usageMetadata": {
    "promptTokenCount": 1234,
    "candidatesTokenCount": 567,
    "totalTokenCount": 1801
  },
  "finishReason": "STOP",
  "streamed": true,
  "chunkCount": 15
}
```

---

## Streaming Considerations

### How Streaming Works in ADK

From the source code analysis of `LlmAgent.callLlmAsync()` (line 491 in `llm_agent.js`):

```javascript
// Simplified from actual source
async *callLlmAsync(invocationContext, llmRequest, modelResponseEvent) {
  // 1. beforeModelCallback fires ONCE before the LLM call
  const beforeModelResponse = await this.handleBeforeModelCallback(...);
  if (beforeModelResponse) { yield beforeModelResponse; return; }
  
  // 2. LLM generates responses (stream=true when SSE mode)
  const responsesGenerator = llm.generateContentAsync(
    llmRequest,
    /* stream= */ invocationContext.runConfig?.streamingMode === StreamingMode.SSE
  );
  
  // 3. For EACH response chunk:
  for await (const llmResponse of responsesGenerator) {
    // afterModelCallback fires for EVERY chunk
    const alteredLlmResponse = await this.handleAfterModelCallback(...);
    yield alteredLlmResponse ?? llmResponse;
  }
}
```

### Key Findings

1. **`beforeModelCallback` fires exactly once per LLM API call** — this is stable and reliable for request capture.

2. **`afterModelCallback` fires once per streamed chunk** — in SSE mode, there will be multiple calls with `partial: true` responses, followed by a final response with `turnComplete: true` or `partial: false/undefined`.

3. **Token usage metadata (`usageMetadata`) is typically only present on the final chunk** — partial chunks usually have `usageMetadata` as `undefined`.

4. **The `for await` loop means callbacks are sequential** — no concurrent callback invocations for the same round trip.

### Streaming Accumulation Strategy

The proxy must maintain per-round-trip state:

```typescript
interface ActiveRoundTrip {
  requestTimestamp: number;
  request: SerializedLlmRequest;  // captured in beforeModelCallback
  partialTexts: string[];         // accumulated from partial chunks
  chunkCount: number;
  lastResponse?: LlmResponse;    // keeps the latest chunk
  responseTimestamp?: number;
}
```

In `afterModelCallback`:
- If `llmResponse.partial === true`: append text content to `partialTexts`, increment `chunkCount`
- If `llmResponse.partial !== true` (final chunk): merge accumulated text, capture `usageMetadata`/`finishReason`, finalize the round trip record
- Edge case: if `partial` is never explicitly `false` but `turnComplete` becomes `true`, treat that as the final chunk too
- Edge case: non-streaming mode yields exactly one `afterModelCallback` call per round trip (no accumulation needed)

---

## Risk Assessment

### Low Risk

| Risk | Mitigation |
|------|-----------|
| BasePlugin API changes | ADK 0.6.x is stable; callbacks are documented and demonstrated in LoggingPlugin. Semver protects minor versions. |
| Performance overhead | Callbacks are async and execute synchronously inline. JSON serialization is fast (<1ms for typical payloads). File writes are buffered and async. |
| Plugin interferes with agent | All callbacks return `undefined`. The plugin is purely observational. Verified that returning `undefined` causes no short-circuit in PluginManager. |

### Medium Risk

| Risk | Mitigation |
|------|-----------|
| Streaming partial accumulation logic | The `partial` and `turnComplete` flags may have edge cases (e.g., error mid-stream). Defensive coding: always finalize on `afterRunCallback` even if no "final" chunk was received. |
| Large payload serialization | Tool results (e.g., YouTube transcripts) can be very large. Implement truncation at 50KB with marker. Use `try/catch` around all serialization. |
| `systemInstruction` type variance | `ContentUnion` can be `string`, `Content`, or `Part[]`. The serializer must handle all three forms. The LoggingPlugin accesses it as a string (`.length`, `.substring()`), suggesting ADK may normalize it to string by the time the plugin sees it. |

### Low-Medium Risk

| Risk | Mitigation |
|------|-----------|
| Memory usage from circular buffer | Default 10 interactions; each interaction's serialized data is bounded by truncation. Estimated max ~5MB for 10 complex interactions. |
| Log file rotation race conditions | Single-writer pattern (one proxy per runner instance). Use `node:fs/promises` with append mode. Check file size before write, rotate if exceeded. |

---

## Recommendation

### Implementation Guidance

1. **Create the plugin as a `BasePlugin` subclass** named `LlmProxyPlugin`. The constructor takes a config object with log directory, buffer size, max file size, and verbose flag.

2. **Implement these callbacks** (minimum viable):
   - `onUserMessageCallback` — start interaction, capture user message
   - `beforeRunCallback` — initialize interaction tracking state
   - `beforeModelCallback` — capture full `LlmRequest`
   - `afterModelCallback` — accumulate streaming responses, capture final `LlmResponse`
   - `beforeToolCallback` — record tool start
   - `afterToolCallback` — record tool result and duration
   - `onModelErrorCallback` — log LLM errors
   - `onToolErrorCallback` — log tool errors
   - `afterRunCallback` — finalize interaction, flush to file, optionally print summary

3. **Serialize `LlmRequest` carefully**:
   - Extract `model` directly
   - Extract `Object.keys(toolsDict)` for tool names (never serialize `toolsDict` values)
   - Serialize `config` but skip `abortSignal` and `httpOptions`
   - Serialize `contents` as-is (the `Content[]` array is JSON-friendly)
   - Handle `config.systemInstruction` type variance (string vs Content vs Part[])

4. **Handle streaming** by maintaining an `activeRoundTrip` object per interaction:
   - `beforeModelCallback`: create new round trip entry
   - `afterModelCallback` with `partial: true`: accumulate
   - `afterModelCallback` with `partial: false/undefined` or `turnComplete: true`: finalize
   - `afterRunCallback`: safety net — finalize any unclosed round trips

5. **Use a factory function** for conditional instantiation:
   ```typescript
   export function createProxyPlugin(): LlmProxyPlugin | undefined {
     if (process.env.LLM_PROXY_ENABLED !== 'true') return undefined;
     const logDir = requireEnv('LLM_PROXY_LOG_DIR');
     // ... validate and create
     return new LlmProxyPlugin({ logDir, ... });
   }
   ```

6. **Integration into TUI and CLI** is a two-line change in each:
   ```typescript
   const proxyPlugin = createProxyPlugin();
   const runner = new InMemoryRunner({
     agent: rootAgent,
     appName,
     plugins: proxyPlugin ? [proxyPlugin] : undefined,
   });
   ```

7. **The `/inspect` command** reads from the plugin's in-memory circular buffer. The plugin instance must be accessible from the command handler (pass it as a reference or store it in a shared module-level variable).

---

## Technical Research Guidance

Research needed: No

All key questions have been answered through direct source code analysis:

- The `BasePlugin` interface is fully documented above with exact signatures from the `.d.ts` type declarations.
- The `LlmRequest` and `LlmResponse` structures are confirmed from the type declarations.
- Streaming behavior is confirmed from the `callLlmAsync` source: `afterModelCallback` fires per chunk.
- The `LoggingPlugin` reference implementation validates how to access all data fields.
- The `PluginManager` execution model (early-exit, registration order) is confirmed from the type declarations and runner source.
- Serialization challenges are identified and mitigation strategies are concrete.

No further deep research is needed. The implementation can proceed directly based on this investigation.
