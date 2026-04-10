# Plan 001: ADK NLM Agent Implementation

**Version**: 1.0
**Date**: 2026-04-10
**Status**: Draft
**Dependencies**: Refined request (refined-request.md), Investigation (investigation-adk-nlm-agent.md), Research (adk-functiontool-patterns.md, adk-session-state.md, nlm-json-schemas.md)

---

## Overview

This plan describes the implementation of a Google ADK Python agent that wraps the `nlm` CLI tool to manage Google NotebookLM collections via natural language. The agent uses `subprocess.run()` to invoke `nlm` commands, parses JSON output, and returns structured results to the Gemini LLM for reasoning.

The work is divided into 6 phases with clear boundaries, dependencies, and acceptance criteria.

---

## Phase Dependency Graph

```
Phase 1: Project Setup & Config
    |
    v
Phase 2: Core Infrastructure (_run_nlm, error handling, config)
    |
    v
Phase 3: Notebook & Auth Tools + Agent Skeleton  (first runnable agent)
    |
    +------+------+
    |             |
    v             v
Phase 4:     Phase 5:
Source &      Studio, Download
Query Tools  & Sharing Tools
    |             |
    +------+------+
           |
           v
Phase 6: Research, Alias, Notes & Polish
```

Phases 4 and 5 can be executed in parallel after Phase 3 is complete.

---

## Phase 1: Project Setup & Configuration

**Goal**: Establish the UV-managed Python project, install dependencies, create the directory structure, and define configuration loading with no fallback values.

### Files to Create

| File | Purpose |
|------|---------|
| `pyproject.toml` | UV project definition with `google-adk` dependency |
| `src/notebooklm_agent/__init__.py` | Package init; exports `root_agent` |
| `src/notebooklm_agent/agent.py` | Stub agent definition (placeholder instruction, no tools yet) |
| `src/notebooklm_agent/config.py` | Configuration loader: reads env vars, raises on missing values |
| `src/notebooklm_agent/.env.example` | Example env file documenting all required variables |
| `.python-version` | Pin Python version (3.12+) |

### Configuration Variables (No Fallbacks)

Per project conventions, every configuration variable must raise an exception if not provided.

| Variable | Purpose | Exception if Missing |
|----------|---------|---------------------|
| `GOOGLE_API_KEY` | Gemini API key for ADK | `EnvironmentError("GOOGLE_API_KEY is required...")` |
| `NLM_CLI_PATH` | Absolute path to `nlm` executable | `EnvironmentError("NLM_CLI_PATH is required...")` |
| `GEMINI_MODEL` | Model name (e.g., `gemini-2.5-flash`) | `EnvironmentError("GEMINI_MODEL is required...")` |
| `NLM_DOWNLOAD_DIR` | Directory for artifact downloads | `EnvironmentError("NLM_DOWNLOAD_DIR is required...")` |

**Exception to convention**: The `.env` file used by ADK's auto-discovery mechanism (`adk web`, `adk run`) is loaded automatically by the framework. The `config.py` module reads from `os.environ` which includes `.env` values loaded by ADK. This must be documented in the project's memory file before implementation.

### Implementation Steps

1. Initialize UV project: `uv init --name notebooklm-agent`
2. Add dependencies: `uv add google-adk`
3. Create directory structure under `src/notebooklm_agent/`
4. Implement `config.py` with strict env var loading
5. Create stub `agent.py` with a minimal `LlmAgent` that responds to greetings
6. Create `__init__.py` that exports `root_agent`
7. Create `.env.example` with all variables documented

### Acceptance Criteria

- [ ] `uv sync` completes without errors
- [ ] `GOOGLE_API_KEY=test GEMINI_MODEL=test NLM_CLI_PATH=test NLM_DOWNLOAD_DIR=/tmp python -c "from notebooklm_agent.config import get_config; get_config()"` succeeds
- [ ] Missing any env var raises `EnvironmentError` with a descriptive message
- [ ] `adk run src/notebooklm_agent` starts and responds to "hello" (requires valid `GOOGLE_API_KEY` in `.env`)
- [ ] `adk web --no-reload` starts the web UI and the agent appears in the sidebar

### Verification Commands

```bash
cd "/Users/giorgosmarinos/aiwork/TrainingMaterial/108 - Google ADK"
source .venv/bin/activate
uv sync

# Config validation (should raise for missing vars)
python -c "from notebooklm_agent.config import get_config; get_config()" 2>&1 | grep "EnvironmentError"

# Agent startup (requires .env with valid GOOGLE_API_KEY)
adk run src/notebooklm_agent
```

### Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| ADK version incompatibility | Agent fails to start | Pin `google-adk>=1.14.0` in pyproject.toml (need `require_confirmation` support) |
| `adk run` cannot discover agent in `src/` subdirectory | Agent not found | Test directory structure; may need to place agent at project root level |
| UV and ADK `.env` loading conflict | Config not loaded | Test that ADK loads `.env` from agent directory and `os.environ` reflects it |

---

## Phase 2: Core Infrastructure

**Goal**: Build the shared `_run_nlm()` helper, error classification, output parsing utilities, and NLM version checking. These are the foundation all tools depend on.

**Depends on**: Phase 1

### Files to Create

| File | Purpose |
|------|---------|
| `src/notebooklm_agent/tools/__init__.py` | Tools package init |
| `src/notebooklm_agent/tools/nlm_runner.py` | `_run_nlm()` helper, error classifier, version check |
| `src/notebooklm_agent/tools/parsers.py` | JSON parsing utilities for each output schema |
| `test_scripts/test_nlm_runner.py` | Unit tests for `_run_nlm()` with mocked subprocess |

### Key Components

#### `_run_nlm()` Helper

```python
def _run_nlm(args: list[str], timeout: int = 60) -> dict:
    """Execute an nlm CLI command and return a classified result dict.

    Returns dict with keys:
      - status: "success" | "auth_error" | "not_found" | "rate_limit" | "timeout" | "config_error" | "error"
      - data: parsed JSON (when status is success and JSON was returned)
      - output: raw text (when status is success but no JSON)
      - error: error message string (when status is not success)
      - action: suggested user action (for auth_error, config_error)
      - hint: optional hint from nlm error output
    """
```

- Reads `NLM_CLI_PATH` from config (no fallback)
- Sets per-command timeouts based on operation category
- Catches `subprocess.TimeoutExpired`, `FileNotFoundError`, and generic `Exception`
- Classifies errors into: `auth_error`, `not_found`, `rate_limit`, `timeout`, `config_error`, `error`
- Parses stdout as JSON; falls back to raw text if not JSON
- Detects nlm's own error JSON format (`{"status": "error", "error": "...", "hint": "..."}`)

#### Timeout Configuration

| Operation Category | Timeout (seconds) | Commands |
|-------------------|-------------------|----------|
| Fast read ops | 30 | notebook list/get/create/rename, source list, alias ops, auth check |
| Medium ops | 60 | query, source add (no wait), studio create, share ops |
| Long write ops | 120 | source add --wait, download, research start |
| Extra long ops | 360 | research status (polling) |

#### Version Check

```python
def check_nlm_version() -> str:
    """Check installed nlm version; log warning if different from tested version."""
```

Tested against: `notebooklm-mcp-cli v0.5.6`

### Acceptance Criteria

- [ ] `_run_nlm(["notebook", "list", "--json"])` returns a dict with `status` and `data` keys (requires authenticated nlm)
- [ ] `_run_nlm(["nonexistent"])` returns `{"status": "error", ...}`
- [ ] `_run_nlm(["notebook", "get", "fake-id", "--json"])` returns `{"status": "not_found", ...}` or `{"status": "error", ...}`
- [ ] Unit tests pass with mocked subprocess: `cd test_scripts && python -m pytest test_nlm_runner.py -v`
- [ ] Version check logs a warning when version does not match expected

### Verification Commands

```bash
cd "/Users/giorgosmarinos/aiwork/TrainingMaterial/108 - Google ADK"
source .venv/bin/activate

# Unit tests (no nlm required)
python -m pytest test_scripts/test_nlm_runner.py -v

# Integration test (requires authenticated nlm)
python -c "
from notebooklm_agent.tools.nlm_runner import run_nlm, check_nlm_version
print(check_nlm_version())
print(run_nlm(['notebook', 'list', '--json']))
"
```

### Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| nlm not installed or not on PATH | `FileNotFoundError` | `_run_nlm` catches this and returns `config_error` status |
| nlm auth expired | All commands fail | `_run_nlm` detects auth keywords in stderr and returns `auth_error` |
| nlm JSON schema changed between versions | Parsing failures | Defensive `.get()` parsing in `parsers.py`; version check at startup |

---

## Phase 3: Notebook & Auth Tools + Agent Skeleton

**Goal**: Implement authentication verification, notebook CRUD tools, session state tracking, the system prompt, and wire everything into a working agent. This is the first fully functional milestone.

**Depends on**: Phase 2

### Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/notebooklm_agent/tools/auth_tools.py` | Create | `check_auth()` tool |
| `src/notebooklm_agent/tools/notebook_tools.py` | Create | `list_notebooks`, `get_notebook`, `create_notebook`, `rename_notebook`, `delete_notebook`, `describe_notebook` |
| `src/notebooklm_agent/agent.py` | Modify | Full system prompt, tool registration, session state config |
| `src/notebooklm_agent/tools/__init__.py` | Modify | Export all tools |
| `test_scripts/test_notebook_tools.py` | Create | Unit tests for notebook tools |
| `test_scripts/test_agent_smoke.py` | Create | Smoke test: start agent, send a message, verify response |

### Tools to Implement

#### Authentication

| Tool | NLM Command | Returns |
|------|-------------|---------|
| `check_auth()` | `nlm login --check` | `{status, authenticated: bool, message}` |

#### Notebook CRUD

| Tool | NLM Command | Returns | Notes |
|------|-------------|---------|-------|
| `list_notebooks()` | `nlm notebook list --json` | `{status, notebooks[], total_count, truncated?}` | Truncate at 50 items |
| `get_notebook(notebook_id: str, tool_context: ToolContext)` | `nlm notebook get <id> --json` | `{status, notebook: {id, title, source_count, url, sources[]}}` | Updates `current_notebook_id` in state |
| `create_notebook(title: str, tool_context: ToolContext)` | `nlm notebook create <title>` | `{status, notebook_id, title}` | Updates `current_notebook_id` in state |
| `rename_notebook(notebook_id: str, new_title: str)` | `nlm notebook rename <id> <title>` | `{status, message}` | |
| `delete_notebook(notebook_id: str)` | `nlm notebook delete <id> --confirm` | `{status, message}` | Wrapped with `require_confirmation=True` |
| `describe_notebook(notebook_id: str)` | `nlm notebook describe <id> --json` | `{status, summary, suggested_topics[]}` | |

#### Session State Tracking

Tools that select or create a notebook will write to `tool_context.state`:
- `current_notebook_id` (session-scoped, no prefix)
- `current_notebook_title` (session-scoped, no prefix)

### System Prompt

The agent instruction (400-700 words) will follow the template from the research document (adk-functiontool-patterns.md, Section 3.8) with these sections:

1. **Persona**: "You are NotebookLM Manager..."
2. **Session Context**: `{current_notebook_title?}`, `{current_notebook_id?}`
3. **Tool Usage Guidelines**: per-tool guidance for non-obvious behaviors
4. **Multi-Step Workflow Patterns**: create-notebook-then-add-sources, etc.
5. **Error Handling**: mapping of status codes to user-facing actions
6. **Output Style**: concise, bullet lists, include IDs

### Destructive Operations: Dual Safeguard

For `delete_notebook`:
1. `FunctionTool(func=delete_notebook, require_confirmation=True)` -- framework-level gate (works in `adk web`)
2. System prompt: "Always confirm with the user before deleting anything" -- LLM-level gate (works in `adk run`)
3. The tool itself always passes `--confirm` to nlm (non-interactive execution)

### Acceptance Criteria

- [ ] `adk web --no-reload` starts and the agent lists notebooks when asked "show me my notebooks"
- [ ] Agent creates a notebook when asked "create a notebook called Test Notebook"
- [ ] After creating or getting a notebook, asking "what is the current notebook?" returns the correct title/ID
- [ ] Agent refuses to delete a notebook without confirmation (in `adk web`, a dialog appears)
- [ ] `check_auth()` correctly detects whether nlm is authenticated
- [ ] Unit tests pass: `python -m pytest test_scripts/test_notebook_tools.py -v`

### Verification Commands

```bash
cd "/Users/giorgosmarinos/aiwork/TrainingMaterial/108 - Google ADK"
source .venv/bin/activate

# Unit tests
python -m pytest test_scripts/test_notebook_tools.py -v

# Manual agent test (requires .env + authenticated nlm)
adk web --no-reload
# In browser: "List all my notebooks"
# In browser: "Create a notebook called ADK Test"
# In browser: "What is the current notebook?"
# In browser: "Delete the current notebook" (should trigger confirmation)
```

### Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| `adk run` does not prompt for `require_confirmation` | Delete executes without confirmation in CLI mode | System prompt includes explicit "always confirm before deleting" instruction as a secondary safeguard |
| ADK cannot discover agent in `src/notebooklm_agent/` | Agent not listed in `adk web` | Test at phase start; restructure directory if needed (move to project root) |
| Gemini model hallucinates tool calls with wrong parameters | Invalid nlm commands | Docstrings with explicit parameter descriptions; validation in tool functions |

---

## Phase 4: Source & Query Tools

**Goal**: Implement source management and notebook querying tools. Add conversation ID tracking for multi-turn queries.

**Depends on**: Phase 3
**Parallel with**: Phase 5

### Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/notebooklm_agent/tools/source_tools.py` | Create | `add_source`, `list_sources`, `describe_source`, `get_source_content`, `delete_source`, `check_stale_sources`, `sync_sources` |
| `src/notebooklm_agent/tools/query_tools.py` | Create | `query_notebook` |
| `src/notebooklm_agent/agent.py` | Modify | Register new tools, update system prompt |
| `test_scripts/test_source_tools.py` | Create | Unit tests |
| `test_scripts/test_query_tools.py` | Create | Unit tests |

### Tools to Implement

#### Source Management

| Tool | NLM Command | Returns | Notes |
|------|-------------|---------|-------|
| `add_source(notebook_id: str, source_type: str, source_value: str)` | `nlm source add <nb> --url/--text/--file/--drive <value>` | `{status, source_id?, message}` | `source_type` is one of: `url`, `text`, `file`, `drive` |
| `list_sources(notebook_id: str)` | `nlm source list <nb> --json` | `{status, sources[], total_count, truncated?}` | Truncate at 30 items |
| `describe_source(source_id: str)` | `nlm source describe <id> --json` | `{status, summary, keywords[]}` | |
| `get_source_content(source_id: str)` | `nlm source content <id> --json` | `{status, content, title, source_type, char_count, truncated?}` | Truncate content at 2000 chars |
| `delete_source(notebook_id: str, source_id: str)` | `nlm source delete <nb> <id> --confirm` | `{status, message}` | Wrapped with `require_confirmation=True` |
| `check_stale_sources(notebook_id: str)` | `nlm source stale <nb>` | `{status, stale_sources[]}` | |
| `sync_sources(notebook_id: str)` | `nlm source sync <nb>` | `{status, message}` | |

#### Querying

| Tool | NLM Command | Returns | Notes |
|------|-------------|---------|-------|
| `query_notebook(notebook_id: str, question: str, conversation_id: str = None, tool_context: ToolContext)` | `nlm notebook query <nb> "question" --json [--conversation-id <id>]` | `{status, answer, conversation_id, sources_used[]}` | Saves `last_conversation_id` to session state; omits unstable `citations`/`references` fields |

### Session State Updates

| Key | Written By | Purpose |
|-----|-----------|---------|
| `last_conversation_id` | `query_notebook` | Enable multi-turn Q&A within the same query thread |

### System Prompt Updates

Add to the instruction:
- Source processing is async (2-5 minutes); inform user
- When adding multiple sources, add them sequentially
- For queries, use `last_conversation_id` for follow-ups automatically
- Rate limit warning: ~50 queries/day

### Acceptance Criteria

- [ ] Agent adds a URL source when asked "add https://example.com to my notebook"
- [ ] Agent lists sources when asked "what sources does this notebook have?"
- [ ] Agent answers questions about notebook content: "what is the main topic of this notebook?"
- [ ] Follow-up queries use the same conversation thread (conversation_id is passed)
- [ ] Agent deletes a source only after confirmation
- [ ] Unit tests pass: `python -m pytest test_scripts/test_source_tools.py test_scripts/test_query_tools.py -v`

### Verification Commands

```bash
cd "/Users/giorgosmarinos/aiwork/TrainingMaterial/108 - Google ADK"
source .venv/bin/activate

python -m pytest test_scripts/test_source_tools.py test_scripts/test_query_tools.py -v

# Manual test in adk web
adk web --no-reload
# "Add https://en.wikipedia.org/wiki/Artificial_intelligence to the current notebook"
# "List the sources"
# "What is the main topic discussed in this notebook?"
# "Tell me more about the history" (should use same conversation thread)
```

### Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| `source add` for text requires reading file content | Complex parameter handling | Tool accepts `source_type` as an enum-like string; validates before calling nlm |
| Query rate limit hit | All queries fail | Tool returns `rate_limit` status; system prompt instructs agent to warn user |
| `conversation_id` is null on first query | Follow-up fails | Only pass `--conversation-id` when the value is non-null |

---

## Phase 5: Studio, Download & Sharing Tools

**Goal**: Implement all content generation tools (audio, video, report, quiz, flashcards, slides, infographic, mind map, data table), studio status checking, artifact downloading, and sharing management.

**Depends on**: Phase 3
**Parallel with**: Phase 4

### Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/notebooklm_agent/tools/studio_tools.py` | Create | All studio creation tools + `studio_status` |
| `src/notebooklm_agent/tools/download_tools.py` | Create | `download_artifact` |
| `src/notebooklm_agent/tools/sharing_tools.py` | Create | `share_status`, `share_public`, `share_private`, `share_invite` |
| `src/notebooklm_agent/agent.py` | Modify | Register new tools, update system prompt |
| `test_scripts/test_studio_tools.py` | Create | Unit tests |

### Tools to Implement

#### Studio Creation

All studio creation commands lack `--json` support. Strategy: run the command, check exit code, then call `studio status --json` to get the artifact details.

| Tool | NLM Command | Returns | Notes |
|------|-------------|---------|-------|
| `create_audio(notebook_id: str, format: str = "deep_dive", length: str = "default")` | `nlm audio create <nb> --format <f> --length <l> --confirm` | `{status, message}` | format: deep_dive/brief/critique/debate; length: short/default/long |
| `create_video(notebook_id: str, format: str = "explainer", style: str = None)` | `nlm video create <nb> --format <f> [--style <s>] --confirm` | `{status, message}` | |
| `create_report(notebook_id: str, format: str = "Briefing Doc")` | `nlm report create <nb> --format <f> --confirm` | `{status, message}` | format: "Briefing Doc"/"Study Guide"/"Blog Post"/"Create Your Own" |
| `create_quiz(notebook_id: str, count: int = 5, difficulty: int = 3)` | `nlm quiz create <nb> --count <n> --difficulty <d> --confirm` | `{status, message}` | count: 1-20; difficulty: 1-5 |
| `create_flashcards(notebook_id: str, difficulty: str = "medium")` | `nlm flashcards create <nb> --difficulty <d> --confirm` | `{status, message}` | difficulty: easy/medium/hard |
| `create_mindmap(notebook_id: str, title: str = None)` | `nlm mindmap create <nb> [--title <t>] --confirm` | `{status, message}` | |
| `create_slides(notebook_id: str, format: str = "detailed_deck")` | `nlm slides create <nb> --format <f> --confirm` | `{status, message}` | format: detailed_deck/presenter_slides |
| `create_infographic(notebook_id: str, orientation: str = "landscape", detail: str = "standard")` | `nlm infographic create <nb> --orientation <o> --detail <d> --confirm` | `{status, message}` | |
| `create_data_table(notebook_id: str, description: str)` | `nlm data-table create <nb> "<desc>" --confirm` | `{status, message}` | |

**Important**: All creation tools automatically append `--confirm` since the agent operates non-interactively.

#### Studio Status

| Tool | NLM Command | Returns | Notes |
|------|-------------|---------|-------|
| `studio_status(notebook_id: str)` | `nlm studio status <nb> --json` | `{status, artifacts[{id, type, status}], completed_count, pending_count}` | Adds summary counts |

#### Downloads

| Tool | NLM Command | Returns | Notes |
|------|-------------|---------|-------|
| `download_artifact(notebook_id: str, artifact_type: str, artifact_id: str, output_path: str = None)` | `nlm download <type> <nb> --id <id> --output <path>` | `{status, file_path, message}` | Default output dir from config; artifact_type: audio/video/report/mind-map/slide-deck/infographic/data-table/quiz/flashcards |

#### Sharing

| Tool | NLM Command | Returns | Notes |
|------|-------------|---------|-------|
| `share_status(notebook_id: str)` | `nlm share status <nb>` | `{status, is_public, collaborators[]}` | Parse text output |
| `share_public(notebook_id: str)` | `nlm share public <nb>` | `{status, message, url?}` | |
| `share_private(notebook_id: str)` | `nlm share private <nb>` | `{status, message}` | |
| `share_invite(notebook_id: str, email: str, role: str = "viewer")` | `nlm share invite <nb> <email> --role <role>` | `{status, message}` | role: viewer/editor |

### System Prompt Updates

Add to the instruction:
- Studio generation takes 1-5 minutes; advise user to check status later
- After creating a studio artifact, suggest using `studio_status` to check progress
- For downloads, use the `NLM_DOWNLOAD_DIR` as default output location
- Multi-step workflow: create notebook -> add sources -> wait -> generate audio -> check status -> download

### Acceptance Criteria

- [ ] Agent creates an audio overview when asked "create a podcast for this notebook"
- [ ] Agent checks studio status when asked "what's the status of my audio?"
- [ ] Agent downloads a completed artifact when asked "download the audio"
- [ ] Agent shares a notebook publicly when asked "make this notebook public"
- [ ] Agent correctly chains: "create a report and let me know when it's ready"
- [ ] Unit tests pass: `python -m pytest test_scripts/test_studio_tools.py -v`

### Verification Commands

```bash
cd "/Users/giorgosmarinos/aiwork/TrainingMaterial/108 - Google ADK"
source .venv/bin/activate

python -m pytest test_scripts/test_studio_tools.py -v

# Manual test in adk web (requires notebook with sources)
adk web --no-reload
# "Create a podcast for the current notebook"
# "Check the studio status"
# "Make this notebook public"
```

### Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Studio creation returns no JSON | Cannot get artifact ID | Use exit code + follow-up `studio status --json` to get artifact info |
| Audio/video generation takes >5 minutes | Agent appears stuck | System prompt instructs agent to inform user about expected wait times |
| Download path permissions | Write failure | Tool validates path exists and is writable before calling nlm |
| Sharing commands return text (no `--json`) | Harder to parse | Use regex or structured text parsing; return raw text if parsing fails |

---

## Phase 6: Research, Alias, Notes & Polish

**Goal**: Implement remaining tool categories (research, aliases, notes), refine error handling, add output truncation, and complete documentation.

**Depends on**: Phases 4 and 5

### Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/notebooklm_agent/tools/research_tools.py` | Create | `start_research`, `research_status`, `import_research` |
| `src/notebooklm_agent/tools/alias_tools.py` | Create | `list_aliases`, `set_alias`, `get_alias`, `delete_alias` |
| `src/notebooklm_agent/tools/note_tools.py` | Create | `list_notes`, `create_note`, `update_note`, `delete_note` |
| `src/notebooklm_agent/agent.py` | Modify | Register all tools, finalize system prompt |
| `docs/design/project-design.md` | Create | Complete project design document |
| `docs/design/configuration-guide.md` | Create | Configuration guide per conventions |
| `Issues - Pending Items.md` | Create | Issue tracker |
| `test_scripts/test_research_tools.py` | Create | Unit tests |
| `test_scripts/test_alias_tools.py` | Create | Unit tests |
| `test_scripts/test_integration.py` | Create | End-to-end workflow tests |

### Tools to Implement

#### Research (no `--json` support on any research command)

| Tool | NLM Command | Returns | Notes |
|------|-------------|---------|-------|
| `start_research(notebook_id: str, query: str, mode: str = "fast", source: str = "web")` | `nlm research start "<query>" --notebook-id <nb> --mode <m> --source <s>` | `{status, message}` | mode: fast/deep; source: web/drive; parse text for task_id |
| `research_status(notebook_id: str)` | `nlm research status <nb>` | `{status, research_status, sources_found?, message}` | Parse text output; deep mode can take ~5 minutes |
| `import_research(notebook_id: str)` | `nlm research import <nb>` | `{status, message}` | |

#### Aliases

| Tool | NLM Command | Returns |
|------|-------------|---------|
| `list_aliases()` | `nlm alias list` | `{status, aliases[]}` |
| `set_alias(name: str, notebook_id: str)` | `nlm alias set <name> <uuid>` | `{status, message}` |
| `get_alias(name: str)` | `nlm alias get <name>` | `{status, notebook_id}` |
| `delete_alias(name: str)` | `nlm alias delete <name>` | `{status, message}` |

#### Notes

| Tool | NLM Command | Returns |
|------|-------------|---------|
| `list_notes(notebook_id: str)` | `nlm note list <nb>` | `{status, notes[]}` |
| `create_note(notebook_id: str, content: str)` | `nlm note create <nb> --content "<content>"` | `{status, note_id?, message}` |
| `update_note(notebook_id: str, note_id: str, content: str)` | `nlm note update <nb> <note_id> --content "<content>"` | `{status, message}` |
| `delete_note(notebook_id: str, note_id: str)` | `nlm note delete <nb> <note_id> --confirm` | `{status, message}` | Wrapped with `require_confirmation=True` |

### Documentation Deliverables

1. **`docs/design/project-design.md`**: Complete architecture description including:
   - Agent architecture diagram
   - Tool inventory with command mappings
   - State management design
   - Error handling strategy
   - Directory structure

2. **`docs/design/configuration-guide.md`**: Per conventions, covering:
   - All configuration variables with purpose, obtainment method, and recommended management
   - Priority order: `.env` file -> environment variables
   - Expiration handling: `GOOGLE_API_KEY` expiration tracking recommendation
   - No default/fallback values policy

3. **`Issues - Pending Items.md`**: Initial population with known limitations:
   - `require_confirmation` not working in `adk run` CLI mode
   - Research commands lack `--json` (fragile text parsing)
   - `studio status --json` excludes mind maps unless `--full` is used
   - `user_id` hardcoded to "user" in `adk web`

4. **`CLAUDE.md`**: Update with tool documentation for any TypeScript tools created

### Integration Tests

Create `test_scripts/test_integration.py` with end-to-end workflow tests:

1. **Create-Add-Generate workflow**: Create notebook -> add URL source -> wait -> create audio -> check status
2. **Query workflow**: Select notebook -> query -> follow-up query (same conversation)
3. **Multi-notebook workflow**: List notebooks -> select one -> describe -> rename

These tests require authenticated nlm and a valid Google API key. They should be marked with `@pytest.mark.integration` to distinguish from unit tests.

### Acceptance Criteria

- [ ] Agent starts research when asked "research 'AI trends 2026' using web sources"
- [ ] Agent checks research status and reports progress
- [ ] Agent creates and lists aliases
- [ ] Agent manages notes in notebooks
- [ ] `docs/design/project-design.md` is complete and accurate
- [ ] `docs/design/configuration-guide.md` covers all variables
- [ ] `Issues - Pending Items.md` tracks known issues
- [ ] All unit tests pass: `python -m pytest test_scripts/ -v --ignore=test_scripts/test_integration.py`
- [ ] Integration tests pass: `python -m pytest test_scripts/test_integration.py -v -m integration`
- [ ] Full multi-step workflow works in `adk web`: "Create a notebook called AI Trends, add https://example.com/ai as a source, and generate a podcast"

### Verification Commands

```bash
cd "/Users/giorgosmarinos/aiwork/TrainingMaterial/108 - Google ADK"
source .venv/bin/activate

# All unit tests
python -m pytest test_scripts/ -v --ignore=test_scripts/test_integration.py

# Integration tests (requires auth)
python -m pytest test_scripts/test_integration.py -v -m integration

# Full agent test
adk web --no-reload
# Multi-step: "Create a notebook called AI Trends 2026, add https://en.wikipedia.org/wiki/Artificial_intelligence, and create a podcast"
```

---

## Complete File Inventory

### Files Created

| Phase | File | Purpose |
|:-----:|------|---------|
| 1 | `pyproject.toml` | UV project definition |
| 1 | `.python-version` | Python version pin |
| 1 | `src/notebooklm_agent/__init__.py` | Package init, exports `root_agent` |
| 1 | `src/notebooklm_agent/agent.py` | Agent definition with system prompt |
| 1 | `src/notebooklm_agent/config.py` | Configuration loader (strict, no fallbacks) |
| 1 | `src/notebooklm_agent/.env.example` | Example configuration |
| 2 | `src/notebooklm_agent/tools/__init__.py` | Tools package init |
| 2 | `src/notebooklm_agent/tools/nlm_runner.py` | Core CLI runner + error classifier |
| 2 | `src/notebooklm_agent/tools/parsers.py` | JSON parsing utilities |
| 2 | `test_scripts/test_nlm_runner.py` | Unit tests for runner |
| 3 | `src/notebooklm_agent/tools/auth_tools.py` | Authentication tool |
| 3 | `src/notebooklm_agent/tools/notebook_tools.py` | Notebook CRUD tools |
| 3 | `test_scripts/test_notebook_tools.py` | Unit tests for notebook tools |
| 3 | `test_scripts/test_agent_smoke.py` | Agent smoke test |
| 4 | `src/notebooklm_agent/tools/source_tools.py` | Source management tools |
| 4 | `src/notebooklm_agent/tools/query_tools.py` | Query tool |
| 4 | `test_scripts/test_source_tools.py` | Unit tests for source tools |
| 4 | `test_scripts/test_query_tools.py` | Unit tests for query tools |
| 5 | `src/notebooklm_agent/tools/studio_tools.py` | Studio creation + status tools |
| 5 | `src/notebooklm_agent/tools/download_tools.py` | Download tool |
| 5 | `src/notebooklm_agent/tools/sharing_tools.py` | Sharing tools |
| 5 | `test_scripts/test_studio_tools.py` | Unit tests for studio tools |
| 6 | `src/notebooklm_agent/tools/research_tools.py` | Research tools |
| 6 | `src/notebooklm_agent/tools/alias_tools.py` | Alias tools |
| 6 | `src/notebooklm_agent/tools/note_tools.py` | Note tools |
| 6 | `test_scripts/test_research_tools.py` | Unit tests for research tools |
| 6 | `test_scripts/test_alias_tools.py` | Unit tests for alias tools |
| 6 | `test_scripts/test_integration.py` | End-to-end integration tests |
| 6 | `docs/design/project-design.md` | Complete project design |
| 6 | `docs/design/configuration-guide.md` | Configuration guide |
| 6 | `Issues - Pending Items.md` | Issue tracker |

### Total Tool Count: ~30 tools

| Category | Tools | Count |
|----------|-------|:-----:|
| Auth | `check_auth` | 1 |
| Notebooks | `list_notebooks`, `get_notebook`, `create_notebook`, `rename_notebook`, `delete_notebook`, `describe_notebook` | 6 |
| Sources | `add_source`, `list_sources`, `describe_source`, `get_source_content`, `delete_source`, `check_stale_sources`, `sync_sources` | 7 |
| Queries | `query_notebook` | 1 |
| Studio | `create_audio`, `create_video`, `create_report`, `create_quiz`, `create_flashcards`, `create_mindmap`, `create_slides`, `create_infographic`, `create_data_table`, `studio_status` | 10 |
| Downloads | `download_artifact` | 1 |
| Sharing | `share_status`, `share_public`, `share_private`, `share_invite` | 4 |
| Research | `start_research`, `research_status`, `import_research` | 3 |
| Aliases | `list_aliases`, `set_alias`, `get_alias`, `delete_alias` | 4 |
| Notes | `list_notes`, `create_note`, `update_note`, `delete_note` | 4 |
| **Total** | | **41** |

---

## Risk Summary

### High Priority Risks

| Risk | Phase | Impact | Mitigation |
|------|:-----:|--------|------------|
| ADK agent directory discovery | 1, 3 | Agent cannot start | Test early; adjust directory structure if needed |
| `require_confirmation` not working in `adk run` | 3 | Destructive ops execute without confirmation | Dual safeguard: framework + system prompt |
| NLM auth expires mid-session | All | All tool calls fail | `_run_nlm` detects auth errors; agent instructs user to re-authenticate |

### Medium Priority Risks

| Risk | Phase | Impact | Mitigation |
|------|:-----:|--------|------------|
| NLM JSON schema changes on upgrade | 2 | Parsing failures | Defensive `.get()` parsing; version check at startup |
| Studio create commands lack `--json` | 5 | Cannot get artifact ID directly | Check exit code + follow-up `studio status --json` |
| Research commands lack `--json` | 6 | Fragile text parsing | Accept as known limitation; use exit codes when possible |
| 30+ tools may overwhelm Gemini context | 6 | LLM tool selection degrades | Monitor tool count; consider sub-agents if needed |

### Low Priority Risks

| Risk | Phase | Impact | Mitigation |
|------|:-----:|--------|------------|
| Process spawn overhead | 2 | ~100-200ms per call | Negligible vs 1-10s API latency |
| `adk web` user_id hardcoded to "user" | All | Multi-tab state sharing | Use session-scoped state (no prefix) |
| Rate limit (~50/day) | 4 | Queries fail | Agent warns user; tool returns `rate_limit` status |

---

## Estimated Effort

| Phase | Description | Estimated Duration | Parallelizable |
|:-----:|-------------|:------------------:|:--------------:|
| 1 | Project Setup & Config | 1-2 hours | No |
| 2 | Core Infrastructure | 2-3 hours | No |
| 3 | Notebook & Auth + Agent | 3-4 hours | No |
| 4 | Source & Query Tools | 2-3 hours | Yes (with Phase 5) |
| 5 | Studio, Download & Sharing | 3-4 hours | Yes (with Phase 4) |
| 6 | Research, Alias, Notes & Polish | 3-4 hours | No |
| **Total** | | **14-20 hours** | |

With Phases 4 and 5 parallelized, the critical path is approximately 12-17 hours.
