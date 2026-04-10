# Project Functions: ADK NLM Agent

**Version**: 1.0
**Date**: 2026-04-10
**Source**: Refined request (refined-request.md)

---

## Functional Requirements

### FR-1: Authentication Verification

The agent must verify that `nlm` authentication is active before performing operations. If authentication has expired, the agent must instruct the user to run `nlm login` manually (since browser-based auth cannot be automated by the agent).

**Tool**: `check_auth()`
**NLM Command**: `nlm login --check`

---

### FR-2: Notebook Management

The agent must support:
- Listing all notebooks (with JSON parsing for structured reasoning, truncated at 50 items)
- Getting details of a specific notebook (ID, title, source count, URL, sources list)
- Creating new notebooks (and tracking the new notebook as "current" in session state)
- Renaming notebooks
- Deleting notebooks (with explicit user confirmation before execution)
- Describing notebooks (AI-generated summary with suggested topics)

**Tools**: `list_notebooks`, `get_notebook`, `create_notebook`, `rename_notebook`, `delete_notebook`, `describe_notebook`
**NLM Commands**: `nlm notebook list/get/create/rename/delete/describe`

---

### FR-3: Source Management

The agent must support:
- Adding sources by URL (including YouTube), text, file path, or Google Drive ID
- Listing sources for a notebook (truncated at 30 items)
- Describing a source (AI-generated summary with keywords)
- Reading source content (truncated at 2000 characters)
- Deleting sources (with confirmation)
- Checking for stale Drive sources
- Syncing stale sources

**Tools**: `add_source`, `list_sources`, `describe_source`, `get_source_content`, `delete_source`, `check_stale_sources`, `sync_sources`
**NLM Commands**: `nlm source add/list/describe/content/delete/stale/sync`

---

### FR-4: Notebook Querying

The agent must support asking questions against notebook sources, with support for conversation continuity (passing conversation IDs stored in session state) and source filtering. The agent must track `last_conversation_id` in session state to enable multi-turn Q&A.

**Tool**: `query_notebook`
**NLM Command**: `nlm notebook query <nb> "question" --json [--conversation-id <id>]`

---

### FR-5: Studio Content Generation

The agent must support creating all studio artifact types:
- Audio (with format: deep_dive/brief/critique/debate, length: short/default/long)
- Video (with format: explainer/brief, style options)
- Reports (with format: "Briefing Doc"/"Study Guide"/"Blog Post"/"Create Your Own")
- Quizzes (with count: 1-20, difficulty: 1-5)
- Flashcards (with difficulty: easy/medium/hard)
- Mind maps (with title)
- Slides (with format: detailed_deck/presenter_slides)
- Infographics (with orientation: landscape/portrait/square, detail: concise/standard/detailed)
- Data tables (with description)

All generation commands must include `--confirm` automatically since the agent operates non-interactively. Studio creation commands lack `--json` output; the agent must check exit codes and follow up with `studio status --json`.

**Tools**: `create_audio`, `create_video`, `create_report`, `create_quiz`, `create_flashcards`, `create_mindmap`, `create_slides`, `create_infographic`, `create_data_table`
**NLM Commands**: `nlm audio/video/report/quiz/flashcards/mindmap/slides/infographic/data-table create`

---

### FR-6: Artifact Status and Download

The agent must:
- Check studio status for a notebook (returns artifact list with id, type, status)
- Parse artifact statuses and report which are completed, pending, or failed
- Download completed artifacts to a specified output path (default from `NLM_DOWNLOAD_DIR` config)
- Handle the async nature of generation (advise waiting, offer to poll)

**Tools**: `studio_status`, `download_artifact`
**NLM Commands**: `nlm studio status <nb> --json`, `nlm download <type> <nb> --id <id> --output <path>`

---

### FR-7: Sharing Management

The agent must support viewing sharing status, enabling/disabling public links, and inviting collaborators with role assignment (viewer/editor).

**Tools**: `share_status`, `share_public`, `share_private`, `share_invite`
**NLM Commands**: `nlm share status/public/private/invite`

---

### FR-8: Alias Management

The agent must support creating, listing, getting, and deleting aliases for easier notebook reference by human-friendly names.

**Tools**: `list_aliases`, `set_alias`, `get_alias`, `delete_alias`
**NLM Commands**: `nlm alias list/set/get/delete`

---

### FR-9: Research Operations

The agent must support starting research tasks (web or Drive, fast or deep mode), checking research status, and importing discovered sources. Research commands lack `--json` output; text parsing or exit code checking is required.

**Tools**: `start_research`, `research_status`, `import_research`
**NLM Commands**: `nlm research start/status/import`

---

### FR-10: Note Management

The agent must support listing, creating, updating, and deleting notes within notebooks. Note deletion requires confirmation.

**Tools**: `list_notes`, `create_note`, `update_note`, `delete_note`
**NLM Commands**: `nlm note list/create/update/delete`

---

### FR-11: Multi-Step Workflow Orchestration

The agent must be capable of executing multi-step workflows autonomously. For example:
- "Create a notebook, add these 3 URLs, wait for processing, then generate a podcast" should result in the agent calling multiple tools in sequence
- The agent should use its LLM reasoning to determine the correct order of operations
- The system prompt must include explicit multi-step workflow patterns

**Implementation**: System prompt with workflow patterns; no dedicated tool needed.

---

### FR-12: Error Handling and Recovery

The agent must:
- Parse error output from `nlm` commands and provide meaningful explanations
- Detect authentication failures and guide the user to re-authenticate
- Handle rate limit errors gracefully (inform user about ~50/day limit)
- Retry transient failures where appropriate
- Classify errors into: `auth_error`, `not_found`, `rate_limit`, `timeout`, `config_error`, `error`

**Implementation**: Error classification in `_run_nlm()` helper; system prompt maps error statuses to user-facing guidance.

---

### FR-13: Destructive Operation Safeguards

The agent must always confirm with the user before executing destructive operations (delete notebook, delete source, delete artifact, delete note). Safeguards are dual-layered:
1. ADK `require_confirmation=True` on `FunctionTool` (framework-level, works in `adk web`)
2. System prompt instruction "always confirm before deleting" (LLM-level, works in `adk run`)
3. The `--confirm` flag is always passed to nlm for non-interactive execution

---

### FR-14: Session State Tracking

The agent must maintain conversational context using ADK session state (`tool_context.state`):

| State Key | Type | Written By | Purpose |
|-----------|------|-----------|---------|
| `current_notebook_id` | `str | None` | `get_notebook`, `create_notebook` | Implicit notebook reference ("add source to it") |
| `current_notebook_title` | `str | None` | `get_notebook`, `create_notebook` | Display name in system prompt |
| `last_conversation_id` | `str | None` | `query_notebook` | Multi-turn Q&A continuity |
| `auth_verified` | `bool` | `check_auth` | Whether auth was checked this session |

State is injected into the system prompt via `{key?}` template syntax.

---

## Non-Functional Requirements

### NFR-1: Response Quality

The agent should provide well-structured, informative responses. When listing notebooks or sources, it should format the data readably rather than dumping raw JSON.

### NFR-2: Latency

CLI tool invocations add latency. The agent should:
- Use `--json` output format for tool calls to enable reliable parsing
- Avoid unnecessary calls (e.g., don't list all notebooks if the user provides an ID)
- Use `--quiet` when only IDs are needed

### NFR-3: Token Efficiency

The agent's system prompt and tool definitions must be concise. Large CLI output should be truncated by the tool wrapper before returning to the LLM:
- Notebook list: max 50 items
- Source list: max 30 items
- Source content: first 2000 characters
- Studio status: all items (typically <20)

### NFR-4: Security

- Never store or log authentication credentials
- Never pass credentials as command-line arguments
- Rely on `nlm`'s own auth management at `~/.notebooklm-mcp-cli/`

### NFR-5: Maintainability

- Each nlm command category is a separate tool module
- Tool functions have clear docstrings for LLM reasoning
- Configuration is externalized with no fallback values

### NFR-6: Testability

- Tool wrapper functions are testable independently of the ADK agent
- `subprocess.run` calls are mockable for unit testing
- Tests are located in `test_scripts/` per project conventions

---

## Constraints

### C-1: Technology Stack

- **Language**: Python 3.12+
- **Framework**: Google ADK (`google-adk >= 1.14.0`)
- **Package Manager**: UV
- **LLM**: Gemini 2.5 Flash (configurable via `GEMINI_MODEL`)
- **CLI Dependency**: `nlm` (notebooklm-mcp-cli) must be installed and authenticated

### C-2: Configuration (No Fallbacks)

| Variable | Purpose | Required |
|----------|---------|:--------:|
| `GOOGLE_API_KEY` | Gemini API key | Yes |
| `GEMINI_MODEL` | LLM model name | Yes |
| `NLM_CLI_PATH` | Path to nlm executable | Yes |
| `NLM_DOWNLOAD_DIR` | Default download directory | Yes |

### C-3: Authentication Boundary

The agent cannot perform browser-based authentication. It must verify auth status and instruct the user to authenticate externally if needed.

### C-4: Rate Limiting

The free tier allows ~50 API queries/day. The agent should be aware of this and avoid unnecessary calls.

### C-5: `adk web --no-reload`

Always run `adk web` with `--no-reload` flag to avoid subprocess transport issues.
