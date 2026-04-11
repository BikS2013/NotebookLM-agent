# Codebase Scan: Terminal UI Integration

**Date:** 2026-04-11
**Purpose:** Analysis of existing codebase to guide TUI implementation.

---

## 1. Project Overview

| Attribute | Value |
|-----------|-------|
| Language | TypeScript (strict mode) |
| Module system | ES modules (`"type": "module"`, `"module": "NodeNext"`) |
| Framework | Google ADK (`@google/adk` ^0.6.1) |
| Build | `tsc --noEmit` (type-checking only; runtime via `npx tsx`) |
| Test framework | Vitest (tests in `test_scripts/*.test.ts`) |
| Runtime | Node.js (tsx for dev) |
| Package manager | npm |

### Directory Layout

```
NotebookLM-agent/
  package.json              # Root package; scripts: web, run, build, test
  tsconfig.json             # Target ES2022, NodeNext modules, strict
  vitest.config.ts          # Test config: test_scripts/**/*.test.ts
  .env                      # Environment variables (loaded by ADK devtools)
  notebooklm_agent/
    package.json            # Sub-package: name=notebooklm_agent, main=agent.ts
    agent.ts                # Entry point; exports rootAgent (LlmAgent)
    config.ts               # Configuration singleton; all env vars required, no defaults
    tools/
      index.ts              # Barrel re-export of all tools
      nlm-runner.ts         # Core CLI executor (execFileSync wrapper)
      notebook-tools.ts     # FunctionTool instances for notebook CRUD
      source-tools.ts       # Source management tools
      query-tools.ts        # Query tool
      studio-tools.ts       # Studio content generation tools
      download-tools.ts     # Artifact download
      sharing-tools.ts      # Sharing tools
      research-tools.ts     # Research tools
      alias-tools.ts        # Alias management
      note-tools.ts         # Note CRUD
      auth-tools.ts         # Authentication check
      youtube-tools.ts      # YouTube search/info/transcript tools
      youtube-client.ts     # HTTP client for YouTube Data API v3
      filesystem-tools.ts   # Local filesystem CRUD tools
      parsers.ts            # Shared parsing utilities
  test_scripts/             # All tests (vitest, *.test.ts)
  docs/
    design/                 # Plans, project design, project functions
    reference/              # Research docs, refined requests
    research/               # ADK API research, session state docs
```

---

## 2. Module Map

### Entry Points

| File | Role |
|------|------|
| `notebooklm_agent/agent.ts` | ADK agent entry point. Exports `rootAgent` (an `LlmAgent` instance). Currently consumed by `npx adk web` and `npx adk run`. |
| `package.json` scripts | `"web": "npx adk web"`, `"run": "npx adk run notebooklm_agent"` |

### Core Modules

| Module | Responsibility | Key Exports |
|--------|---------------|-------------|
| `agent.ts` | Defines the `rootAgent` LlmAgent with system prompt (dynamic via `buildInstruction`), model config, and tool registration. | `rootAgent` |
| `config.ts` | Loads 5 required env vars into a frozen singleton. Throws on missing vars. | `getConfig(): AgentConfig`, `resetConfig()` (test helper) |
| `tools/index.ts` | Barrel re-export of all 43 FunctionTool instances across 14 tool files. | Individual named tool exports |
| `tools/nlm-runner.ts` | Synchronous CLI executor (`execFileSync`) for the `nlm` binary. Classifies errors into typed results (`NlmResult`). | `runNlm()`, `NlmResult`, `NlmStatus`, timeout constants |
| `tools/youtube-client.ts` | Async HTTP client for YouTube Data API v3 with error classification and URL parsing. | `youtubeSearchVideos()`, `youtubeGetVideos()`, `resolveChannelId()`, `extractVideoId()` |

### Configuration (`AgentConfig` interface)

```typescript
interface AgentConfig {
  readonly googleGenaiApiKey: string;   // GOOGLE_GENAI_API_KEY
  readonly nlmCliPath: string;          // NLM_CLI_PATH
  readonly geminiModel: string;         // GEMINI_MODEL
  readonly nlmDownloadDir: string;      // NLM_DOWNLOAD_DIR
  readonly youtubeApiKey: string;       // YOUTUBE_API_KEY
}
```

All loaded via `requireEnv()` -- no defaults, throws on missing.

---

## 3. Conventions

### Coding Patterns

- **Tool pattern:** Each tool file exports one or more `FunctionTool` instances. Schema defined with Zod (`z.object()`), execute function is async, returns `Record<string, unknown>` with a `status` field.
- **State access:** Tools receive `context?: Context` as second parameter, use `context.state.set()` / `.get()` for session state.
- **Error handling:** `NlmResult` union type (`success | auth_error | not_found | rate_limit | timeout | config_error | error`). Tools return the raw result on non-success.
- **Naming:** Tool names use `snake_case` (e.g., `list_notebooks`). TypeScript variables use `camelCase`. Files use `kebab-case`.
- **Imports:** All use `.ts` extension in import paths (enabled by `allowImportingTsExtensions`).
- **No fallbacks:** Configuration strictly enforced -- missing env vars throw, never substituted.

### Testing Patterns

- **Framework:** Vitest with `describe/it/expect` from `vitest`.
- **Location:** `test_scripts/*.test.ts` (not co-located with source).
- **Mocking:** `beforeEach`/`afterEach` for env var manipulation; `resetConfig()` helper for singleton reset; `restoreMocks: true` in vitest config.
- **Style:** Direct function import from source files using `.ts` extensions.

### System Prompt

The agent's system prompt is dynamically constructed via `buildInstruction(ctx: ReadonlyContext): string`. It injects session state (`current_notebook_id`, `current_notebook_title`, `last_conversation_id`) into the prompt at runtime. This function is passed as the `instruction` property to `LlmAgent`.

---

## 4. Integration Points for the TUI

### ADK Programmatic Runner API

The TUI must use `InMemoryRunner` from `@google/adk` to run the agent programmatically. The existing codebase already documents this pattern in `docs/research/adk-typescript-api.md` (lines 486-511):

```typescript
import { InMemoryRunner } from '@google/adk';
import { createUserContent, stringifyContent } from '@google/genai';

const runner = new InMemoryRunner({ agent: rootAgent });
const session = await runner.sessionService.createSession({
  appName: runner.appName,
  userId: 'user-123',
});

for await (const event of runner.runAsync({
  userId: session.userId,
  sessionId: session.id,
  newMessage: createUserContent('user message here'),
})) {
  if (event.content?.parts?.length) {
    console.log(stringifyContent(event));
  }
}
```

Key observations:
- **`rootAgent`** can be directly imported from `notebooklm_agent/agent.ts`.
- **`InMemoryRunner`** wraps the agent and provides `runAsync()` which yields async-iterable events (streaming).
- **Events** have `.content?.parts` for text and likely have tool-call information for tool call visibility (FR-5).
- **Session** is created via `runner.sessionService.createSession()`.
- **`createUserContent()`** and **`stringifyContent()`** come from `@google/genai`.

### Files the TUI Must Import

| Import | From | Purpose |
|--------|------|---------|
| `rootAgent` | `./notebooklm_agent/agent.ts` | The agent instance to wrap with InMemoryRunner |
| `getConfig` | `./notebooklm_agent/config.ts` | To validate config is present at startup (env vars) |
| `InMemoryRunner` | `@google/adk` | Programmatic runner |
| `createUserContent`, `stringifyContent` | `@google/genai` | Message creation and stringification |
| `dotenv/config` | `dotenv` | To load `.env` (ADK devtools does this automatically for `adk web`/`adk run`, but the TUI must do it manually) |

### Files That May Need Modification

| File | Change | Reason |
|------|--------|--------|
| `package.json` | Add `"tui"` script (e.g., `"tui": "npx tsx notebooklm_agent/tui.ts"`) | New entry point per constraint C-5 |
| `package.json` | Possibly add TUI library dependency (e.g., `blessed`, `ink`, `terminal-kit`) | UI rendering |

### Files That Should NOT Be Modified

- `agent.ts` -- The agent definition is self-contained and the TUI is purely a new frontend.
- `config.ts` -- The TUI reuses the same config. No new env vars needed unless the TUI has its own settings.
- `tools/*` -- Tool implementations remain unchanged.

### New File(s) to Create

| File | Purpose |
|------|---------|
| `notebooklm_agent/tui.ts` | Main TUI entry point (or a `tui/` subdirectory if the TUI has multiple modules) |

### Critical Implementation Notes

1. **dotenv loading:** The ADK devtools auto-load `.env`, but a standalone TUI entry point must call `import 'dotenv/config'` before importing `agent.ts` (which calls `getConfig()` at module-level).

2. **Synchronous tool execution:** Many tools use `execFileSync` (nlm-runner.ts) which blocks the Node.js event loop. The TUI must handle this -- either run the agent in a worker thread, or accept that the UI freezes during tool calls. The async `for await` loop in `runner.runAsync()` should handle this at the ADK level, but the underlying `execFileSync` calls in tools could still block.

3. **Event stream structure:** The TUI needs to inspect events from `runner.runAsync()` to distinguish:
   - Text response parts (agent speaking)
   - Tool call events (for showing "Calling search_youtube..." indicators)
   - Tool result events (for showing results)
   The exact event shape needs investigation against `@google/adk` source or typings.

4. **Config validation at startup:** `getConfig()` is called at module-load time in `agent.ts` (line 77). If any env var is missing, the import itself will throw. The TUI should catch this and display a helpful error.

5. **Session state:** The agent uses session state for `current_notebook_id`, `current_notebook_title`, and `last_conversation_id`. The `InMemoryRunner`'s session service maintains this automatically across turns within a session.

---

## 5. Dependency Summary

### Current Dependencies

| Package | Version | Role |
|---------|---------|------|
| `@google/adk` | ^0.6.1 | Agent framework |
| `dotenv` | ^16.4.7 | Env var loading |
| `youtube-transcript-plus` | ^2.0.0 | YouTube transcript fetching |
| `zod` | ^4.3.6 | Parameter schema validation |

### Dev Dependencies

| Package | Version | Role |
|---------|---------|------|
| `@google/adk-devtools` | ^0.2.1 | `adk web` / `adk run` commands |
| `@types/node` | ^22.0.0 | Node.js type definitions |
| `tsx` | ^4.21.0 | TypeScript execution |
| `typescript` | ^5.7.0 | Type checking |
| `vitest` | ^3.0.0 | Testing |

### New Dependencies Needed

The TUI will require a terminal UI library. This is an open question (OQ-2 in the refined request). No terminal UI dependency exists in the project currently.
