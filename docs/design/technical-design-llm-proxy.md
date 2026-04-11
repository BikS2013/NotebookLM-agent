# Technical Design: LLM Proxy Plugin

**Version**: 1.0  
**Date**: 2026-04-11  
**Status**: Draft  
**Dependencies**: plan-006-llm-proxy.md, investigation-llm-proxy.md, codebase-scan-llm-proxy.md, refined-request-llm-proxy.md  
**Project**: NotebookLM Agent

---

## Table of Contents

1. [Module Architecture](#1-module-architecture)
2. [Type Definitions](#2-type-definitions)
3. [Component Design](#3-component-design)
4. [Data Flow](#4-data-flow)
5. [Streaming Accumulation](#5-streaming-accumulation)
6. [Integration Design](#6-integration-design)
7. [Error Handling](#7-error-handling)
8. [Interface Contracts](#8-interface-contracts)
9. [Implementation Units](#9-implementation-units)

---

## 1. Module Architecture

All proxy modules live under `notebooklm_agent/proxy/`. The directory is self-contained and can be conditionally imported. When the proxy is disabled, none of these modules are loaded.

### 1.1 File Map

```
notebooklm_agent/
  proxy/
    index.ts                  # Barrel export (public API)
    proxy-types.ts            # All TypeScript types and interfaces
    proxy-serializer.ts       # Safe JSON serialization, request/response extractors
    proxy-buffer.ts           # In-memory circular buffer (InteractionRecord[])
    proxy-logger.ts           # Async NDJSON file writer with rotation
    proxy-config.ts           # Env var loading and validation
    llm-proxy-plugin.ts       # BasePlugin subclass (core orchestration)
    format-inspect.ts         # /inspect output formatter
    proxy-factory.ts          # Conditional plugin construction
```

### 1.2 Dependency Graph (Internal)

```
proxy-types.ts              ← no dependencies (foundation)
    ↑
proxy-serializer.ts         ← depends on proxy-types
    ↑
proxy-buffer.ts             ← depends on proxy-types
proxy-logger.ts             ← depends on proxy-types
proxy-config.ts             ← no dependencies (reads process.env)
    ↑
llm-proxy-plugin.ts         ← depends on proxy-types, proxy-serializer,
    ↑                          proxy-buffer, proxy-logger, proxy-config
    ↑
format-inspect.ts           ← depends on proxy-types, llm-proxy-plugin (type only)
proxy-factory.ts            ← depends on proxy-config, llm-proxy-plugin
    ↑
index.ts                    ← re-exports from proxy-factory, llm-proxy-plugin,
                               format-inspect
```

### 1.3 External Dependencies

Only Node.js built-in modules and existing project dependencies:

| Module | Source | Used By |
|--------|--------|---------|
| `node:fs/promises` | Node.js built-in | proxy-logger.ts |
| `node:path` | Node.js built-in | proxy-logger.ts |
| `node:crypto` | Node.js built-in | proxy-types.ts (UUID generation) |
| `@google/adk` | Existing dependency | llm-proxy-plugin.ts (BasePlugin) |

No new npm packages are introduced.

---

## 2. Type Definitions

### File: `notebooklm_agent/proxy/proxy-types.ts`

All shared types for the proxy subsystem. This module has zero runtime dependencies.

```typescript
// ---------------------------------------------------------------------------
// Event types for NDJSON log entries
// ---------------------------------------------------------------------------

export type ProxyEventType =
  | 'interaction_start'
  | 'llm_request'
  | 'llm_response'
  | 'tool_start'
  | 'tool_result'
  | 'tool_error'
  | 'llm_error'
  | 'interaction_end';

// ---------------------------------------------------------------------------
// Tool call record — one tool invocation within a round trip
// ---------------------------------------------------------------------------

export interface ToolCallRecord {
  /** Name of the tool invoked (e.g., "search_youtube"). */
  toolName: string;

  /** Function call ID from the LLM response, used to correlate before/after. */
  functionCallId: string;

  /** Tool arguments (JSON-serializable). */
  args: Record<string, unknown>;

  /** Tool result (JSON-serializable). Populated by afterToolCallback. */
  result?: Record<string, unknown>;

  /** Error message if the tool failed. Populated by onToolErrorCallback. */
  error?: string;

  /** Timestamp (ms since epoch) when beforeToolCallback fired. */
  startedAt: number;

  /** Timestamp (ms since epoch) when afterToolCallback fired. */
  completedAt?: number;

  /** Computed: completedAt - startedAt. */
  durationMs?: number;
}

// ---------------------------------------------------------------------------
// Round trip record — one LLM request/response cycle
// ---------------------------------------------------------------------------

export interface RoundTripRecord {
  /** Sequential number within the interaction (1-based). */
  roundTripNumber: number;

  /** Name of the agent that made the LLM call. */
  agentName: string;

  /** Timestamp (ms) when beforeModelCallback fired. */
  requestTimestamp: number;

  /** Timestamp (ms) when the final afterModelCallback fired. */
  responseTimestamp?: number;

  /** Computed: responseTimestamp - requestTimestamp. */
  durationMs?: number;

  // --- Request fields (serialized from LlmRequest) ---

  /** Model name (e.g., "gemini-2.0-flash"). */
  model?: string;

  /** Raw systemInstruction (Content object as-is). */
  systemInstruction?: unknown;

  /** Flattened text of systemInstruction for quick reading. */
  systemInstructionText?: string;

  /** Number of Content objects in the request's contents array. */
  contentsCount: number;

  /** Serialized conversation history (Content[] array). */
  contents?: unknown[];

  /** Tool names available for this round trip. */
  toolNames: string[];

  /**
   * Full tool declarations (schemas). Only populated on the first round trip
   * of each interaction; subsequent round trips contain only toolNames.
   */
  toolDeclarations?: unknown[];

  /** Generation config (temperature, topP, maxOutputTokens, etc.). */
  generationConfig?: Record<string, unknown>;

  // --- Response fields (accumulated from streaming chunks) ---

  /** Final accumulated response content. */
  responseContent?: unknown;

  /** Token usage from the final response chunk. */
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };

  /** LLM finish reason (e.g., "STOP", "MAX_TOKENS"). */
  finishReason?: string;

  /** Whether this round trip was streamed (SSE). */
  streamed: boolean;

  /** Number of streaming chunks received (1 for non-streaming). */
  chunkCount: number;

  /** Error code from the LLM (if error response). */
  errorCode?: string;

  /** Error message from the LLM (if error response). */
  errorMessage?: string;

  /** Tool calls triggered by the LLM's response in this round trip. */
  toolCalls: ToolCallRecord[];
}

// ---------------------------------------------------------------------------
// Interaction record — a complete user message → agent response cycle
// ---------------------------------------------------------------------------

export interface InteractionRecord {
  /** Unique ID for this interaction (from InvocationContext.invocationId). */
  interactionId: string;

  /** ADK session ID. */
  sessionId: string;

  /** Timestamp (ms) when the interaction started. */
  startedAt: number;

  /** Timestamp (ms) when the interaction completed. */
  completedAt?: number;

  /** Computed: completedAt - startedAt. */
  durationMs?: number;

  /** First 500 chars of the user's message text. */
  userMessage?: string;

  /** All LLM round trips within this interaction. */
  roundTrips: RoundTripRecord[];

  /** Sum of promptTokenCount across all round trips. */
  totalPromptTokens: number;

  /** Sum of candidatesTokenCount across all round trips. */
  totalCompletionTokens: number;
}

// ---------------------------------------------------------------------------
// NDJSON log entry — envelope written to the log file
// ---------------------------------------------------------------------------

export interface LogEntry {
  /** Event type identifier. */
  event: ProxyEventType;

  /** ISO-8601 timestamp of the event. */
  timestamp: string;

  /** Interaction ID (groups all events for one user message). */
  interactionId: string;

  /** Round trip number within the interaction (undefined for interaction_start/end). */
  roundTrip?: number;

  /** Event-specific payload. */
  payload: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Proxy configuration
// ---------------------------------------------------------------------------

export interface ProxyConfig {
  /** Always true when a ProxyConfig exists (proxy is enabled). */
  enabled: true;

  /** Directory for NDJSON log files (required, no fallback). */
  logDir: string;

  /** Whether to print per-interaction summaries to stderr. */
  verbose: boolean;

  /** Number of interactions to retain in the in-memory buffer. */
  bufferSize: number;

  /** Maximum log file size in bytes before rotation. */
  maxFileSize: number;
}
```

---

## 3. Component Design

### 3.1 `proxy-serializer.ts` — Safe JSON Serialization

**Purpose**: Safely convert LlmRequest and LlmResponse objects to JSON-serializable structures, handling circular references, non-serializable fields, and payload truncation.

#### Exported Functions

```typescript
/**
 * Safely serialize any value to a JSON string.
 *
 * Handles:
 * - Circular references → "[Circular]"
 * - Functions → "[Function]"
 * - BigInt → string representation
 * - Skips known non-serializable keys: abortSignal, httpOptions, liveConnectConfig
 * - Truncates output exceeding maxSize
 *
 * Never throws. Returns an error marker string on failure.
 *
 * @param obj - The value to serialize
 * @param maxSize - Maximum output size in bytes (default: 51200 = 50KB)
 * @returns JSON string or error marker
 */
export function safeSerialize(obj: unknown, maxSize?: number): string;

/**
 * Extract tool names from LlmRequest.toolsDict.
 * Returns Object.keys(toolsDict) or empty array if input is falsy.
 */
export function extractToolNames(
  toolsDict: Record<string, unknown> | undefined | null,
): string[];

/**
 * Flatten a ContentUnion (string | Content | Part[]) to a plain text string.
 * Returns "" for undefined/null.
 *
 * Handles:
 * - string → returned as-is
 * - Content object → concatenates text from all parts with role "model"/"user"
 * - Part[] → concatenates text from all text-typed parts
 * - unknown → String(instruction) as fallback
 */
export function flattenSystemInstruction(instruction: unknown): string;

/**
 * Extract and serialize relevant fields from an LlmRequest object.
 *
 * @param request - The raw LlmRequest from beforeModelCallback
 * @param isFirstRoundTrip - If true, include full tool declarations; else names only
 * @returns A plain object safe for JSON.stringify / LogEntry payload
 */
export function serializeLlmRequest(
  request: unknown,
  isFirstRoundTrip: boolean,
): Record<string, unknown>;

/**
 * Extract and serialize relevant fields from an LlmResponse object.
 *
 * Extracts: content, usageMetadata, finishReason, errorCode, errorMessage,
 *           partial, turnComplete, groundingMetadata, customMetadata.
 *
 * @param response - The raw LlmResponse from afterModelCallback
 * @returns A plain object safe for JSON.stringify / LogEntry payload
 */
export function serializeLlmResponse(
  response: unknown,
): Record<string, unknown>;
```

#### Implementation Details

**`safeSerialize` internals:**

```typescript
export function safeSerialize(obj: unknown, maxSize: number = 50 * 1024): string {
  try {
    const seen = new WeakSet<object>();
    const SKIP_KEYS = new Set(['abortSignal', 'httpOptions', 'liveConnectConfig']);

    const json = JSON.stringify(obj, (key: string, value: unknown): unknown => {
      // Skip known non-serializable fields
      if (SKIP_KEYS.has(key)) return undefined;

      // Handle functions
      if (typeof value === 'function') return '[Function]';

      // Handle BigInt
      if (typeof value === 'bigint') return value.toString();

      // Handle circular references
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) return '[Circular]';
        seen.add(value);
      }

      return value;
    });

    // Truncation check
    if (json.length > maxSize) {
      return json.slice(0, maxSize) + `\n[truncated at ${maxSize} bytes]`;
    }

    return json;
  } catch (err) {
    return `[serialization failed: ${err instanceof Error ? err.message : String(err)}]`;
  }
}
```

**`serializeLlmRequest` field extraction:**

The function accesses the request object using dynamic property access (the request parameter is typed as `unknown` to avoid coupling to ADK internal types). Fields extracted:

| Source Field | Output Key | Notes |
|-------------|-----------|-------|
| `request.model` | `model` | String, direct copy |
| `request.config?.systemInstruction` | `systemInstruction` | Raw Content object via `safeSerialize` then `JSON.parse` |
| `request.config?.systemInstruction` | `systemInstructionText` | Via `flattenSystemInstruction()` |
| `request.contents` | `contents` | Array, serialized via `safeSerialize` then `JSON.parse` |
| `request.contents?.length` | `contentsCount` | Number |
| `request.toolsDict` | `toolNames` | Via `extractToolNames()` (always) |
| `request.config?.tools` | `toolDeclarations` | Full schemas only when `isFirstRoundTrip === true` |
| `request.config` (minus tools, systemInstruction, abortSignal) | `generationConfig` | Remaining config fields |

**`serializeLlmResponse` field extraction:**

| Source Field | Output Key | Notes |
|-------------|-----------|-------|
| `response.content` | `content` | Serialized Content object |
| `response.usageMetadata` | `usageMetadata` | `{ promptTokenCount, candidatesTokenCount, totalTokenCount }` |
| `response.finishReason` | `finishReason` | String |
| `response.errorCode` | `errorCode` | String (if present) |
| `response.errorMessage` | `errorMessage` | String (if present) |
| `response.partial` | `partial` | Boolean |
| `response.turnComplete` | `turnComplete` | Boolean |

---

### 3.2 `proxy-buffer.ts` — Circular Buffer

**Purpose**: In-memory ring buffer storing the last N `InteractionRecord` objects. Used by the `/inspect` command. No file I/O.

#### Class Design

```typescript
export class ProxyBuffer {
  private readonly capacity: number;
  private readonly buffer: (InteractionRecord | undefined)[];
  private head: number;   // next write position
  private count: number;  // current number of stored items

  /**
   * @param capacity - Maximum number of interactions to retain (default: 10)
   */
  constructor(capacity?: number);

  /**
   * Add an interaction to the buffer.
   * If the buffer is full, the oldest interaction is evicted.
   */
  push(interaction: InteractionRecord): void;

  /**
   * Retrieve all stored interactions in chronological order (oldest first).
   */
  getAll(): InteractionRecord[];

  /**
   * Retrieve the most recently added interaction, or undefined if empty.
   */
  getLast(): InteractionRecord | undefined;

  /**
   * Remove all interactions from the buffer.
   */
  clear(): void;

  /**
   * Number of interactions currently in the buffer.
   */
  get size(): number;
}
```

#### Implementation Notes

- Uses a fixed-size array of length `capacity` initialized to `undefined`.
- `head` starts at 0, increments (mod `capacity`) on each push.
- `count` tracks actual fill level, capped at `capacity`.
- `getAll()` iterates from `(head - count + capacity) % capacity` to `head - 1`, collecting non-undefined entries.
- `getLast()` returns `buffer[(head - 1 + capacity) % capacity]` when `count > 0`.

---

### 3.3 `proxy-logger.ts` — Async NDJSON File Writer

**Purpose**: Write `LogEntry` objects as NDJSON to disk. Handles buffering, periodic flushing, and file rotation.

#### Class Design

```typescript
import type { LogEntry } from './proxy-types.ts';

export class ProxyLogger {
  private logDir: string;
  private sessionId: string;
  private maxFileSize: number;
  private currentFilePath: string;
  private fileHandle: import('node:fs/promises').FileHandle | null;
  private writeBuffer: string[];
  private bufferByteSize: number;
  private currentFileSize: number;
  private flushTimer: ReturnType<typeof setInterval> | null;
  private fileIndex: number;
  private initialized: boolean;
  private initPromise: Promise<void> | null;

  /**
   * @param opts.logDir - Directory for log files (must exist or will be created)
   * @param opts.sessionId - ADK session ID for file naming
   * @param opts.maxFileSize - Max file size in bytes before rotation
   */
  constructor(opts: {
    logDir: string;
    sessionId: string;
    maxFileSize: number;
  });

  /**
   * Queue a log entry for writing. Non-blocking.
   * The entry is serialized immediately and added to the write buffer.
   * Actual disk write happens on flush (timer or threshold).
   *
   * Never throws. Serialization/write errors are silently sent to stderr.
   */
  write(entry: LogEntry): void;

  /**
   * Force flush the write buffer to disk.
   * Called explicitly by the plugin at interaction end.
   * Never throws.
   */
  async flush(): Promise<void>;

  /**
   * Flush remaining buffer and close the file handle.
   * Stops the periodic flush timer.
   * Never throws.
   */
  async close(): Promise<void>;

  /**
   * Update the session ID (called when the actual session is created).
   * Only effective before the first write (before file is opened).
   */
  setSessionId(sessionId: string): void;

  /**
   * Returns the path to the current log file.
   */
  getFilePath(): string;
}
```

#### Implementation Details

**File naming**: `proxy-<sessionId>-<ISO-timestamp>.ndjson`  
Example: `proxy-abc12345-2026-04-11T14-30-00.ndjson`

**Write buffer**: Internal `string[]` array. Each `write()` call serializes the `LogEntry` to a single JSON line (`JSON.stringify(entry) + '\n'`), pushes it to the buffer, and adds to `bufferByteSize`.

**Flush triggers**:
1. Periodic timer: every 500ms via `setInterval`
2. Buffer threshold: when `bufferByteSize > 65536` (64KB)
3. Explicit: `flush()` called by the plugin in `afterRunCallback`

**Flush implementation**:
```
1. If buffer is empty, return immediately
2. Concatenate all buffer strings into a single string
3. Clear buffer and reset bufferByteSize
4. Ensure file handle is open (lazy initialization)
5. Check if currentFileSize + writeSize > maxFileSize → rotate
6. Append string to file via fileHandle.appendFile()
7. Update currentFileSize
```

**File rotation**:
1. Close current file handle
2. Increment `fileIndex`
3. Generate new file path with `.N` suffix (e.g., `proxy-abc12345-2026-04-11T14-30-00.1.ndjson`)
4. Open new file handle
5. Reset `currentFileSize` to 0

**Error handling**: Every async operation is wrapped in try/catch. Errors are written to `process.stderr.write()` with a `[llm-proxy]` prefix. The logger never throws or propagates errors.

**Lazy initialization**: The file handle is not opened in the constructor. It is opened on the first `flush()` call that has data to write. This avoids creating empty log files.

**Directory creation**: On first flush, if `logDir` does not exist, create it with `mkdir({ recursive: true })`.

---

### 3.4 `proxy-config.ts` — Configuration Loading

**Purpose**: Load and validate proxy-specific environment variables. Separate from the core `config.ts` to avoid startup failures when proxy vars are absent.

#### Exported Functions

```typescript
import type { ProxyConfig } from './proxy-types.ts';

/**
 * Read proxy configuration from environment variables.
 *
 * Returns undefined if the proxy is disabled (LLM_PROXY_ENABLED !== 'true').
 * Throws if proxy is enabled but LLM_PROXY_LOG_DIR is missing.
 * Throws if numeric values are invalid (NaN, negative, zero).
 *
 * Documented default-value exceptions (recorded in Issues - Pending Items.md):
 * - LLM_PROXY_ENABLED defaults to false (not 'true')
 * - LLM_PROXY_VERBOSE defaults to false
 * - LLM_PROXY_BUFFER_SIZE defaults to 10
 * - LLM_PROXY_MAX_FILE_SIZE defaults to 52428800 (50MB)
 */
export function getProxyConfig(): ProxyConfig | undefined;

/**
 * Reset cached config for testing purposes.
 */
export function resetProxyConfig(): void;
```

#### Implementation Logic

```
1. Read LLM_PROXY_ENABLED from process.env
   - If value is not exactly 'true', return undefined

2. Read LLM_PROXY_LOG_DIR from process.env
   - If missing or empty string, throw:
     Error('LLM_PROXY_LOG_DIR must be set when LLM_PROXY_ENABLED=true')

3. Read LLM_PROXY_VERBOSE from process.env
   - Default: false
   - Value 'true' → true; anything else → false

4. Read LLM_PROXY_BUFFER_SIZE from process.env
   - Default: 10
   - Parse as integer via parseInt(value, 10)
   - If NaN or <= 0, throw:
     Error('LLM_PROXY_BUFFER_SIZE must be a positive integer, got: <value>')

5. Read LLM_PROXY_MAX_FILE_SIZE from process.env
   - Default: 52428800
   - Parse as integer via parseInt(value, 10)
   - If NaN or <= 0, throw:
     Error('LLM_PROXY_MAX_FILE_SIZE must be a positive integer, got: <value>')

6. Cache result in module-level variable (singleton pattern matching config.ts)
7. Return Object.freeze({ enabled: true, logDir, verbose, bufferSize, maxFileSize })
```

---

### 3.5 `llm-proxy-plugin.ts` — The Core Plugin

**Purpose**: ADK `BasePlugin` subclass that orchestrates all proxy functionality. Connects the serializer, buffer, and logger.

#### Class Design

```typescript
import { BasePlugin } from '@google/adk';
import type { ProxyConfig, InteractionRecord, RoundTripRecord,
              ToolCallRecord, LogEntry } from './proxy-types.ts';
import { ProxyBuffer } from './proxy-buffer.ts';
import { ProxyLogger } from './proxy-logger.ts';
import {
  serializeLlmRequest,
  serializeLlmResponse,
  flattenSystemInstruction,
  extractToolNames,
  safeSerialize,
} from './proxy-serializer.ts';

export class LlmProxyPlugin extends BasePlugin {
  // --- Dependencies ---
  private readonly buffer: ProxyBuffer;
  private readonly logger: ProxyLogger;
  private readonly verbose: boolean;

  // --- Active state tracking ---
  private currentInteraction: InteractionRecord | null;
  private currentRoundTrip: RoundTripRecord | null;
  private activeToolCalls: Map<string, ToolCallRecord>;  // keyed by functionCallId
  private partialTexts: string[];
  private chunkCount: number;
  private roundTripCounter: number;
  private sessionIdKnown: boolean;

  constructor(config: ProxyConfig);

  // --- Plugin callbacks (all return undefined) ---

  async onUserMessageCallback(params: {
    invocationContext: unknown;
    userMessage: unknown;
  }): Promise<undefined>;

  async beforeRunCallback(params: {
    invocationContext: unknown;
  }): Promise<undefined>;

  async beforeModelCallback(params: {
    callbackContext: unknown;
    llmRequest: unknown;
  }): Promise<undefined>;

  async afterModelCallback(params: {
    callbackContext: unknown;
    llmResponse: unknown;
  }): Promise<undefined>;

  async beforeToolCallback(params: {
    tool: unknown;
    toolArgs: Record<string, unknown>;
    toolContext: unknown;
  }): Promise<undefined>;

  async afterToolCallback(params: {
    tool: unknown;
    toolArgs: Record<string, unknown>;
    toolContext: unknown;
    result: Record<string, unknown>;
  }): Promise<undefined>;

  async onModelErrorCallback(params: {
    callbackContext: unknown;
    llmRequest: unknown;
    error: Error;
  }): Promise<undefined>;

  async onToolErrorCallback(params: {
    tool: unknown;
    toolArgs: Record<string, unknown>;
    toolContext: unknown;
    error: Error;
  }): Promise<undefined>;

  async afterRunCallback(params: {
    invocationContext: unknown;
  }): Promise<void>;

  // --- Public API for /inspect ---

  getLastInteraction(): InteractionRecord | undefined;
  getAllInteractions(): InteractionRecord[];
  isActive(): boolean;

  // --- Cleanup ---
  async close(): Promise<void>;
}
```

#### State Management

The plugin maintains mutable state that tracks the lifecycle of the current interaction:

```
┌─────────────────────────────────────────────────┐
│ Plugin Instance (lives for entire session)       │
│                                                   │
│ currentInteraction: InteractionRecord | null      │
│   └── roundTrips: RoundTripRecord[]              │
│                                                   │
│ currentRoundTrip: RoundTripRecord | null         │
│   └── toolCalls: ToolCallRecord[]                │
│                                                   │
│ activeToolCalls: Map<string, ToolCallRecord>     │
│   (keyed by functionCallId, for correlating      │
│    beforeTool → afterTool pairs)                 │
│                                                   │
│ partialTexts: string[]  (streaming accumulator)  │
│ chunkCount: number                                │
│ roundTripCounter: number                          │
│                                                   │
│ buffer: ProxyBuffer      (completed interactions) │
│ logger: ProxyLogger      (disk output)           │
└─────────────────────────────────────────────────┘
```

#### Callback Implementation Details

**`onUserMessageCallback`**:
```
1. Extract user message text from userMessage.parts[0].text (or safeSerialize)
2. Truncate to 500 chars
3. Store as pendingUserMessage for the next beforeRunCallback
4. Return undefined
```

**`beforeRunCallback`**:
```
1. Safety net: if currentInteraction is not null, finalize it (edge case: 
   previous interaction was not properly closed)
2. Extract invocationId from invocationContext
3. Extract sessionId from invocationContext.session.id
4. Update logger sessionId if not yet known
5. Create new InteractionRecord:
   {
     interactionId: invocationId,
     sessionId: sessionId,
     startedAt: Date.now(),
     userMessage: pendingUserMessage,
     roundTrips: [],
     totalPromptTokens: 0,
     totalCompletionTokens: 0,
   }
6. Reset: roundTripCounter = 0, currentRoundTrip = null,
          activeToolCalls.clear(), partialTexts = [], chunkCount = 0
7. Log 'interaction_start' event
8. Return undefined
```

**`beforeModelCallback`**:
```
1. Safety net: if currentRoundTrip is not null, finalize it
   (handles edge case where afterModelCallback final chunk was missed)
2. Increment roundTripCounter
3. Extract agentName from callbackContext.agentName
4. Determine isFirstRoundTrip = (roundTripCounter === 1)
5. Serialize LlmRequest via serializeLlmRequest(llmRequest, isFirstRoundTrip)
6. Create new RoundTripRecord:
   {
     roundTripNumber: roundTripCounter,
     agentName: agentName,
     requestTimestamp: Date.now(),
     contentsCount: serialized.contentsCount,
     contents: serialized.contents,
     model: serialized.model,
     systemInstruction: serialized.systemInstruction,
     systemInstructionText: serialized.systemInstructionText,
     toolNames: serialized.toolNames,
     toolDeclarations: isFirstRoundTrip ? serialized.toolDeclarations : undefined,
     generationConfig: serialized.generationConfig,
     streamed: false,
     chunkCount: 0,
     toolCalls: [],
   }
7. Reset: partialTexts = [], chunkCount = 0
8. Log 'llm_request' event with serialized request data
9. Return undefined
```

**`afterModelCallback`**:
```
1. If currentRoundTrip is null, return undefined (defensive guard)
2. Increment chunkCount
3. Serialize response via serializeLlmResponse(llmResponse)
4. Access llmResponse.partial and llmResponse.turnComplete

5. If partial === true:
   a. Extract text from llmResponse.content.parts (if text parts exist)
   b. Append to partialTexts
   c. Set currentRoundTrip.streamed = true
   d. Return undefined (do not finalize yet)

6. If partial is false/undefined OR turnComplete is true (FINAL CHUNK):
   a. If partialTexts has accumulated text:
      - Build merged response content from accumulated text
      - Set currentRoundTrip.streamed = true
   b. Set currentRoundTrip.responseContent from serialized response content
   c. Set currentRoundTrip.usageMetadata from serialized usageMetadata
   d. Set currentRoundTrip.finishReason from serialized finishReason
   e. Set currentRoundTrip.errorCode, errorMessage if present
   f. Set currentRoundTrip.chunkCount = chunkCount
   g. Set currentRoundTrip.responseTimestamp = Date.now()
   h. Compute currentRoundTrip.durationMs
   i. Log 'llm_response' event
   j. Push currentRoundTrip to currentInteraction.roundTrips
   k. Set currentRoundTrip = null
   l. Reset partialTexts = [], chunkCount = 0

7. Return undefined
```

**`beforeToolCallback`**:
```
1. Extract functionCallId from toolContext.functionCallId
2. Extract toolName from tool.name
3. Create ToolCallRecord:
   {
     toolName,
     functionCallId,
     args: toolArgs (already Record<string, unknown>),
     startedAt: Date.now(),
   }
4. Store in activeToolCalls map keyed by functionCallId
5. Log 'tool_start' event with { toolName, args }
6. Return undefined
```

**`afterToolCallback`**:
```
1. Extract functionCallId from toolContext.functionCallId
2. Retrieve ToolCallRecord from activeToolCalls
3. If found:
   a. Set record.result = result
   b. Set record.completedAt = Date.now()
   c. Compute record.durationMs = completedAt - startedAt
   d. Push record to currentRoundTrip.toolCalls (if currentRoundTrip exists)
      OR to the LAST roundTrip in currentInteraction.roundTrips
   e. Remove from activeToolCalls
4. Log 'tool_result' event with { toolName, durationMs, resultSummary }
5. Return undefined
```

**`onModelErrorCallback`**:
```
1. If currentRoundTrip exists:
   a. Set errorCode and errorMessage from error.message
   b. Set responseTimestamp, compute durationMs
   c. Set chunkCount
   d. Push to currentInteraction.roundTrips
   e. Set currentRoundTrip = null
2. Log 'llm_error' event with { error: error.message, requestSummary }
3. Return undefined
```

**`onToolErrorCallback`**:
```
1. Extract functionCallId from toolContext.functionCallId
2. Retrieve ToolCallRecord from activeToolCalls
3. If found:
   a. Set record.error = error.message
   b. Set record.completedAt = Date.now()
   c. Compute durationMs
   d. Push to appropriate round trip's toolCalls
   e. Remove from activeToolCalls
4. Log 'tool_error' event with { toolName, error: error.message }
5. Return undefined
```

**`afterRunCallback`**:
```
1. Safety net: if currentRoundTrip is not null:
   a. Finalize it (set responseTimestamp, compute durationMs, push to interaction)
   b. Set currentRoundTrip = null
2. Safety net: drain any remaining activeToolCalls (mark as error: "interaction ended")
3. If currentInteraction exists:
   a. Set completedAt = Date.now()
   b. Compute durationMs
   c. Sum totalPromptTokens from all roundTrips[].usageMetadata.promptTokenCount
   d. Sum totalCompletionTokens from all roundTrips[].usageMetadata.candidatesTokenCount
   e. Log 'interaction_end' event with summary
   f. Push to buffer
   g. Await logger.flush()
   h. If verbose: write summary to process.stderr
4. Set currentInteraction = null
```

**Verbose stderr summary format:**
```
[llm-proxy] Interaction <id> completed: 3 round trips, 
  tokens: 1234 prompt + 567 completion = 1801 total, 
  tools: search_youtube, get_video_info, 
  duration: 4.2s
```

---

### 3.6 `format-inspect.ts` — `/inspect` Output Formatter

**Purpose**: Format the contents of the proxy buffer for human-readable display in the TUI and CLI.

#### Exported Functions

```typescript
import type { LlmProxyPlugin } from './llm-proxy-plugin.ts';

/**
 * Format the last interaction from the proxy buffer as a readable summary.
 *
 * Output structure:
 *   === LLM Proxy: Last Interaction ===
 *   Interaction: <id-truncated>
 *   Duration: 4.2s
 *   Round Trips: 3
 *   Total Tokens: 1234 prompt + 567 completion = 1801
 *   User Message: "List my notebooks" (truncated to 200 chars)
 *
 *   Round Trip 1 [gemini-2.0-flash] (1.2s)
 *     Tokens: 800 prompt + 200 completion
 *     Tool Calls:
 *       → list_notebooks (0.8s) ✓
 *
 *   Round Trip 2 [gemini-2.0-flash] (0.9s)
 *     Tokens: 434 prompt + 367 completion
 *     No tool calls
 *
 * Returns "No interactions captured yet." if buffer is empty.
 */
export function formatInspect(plugin: LlmProxyPlugin): string;

/**
 * Returns a message indicating the proxy is disabled and how to enable it.
 *
 * Output:
 *   LLM Proxy is not active.
 *   To enable, set: LLM_PROXY_ENABLED=true and LLM_PROXY_LOG_DIR=<path>
 */
export function formatInspectDisabled(): string;
```

#### Formatting Rules

- Duration: displayed as `Xs`, `Xms`, or `X.Xs` depending on magnitude.
- Token counts: omit lines where all counts are 0 or undefined.
- Tool calls: show name, duration, and success (checkmark) or failure (cross with error).
- User message: truncated to 200 characters with `...` ellipsis.
- Interaction ID: show first 8 characters only.
- Follow the same pure-function pattern as `format-commands.ts`: no side effects, returns a string.

---

### 3.7 `proxy-factory.ts` — Conditional Plugin Creation

**Purpose**: Single entry point for both TUI and CLI to optionally create the proxy plugin.

```typescript
import type { LlmProxyPlugin } from './llm-proxy-plugin.ts';

/**
 * Create an LlmProxyPlugin if the proxy is enabled via environment variables.
 *
 * Returns undefined if LLM_PROXY_ENABLED is not 'true'.
 * Throws if proxy is enabled but configuration is invalid.
 *
 * This is the ONLY function that TUI and CLI need to import for proxy setup.
 */
export function createProxyPlugin(): LlmProxyPlugin | undefined;
```

#### Implementation

```
1. Call getProxyConfig()
2. If returns undefined → return undefined
3. Construct new LlmProxyPlugin(config)
4. Return the plugin instance
```

---

### 3.8 `index.ts` — Barrel Export

```typescript
// notebooklm_agent/proxy/index.ts

export { createProxyPlugin } from './proxy-factory.ts';
export { LlmProxyPlugin } from './llm-proxy-plugin.ts';
export { formatInspect, formatInspectDisabled } from './format-inspect.ts';
```

Only three things are needed by external consumers: the factory, the plugin type, and the formatters.

---

## 4. Data Flow

### 4.1 Single User Message Lifecycle

The following traces a user message ("list my notebooks") through the proxy:

```
User types: "list my notebooks"
│
├─ onUserMessageCallback
│   └── Store userMessage text = "list my notebooks"
│
├─ beforeRunCallback
│   ├── Create InteractionRecord { id: "inv-abc", startedAt: t0 }
│   └── Log: { event: "interaction_start", interactionId: "inv-abc" }
│
├─── Round Trip 1 ─────────────────────────────────────────────
│  ├─ beforeModelCallback
│  │   ├── Create RoundTripRecord #1
│  │   ├── Serialize LlmRequest (full tool declarations)
│  │   └── Log: { event: "llm_request", roundTrip: 1, payload: {...} }
│  │
│  ├─ afterModelCallback (×N chunks if streaming)
│  │   ├── Partial chunks: accumulate text
│  │   └── Final chunk:
│  │       ├── Finalize RoundTripRecord #1
│  │       ├── Record: usageMetadata, finishReason, content (FunctionCall)
│  │       └── Log: { event: "llm_response", roundTrip: 1, payload: {...} }
│  │
│  ├─ beforeToolCallback
│  │   ├── Create ToolCallRecord { toolName: "list_notebooks", startedAt: t1 }
│  │   └── Log: { event: "tool_start", payload: { toolName, args } }
│  │
│  └─ afterToolCallback
│      ├── Update ToolCallRecord { result: {...}, completedAt: t2, durationMs }
│      ├── Attach to RoundTrip #1's toolCalls
│      └── Log: { event: "tool_result", payload: { toolName, durationMs } }
│
├─── Round Trip 2 ─────────────────────────────────────────────
│  ├─ beforeModelCallback
│  │   ├── Create RoundTripRecord #2
│  │   ├── Serialize LlmRequest (tool NAMES only, not full declarations)
│  │   └── Log: { event: "llm_request", roundTrip: 2, payload: {...} }
│  │
│  └─ afterModelCallback (final chunk has text response)
│      ├── Finalize RoundTripRecord #2 (no tool calls)
│      └── Log: { event: "llm_response", roundTrip: 2, payload: {...} }
│
└─ afterRunCallback
    ├── Finalize InteractionRecord { completedAt: t3, durationMs }
    ├── Sum tokens across round trips
    ├── Log: { event: "interaction_end", payload: { summary } }
    ├── Push InteractionRecord to ProxyBuffer
    ├── Flush ProxyLogger to disk
    └── If verbose: print summary to stderr
```

### 4.2 NDJSON Log File Output

For the above interaction, the log file contains exactly 7 lines:

```
{"event":"interaction_start","timestamp":"2026-04-11T14:30:00.123Z","interactionId":"inv-abc","payload":{"sessionId":"sess-xyz","userMessage":"list my notebooks"}}
{"event":"llm_request","timestamp":"2026-04-11T14:30:00.125Z","interactionId":"inv-abc","roundTrip":1,"payload":{"model":"gemini-2.0-flash","contentsCount":1,"toolNames":[...],"toolDeclarations":[...],"systemInstructionText":"You are a..."}}
{"event":"llm_response","timestamp":"2026-04-11T14:30:01.200Z","interactionId":"inv-abc","roundTrip":1,"payload":{"content":{...},"usageMetadata":{"promptTokenCount":800,"candidatesTokenCount":15},"finishReason":"STOP","streamed":true,"chunkCount":3}}
{"event":"tool_start","timestamp":"2026-04-11T14:30:01.202Z","interactionId":"inv-abc","roundTrip":1,"payload":{"toolName":"list_notebooks","args":{}}}
{"event":"tool_result","timestamp":"2026-04-11T14:30:02.000Z","interactionId":"inv-abc","roundTrip":1,"payload":{"toolName":"list_notebooks","durationMs":798,"resultKeys":["status","data"]}}
{"event":"llm_request","timestamp":"2026-04-11T14:30:02.001Z","interactionId":"inv-abc","roundTrip":2,"payload":{"model":"gemini-2.0-flash","contentsCount":3,"toolNames":[...]}}
{"event":"llm_response","timestamp":"2026-04-11T14:30:03.500Z","interactionId":"inv-abc","roundTrip":2,"payload":{"content":{...},"usageMetadata":{"promptTokenCount":434,"candidatesTokenCount":367},"finishReason":"STOP","streamed":true,"chunkCount":12}}
{"event":"interaction_end","timestamp":"2026-04-11T14:30:03.501Z","interactionId":"inv-abc","payload":{"roundTripCount":2,"totalPromptTokens":1234,"totalCompletionTokens":382,"durationMs":3378,"toolCalls":["list_notebooks"]}}
```

---

## 5. Streaming Accumulation

### 5.1 The Problem

When using `StreamingMode.SSE` (which both TUI and CLI use), the ADK calls `afterModelCallback` once per streamed chunk. A single LLM round trip may produce 10-50 chunks. Only the final chunk contains `usageMetadata` and a definitive `finishReason`.

### 5.2 Detection of Final Chunk

A response chunk is considered "final" when ANY of these conditions is true:

| Condition | Meaning |
|-----------|---------|
| `llmResponse.partial === false` | Explicitly marked as non-partial |
| `llmResponse.partial === undefined` | Not a streaming response (single-shot) |
| `llmResponse.turnComplete === true` | Model's turn is complete |

A response chunk is considered "partial" only when:
- `llmResponse.partial === true` AND `llmResponse.turnComplete` is not `true`

### 5.3 Accumulation State

During streaming, the plugin maintains per-round-trip state:

```
partialTexts: string[]   — text extracted from each partial chunk's content.parts
chunkCount: number       — total chunks received for this round trip
```

On the final chunk:
1. If `partialTexts` has entries, the text is joined (no separator needed; the LLM produces contiguous text fragments).
2. The final chunk's `content` replaces any accumulated content (it typically contains the complete response in the last chunk).
3. `usageMetadata` is taken from the final chunk (it is undefined on partial chunks).
4. The accumulated `chunkCount` is stored on the `RoundTripRecord`.

### 5.4 Edge Cases

| Scenario | Handling |
|----------|----------|
| Error mid-stream (afterModelCallback stops firing) | `beforeModelCallback` for the NEXT round trip acts as implicit closer. `afterRunCallback` is the ultimate safety net. |
| Non-streaming mode (single afterModelCallback) | `partial` is `undefined`, so the chunk is immediately treated as final. `chunkCount` = 1, `streamed` = `false`. |
| `turnComplete` fires on a partial chunk | Treat as final. Some ADK versions may set both `partial: true` and `turnComplete: true` on the last chunk. |
| Empty content in partial chunks | Accumulate nothing; just increment `chunkCount`. |
| Multiple text parts in one chunk | Concatenate all text-type parts from `content.parts`. |

---

## 6. Integration Design

### 6.1 Changes to `notebooklm_agent/tui/hooks/useAgent.ts`

**Lines affected**: ~88 (runner creation), ~27-52 (UseAgentResult interface), ~66 (hook function)

**Step 1**: Add import at top of file:
```typescript
import { createProxyPlugin, type LlmProxyPlugin } from '../../proxy/index.ts';
```

**Step 2**: Add `proxyPlugin` to `UseAgentResult` interface:
```typescript
export interface UseAgentResult {
  // ... existing fields ...

  /** LLM proxy plugin instance, or undefined if proxy is disabled. */
  proxyPlugin: LlmProxyPlugin | undefined;
}
```

**Step 3**: Create proxy plugin and pass to runner (inside the `init()` function, around line 88):
```typescript
const proxyPlugin = createProxyPlugin();
const runner = new InMemoryRunner({
  agent: rootAgent,
  appName: 'notebooklm-tui',
  plugins: proxyPlugin ? [proxyPlugin] : undefined,
});
```

**Step 4**: Store proxy plugin in a ref and return it from the hook:
```typescript
const proxyPluginRef = useRef<LlmProxyPlugin | undefined>(undefined);
// Inside init():
proxyPluginRef.current = proxyPlugin;
// In return value:
proxyPlugin: proxyPluginRef.current,
```

### 6.2 Changes to `notebooklm_agent/cli.ts`

**Lines affected**: ~24 (imports), ~68 (runner creation), ~77 (help text), ~88-179 (command handlers)

**Step 1**: Add imports:
```typescript
import {
  createProxyPlugin,
  formatInspect,
  formatInspectDisabled,
} from './proxy/index.ts';
```

**Step 2**: Create proxy plugin and pass to runner (line ~68):
```typescript
const proxyPlugin = createProxyPlugin();
const runner = new InMemoryRunner({
  agent: rootAgent,
  appName,
  plugins: proxyPlugin ? [proxyPlugin] : undefined,
});
```

**Step 3**: Update help text (line ~77):
```typescript
console.log(`${DIM}Commands: /history /memory /new /last /inspect /quit${RESET}`);
```

**Step 4**: Add `/inspect` command handler (after `/last` handler, around line ~165):
```typescript
if (command === '/inspect' || command === '/proxy') {
  const output = proxyPlugin
    ? formatInspect(proxyPlugin)
    : formatInspectDisabled();
  printSystem(output);
  console.log();
  rl.prompt();
  return;
}
```

### 6.3 Changes to `notebooklm_agent/tui/index.tsx`

**Lines affected**: ~28 (imports), ~158 (after /last handler)

**Step 1**: Add imports:
```typescript
import { formatInspect, formatInspectDisabled } from '../proxy/index.ts';
```

**Step 2**: Add `/inspect` command handler in `handleSubmit`, after the `/last` block (around line ~158):
```typescript
if (command === '/inspect' || command === '/proxy') {
  history.addEntry(text);
  const output = agent.proxyPlugin
    ? formatInspect(agent.proxyPlugin)
    : formatInspectDisabled();
  agent.addSystemMessage(output);
  editor.clear();
  return;
}
```

Note: `/inspect` does not require the agent to be idle (it reads from the in-memory buffer which is safe to access during agent execution).

### 6.4 Changes to Help Text

**TUI**: The `/help` command currently falls through to the agent. If a help handler is added in the future, include `/inspect`.

**CLI**: Update the startup message (line ~77) to include `/inspect`.

---

## 7. Error Handling

### 7.1 Guiding Principle

**The proxy must never crash the agent.** Every method in the proxy subsystem is wrapped in try/catch at the appropriate level. Errors are logged to `process.stderr` and silently swallowed.

### 7.2 Error Handling by Component

| Component | Error Strategy |
|-----------|---------------|
| `proxy-serializer.ts` | `safeSerialize` returns error marker string. `serializeLlmRequest/Response` return partial results if individual fields fail. |
| `proxy-buffer.ts` | No I/O, no async. The only possible error is memory allocation failure which is fatal anyway. |
| `proxy-logger.ts` | All file I/O wrapped in try/catch. Errors written to stderr with `[llm-proxy]` prefix. Failed writes are dropped (data loss preferred over crash). |
| `proxy-config.ts` | Throws only during startup (before the agent runs). Invalid config is a configuration error, not a runtime error. |
| `llm-proxy-plugin.ts` | Every callback body is wrapped in a top-level try/catch that writes to stderr and returns `undefined`. The plugin never throws. |
| `format-inspect.ts` | Pure functions. Input is typed. No I/O. |
| `proxy-factory.ts` | Catches config errors and re-throws (this runs at startup, not during agent execution). |

### 7.3 Callback Error Wrapping Pattern

Every plugin callback follows this pattern:

```typescript
async beforeModelCallback(params: { callbackContext: unknown; llmRequest: unknown }): Promise<undefined> {
  try {
    // ... callback logic ...
  } catch (err) {
    process.stderr.write(
      `[llm-proxy] Error in beforeModelCallback: ${err instanceof Error ? err.message : String(err)}\n`
    );
  }
  return undefined;
}
```

This ensures that even if a bug exists in the proxy code, the agent continues to function normally.

---

## 8. Interface Contracts

### 8.1 Plugin → Buffer Contract

The plugin calls `buffer.push(interaction)` in `afterRunCallback` with a fully populated `InteractionRecord`. The buffer makes no assumptions about the record's contents beyond it being a valid `InteractionRecord` object.

### 8.2 Plugin → Logger Contract

The plugin calls `logger.write(entry)` during each callback with a `LogEntry` object. The logger is responsible for:
- Serializing the entry to JSON (via `JSON.stringify`)
- Appending a newline
- Buffering and flushing

The `LogEntry.payload` field is always a `Record<string, unknown>` that has already been sanitized by the serializer (no circular references, no non-serializable values). The logger does NOT use `safeSerialize` — it calls plain `JSON.stringify` because the data has already been cleaned.

### 8.3 Plugin → Serializer Contract

The plugin passes raw ADK objects (`LlmRequest`, `LlmResponse`) to the serializer functions. The serializer:
- Accepts `unknown` types (no coupling to ADK type imports)
- Returns plain objects (`Record<string, unknown>`) safe for JSON.stringify
- Handles missing/undefined fields gracefully (returns partial results)
- Never throws (catches errors internally)

### 8.4 Factory → Config Contract

The factory calls `getProxyConfig()` which either:
- Returns `undefined` (proxy disabled) — factory returns `undefined`
- Returns `ProxyConfig` (proxy enabled) — factory creates plugin
- Throws (invalid config) — exception propagates to caller (startup error)

### 8.5 TUI/CLI → Factory Contract

Both TUI and CLI call `createProxyPlugin()` at startup:
- If it returns `undefined`: do not pass `plugins` to `InMemoryRunner`
- If it returns `LlmProxyPlugin`: pass `plugins: [plugin]` to `InMemoryRunner`
- If it throws: the error propagates and prevents startup (same as any config error)

### 8.6 TUI/CLI → Formatter Contract

Both TUI and CLI call `formatInspect(plugin)` for the `/inspect` command:
- Input: the `LlmProxyPlugin` instance
- Output: a string ready for display
- The formatter calls `plugin.getLastInteraction()` and `plugin.getAllInteractions()` — both are synchronous, read-only, and safe to call at any time.

---

## 9. Implementation Units

### Unit A: Types + Serializer (Foundation)

**Files**: `proxy-types.ts`, `proxy-serializer.ts`  
**Test file**: `test_scripts/test-proxy-serializer.test.ts`  
**Dependencies**: None  
**Can run in parallel with**: Nothing (must be first)  
**Estimated tests**: ~18  
**Deliverables**:
- All type/interface definitions compiled without errors
- `safeSerialize` handles circular refs, functions, BigInt, truncation
- `flattenSystemInstruction` handles string, Content, Part[]
- `extractToolNames` returns keys
- `serializeLlmRequest` and `serializeLlmResponse` produce correct output

### Unit B: Buffer + Logger (Storage)

**Files**: `proxy-buffer.ts`, `proxy-logger.ts`  
**Test files**: `test_scripts/test-proxy-buffer.test.ts`, `test_scripts/test-proxy-logger.test.ts`  
**Dependencies**: Unit A (proxy-types.ts)  
**Can run in parallel with**: Unit C  
**Estimated tests**: ~16  
**Deliverables**:
- Circular buffer push/evict/getAll/getLast/clear all correct
- Logger creates NDJSON files, flushes, rotates on size limit
- Logger never throws

### Unit C: Config (Independent)

**Files**: `proxy-config.ts`  
**Test file**: `test_scripts/test-proxy-config.test.ts`  
**Dependencies**: Unit A (proxy-types.ts for `ProxyConfig` type)  
**Can run in parallel with**: Unit B  
**Estimated tests**: ~10  
**Deliverables**:
- Returns `undefined` when disabled
- Throws when enabled but `LLM_PROXY_LOG_DIR` missing
- Applies defaults for optional vars
- Validates numeric values

### Unit D: Plugin + Factory (Core)

**Files**: `llm-proxy-plugin.ts`, `proxy-factory.ts`, `index.ts`  
**Test files**: `test_scripts/test-llm-proxy-plugin.test.ts`  
**Dependencies**: Units A, B, C  
**Can run in parallel with**: Nothing (depends on all foundations)  
**Estimated tests**: ~20  
**Deliverables**:
- All callbacks return `undefined`
- Round trips correctly numbered
- Streaming accumulation works
- Tool calls linked to correct round trips
- Safety nets in afterRunCallback work
- Factory returns plugin or undefined correctly
- NDJSON entries written for each event type

### Unit E: Formatter + Integration (UI)

**Files**: `format-inspect.ts`, modifications to `useAgent.ts`, `cli.ts`, `tui/index.tsx`  
**Test file**: `test_scripts/test-format-inspect.test.ts`  
**Dependencies**: Unit D  
**Can run in parallel with**: Nothing (depends on plugin)  
**Estimated tests**: ~6  
**Deliverables**:
- `formatInspect` produces readable output
- `formatInspectDisabled` provides enablement instructions
- `/inspect` command works in both TUI and CLI
- Both TUI and CLI compile without type errors

### Summary Dependency Chain

```
Unit A (Types + Serializer)
    │
    ├──→ Unit B (Buffer + Logger)  ──┐
    │                                 │
    └──→ Unit C (Config)           ──┤
                                      │
                                      v
                            Unit D (Plugin + Factory)
                                      │
                                      v
                            Unit E (Formatter + Integration)
```

**Total estimated tests**: ~70
