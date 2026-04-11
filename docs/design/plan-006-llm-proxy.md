# Plan 006: LLM Proxy Plugin

**Version**: 1.0  
**Date**: 2026-04-11  
**Status**: Draft  
**Dependencies**: refined-request-llm-proxy.md, investigation-llm-proxy.md, codebase-scan-llm-proxy.md  
**Acceptance Criteria**: AC-01 through AC-10 from refined-request-llm-proxy.md

---

## Table of Contents

1. [Overview](#1-overview)
2. [Pre-Implementation Tasks](#2-pre-implementation-tasks)
3. [Phase 1: Types and Serialization](#3-phase-1-types-and-serialization)
4. [Phase 2: Circular Buffer and NDJSON Logger](#4-phase-2-circular-buffer-and-ndjson-logger)
5. [Phase 3: Proxy Configuration](#5-phase-3-proxy-configuration)
6. [Phase 4: Core Plugin](#6-phase-4-core-plugin)
7. [Phase 5: Format and Factory](#7-phase-5-format-and-factory)
8. [Phase 6: Integration into TUI and CLI](#8-phase-6-integration-into-tui-and-cli)
9. [Phase 7: Tests](#9-phase-7-tests)
10. [Phase 8: Documentation](#10-phase-8-documentation)
11. [Dependency Graph](#11-dependency-graph)
12. [File Inventory](#12-file-inventory)
13. [Risks and Mitigations](#13-risks-and-mitigations)

---

## 1. Overview

Implement an optional ADK `BasePlugin` subclass that intercepts all agent-to-LLM traffic, writes structured NDJSON logs, maintains an in-memory circular buffer for the `/inspect` command, and optionally prints per-interaction summaries to stderr. The plugin is purely observational (all callbacks return `undefined`) and adds zero overhead when disabled.

### Guiding Principles

- **No modification of `agent.ts`** -- the proxy is injected at the runner level.
- **No modification of `config.ts`** -- proxy configuration is separate because the proxy is optional and its env vars should not cause startup failures when disabled.
- **No new npm dependencies** -- only Node.js built-in modules (`node:fs`, `node:path`, `node:crypto`).
- **No fallback values** for `LLM_PROXY_LOG_DIR` (strict policy). Documented exceptions for `LLM_PROXY_ENABLED`, `LLM_PROXY_VERBOSE`, `LLM_PROXY_BUFFER_SIZE`, and `LLM_PROXY_MAX_FILE_SIZE` (optional developer tool with sensible defaults).

---

## 2. Pre-Implementation Tasks

### 2.1 Record Configuration Exception

Before writing any code, record the fallback-value exception in `Issues - Pending Items.md`:

> **LLM Proxy config defaults exception**: `LLM_PROXY_ENABLED` (default: `false`), `LLM_PROXY_VERBOSE` (default: `false`), `LLM_PROXY_BUFFER_SIZE` (default: `10`), and `LLM_PROXY_MAX_FILE_SIZE` (default: `52428800`) use default values because the proxy is an optional developer tool, not a core agent configuration. `LLM_PROXY_LOG_DIR` follows the strict no-fallback policy.

**Acceptance**: The exception is documented in `Issues - Pending Items.md` before any proxy code is committed.

---

## 3. Phase 1: Types and Serialization

**Goal**: Define all data structures and the safe serialization utility. These are pure modules with no side effects, enabling parallel work on buffer, logger, and plugin.

**Can be parallelized with**: Nothing (foundation layer).

### 3.1 Create `notebooklm_agent/proxy/proxy-types.ts`

Define the following TypeScript types:

```typescript
// Event types for NDJSON log entries
type ProxyEventType =
  | 'interaction_start'
  | 'llm_request'
  | 'llm_response'
  | 'tool_start'
  | 'tool_result'
  | 'tool_error'
  | 'llm_error'
  | 'interaction_end';

// A single tool call within a round trip
interface ToolCallRecord {
  toolName: string;
  args: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;
  startedAt: number;        // Date.now() ms
  completedAt?: number;
  durationMs?: number;
}

// Accumulated state for a single LLM round trip
interface RoundTripRecord {
  roundTripNumber: number;
  agentName: string;
  requestTimestamp: number;
  responseTimestamp?: number;
  durationMs?: number;
  // Request fields (serialized from LlmRequest)
  model?: string;
  systemInstruction?: unknown;       // raw Content object
  systemInstructionText?: string;    // flattened text for readability
  contentsCount: number;
  contents?: unknown[];              // serialized Content[] array
  toolNames: string[];
  toolDeclarations?: unknown[];      // full schemas, first round trip only
  generationConfig?: Record<string, unknown>;
  // Response fields (accumulated from streaming chunks)
  responseContent?: unknown;         // final Content object
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  finishReason?: string;
  streamed: boolean;
  chunkCount: number;
  errorCode?: string;
  errorMessage?: string;
  // Tool calls triggered by this round trip
  toolCalls: ToolCallRecord[];
}

// A complete interaction (user message to final response)
interface InteractionRecord {
  interactionId: string;
  sessionId: string;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  userMessage?: string;
  roundTrips: RoundTripRecord[];
  totalPromptTokens: number;
  totalCompletionTokens: number;
}

// NDJSON log entry envelope
interface LogEntry {
  event: ProxyEventType;
  timestamp: string;          // ISO-8601
  interactionId: string;
  roundTrip?: number;
  payload: Record<string, unknown>;
}
```

### 3.2 Create `notebooklm_agent/proxy/proxy-serializer.ts`

Implement:

- `safeSerialize(obj: unknown, maxSize?: number): string` -- JSON.stringify with:
  - Circular reference detection via `WeakSet<object>`
  - Skip known non-serializable fields: `abortSignal`, `httpOptions`, `liveConnectConfig`
  - Replace functions with `"[Function]"`
  - Replace BigInt with string representation
  - Truncate result if > `maxSize` (default 50KB) with `"[truncated at ${maxSize} bytes]"` appended
  - Wrapped in try/catch returning `"[serialization failed: <error>]"` on any exception

- `extractToolNames(toolsDict: Record<string, unknown>): string[]` -- returns `Object.keys(toolsDict)`

- `flattenSystemInstruction(instruction: unknown): string` -- handles `string`, `Content` (extracts text parts), and `Part[]` (extracts text parts). Returns empty string for undefined/null.

- `serializeLlmRequest(request: unknown, isFirstRoundTrip: boolean): Record<string, unknown>` -- extracts and serializes all request fields. Full tool declarations on first round trip, names only on subsequent.

- `serializeLlmResponse(response: unknown): Record<string, unknown>` -- extracts content, usageMetadata, finishReason, errorCode, errorMessage, partial, turnComplete.

### Acceptance Criteria (Phase 1)

- Types compile without errors (`npx tsc --noEmit`)
- `safeSerialize` handles circular references, functions, BigInt, and truncation
- `flattenSystemInstruction` handles string, Content, and Part[] inputs
- All functions are pure (no side effects, no I/O)

### Verification

```bash
npx tsc --noEmit
npx vitest run test_scripts/test-proxy-serializer.test.ts
```

---

## 4. Phase 2: Circular Buffer and NDJSON Logger

**Goal**: Implement the two storage backends (memory and file). These are independent of each other and independent of the plugin.

**Can be parallelized with**: Phase 1 must complete first (types dependency). Phase 2a and 2b can run in parallel.

### 4a. Create `notebooklm_agent/proxy/proxy-buffer.ts`

Implement a circular buffer for `InteractionRecord`:

- Constructor takes `capacity: number` (default 10)
- `push(interaction: InteractionRecord): void` -- adds to buffer, evicts oldest if full
- `getAll(): InteractionRecord[]` -- returns all stored interactions, oldest first
- `getLast(): InteractionRecord | undefined` -- returns the most recent interaction
- `clear(): void` -- empties the buffer
- `size: number` (getter)

Implementation: array-based ring buffer with head/tail pointers.

### 4b. Create `notebooklm_agent/proxy/proxy-logger.ts`

Implement an async NDJSON file writer:

- Constructor takes `{ logDir: string, sessionId: string, maxFileSize: number }`
- On construction: generates log file name as `${logDir}/proxy-${sessionId}-${timestamp}.ndjson`
- `write(entry: LogEntry): void` -- serializes entry as JSON, appends newline, writes to buffer
- Uses internal write buffer, flushes to disk periodically (every 500ms) or when buffer exceeds 64KB
- `flush(): Promise<void>` -- force flush buffer to disk
- `close(): Promise<void>` -- flush and close file handle
- File rotation: before each write, check file size. If exceeding `maxFileSize`, close current file and open a new one with incremented suffix
- Uses `node:fs/promises` for non-blocking I/O
- `getFilePath(): string` -- returns current log file path

All file operations wrapped in try/catch to never crash the agent.

### Acceptance Criteria (Phase 2)

- Circular buffer correctly evicts oldest entries when full
- Logger creates valid NDJSON files (one JSON object per line)
- Logger rotates when file size exceeds configured maximum
- Logger flush is non-blocking
- Logger never throws (all I/O errors are caught and silently ignored)

### Verification

```bash
npx vitest run test_scripts/test-proxy-buffer.test.ts
npx vitest run test_scripts/test-proxy-logger.test.ts
```

---

## 5. Phase 3: Proxy Configuration

**Goal**: Validate and load proxy-specific environment variables, separate from the core `config.ts`.

**Can be parallelized with**: Phase 2 (no dependency on buffer or logger implementation).

### Create `notebooklm_agent/proxy/proxy-config.ts`

Implement:

```typescript
interface ProxyConfig {
  enabled: boolean;
  logDir: string;            // required when enabled; throw if missing
  verbose: boolean;
  bufferSize: number;
  maxFileSize: number;
}

function getProxyConfig(): ProxyConfig | undefined
```

Logic:
1. Read `LLM_PROXY_ENABLED`. If not `'true'`, return `undefined`.
2. Read `LLM_PROXY_LOG_DIR`. If missing, throw `Error('LLM_PROXY_LOG_DIR must be set when LLM_PROXY_ENABLED=true')`.
3. Read `LLM_PROXY_VERBOSE` (default `false`).
4. Read `LLM_PROXY_BUFFER_SIZE` (default `10`). Validate as positive integer.
5. Read `LLM_PROXY_MAX_FILE_SIZE` (default `52428800`). Validate as positive integer.
6. Return frozen `ProxyConfig`.

Expose `resetProxyConfig()` for testing (clears cached config).

### Acceptance Criteria (Phase 3)

- Returns `undefined` when `LLM_PROXY_ENABLED` is not `'true'`
- Throws when `LLM_PROXY_LOG_DIR` is missing and proxy is enabled
- Applies defaults for `LLM_PROXY_VERBOSE`, `LLM_PROXY_BUFFER_SIZE`, `LLM_PROXY_MAX_FILE_SIZE`
- Invalid numeric values (negative, NaN) cause a descriptive error

### Verification

```bash
npx vitest run test_scripts/test-proxy-config.test.ts
```

---

## 6. Phase 4: Core Plugin

**Goal**: Implement the `LlmProxyPlugin` class extending `BasePlugin`. This is the central component that ties together types, serializer, buffer, and logger.

**Depends on**: Phase 1, Phase 2, Phase 3 (all must be complete).

### Create `notebooklm_agent/proxy/llm-proxy-plugin.ts`

Class `LlmProxyPlugin extends BasePlugin`:

**Constructor**:
```typescript
constructor(config: ProxyConfig)
```
- Calls `super('llm-proxy')`
- Creates `ProxyBuffer` with `config.bufferSize`
- Creates `ProxyLogger` with `config.logDir`, a placeholder session ID (updated on first run), and `config.maxFileSize`
- Stores `config.verbose`

**State tracking**:
- `currentInteraction: InteractionRecord | null` -- active interaction being built
- `currentRoundTrip: RoundTripRecord | null` -- active round trip within interaction
- `activeToolCalls: Map<string, ToolCallRecord>` -- tool calls in progress (keyed by `functionCallId`)
- `partialTexts: string[]` -- accumulated text from streaming partial responses
- `chunkCount: number` -- count of streamed chunks in current round trip

**Callbacks implemented**:

1. **`onUserMessageCallback`**: Extract user message text, store for interaction record.

2. **`beforeRunCallback`**: 
   - Create new `InteractionRecord` with `invocationContext.invocationId` as interaction ID
   - Record `startedAt` timestamp
   - Log `interaction_start` event

3. **`beforeModelCallback`**:
   - Increment round trip counter
   - Create new `RoundTripRecord`
   - Serialize `LlmRequest` using `serializeLlmRequest()` (full tool declarations on round trip 1, names only on subsequent)
   - Log `llm_request` event
   - Return `undefined`

4. **`afterModelCallback`**:
   - If `llmResponse.partial === true`: accumulate text content in `partialTexts`, increment `chunkCount`
   - If `llmResponse.partial !== true` OR `llmResponse.turnComplete === true`:
     - Merge accumulated text into final response
     - Capture `usageMetadata`, `finishReason`, `errorCode`, `errorMessage`
     - Set `responseTimestamp` and compute `durationMs`
     - Log `llm_response` event
     - Finalize round trip, push to current interaction's `roundTrips` array
     - Reset partial accumulation state
   - Return `undefined`

5. **`beforeToolCallback`**:
   - Create `ToolCallRecord` with `tool.name`, `toolArgs`, `startedAt`
   - Store in `activeToolCalls` keyed by `toolContext.functionCallId`
   - Log `tool_start` event
   - Return `undefined`

6. **`afterToolCallback`**:
   - Retrieve from `activeToolCalls` by `toolContext.functionCallId`
   - Set `result`, `completedAt`, compute `durationMs`
   - Attach to current round trip's `toolCalls` array
   - Log `tool_result` event
   - Return `undefined`

7. **`onModelErrorCallback`**:
   - Log `llm_error` event with error message and the request that triggered it
   - Finalize current round trip with error info
   - Return `undefined`

8. **`onToolErrorCallback`**:
   - Retrieve from `activeToolCalls`, set `error`
   - Log `tool_error` event
   - Return `undefined`

9. **`afterRunCallback`**:
   - Safety net: finalize any unclosed round trip (edge case: error mid-stream)
   - Set interaction `completedAt`, compute `durationMs`
   - Compute `totalPromptTokens` and `totalCompletionTokens` from all round trips
   - Log `interaction_end` event
   - Push interaction to circular buffer
   - Flush logger
   - If `verbose`: print summary to `process.stderr`

**Public methods for `/inspect`**:
- `getLastInteraction(): InteractionRecord | undefined`
- `getAllInteractions(): InteractionRecord[]`
- `isActive(): boolean` -- returns `true` (always, since the plugin only exists when enabled)

### Acceptance Criteria (Phase 4)

- All callbacks return `undefined` (AC-07)
- Round trips are correctly numbered within an interaction (AC-02)
- Streaming partial responses are accumulated into a single round trip record
- Tool calls are linked to the round trip that triggered them
- Unclosed round trips are finalized in `afterRunCallback` (safety net)
- NDJSON log entries are written for every event type
- Verbose summary is printed to stderr (not stdout)

### Verification

```bash
npx tsc --noEmit
npx vitest run test_scripts/test-llm-proxy-plugin.test.ts
```

---

## 7. Phase 5: Format and Factory

**Goal**: Create the `/inspect` output formatter and the conditional factory function.

**Depends on**: Phase 4 (needs `LlmProxyPlugin` type), Phase 3 (needs `getProxyConfig`).

**Phase 5a and 5b can be parallelized.**

### 5a. Create `notebooklm_agent/proxy/format-inspect.ts`

Implement `formatInspect(plugin: LlmProxyPlugin): string`:

- If no interactions in buffer: return `"No interactions captured yet."`
- For the last interaction, format:
  - Interaction ID (truncated UUID)
  - Duration
  - Total round trips
  - Total tokens (prompt + completion)
  - Per-round-trip summary:
    - Round trip number, model, duration
    - Token usage
    - Tool calls (name, duration, success/error)
  - User message (first 200 chars)

Implement `formatInspectDisabled(): string`:
- Returns message explaining proxy is disabled and how to enable it (`LLM_PROXY_ENABLED=true`)

Follow the pattern of existing formatters in `tui/lib/format-commands.ts`.

### 5b. Create `notebooklm_agent/proxy/proxy-factory.ts`

Implement `createProxyPlugin(): LlmProxyPlugin | undefined`:

1. Call `getProxyConfig()`
2. If returns `undefined` (proxy disabled), return `undefined`
3. Construct `LlmProxyPlugin` with the config
4. Return the plugin instance

This is the single entry point for both TUI and CLI integration.

### 5c. Create barrel export `notebooklm_agent/proxy/index.ts`

Re-export:
- `createProxyPlugin` from `proxy-factory.ts`
- `LlmProxyPlugin` type from `llm-proxy-plugin.ts`
- `formatInspect`, `formatInspectDisabled` from `format-inspect.ts`

### Acceptance Criteria (Phase 5)

- `createProxyPlugin()` returns `undefined` when proxy is disabled (AC-06)
- `createProxyPlugin()` returns a valid `LlmProxyPlugin` when proxy is enabled
- `formatInspect()` produces human-readable output with round trip details (AC-05)
- `formatInspectDisabled()` provides clear enablement instructions

### Verification

```bash
npx tsc --noEmit
npx vitest run test_scripts/test-format-inspect.test.ts
```

---

## 8. Phase 6: Integration into TUI and CLI

**Goal**: Wire the proxy into the two entry points and add the `/inspect` slash command.

**Depends on**: Phase 5 (needs factory and formatter).

### 6.1 Modify `notebooklm_agent/tui/hooks/useAgent.ts`

Changes:
1. Import `createProxyPlugin` and `LlmProxyPlugin` from `../proxy/index.ts`
2. At runner creation (currently line ~88), call `createProxyPlugin()`
3. Pass plugin to `InMemoryRunner` via `plugins` array:
   ```typescript
   const proxyPlugin = createProxyPlugin();
   const runner = new InMemoryRunner({
     agent: rootAgent,
     appName: 'notebooklm-tui',
     plugins: proxyPlugin ? [proxyPlugin] : undefined,
   });
   ```
4. Expose `proxyPlugin` reference from the hook's return value (e.g., add `proxyPlugin: LlmProxyPlugin | undefined` to the returned object)

### 6.2 Modify `notebooklm_agent/cli.ts`

Changes:
1. Import `createProxyPlugin`, `LlmProxyPlugin`, `formatInspect`, `formatInspectDisabled` from `./proxy/index.ts`
2. At runner creation (currently line ~68), call `createProxyPlugin()`
3. Pass plugin to `InMemoryRunner` via `plugins` array (same pattern as TUI)
4. Add `/inspect` (alias `/proxy`) command handler in the `rl.on('line')` handler, after the `/last` handler:
   ```typescript
   if (command === '/inspect' || command === '/proxy') {
     const output = proxyPlugin
       ? formatInspect(proxyPlugin)
       : formatInspectDisabled();
     printSystem(output);
     continue; // or equivalent flow control
   }
   ```

### 6.3 Modify `notebooklm_agent/tui/index.tsx`

Changes:
1. Import `formatInspect`, `formatInspectDisabled` from `../proxy/index.ts`
2. Add `/inspect` (alias `/proxy`) command handler in `handleSubmit`, after the `/last` handler:
   ```typescript
   if (command === '/inspect' || command === '/proxy') {
     const output = agent.proxyPlugin
       ? formatInspect(agent.proxyPlugin)
       : formatInspectDisabled();
     agent.addSystemMessage(output);
     return;
   }
   ```

### 6.4 Update `/help` output in both TUI and CLI

Add `/inspect` to the help text with description: "Show last interaction's LLM round trips (requires LLM_PROXY_ENABLED=true)".

### Acceptance Criteria (Phase 6)

- When `LLM_PROXY_ENABLED=true` and `LLM_PROXY_LOG_DIR` is set, the proxy captures all LLM round trips (AC-01)
- When proxy is disabled, zero overhead: plugin is not instantiated (AC-06)
- `/inspect` command works in both TUI and CLI (AC-05)
- `/inspect` shows "proxy is disabled" message with instructions when proxy is off
- Both TUI and CLI build without type errors

### Verification

```bash
npx tsc --noEmit
# Manual verification: run TUI/CLI with LLM_PROXY_ENABLED=true and check log files
# Manual verification: run /inspect command in both interfaces
```

---

## 9. Phase 7: Tests

**Goal**: Comprehensive test coverage for all proxy components.

**Depends on**: Phase 6 (all code must be written). However, unit tests for individual modules (serializer, buffer, logger, config) can be written alongside their respective phases.

### Test Files

All tests in `test_scripts/` using Vitest.

#### 7.1 `test_scripts/test-proxy-serializer.test.ts`

- `safeSerialize` with plain objects
- `safeSerialize` with circular references
- `safeSerialize` with functions (replaced with `"[Function]"`)
- `safeSerialize` with BigInt
- `safeSerialize` truncation at max size
- `safeSerialize` exception handling (returns error marker)
- `flattenSystemInstruction` with string input
- `flattenSystemInstruction` with Content object
- `flattenSystemInstruction` with Part[] array
- `flattenSystemInstruction` with undefined/null
- `extractToolNames` with populated dict
- `extractToolNames` with empty dict
- `serializeLlmRequest` first round trip (full tool declarations)
- `serializeLlmRequest` subsequent round trips (names only)
- `serializeLlmResponse` with all fields
- `serializeLlmResponse` with partial response

**Estimated test count**: ~18

#### 7.2 `test_scripts/test-proxy-buffer.test.ts`

- Push and retrieve single interaction
- Push multiple, retrieve in order
- Capacity eviction (push N+1 items to capacity-N buffer)
- `getLast()` returns most recent
- `getLast()` on empty buffer returns undefined
- `clear()` empties buffer
- `size` getter accuracy

**Estimated test count**: ~8

#### 7.3 `test_scripts/test-proxy-logger.test.ts`

- Creates log file in specified directory
- Writes valid NDJSON (each line parseable as JSON)
- Flush writes buffered entries to disk
- File rotation on size limit
- Graceful handling of write errors (no throw)
- `close()` flushes and closes

**Estimated test count**: ~8

#### 7.4 `test_scripts/test-proxy-config.test.ts`

- Returns `undefined` when `LLM_PROXY_ENABLED` is not set
- Returns `undefined` when `LLM_PROXY_ENABLED` is `'false'`
- Throws when enabled but `LLM_PROXY_LOG_DIR` missing
- Returns config with defaults when only required vars set
- Overrides defaults with provided values
- Rejects invalid `LLM_PROXY_BUFFER_SIZE` (negative, NaN)
- Rejects invalid `LLM_PROXY_MAX_FILE_SIZE` (negative, NaN)
- `resetProxyConfig()` clears cache

**Estimated test count**: ~10

#### 7.5 `test_scripts/test-llm-proxy-plugin.test.ts`

- Plugin name is `'llm-proxy'`
- `beforeRunCallback` creates interaction record
- `beforeModelCallback` creates round trip and returns `undefined`
- `afterModelCallback` with non-streaming response finalizes round trip, returns `undefined`
- `afterModelCallback` with streaming partials accumulates text
- `afterModelCallback` with final chunk captures usage metadata
- `beforeToolCallback` records tool start, returns `undefined`
- `afterToolCallback` records result and duration, returns `undefined`
- `onModelErrorCallback` logs error, returns `undefined`
- `onToolErrorCallback` logs error, returns `undefined`
- `afterRunCallback` finalizes interaction and pushes to buffer
- `afterRunCallback` finalizes unclosed round trips (safety net)
- Round trip numbering increments correctly across multiple LLM calls
- Tool calls are associated with correct round trip
- Verbose mode prints summary to stderr
- `getLastInteraction()` returns last completed interaction
- `getAllInteractions()` returns all buffered interactions
- Multi-interaction scenario: buffer retains correct count

**Estimated test count**: ~20

#### 7.6 `test_scripts/test-format-inspect.test.ts`

- `formatInspect` with no interactions returns "No interactions captured" message
- `formatInspect` with single interaction formats correctly
- `formatInspect` with multiple round trips shows per-round-trip details
- `formatInspect` with tool calls shows tool names and durations
- `formatInspectDisabled` returns enablement instructions

**Estimated test count**: ~6

### Total Estimated Tests: ~70

### Acceptance Criteria (Phase 7)

- All tests pass: `npx vitest run` (AC-10)
- Serialization safety validated (AC-08)
- Log file format validated as NDJSON (AC-09)
- Round trip counting validated (AC-02)
- All callbacks confirmed to return `undefined` (AC-07)

### Verification

```bash
npx vitest run test_scripts/test-proxy-serializer.test.ts
npx vitest run test_scripts/test-proxy-buffer.test.ts
npx vitest run test_scripts/test-proxy-logger.test.ts
npx vitest run test_scripts/test-proxy-config.test.ts
npx vitest run test_scripts/test-llm-proxy-plugin.test.ts
npx vitest run test_scripts/test-format-inspect.test.ts
# All at once:
npx vitest run test_scripts/test-proxy-*.test.ts test_scripts/test-llm-proxy-plugin.test.ts test_scripts/test-format-inspect.test.ts
```

---

## 10. Phase 8: Documentation

**Goal**: Update all project documentation to reflect the new proxy feature.

**Depends on**: Phase 6 (implementation complete).

### 8.1 Update `CLAUDE.md`

Add `<LlmProxy>` tool documentation section following the established format:

```xml
<LlmProxy>
    <objective>
        Optional ADK plugin that captures all agent-to-LLM traffic ...
    </objective>
    <command>
        Activated via LLM_PROXY_ENABLED=true environment variable.
        No direct CLI command.
    </command>
    <info>
        Module structure, env vars, /inspect command, log format, etc.
    </info>
</LlmProxy>
```

### 8.2 Update `docs/design/project-design.md`

- Add the LLM Proxy Plugin to the System Architecture component diagram
- Add a new section describing the proxy architecture and data flow
- Update the project structure file tree

### 8.3 Update `docs/design/project-functions.md`

Add FR-PROXY-01 through FR-PROXY-08 (see section below for exact content).

### 8.4 Update `Issues - Pending Items.md`

- Add the configuration exception record (from Phase 0)
- Add note about log file sensitivity (developer responsibility)

### Acceptance Criteria (Phase 8)

- CLAUDE.md has complete `<LlmProxy>` documentation
- `project-design.md` reflects the proxy in the architecture
- `project-functions.md` has all 8 FR-PROXY requirements
- `Issues - Pending Items.md` has the config exception recorded

---

## 11. Dependency Graph

```
Phase 1 (Types + Serializer)
    |
    ├──> Phase 2a (Buffer)     ──┐
    ├──> Phase 2b (Logger)     ──┤
    └──> Phase 3 (Config)      ──┤
                                  │
                                  v
                        Phase 4 (Core Plugin)
                                  │
                                  v
                   ┌──> Phase 5a (Format Inspect) ──┐
                   └──> Phase 5b (Factory)         ──┤
                                                     │
                                                     v
                                          Phase 6 (Integration)
                                                     │
                                                     v
                                          Phase 7 (Tests)
                                                     │
                                                     v
                                          Phase 8 (Documentation)
```

**Parallelization opportunities**:
- Phase 2a, 2b, 3 can all run in parallel (after Phase 1)
- Phase 5a and 5b can run in parallel (after Phase 4)
- Unit tests for each module can be written alongside their respective phase

---

## 12. File Inventory

### New Files

| File | Phase | Purpose |
|------|-------|---------|
| `notebooklm_agent/proxy/proxy-types.ts` | 1 | Data type definitions |
| `notebooklm_agent/proxy/proxy-serializer.ts` | 1 | Safe JSON serialization |
| `notebooklm_agent/proxy/proxy-buffer.ts` | 2a | In-memory circular buffer |
| `notebooklm_agent/proxy/proxy-logger.ts` | 2b | Async NDJSON file writer |
| `notebooklm_agent/proxy/proxy-config.ts` | 3 | Environment variable validation |
| `notebooklm_agent/proxy/llm-proxy-plugin.ts` | 4 | BasePlugin subclass |
| `notebooklm_agent/proxy/format-inspect.ts` | 5a | /inspect output formatter |
| `notebooklm_agent/proxy/proxy-factory.ts` | 5b | Conditional plugin instantiation |
| `notebooklm_agent/proxy/index.ts` | 5c | Barrel re-export |
| `test_scripts/test-proxy-serializer.test.ts` | 7 | Serializer tests |
| `test_scripts/test-proxy-buffer.test.ts` | 7 | Buffer tests |
| `test_scripts/test-proxy-logger.test.ts` | 7 | Logger tests |
| `test_scripts/test-proxy-config.test.ts` | 7 | Config tests |
| `test_scripts/test-llm-proxy-plugin.test.ts` | 7 | Plugin behavior tests |
| `test_scripts/test-format-inspect.test.ts` | 7 | Formatter tests |

### Modified Files

| File | Phase | Change |
|------|-------|--------|
| `notebooklm_agent/tui/hooks/useAgent.ts` | 6 | Import proxy, pass plugin to InMemoryRunner, expose proxy ref |
| `notebooklm_agent/cli.ts` | 6 | Import proxy, pass plugin to InMemoryRunner, add /inspect handler |
| `notebooklm_agent/tui/index.tsx` | 6 | Add /inspect slash command handler |
| `CLAUDE.md` | 8 | Add LlmProxy tool documentation |
| `docs/design/project-design.md` | 8 | Add proxy to architecture, update file tree |
| `docs/design/project-functions.md` | 8 | Add FR-PROXY-01 through FR-PROXY-08 |
| `Issues - Pending Items.md` | 0, 8 | Record config exception, add sensitivity note |

### Files NOT Modified

| File | Reason |
|------|--------|
| `notebooklm_agent/agent.ts` | Explicitly out of scope |
| `notebooklm_agent/config.ts` | Proxy config is separate |
| `notebooklm_agent/tools/*` | Tools are unaffected |
| `package.json` | No new dependencies |

---

## 13. Risks and Mitigations

### R1: Streaming Partial Accumulation Edge Cases (Medium)

**Risk**: The `partial` and `turnComplete` flags may behave unexpectedly during errors mid-stream, leaving an unclosed round trip.

**Mitigation**: The `afterRunCallback` acts as a safety net, finalizing any unclosed round trip. Additionally, each `beforeModelCallback` implicitly closes the previous round trip if it was not finalized (defensive guard).

### R2: Large Payload Serialization (Medium)

**Risk**: Tool results like YouTube transcripts can be very large, causing memory pressure and oversized log files.

**Mitigation**: `safeSerialize` enforces a 50KB truncation limit per serialized payload. Tool results are independently truncated. The 50KB limit is hardcoded in Phase 1 but could be made configurable in a future version.

### R3: `systemInstruction` Type Variance (Low-Medium)

**Risk**: `ContentUnion` can be `string`, `Content`, or `Part[]`. The `LoggingPlugin` reference uses `.length` and `.substring()`, suggesting the ADK may normalize it to string. But this is not guaranteed.

**Mitigation**: `flattenSystemInstruction` handles all three forms explicitly, with a fallback to `String(instruction)` for unexpected types.

### R4: ADK BasePlugin API Stability (Low)

**Risk**: The `BasePlugin` callback signatures could change in future ADK versions.

**Mitigation**: The project pins `@google/adk ^0.6.1`. The plugin callbacks are documented in the ADK type declarations and demonstrated by the built-in `LoggingPlugin`. Semver protects against breaking changes in patch/minor releases.

### R5: Memory from Circular Buffer (Low)

**Risk**: 10 interactions with large payloads could consume significant memory.

**Mitigation**: Each interaction's serialized data is bounded by the 50KB truncation in the serializer. Estimated maximum is ~5MB for 10 complex interactions, well within acceptable limits.

### R6: File Rotation Race Conditions (Low)

**Risk**: Concurrent writes during rotation could corrupt the log file.

**Mitigation**: Single-writer pattern (one proxy per runner instance). The logger uses sequential async operations (no concurrent writes). File size is checked before each write batch.
