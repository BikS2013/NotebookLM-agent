# Codebase Scan: YouTube Tools Integration

**Date**: 2026-04-10
**Purpose**: Identify integration points and conventions for adding YouTube tools

---

## 1. Project Overview

- **Language**: TypeScript (ESM, `"type": "module"`)
- **Framework**: `@google/adk` v0.6.1 (Google Agent Development Kit)
- **Build**: `tsc --noEmit` (type-checking only, no emit — ADK uses tsx at runtime)
- **Test**: `vitest` v3
- **Package Manager**: npm (package-lock.json present)
- **Schema Validation**: Zod v4.3.6

## 2. Directory Layout

```
NotebookLM-agent/
├── notebooklm_agent/
│   ├── agent.ts          # LlmAgent definition, system prompt, tool registration
│   ├── config.ts         # AgentConfig interface, requireEnv(), getConfig()
│   └── tools/
│       ├── index.ts      # Barrel export of all tool instances
│       ├── nlm-runner.ts # CLI subprocess runner (runNlm, error classification)
│       ├── parsers.ts    # Normalize/truncate utilities
│       ├── auth-tools.ts
│       ├── notebook-tools.ts
│       ├── source-tools.ts
│       ├── query-tools.ts
│       ├── studio-tools.ts
│       ├── download-tools.ts
│       ├── sharing-tools.ts
│       ├── alias-tools.ts
│       ├── research-tools.ts
│       └── note-tools.ts
├── test_scripts/
│   ├── test-config.test.ts
│   ├── test-nlm-runner.test.ts
│   ├── test-notebook-tools.test.ts
│   └── test-parsers.test.ts
├── docs/design/
│   ├── project-design.md
│   ├── project-functions.md
│   ├── plan-001-adk-nlm-agent.md
│   └── plan-002-typescript-migration.md
├── docs/reference/
│   ├── refined-request.md
│   └── investigation-adk-nlm-agent.md
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── CLAUDE.md
└── Issues - Pending Items.md
```

## 3. Key Patterns

### 3.1 Tool Pattern (source-tools.ts as exemplar)

Each tool file follows this pattern:
1. Import `FunctionTool` from `@google/adk`, `z` from `zod`
2. Import helpers from `nlm-runner.ts` and `parsers.ts`
3. Define a Zod schema for parameters
4. Export a `const xxxTool = new FunctionTool({...})` with:
   - `name`: snake_case
   - `description`: concise string for LLM
   - `parameters`: Zod schema
   - `execute`: async function taking typed params, returning plain object with `status` field

### 3.2 Config Pattern

- `AgentConfig` interface with readonly fields
- `requireEnv(name)` throws `Error` if env var is missing
- `getConfig()` returns frozen singleton
- `resetConfig()` for testing

### 3.3 Runner Pattern (nlm-runner.ts)

- `runNlm(args, timeout)` — synchronous subprocess via `execFileSync`
- Returns `NlmResult` with `status`, `data`/`output`, `error`, `action`, `hint`
- Error classification into: success, auth_error, not_found, rate_limit, timeout, config_error, error

### 3.4 Agent Registration (agent.ts)

- Imports all tools from `tools/index.ts`
- `buildInstruction(ctx: ReadonlyContext): string` — dynamic system prompt with session state
- `rootAgent = new LlmAgent({...tools: [...]})` — flat tool array

## 4. Integration Points for YouTube Tools

### 4.1 New Files Needed

| File | Role |
|------|------|
| `notebooklm_agent/tools/youtube-client.ts` | YouTube API HTTP client (analogous to nlm-runner.ts) |
| `notebooklm_agent/tools/youtube-tools.ts` | 5 FunctionTool definitions |
| `test_scripts/test-youtube-tools.test.ts` | Unit tests |
| `test_scripts/test-youtube-client.test.ts` | Unit tests for client/parser |

### 4.2 Files to Modify

| File | Change |
|------|--------|
| `config.ts` | Add `youtubeApiKey: string` to AgentConfig, add `requireEnv('YOUTUBE_API_KEY')` |
| `tools/index.ts` | Add YouTube exports section |
| `agent.ts` | Import YouTube tools, add to tools array, add YouTube section to system prompt |
| `package.json` | Add `youtube-transcript` dependency |
| `parsers.ts` | Potentially add YouTube-specific normalizers (or keep them in youtube-client.ts) |

### 4.3 Patterns to Follow

- Use `FunctionTool` constructor with Zod schema, not function wrapping
- Return `{ status: 'success' | 'error' | ... }` objects consistently
- Use `truncateText()` and `truncateList()` from `parsers.ts` for output limiting
- Never throw from execute functions — catch all errors
- Use built-in `fetch()` for HTTP (no axios)
- Error classification should map to same status categories as NlmResult

### 4.4 Key Difference from Existing Tools

Existing tools use `runNlm()` (subprocess). YouTube tools use HTTP `fetch()`. This means:
- `youtube-client.ts` replaces `nlm-runner.ts` as the infrastructure layer
- The client should export a `youtubeApiFetch()` function analogous to `runNlm()`
- Error classification logic should produce compatible status values
