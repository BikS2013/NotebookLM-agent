# Codebase Scan: LLM Proxy Plugin Integration

**Date**: 2026-04-11  
**Purpose**: Map the existing codebase to identify integration points, patterns, and constraints for the LLM proxy plugin.

---

## 1. Project Overview

| Attribute | Value |
|-----------|-------|
| Language | TypeScript (strict mode, ES2022 target) |
| Module system | ESM (`"type": "module"`, NodeNext resolution) |
| Framework | Google ADK `@google/adk ^0.6.1` |
| UI layers | Ink 7 (React for CLI) TUI + readline-based CLI |
| Build | `tsc --noEmit` (type-check only; executed via `tsx` at runtime) |
| Test framework | Vitest (`test_scripts/**/*.test.ts`) |
| Package manager | npm |
| JSX | `react-jsx` (jsxImportSource: react) |

### Directory Layout

```
NotebookLM-agent/
  notebooklm_agent/
    agent.ts                  # Agent definition (rootAgent export)
    config.ts                 # Configuration singleton (requireEnv pattern)
    cli.ts                    # Readline-based CLI entry point
    tui.ts                    # Ink/React TUI entry point
    tools/                    # 14 tool files + barrel index.ts
      index.ts                # Barrel re-export of all 48 tools
      nlm-runner.ts           # nlm CLI subprocess wrapper
      youtube-client.ts       # YouTube API HTTP client
      parsers.ts              # Shared text truncation helpers
      filesystem-tools.ts     # File/folder CRUD tools
      notebook-tools.ts, source-tools.ts, ...
    tui/
      index.tsx               # App root component
      types.ts                # Shared types (Message, AgentStatus, ToolCallInfo)
      hooks/
        useAgent.ts           # InMemoryRunner wrapper (main integration point)
        useTextEditor.ts      # Text buffer state management
        useKeyHandler.ts      # Keyboard shortcut resolution
        useInputHistory.ts    # Input recall (up/down arrow)
        useScrollManager.ts   # Chat scroll state
      lib/
        format-commands.ts    # Pure formatters for /history, /memory, /last
        text-buffer.ts        # Immutable text buffer operations
        word-boundaries.ts, kill-ring.ts, undo-stack.ts, edit-actions.ts
      components/
        ChatHistory.tsx, InputArea.tsx, MessageBubble.tsx, StatusBar.tsx, ToolCallIndicator.tsx
      worker/
        agent-protocol.ts     # Worker message protocol types (unused, future)
  test_scripts/               # All tests (vitest)
  docs/                       # Design docs, plans, reference material
  package.json, tsconfig.json, vitest.config.ts
```

---

## 2. Module Map

### Entry Points

| Entry point | npm script | File | Description |
|------------|-----------|------|-------------|
| ADK web/run | `npm run web` / `npm run run` | `notebooklm_agent/agent.ts` | Exports `rootAgent` for ADK discovery |
| TUI | `npm run tui` | `notebooklm_agent/tui.ts` | Ink render, dotenv loading |
| CLI | `npm run cli` | `notebooklm_agent/cli.ts` | readline loop, dotenv loading |

### Agent Definition (`agent.ts`)

- Exports `rootAgent` as a `LlmAgent` instance
- Uses `getConfig().geminiModel` for the model name
- 48 `FunctionTool` instances registered via the `tools` array
- `instruction` is a function (`buildInstruction`) that reads from `ReadonlyContext.state` for dynamic system prompt injection
- **No plugins are used anywhere in the project currently**

### Configuration (`config.ts`)

- Singleton pattern with `getConfig()` returning a frozen `AgentConfig` object
- `requireEnv(name)` throws if env var is missing (no fallbacks)
- Current env vars: `GOOGLE_GENAI_API_KEY`, `NLM_CLI_PATH`, `GEMINI_MODEL`, `NLM_DOWNLOAD_DIR`, `YOUTUBE_API_KEY`
- `resetConfig()` exposed for testing

### Runner Instantiation

**TUI** (`tui/hooks/useAgent.ts`, line 88):
```typescript
const runner = new InMemoryRunner({
  agent: rootAgent,
  appName: 'notebooklm-tui',
});
```

**CLI** (`cli.ts`, line 68):
```typescript
const runner = new InMemoryRunner({ agent: rootAgent, appName });
```

Both instantiate `InMemoryRunner` with only `agent` and `appName`. Neither passes a `plugins` array.

### Slash Commands

Both TUI and CLI support: `/history`, `/memory` (`/state`), `/new` (`/reset`), `/last` (`/raw`), `/quit` (`/exit`).

- TUI handles commands in `tui/index.tsx` `handleSubmit` callback (lines 69-168)
- CLI handles commands in the `rl.on('line')` handler (lines 88-179)
- Format functions are shared via `tui/lib/format-commands.ts` (`formatHistory`, `formatSessionState`, `formatLastExchange`)

### Event Stream Processing

Both TUI and CLI use the same pattern:
```typescript
const gen = runner.runAsync({
  userId, sessionId,
  newMessage: createUserContent(text),
  runConfig: { streamingMode: StreamingMode.SSE },
});
for await (const event of gen) {
  const structuredEvents = toStructuredEvents(event);
  for (const se of structuredEvents) { /* switch on se.type */ }
}
```

Event types handled: `CONTENT`, `TOOL_CALL`, `TOOL_RESULT`, `ERROR`, `FINISHED`, `THOUGHT` (ignored), `TOOL_CONFIRMATION` (not implemented).

---

## 3. Conventions

### Coding Style

- **Naming**: camelCase for variables/functions, PascalCase for types/interfaces/components
- **Error handling**: try/catch with `err instanceof Error ? err.message : String(err)` pattern
- **Imports**: explicit `.ts`/`.tsx` extensions on all local imports; `node:` prefix for Node.js built-ins
- **Tool pattern**: Zod schema for parameters, `FunctionTool` constructor with `{ name, description, parameters, execute }`, return `{ status: 'success'|'error', ... }`
- **No classes** in application code (only ADK classes like `FunctionTool`, `LlmAgent`). Functional/hook-based throughout.
- **No logging library** in use. Console output uses raw `process.stdout.write` and `console.log` with ANSI escape codes.

### Configuration Approach

- All config via environment variables, loaded from `.env` by `dotenv/config`
- Strict no-fallback policy: missing required env vars throw immediately
- Config is validated once at startup via `getConfig()` singleton

### Testing Setup

- Vitest with `environment: 'node'`, `restoreMocks: true`
- Tests in `test_scripts/` with `*.test.ts` naming
- Pattern: import module directly, call functions, assert with `expect`
- For tool tests: `callTool(tool, args)` helper that calls `tool.execute(args)`
- Temp directories created in `beforeEach`, cleaned in `afterEach`/`afterAll`

### Import/Export Conventions

- Barrel exports from `tools/index.ts`
- Named exports everywhere (no default exports except React components)
- Types imported with `import type { ... }` where possible
- ADK types imported from `@google/adk` and `@google/genai`

---

## 4. Integration Points

### 4.1 Where the Plugin Connects

The `InMemoryRunner` constructor accepts an optional `plugins: BasePlugin[]` parameter. The plugin must be injected at runner creation time in two places:

| File | Location | Current Code |
|------|----------|-------------|
| `notebooklm_agent/tui/hooks/useAgent.ts` | Line 88 | `new InMemoryRunner({ agent: rootAgent, appName: 'notebooklm-tui' })` |
| `notebooklm_agent/cli.ts` | Line 68 | `new InMemoryRunner({ agent: rootAgent, appName })` |

Both need: conditionally construct the proxy plugin, then pass `plugins: [proxyPlugin]` to the runner.

### 4.2 ADK BasePlugin API (from `@google/adk ^0.6.1`)

The `BasePlugin` abstract class provides these callbacks relevant to the proxy:

| Callback | Params | Return | Purpose for proxy |
|----------|--------|--------|-------------------|
| `beforeModelCallback` | `{ callbackContext: Context, llmRequest: LlmRequest }` | `LlmResponse \| undefined` | Capture full request (contents, config, tools, model) |
| `afterModelCallback` | `{ callbackContext: Context, llmResponse: LlmResponse }` | `LlmResponse \| undefined` | Capture full response (content, usage, finish reason) |
| `beforeToolCallback` | `{ tool: BaseTool, toolArgs: Record<string,unknown>, toolContext: Context }` | `Record<string,unknown> \| undefined` | Capture tool invocation |
| `afterToolCallback` | `{ tool, toolArgs, toolContext, result }` | `Record<string,unknown> \| undefined` | Capture tool result |
| `onModelErrorCallback` | `{ callbackContext, llmRequest, error: Error }` | `LlmResponse \| undefined` | Capture LLM errors |
| `beforeRunCallback` | `{ invocationContext: InvocationContext }` | `Content \| undefined` | Start interaction tracking |
| `afterRunCallback` | `{ invocationContext: InvocationContext }` | `void` | Finalize interaction, flush logs |

All callbacks must return `undefined` for the proxy to be purely observational.

### 4.3 LlmRequest / LlmResponse Shapes

**`LlmRequest`** (from `@google/adk`):
- `model?: string` -- model name
- `contents: Content[]` -- conversation history
- `config?: GenerateContentConfig` -- includes `systemInstruction`, `tools`, temperature, safety, etc.
- `toolsDict: { [key: string]: BaseTool }` -- tool instances (non-serializable, need names only)

**`LlmResponse`** (from `@google/adk`):
- `content?: Content` -- response content (text parts, function call parts)
- `usageMetadata?: GenerateContentResponseUsageMetadata` -- token counts
- `finishReason?: FinishReason`
- `groundingMetadata?: GroundingMetadata`
- `errorCode?: string`, `errorMessage?: string`
- `partial?: boolean`, `turnComplete?: boolean` -- streaming flags

### 4.4 Slash Command Integration

The `/inspect` command must be added in two places, following existing patterns:

**TUI** (`tui/index.tsx`): Add a block in `handleSubmit` after the `/last` handler (around line 158). Pattern: check `command === '/inspect' || command === '/proxy'`, call proxy buffer, format output, call `agent.addSystemMessage(output)`.

**CLI** (`cli.ts`): Add a block in the `rl.on('line')` handler after the `/last` handler (around line 165). Pattern: check command, format output, call `printSystem(output)`.

### 4.5 Format Commands Extension

Add a `formatInspect()` function to `tui/lib/format-commands.ts` (or a new `proxy/format-inspect.ts` module) to format the proxy buffer data as a readable string. This follows the existing pattern of `formatHistory`, `formatSessionState`, `formatLastExchange`.

### 4.6 New Files (Recommended Structure)

```
notebooklm_agent/
  proxy/
    llm-proxy-plugin.ts      # BasePlugin subclass (core logic)
    proxy-types.ts            # Interaction, RoundTrip, LogEntry types
    proxy-logger.ts           # NDJSON file writer (async, rotation)
    proxy-buffer.ts           # In-memory circular buffer
    proxy-factory.ts          # Conditional instantiation based on env vars
    format-inspect.ts         # /inspect command formatter
test_scripts/
  test-llm-proxy.test.ts     # Plugin behavior tests
  test-proxy-logger.test.ts  # File I/O tests
  test-proxy-buffer.test.ts  # Circular buffer tests
```

### 4.7 Configuration Integration

New env vars (`LLM_PROXY_ENABLED`, `LLM_PROXY_LOG_DIR`, etc.) should NOT be added to the existing `config.ts` `AgentConfig` interface, because:
1. The proxy is optional and its config should not cause startup failures when disabled
2. The proxy config has different lifecycle (checked only when enabled)

Instead, create a separate `proxy/proxy-config.ts` with its own validation, following the same `requireEnv` pattern for `LLM_PROXY_LOG_DIR` when the proxy is enabled. The default-value exceptions for `LLM_PROXY_BUFFER_SIZE` and `LLM_PROXY_MAX_FILE_SIZE` must be recorded in the project memory file before implementation.

### 4.8 Files That Will Be Modified

| File | Change |
|------|--------|
| `notebooklm_agent/tui/hooks/useAgent.ts` | Add optional `plugins` param to `InMemoryRunner` constructor; expose proxy ref |
| `notebooklm_agent/cli.ts` | Add optional `plugins` param to `InMemoryRunner` constructor |
| `notebooklm_agent/tui/index.tsx` | Add `/inspect` slash command handler |
| `notebooklm_agent/.env.example` | Add proxy env var documentation |
| `CLAUDE.md` | Add LlmProxy tool documentation |
| `Issues - Pending Items.md` | Record fallback-value exception for proxy config |

### 4.9 Files That Must NOT Be Modified

| File | Reason |
|------|--------|
| `notebooklm_agent/agent.ts` | Explicitly out of scope per refined request |
| `notebooklm_agent/config.ts` | Proxy config is separate; core config must not fail when proxy vars are absent |
| `notebooklm_agent/tools/*` | Tools are not affected by the proxy |

---

## 5. Key Observations

1. **No existing plugin usage**: The project has never used ADK plugins. The `BasePlugin` import and `plugins` constructor param will be new additions.

2. **Streaming mode is SSE**: Both TUI and CLI use `StreamingMode.SSE`, which means `afterModelCallback` may fire multiple times per round trip with `partial: true` responses. The proxy must accumulate partials.

3. **Two independent runner instances**: TUI and CLI each create their own `InMemoryRunner`. The proxy factory must be callable from both without shared state issues.

4. **No external logging**: The project uses no logging library. The proxy's NDJSON writer will be the first structured logging in the project.

5. **Serialization concern**: `LlmRequest.toolsDict` contains `BaseTool` instances (non-serializable). The proxy must extract tool names rather than serializing the full objects. `LlmRequest.config` may contain `Content` objects with complex nesting.

6. **ADK version**: `@google/adk ^0.6.1` confirmed to have `BasePlugin` with all required callbacks including `beforeModelCallback`, `afterModelCallback`, `beforeToolCallback`, `afterToolCallback`, `onModelErrorCallback`, `beforeRunCallback`, and `afterRunCallback`.
