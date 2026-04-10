# Issues - Pending Items

## Pending

### Medium Priority

1. **Configuration guide not yet created** -- The `docs/design/configuration-guide.md` document needs to be created per project conventions.

2. **Destructive tools rely on system prompt only for confirmation** -- TypeScript ADK's `LongRunningFunctionTool` constructor expects `ToolOptions` (raw config), not a `FunctionTool` instance. The delete tools (`delete_notebook`, `delete_source`, `delete_note`) currently rely solely on the system prompt instructing the LLM to confirm before executing. A future improvement would be to refactor the delete tools to export their options separately for `LongRunningFunctionTool` wrapping.

3. **`adk web` hardcodes `user_id` to "user"** -- All browser tabs share the same user identity. Session-scoped state (no prefix) isolates state per tab, so this is acceptable for development.

### Low Priority

4. **Studio creation commands lack `--json` output** -- Studio create commands (audio, video, report, etc.) return Rich-formatted text, not JSON. The tools return the raw text as a message. Use `studio_status` to get structured artifact information after creation.

5. **Research commands lack `--json` output** -- Same as studio create -- text output only.

6. **ESM/CJS `lodash-es` bug in `@google/adk`** -- A known issue where the CJS build incorrectly imports `lodash-es`. May need a pnpm patch if encountered in production. Not affecting development with `npx adk web`.

---

## Completed

### TypeScript Migration (2026-04-10)

1. **COMPLETED: Python-to-TypeScript migration** -- Full rewrite from Python (`google-adk` on PyPI) to TypeScript (`@google/adk` on npm). All 41 tools preserved, architecture unchanged.

2. **COMPLETED: Zod v4 compatibility** -- Updated from Zod v3 to v4 to match `@google/adk@0.6.1` peer dependency requirement. All schemas use Zod v4 syntax.

3. **COMPLETED: `ToolContext` -> `Context` fix** -- TypeScript ADK exports `Context` not `ToolContext`. Fixed all tool files.

4. **COMPLETED: `.env` loading from agent directory** -- Configured `dotenv` to load `.env` from the agent directory rather than CWD.

5. **COMPLETED: Unit tests (47 tests, all passing)** -- Config, parsers, nlm-runner, and notebook-tools test suites.

### Code Review Fixes (2026-04-10, Python era)

6. **FIXED: `query_notebook` session state fallback** -- Added session state fallback for conversation_id.
7. **FIXED: Timeout mismatches** -- Corrected 6 timeout values to match design specification.
8. **FIXED: `create_infographic` docstring options** -- Corrected orientation and detail options.
