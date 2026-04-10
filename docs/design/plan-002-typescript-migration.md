# Plan 002: TypeScript Migration

**Version**: 1.0
**Date**: 2026-04-10
**Status**: Active
**Depends on**: plan-001 (architecture), investigation, research

---

## Overview

Migrate the Google ADK NotebookLM agent from Python (`google-adk` on PyPI) to TypeScript (`@google/adk` on npm). The architecture, 41 tools, system prompt, and all design decisions remain identical. Only the language and SDK idioms change.

## Key Differences: Python -> TypeScript

| Aspect | Python | TypeScript |
|--------|--------|------------|
| Package | `google-adk` (PyPI) | `@google/adk` (npm) |
| Entry point | `__init__.py` + `root_agent` | `agent.ts` + `rootAgent` |
| Tool definition | Plain function + docstring | `new FunctionTool({ name, description, parameters: z.object(), execute })` |
| Parameter schema | Type hints + docstring | Zod schemas with `.describe()` |
| Session state | `tool_context.state["key"] = value` | `context.state.set("key", value)` |
| Subprocess | `subprocess.run()` | `child_process.execFileSync()` |
| Config | `os.environ` | `process.env` |
| Env var name | `GOOGLE_API_KEY` | `GOOGLE_GENAI_API_KEY` |
| Destructive guard | `FunctionTool(require_confirmation=True)` | `new LongRunningFunctionTool(...)` |
| Dev UI | `adk web` | `npx adk web` |

## Project Structure

```
108 - Google ADK/
  package.json                    # npm project with @google/adk, zod
  tsconfig.json                   # TypeScript config
  notebooklm_agent/               # agent directory (adk web discovers this)
    agent.ts                      # exports rootAgent
    config.ts                     # strict env var loading
    .env                          # environment variables
    .env.example                  # template
    tools/
      nlm-runner.ts               # runNlm() helper + error classification
      parsers.ts                  # JSON parsing utilities
      auth-tools.ts               # check_auth
      notebook-tools.ts           # 6 notebook tools
      source-tools.ts             # 7 source tools
      query-tools.ts              # query_notebook
      studio-tools.ts             # 10 studio tools
      download-tools.ts           # download_artifact
      sharing-tools.ts            # 4 sharing tools
      research-tools.ts           # 3 research tools
      alias-tools.ts              # 4 alias tools
      note-tools.ts               # 4 note tools
      index.ts                    # barrel export
  test_scripts/                   # unit tests
  docs/                           # unchanged
```

## Implementation Phases

### Phase 1: Scaffold + Core Infrastructure
- Delete Python: `src/`, `pyproject.toml`, `.python-version`, `.venv/`
- Create `package.json`, `tsconfig.json`
- Install: `@google/adk`, `@google/adk-devtools`, `zod`, `dotenv`
- Create `config.ts`, `nlm-runner.ts`, `parsers.ts`
- Create `.env` from existing values

### Phase 2: All 41 Tools (parallel agents)
- Agent A: auth + notebooks + sources + query tools (15 tools)
- Agent B: studio + download + sharing + research + alias + note tools (26 tools)

### Phase 3: Agent Definition + Wiring
- Create `agent.ts` with rootAgent, system prompt, all tools registered
- Destructive ops use `LongRunningFunctionTool`
- Verify with `npx adk web`

### Phase 4: Tests + Verification
- Unit tests with mocked child_process
- Build verification with `npx tsc --noEmit`
- Agent load verification
