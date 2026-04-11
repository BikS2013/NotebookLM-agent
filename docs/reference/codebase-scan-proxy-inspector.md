# Codebase Scan: Proxy Inspector (Electron Log Viewer)

**Date**: 2026-04-11
**Purpose**: Provide the implementation team with a precise understanding of the existing proxy log format, project layout, and Electron patterns so the `proxy-inspector/` tool can be built correctly.

---

## 1. Project Layout Summary

```
NotebookLM-agent/
  CLAUDE.md                          # Project docs and tool registry
  package.json                       # Root package (ESM, dependencies: @google/adk, ink, react, zod)
  tsconfig.json
  vitest.config.ts
  logs/                              # NDJSON log files written by the proxy
    proxy-<sessionId>-<timestamp>.ndjson
  notebooklm_agent/
    agent.ts                         # ADK agent definition
    config.ts                        # Config loader (env vars, no fallback)
    cli.ts                           # Readline-based CLI
    tui.ts                           # Ink-based TUI entry point
    tui/                             # TUI components, hooks, lib
    tools/                           # ADK FunctionTools (youtube, filesystem, notebook, etc.)
    proxy/                           # LLM proxy plugin subsystem
      proxy-types.ts                 # Type definitions (LogEntry, ProxyEventType, etc.)
      proxy-logger.ts                # NDJSON file writer with buffering and rotation
      proxy-serializer.ts            # Safe JSON serialization for LLM request/response
      proxy-buffer.ts                # In-memory interaction buffer
      proxy-config.ts                # Proxy config loader
      proxy-factory.ts               # Factory for proxy plugin creation
      llm-proxy-plugin.ts            # ADK callbacks (beforeModel, afterModel, beforeTool, etc.)
      format-inspect.ts              # CLI formatting for /inspect command
      index.ts                       # Barrel export
  test_scripts/                      # Vitest tests
  docs/
    design/                          # Plans, technical designs, project design
    reference/                       # Investigation docs, refined requests, codebase scans
```

The new `proxy-inspector/` directory should be placed at the **root level** of `NotebookLM-agent/`, as a sibling to `notebooklm_agent/`, `logs/`, and `test_scripts/`. This matches NFR-3.1 (own directory, own `package.json`, own `node_modules`).

---

## 2. Proxy Type Definitions

**File**: `notebooklm_agent/proxy/proxy-types.ts` (zero runtime dependencies)

### 2.1 ProxyEventType (union of 8 string literals)

```typescript
export type ProxyEventType =
  | 'interaction_start'
  | 'llm_request'
  | 'llm_response'
  | 'tool_start'
  | 'tool_result'
  | 'tool_error'
  | 'llm_error'
  | 'interaction_end';
```

### 2.2 LogEntry (NDJSON line envelope)

```typescript
export interface LogEntry {
  event: ProxyEventType;
  timestamp: string;           // ISO-8601
  interactionId: string;       // Groups all events for one user message
  roundTrip?: number;          // Undefined for interaction_start/end
  payload: Record<string, unknown>;
}
```

### 2.3 Supporting Types (for reference, not directly in log lines)

```typescript
export interface ToolCallRecord {
  toolName: string;
  functionCallId: string;
  args: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
}

export interface RoundTripRecord {
  roundTripNumber: number;
  agentName: string;
  requestTimestamp: number;
  responseTimestamp?: number;
  durationMs?: number;
  model?: string;
  systemInstruction?: unknown;
  systemInstructionText?: string;
  contentsCount: number;
  contents?: unknown[];
  toolNames: string[];
  toolDeclarations?: unknown[];
  generationConfig?: Record<string, unknown>;
  responseContent?: unknown;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
  finishReason?: string;
  streamed: boolean;
  chunkCount: number;
  errorCode?: string;
  errorMessage?: string;
  toolCalls: ToolCallRecord[];
}

export interface InteractionRecord {
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

export interface ProxyConfig {
  enabled: true;
  logDir: string;
  verbose: boolean;
  bufferSize: number;
  maxFileSize: number;
}
```

**Important**: `InteractionRecord`, `RoundTripRecord`, and `ToolCallRecord` are the proxy plugin's in-memory structures. They are NOT directly serialized to the log file. The log file contains flat `LogEntry` objects with event-specific payloads. The Electron inspector must reconstruct the hierarchical view from the flat NDJSON stream.

---

## 3. Log File Format Analysis

### 3.1 File Naming Convention

```
proxy-<sessionId>-<ISO-timestamp>.ndjson
```

Example: `proxy-36d86b1d-cb79-4609-b8e5-1a777a25db08-2026-04-11T06-58-50.ndjson`

- Session ID extracted from the filename: `36d86b1d-cb79-4609-b8e5-1a777a25db08`
- Timestamp colons replaced with hyphens, milliseconds stripped
- Rotation appends `.1`, `.2`, etc. before `.ndjson`

### 3.2 File Structure (sample file: 12 lines, 2 interactions)

| Line | Event              | Interaction (last 8) | RT   | Payload Size |
|------|--------------------|----------------------|------|-------------|
| 1    | interaction_start  | 343b4240             | null | 208 B       |
| 2    | llm_request        | 343b4240             | 1    | 33,308 B    |
| 3    | llm_response       | 343b4240             | 1    | 512 B       |
| 4    | interaction_end    | 343b4240             | null | 258 B       |
| 5    | interaction_start  | 1ba376fd             | null | 223 B       |
| 6    | llm_request        | 1ba376fd             | 1    | 33,579 B    |
| 7    | llm_response       | 1ba376fd             | 1    | 400 B       |
| 8    | tool_start         | 1ba376fd             | 1    | 243 B       |
| 9    | tool_result        | 1ba376fd             | 1    | 308 B       |
| 10   | llm_request        | 1ba376fd             | 2    | 18,893 B    |
| 11   | llm_response       | 1ba376fd             | 2    | 7,971 B     |
| 12   | interaction_end    | 1ba376fd             | null | 280 B       |

**Total file size**: 94 KB for 12 lines and 2 interactions.

### 3.3 Key Observations

- Events for one interaction are **contiguous** (not interleaved).
- `llm_request` payloads are by far the largest (19-33 KB) due to conversation history and tool declarations.
- `llm_response` payloads vary: 400 B for a function call, 8 KB for a long text response.
- `tool_start` / `tool_result` are small (200-300 B).
- `interaction_start` / `interaction_end` are tiny (200-280 B).
- Round trip 1 `llm_request` includes `toolDeclarations` (full schemas); round trip 2+ omits them (only `toolNames`).

---

## 4. Payload Structure Per Event Type

### 4.1 interaction_start

```json
{
  "event": "interaction_start",
  "timestamp": "2026-04-11T06:58:50.936Z",
  "interactionId": "e-81280261-9171-46ea-988e-a36e343b4240",
  "payload": {
    "sessionId": "36d86b1d-cb79-4609-b8e5-1a777a25db08",
    "userMessage": "hi"
  }
}
```

Payload keys: `sessionId`, `userMessage`

### 4.2 llm_request

```json
{
  "event": "llm_request",
  "timestamp": "2026-04-11T06:58:50.941Z",
  "interactionId": "e-81280261-9171-46ea-988e-a36e343b4240",
  "roundTrip": 1,
  "payload": {
    "model": "gemini-2.5-flash",
    "contentsCount": 1,
    "contents": [/* array of Content objects, each with role + parts */],
    "systemInstruction": {/* Content object with parts[].text */},
    "systemInstructionText": "You are an agent. Your internal name is...",
    "toolDeclarations": [/* array of tool schema objects (RT1 only) */],
    "toolNames": ["check_auth", "list_notebooks", "get_notebook", ...]
  }
}
```

Payload keys:
- Always: `model`, `contentsCount`, `contents`, `systemInstruction`, `systemInstructionText`, `toolNames`
- RT1 only: `toolDeclarations` (full tool schemas, omitted on RT2+)
- Optional: `generationConfig` (not present in sample)

**Note on `contents`**: Each Content object has `{role: "user"|"model", parts: [{text: "..."} | {functionCall: {...}} | {functionResponse: {...}}]}`.

**Note on `toolDeclarations`**: Contains a single-element array wrapping an object with `functionDeclarations` -- an array of all tool schemas (52 tools in the sample). This is the bulk of the 33 KB payload.

### 4.3 llm_response (text response)

```json
{
  "event": "llm_response",
  "timestamp": "2026-04-11T06:58:51.870Z",
  "interactionId": "e-81280261-9171-46ea-988e-a36e343b4240",
  "roundTrip": 1,
  "payload": {
    "content": {
      "role": "model",
      "parts": [
        { "text": "Hello! I'm NotebookLM Manager..." }
      ]
    },
    "usageMetadata": {
      "promptTokenCount": 6099,
      "candidatesTokenCount": 41,
      "totalTokenCount": 6140
    },
    "streamed": true,
    "chunkCount": 4,
    "durationMs": 929
  }
}
```

### 4.4 llm_response (function call)

```json
{
  "event": "llm_response",
  "timestamp": "2026-04-11T07:00:03.796Z",
  "interactionId": "e-5a54eb01-4f09-45db-bf68-e1101ba376fd",
  "roundTrip": 1,
  "payload": {
    "content": {
      "parts": [
        {
          "functionCall": { "name": "list_notebooks", "args": {} }
        }
      ],
      "role": "model"
    },
    "usageMetadata": {
      "promptTokenCount": 6146,
      "candidatesTokenCount": 11,
      "totalTokenCount": 6157
    },
    "finishReason": "STOP",
    "streamed": false,
    "chunkCount": 1,
    "durationMs": 1125
  }
}
```

Payload keys: `content`, `usageMetadata`, `streamed`, `chunkCount`, `durationMs`, optionally `finishReason`

**Content format varies**:
- Streamed responses: `content` is an object `{role, parts}` (accumulated by the proxy)
- Non-streamed responses: also `{role, parts}` (single chunk)
- `parts` array can contain `{text: "..."}` and/or `{functionCall: {name, args}}`

### 4.5 tool_start

```json
{
  "event": "tool_start",
  "timestamp": "2026-04-11T07:00:03.797Z",
  "interactionId": "e-5a54eb01-4f09-45db-bf68-e1101ba376fd",
  "roundTrip": 1,
  "payload": {
    "toolName": "list_notebooks",
    "functionCallId": "adk-ec0ec6b4-4d38-487e-a0e1-004586d6d616",
    "args": {}
  }
}
```

Payload keys: `toolName`, `functionCallId`, `args`

### 4.6 tool_result

```json
{
  "event": "tool_result",
  "timestamp": "2026-04-11T07:00:04.947Z",
  "interactionId": "e-5a54eb01-4f09-45db-bf68-e1101ba376fd",
  "roundTrip": 1,
  "payload": {
    "toolName": "list_notebooks",
    "functionCallId": "adk-ec0ec6b4-4d38-487e-a0e1-004586d6d616",
    "durationMs": 1150,
    "resultKeys": ["status", "notebooks", "total", "truncated"]
  }
}
```

Payload keys: `toolName`, `functionCallId`, `durationMs`, `resultKeys`

**Note**: Full tool results are intentionally NOT logged. Only the top-level keys of the result object are recorded in `resultKeys`.

### 4.7 tool_error (not in sample, defined in types)

Expected payload keys: `toolName`, `functionCallId`, `error`

### 4.8 llm_error (not in sample, defined in types)

Expected payload keys: `errorCode`, `errorMessage`

### 4.9 interaction_end

```json
{
  "event": "interaction_end",
  "timestamp": "2026-04-11T07:00:21.736Z",
  "interactionId": "e-5a54eb01-4f09-45db-bf68-e1101ba376fd",
  "payload": {
    "roundTripCount": 2,
    "totalPromptTokens": 16711,
    "totalCompletionTokens": 4062,
    "totalTokens": 20773,
    "durationMs": 19068,
    "toolCalls": ["list_notebooks"]
  }
}
```

Payload keys: `roundTripCount`, `totalPromptTokens`, `totalCompletionTokens`, `totalTokens`, `durationMs`, `toolCalls`

**Note**: `toolCalls` is a string array of tool names (not `ToolCallRecord` objects).

---

## 5. Serialization Details (from proxy-serializer.ts)

The serializer handles ADK-specific hazards:
- **Non-serializable keys** are stripped: `abortSignal`, `httpOptions`, `liveConnectConfig`
- **Circular references** are replaced with `"[Circular]"`
- **Functions** are replaced with `"[Function]"`
- **BigInt** values are converted to strings
- **Truncation** at 50 KB per serialized field (configurable)
- `toolDeclarations` are only included on the first round trip of each interaction

---

## 6. Log Writing Details (from proxy-logger.ts)

- **Buffering**: Entries queued in memory, flushed every 500ms or when buffer exceeds 64 KB
- **Rotation**: New file created when current file exceeds `maxFileSize` (from ProxyConfig)
- **Append mode**: File opened with `'a'` flag -- always appends
- **File naming**: `proxy-<sessionId>-<timestamp>[.<index>].ndjson`
- **Directory creation**: `logDir` created recursively on first write

For the Electron inspector's file watcher (FR-2), this means:
- New lines appear in bursts (buffer flush) rather than one-at-a-time
- The inspector should watch for file changes and re-read from the last known byte offset
- File rotation creates a new file; the inspector does not need to follow rotation (single-file viewer)

---

## 7. Existing Electron Pattern (Gitter sibling project)

The Gitter project at `../gitter/` has an Electron UI with this structure:

```
gitter/src/ui/
  electron-main.cjs    # Electron main process (CommonJS required by Electron)
  server.ts            # Express server serving the HTML
  html.ts              # HTML template generation
```

Key patterns from `gitter/src/ui/electron-main.cjs`:
- **CommonJS** file (Electron main process does not support ESM)
- `BrowserWindow` with `nodeIntegration: false`, `contextIsolation: true`
- Window state persistence (position/size) to a JSON file
- Server URL passed via environment variable
- Minimal 91-line file

The Proxy Inspector should follow a similar architecture but can modernize:
- Use `electron-forge` or `electron-vite` for build tooling
- Use React for the renderer (consistent with the TUI's React/Ink pattern)
- Keep the main process as a small CJS file
- Use IPC for file operations (main process reads files, renderer displays)

---

## 8. Recommendations for Project Placement

### Directory Structure

```
NotebookLM-agent/
  proxy-inspector/               # New Electron app (NFR-3.1: own directory)
    package.json                 # Own dependencies (electron, react, vite, etc.)
    tsconfig.json
    electron.vite.config.ts      # Or equivalent build config
    src/
      main/                      # Electron main process
        main.ts                  # Window creation, file dialogs, IPC handlers
        file-watcher.ts          # fs.watch + incremental NDJSON parsing
      preload/
        preload.ts               # contextBridge for IPC
      renderer/                  # React app
        App.tsx                  # Root component
        components/              # InteractionList, EventTimeline, PayloadRenderers
        hooks/                   # useFileData, useFilter, useLiveTail
        types.ts                 # Re-export or copy of LogEntry, ProxyEventType
```

### Type Sharing Strategy

Per NFR-3.2, the inspector may import types from `notebooklm_agent/proxy/proxy-types.ts` at compile time. Two approaches:

1. **TypeScript path alias**: Configure `proxy-inspector/tsconfig.json` with a path alias pointing to `../notebooklm_agent/proxy/proxy-types.ts`. The types have zero runtime dependencies so this is safe.

2. **Copy types**: Duplicate the 5 interfaces and 1 type alias into `proxy-inspector/src/shared/log-types.ts`. Simpler but risks drift.

Recommendation: Use approach 1 (path alias) for development, with a note in the build config to resolve the import at compile time.

### Key Implementation Notes

- The NDJSON parser only needs to handle `LogEntry` -- one `JSON.parse()` per line
- Group events by `interactionId` (they are contiguous in the file)
- `llm_request` payloads can be 30+ KB; lazy-render with collapsible sections (NFR-1.3)
- `content` in `llm_response` is always a structured `{role, parts}` object (not a raw string) based on the actual log data
- `toolCalls` in `interaction_end` is a `string[]`, not an array of objects
- The sample log file (12 lines, 94 KB, 2 interactions) serves as the primary test fixture (Assumption 6 from refined request)
