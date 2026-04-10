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

### Filesystem Tools Review (2026-04-10)

15. **FIXED: `createFileTool` overwrite message always said "File overwritten"** -- The `message` field in `createFileTool` checked `fs.existsSync(resolved)` after the file was already written, so it always returned true. Fixed to capture `existed` before writing.

16. **ADDED: CLAUDE.md FilesystemTools documentation** -- Added `<FilesystemTools>` section documenting all 7 tools.

17. **ADDED: `project-functions.md` Filesystem FRs** -- Added FR-FS-01 through FR-FS-07 documenting functional requirements for all 7 filesystem tools.

18. **ADDED: Filesystem tools unit tests** -- `test-filesystem-tools.test.ts` (25 tests) covers all 7 tools with real filesystem operations in temp directories.

### TypeScript Migration (2026-04-10)

1. **COMPLETED: Python-to-TypeScript migration** -- Full rewrite from Python (`google-adk` on PyPI) to TypeScript (`@google/adk` on npm). All 41 tools preserved, architecture unchanged.

2. **COMPLETED: Zod v4 compatibility** -- Updated from Zod v3 to v4 to match `@google/adk@0.6.1` peer dependency requirement. All schemas use Zod v4 syntax.

3. **COMPLETED: `ToolContext` -> `Context` fix** -- TypeScript ADK exports `Context` not `ToolContext`. Fixed all tool files.

4. **COMPLETED: `.env` loading from agent directory** -- Configured `dotenv` to load `.env` from the agent directory rather than CWD.

5. **COMPLETED: Unit tests (94 tests, all passing)** -- Config, parsers, nlm-runner, notebook-tools, youtube-client, and youtube-tools test suites.

### YouTube Unit Tests (2026-04-10)

9. **COMPLETED: YouTube unit tests created** -- `test-youtube-client.test.ts` (24 tests) covers `extractVideoId` with 16 URL formats and edge cases, and `parseDuration` with 8 ISO 8601 patterns. `test-youtube-tools.test.ts` (23 tests) covers all 5 FunctionTool execute functions with mocked API responses, including error cases.

10. **FIXED: `test-config.test.ts` missing `YOUTUBE_API_KEY`** -- The config test's `setAllEnvVars()` helper did not include `YOUTUBE_API_KEY` after it was added to the config, causing 3 test failures. Added the env var to setup and cleanup, plus an assertion for the new field.

### YouTube Code Review (2026-04-10)

11. **FIXED: `test-youtube-tools.test.ts` compilation errors** -- All 23 test cases accessed `FunctionTool.execute` directly, which is private in `@google/adk` type definitions. Fixed by routing all calls through a `callTool(tool, args)` helper that casts via `any`, matching the pattern used in `test-notebook-tools.test.ts`.

12. **FIXED: `.env.example` missing `YOUTUBE_API_KEY`** -- Added the `YOUTUBE_API_KEY` entry with documentation per design section 10.3.4.

13. **ADDED: CLAUDE.md YouTube tool documentation** -- Added `<YouTubeTools>` section documenting all 5 tools and the supporting `youtube-client.ts` module.

14. **ADDED: `project-functions.md` YouTube FRs** -- Added FR-YT-01 through FR-YT-05 documenting functional requirements for all 5 YouTube tools.

### Code Review Fixes (2026-04-10, Python era)

6. **FIXED: `query_notebook` session state fallback** -- Added session state fallback for conversation_id.
7. **FIXED: Timeout mismatches** -- Corrected 6 timeout values to match design specification.
8. **FIXED: `create_infographic` docstring options** -- Corrected orientation and detail options.
