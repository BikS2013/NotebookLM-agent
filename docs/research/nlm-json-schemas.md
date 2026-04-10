# NLM CLI `--json` Output Schema Stability

**Research Date**: 2026-04-10
**Package Version Examined**: `notebooklm-mcp-cli` v0.5.6
**Source**: Installed package at `~/.local/share/uv/tools/notebooklm-mcp-cli/`

---

## Overview

This document provides a complete reference for the JSON output schemas produced by the `nlm` CLI when invoked with `--json`. The research was conducted by reading the actual installed package source code — specifically the `services/` TypedDicts, the `cli/formatters.py` `JsonFormatter` class, and each `cli/commands/*.py` file. This gives high-confidence, ground-truth schema information that reflects what the currently installed version actually emits.

The central finding is that **JSON schemas are backed by Python TypedDicts and Pydantic models** and are therefore well-structured and consistent within a version, but **there is no published stability contract or versioning system**. The risk of breakage across upgrades is moderate and manageable with defensive parsing.

---

## Key Concepts

### How JSON Output Is Produced

The `--json` flag routes output through `JsonFormatter` in `cli/formatters.py`. The formatter's methods are:

- `format_notebooks(notebooks)` — emits a JSON **array** directly to stdout
- `format_sources(sources)` — emits a JSON **array** directly to stdout
- `format_artifacts(artifacts)` — emits a JSON **array** directly to stdout
- `format_item(item)` — emits a JSON **object** (calls `model_dump()` on Pydantic models, or `__dict__` on plain objects)

All output uses `json.dumps(data, indent=2, ensure_ascii=False)`. Non-ASCII characters (e.g., notebook titles in non-Latin scripts) are preserved.

**Critical behavioral note**: When `--json` is not specified and stdout is not a TTY (e.g., when called via `subprocess.run()` with `capture_output=True`), the CLI **automatically switches to JSON format** via `detect_output_format()`. This means the agent's subprocess calls will receive JSON output even without the explicit flag. However, relying on the explicit `--json` flag is strongly recommended for clarity and robustness.

### Error Output Format

When `--json` is passed to a command and an error occurs, the CLI outputs a JSON object to stdout:

```json
{
  "status": "error",
  "error": "<user-facing error message>",
  "hint": "<optional guidance string>"
}
```

The `hint` field is present only when the underlying exception carries one (e.g., `NotFoundError` always includes a hint like `"Run 'nlm notebook list' to see available notebooks."`).

---

## JSON Schemas by Command

### 1. `nlm notebook list --json`

**Output shape**: JSON array of notebook objects.

```json
[
  {
    "id": "abc123def456...",
    "title": "My Research Notebook",
    "source_count": 12,
    "updated_at": "2026-03-15T10:30:00"
  }
]
```

**Field reference** (from `JsonFormatter.format_notebooks` + `core/data_types.py` `Notebook` dataclass):

| Field | Type | Always Present | Notes |
|-------|------|:-:|-------|
| `id` | string | Yes | Full UUID string |
| `title` | string | Yes | Notebook display title |
| `source_count` | integer | Yes | Number of sources; mapped from `source_count` or `sources_count` attribute |
| `updated_at` | string | No | ISO 8601 timestamp if available; field omitted entirely when `None` |
| `created_at` | string | No | Only present when `--full` flag is used |

**Parsing note**: The formatter accesses `getattr(nb, 'source_count', None) or getattr(nb, 'sources_count', 0)`, revealing that the underlying object may use either attribute name. Always use `.get("source_count", 0)` with a default.

**Important**: This command calls `client.list_notebooks()` directly and passes raw dataclass objects to the formatter. It does **not** go through the `notebooks_service.list_notebooks()` function, which returns a richer `NotebookListResult` TypedDict with `count`, `owned_count`, etc. Those extra fields are not in the `--json` output.

---

### 2. `nlm notebook get <id> --json`

**Output shape**: JSON object (single notebook detail).

```json
{
  "notebook_id": "abc123def456...",
  "title": "My Research Notebook",
  "source_count": 12,
  "url": "https://notebooklm.google.com/notebook/abc123...",
  "sources": [
    {"id": "src-uuid-1", "title": "Source Title 1"},
    {"id": "src-uuid-2", "title": "Source Title 2"}
  ]
}
```

**Field reference** (from `services/notebooks.py` `NotebookDetailResult` TypedDict):

| Field | Type | Always Present | Notes |
|-------|------|:-:|-------|
| `notebook_id` | string | Yes | Full UUID |
| `title` | string | Yes | Notebook title |
| `source_count` | integer | Yes | Count of sources |
| `url` | string | Yes | Direct NotebookLM web URL |
| `sources` | array | Yes | List of `{id, title}` objects; may be empty `[]` |

**Sources array item fields**:

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | Source UUID |
| `title` | string | Source display title |

**Parsing risk**: The service handles raw RPC data (a nested list format from the Google API) with special-case normalization. If the API format changes, the `sources` array may be empty even when sources exist. Always guard against an empty array.

---

### 3. `nlm notebook describe <id> --json`

**Output shape**: JSON object.

```json
{
  "summary": "This notebook contains sources about...",
  "suggested_topics": [
    "Machine Learning fundamentals",
    "Neural network architectures"
  ]
}
```

**Field reference** (from `services/notebooks.py` `NotebookSummaryResult` TypedDict):

| Field | Type | Always Present | Notes |
|-------|------|:-:|-------|
| `summary` | string | Yes | AI-generated markdown summary |
| `suggested_topics` | array | Yes | Array of strings; may be empty `[]` |

---

### 4. `nlm source list <notebook> --json`

**Output shape**: JSON array of source objects.

```json
[
  {
    "id": "src-uuid-1",
    "title": "Article Title",
    "type": "url",
    "url": "https://example.com/article"
  }
]
```

**Field reference** (from `JsonFormatter.format_sources`):

| Field | Type | Always Present | Notes |
|-------|------|:-:|-------|
| `id` | string | Yes | Source UUID |
| `title` | string | Yes | Source display title |
| `type` | string | Yes | Source type: `url`, `text`, `drive`, `youtube`, `file`, or raw `source_type_name` value from API |
| `url` | string | Yes | URL if applicable; empty string `""` for non-URL sources |
| `is_stale` | boolean | No | Only present when `--full` or `--drive` flag is used |

**Parsing note**: The type field is resolved via `src.get('source_type_name') or src.get('type', '')`. The `source_type_name` comes directly from the Google API. The exact string values depend on Google's internal naming.

---

### 5. `nlm source describe <source-id> --json`

**Output shape**: JSON object.

```json
{
  "summary": "This source discusses...",
  "keywords": ["machine learning", "neural networks", "deep learning"]
}
```

**Field reference** (from `services/sources.py` `DescribeResult` TypedDict):

| Field | Type | Always Present | Notes |
|-------|------|:-:|-------|
| `summary` | string | Yes | AI-generated markdown summary |
| `keywords` | array | Yes | Array of keyword strings; may be empty `[]` |

---

### 6. `nlm source content <source-id> --json`

**Output shape**: JSON object.

```json
{
  "content": "Full text content of the source...",
  "title": "Source Title",
  "source_type": "url",
  "char_count": 42517
}
```

**Field reference** (from `services/sources.py` `SourceContentResult` TypedDict):

| Field | Type | Always Present | Notes |
|-------|------|:-:|-------|
| `content` | string | Yes | Full raw text; can be very large |
| `title` | string | Yes | Source display title |
| `source_type` | string | Yes | Type string (e.g. `"url"`, `"text"`) |
| `char_count` | integer | Yes | Character count of `content` |

**Note**: `char_count` is always `len(content)` — derived by the service, not from the API. It is reliable.

---

### 7. `nlm notebook query <nb> "question" --json`

**Output shape**: JSON object.

```json
{
  "answer": "Based on the sources, the key themes are...",
  "conversation_id": "conv-uuid-abc123",
  "sources_used": ["src-uuid-1", "src-uuid-2"],
  "citations": {},
  "references": []
}
```

**Field reference** (from `services/chat.py` `QueryResult` TypedDict):

| Field | Type | Always Present | Notes |
|-------|------|:-:|-------|
| `answer` | string | Yes | Full AI response text |
| `conversation_id` | string or null | Yes | UUID for follow-up queries; `null` for first turn in some cases |
| `sources_used` | array | Yes | Array of source IDs cited; may be empty `[]` |
| `citations` | object | Yes | Citation metadata dict; structure varies; may be empty `{}` |
| `references` | array | Yes | Reference list; may be empty `[]` |

**Parsing note**: The `citations` and `references` fields come directly from the Google API response without normalization. Their internal structure is undocumented and may change without the CLI version changing. **Treat these as opaque** — do not parse their internal structure.

**Important**: The `format_item()` method is used for this command. It calls `model_dump(exclude_none=True)` on Pydantic models. Fields with `None` values may be absent from the output when using Pydantic path.

---

### 8. `nlm studio status <nb> --json`

**Output shape**: JSON array of artifact objects.

```json
[
  {
    "id": "artifact-uuid-1",
    "type": "audio",
    "status": "completed",
    "custom_instructions": null
  },
  {
    "id": "artifact-uuid-2",
    "type": "report",
    "status": "in_progress",
    "custom_instructions": null
  }
]
```

**Field reference** (from `JsonFormatter.format_artifacts`):

| Field | Type | Always Present | Notes |
|-------|------|:-:|-------|
| `id` | string | Yes | Artifact UUID; resolved from `artifact_id` or `id` key in source dict |
| `type` | string | Yes | Artifact type: `audio`, `video`, `report`, `quiz`, `flashcards`, `slide_deck`, `infographic`, `mind_map`, `data_table` |
| `status` | string | Yes | One of: `completed`, `in_progress`, `pending`, `failed` |
| `custom_instructions` | string or null | Yes | Always included in JSON output; typically `null` |
| `title` | string | No | Only present when `--full` flag is used |
| `url` | string | No | Only present when `--full` flag is used |

**Important nuance**: The `studio status` CLI command calls `client.poll_studio_status()` directly, **bypassing** the `studio_service.get_studio_status()` function. This means **mind maps are NOT included** in the studio status output unless `--full` is used. The service function adds mind maps, but the CLI command does not call the service function.

---

### 9. Studio Creation Commands (`--json` flag does NOT apply)

Commands like `nlm audio create`, `nlm report create`, `nlm quiz create`, etc. do **not** have a `--json` flag. Their output is always human-readable text to the console (Rich-formatted). Example output:

```
✓ Audio generation started
  Artifact ID: artifact-uuid-1

Run 'nlm studio status <notebook-id>' to check progress.
```

**Consequence for the agent**: These commands cannot be parsed with JSON. The agent should:
1. Run the create command and ignore its stdout
2. Check exit code for success/failure
3. Immediately run `nlm studio status <nb> --json` to get the artifact ID

---

### 10. `nlm research start` (no `--json` flag)

The research `start` command also does **not** have a `--json` flag. Output is human-readable text. To get the `task_id`, parse stdout or use `nlm research status <nb>` immediately after.

---

### 11. `nlm research status <nb>` (no `--json` flag)

The research `status` command does **not** have a `--json` flag either. The status is displayed using Rich console formatting. The underlying `ResearchStatusResult` TypedDict structure is:

| Field | Type | Notes |
|-------|------|-------|
| `status` | string | `pending`, `running`, `in_progress`, `completed`, `failed`, `no_research` |
| `notebook_id` | string | Notebook UUID |
| `task_id` | string or null | Research task UUID; null when no research found |
| `sources_found` | integer | Count of discovered sources |
| `sources` | array | Source objects (compact: max 5 with truncation note) |
| `report` | string | Research report text (compact: truncated at 500 chars) |
| `message` | string or null | Action guidance message |

**Consequence for the agent**: Since neither `research start` nor `research status` support `--json`, the agent must either parse human-readable output or use a different strategy. The recommended approach is to use `nlm research status` and parse the text output, or accept that research operations are "fire and forget" with manual polling.

---

## Schema Stability Assessment

### What Provides Stability

1. **Python TypedDicts as contracts**: All service functions return TypedDicts with explicit field names and types. These are compiler-checked contracts within the codebase. Changing a TypedDict field is a deliberate act, not an accident.

2. **Pydantic models for core data**: `core/models.py` defines Pydantic models (`Notebook`, `Source`, `QueryResponse`, etc.) with field-level defaults and validation. These provide additional runtime stability.

3. **Explicit formatter code**: `JsonFormatter` builds output dicts explicitly in code (not via automatic serialization). This means fields are chosen intentionally, and additions/removals require explicit code changes.

4. **Version available at runtime**: `notebooklm_tools.__version__` is `"0.5.6"`. The agent can check the installed version at startup to detect upgrades.

### Risk Factors

1. **No published JSON schema contract**: There is no `SCHEMA_CHANGELOG.md`, no version negotiation, and no `--schema-version` flag. The `--json` output format is a by-product of implementation, not a formal API.

2. **CLI layer bypasses service layer in places**: `notebook list --json` and `studio status --json` call client methods directly rather than the service layer. This means the output can diverge from the TypedDicts when the client layer changes.

3. **`format_item()` is generic and lossy**: Commands using `format_item()` (e.g., `notebook get`, `notebook describe`, `source describe`, `notebook query`) rely on `model_dump(exclude_none=True)` or `__dict__`. Fields with `None` values may be silently omitted.

4. **Google API structure leaks through**: The `type` field in source lists, the `citations` and `references` in query results, and the `sources` array in research status are passed through from Google's internal API without normalization. Google can change its API without changing the `nlm` CLI version.

5. **Rapid development pace**: The package went from a TypeScript-based tool to a complete Python rewrite ("complete refactor" in January 2026), advancing to v0.5.6 within months. This indicates an active, fast-moving project where breaking schema changes are possible between minor versions.

6. **`exclude_none=True` creates variable-length outputs**: Fields that are `None` (e.g., `conversation_id`, `url`, timestamps) may or may not appear depending on the data. A parser must never assume a field is present simply because it was present in a previous call.

---

## Recommended Parsing Strategy

### Strategy: Defensive Parsing with Known-Field Extraction

Do not use strict schema validation. Instead, use defensive `.get()` extraction with sensible defaults.

#### Pattern A: Array Commands (list, source list, studio status)

```python
def parse_notebook_list(raw_json: str) -> list[dict]:
    """
    Parse output of: nlm notebook list --json
    Returns a normalized list of notebook dicts with guaranteed fields.
    """
    try:
        data = json.loads(raw_json)
    except json.JSONDecodeError as e:
        raise ValueError(f"nlm returned invalid JSON: {e}")

    if not isinstance(data, list):
        raise ValueError(f"Expected JSON array, got {type(data).__name__}")

    notebooks = []
    for item in data:
        if not isinstance(item, dict):
            continue  # Skip malformed entries
        notebooks.append({
            "id": item.get("id", ""),
            "title": item.get("title", "Untitled"),
            "source_count": item.get("source_count", 0),
            "updated_at": item.get("updated_at"),  # None if absent — acceptable
        })
    return notebooks
```

#### Pattern B: Object Commands (notebook get, query, describe)

```python
def parse_query_response(raw_json: str) -> dict:
    """
    Parse output of: nlm notebook query <nb> "question" --json
    Returns a normalized dict with guaranteed fields.
    """
    try:
        data = json.loads(raw_json)
    except json.JSONDecodeError as e:
        raise ValueError(f"nlm returned invalid JSON: {e}")

    if isinstance(data, dict) and data.get("status") == "error":
        raise RuntimeError(data.get("error", "Unknown error from nlm"))

    if not isinstance(data, dict):
        raise ValueError(f"Expected JSON object, got {type(data).__name__}")

    return {
        "answer": data.get("answer", ""),
        "conversation_id": data.get("conversation_id"),  # May be None
        "sources_used": data.get("sources_used", []),
        # Intentionally omit citations/references — structure is unstable
    }
```

#### Pattern C: Error Detection (applies to all commands)

```python
def _run_nlm(args: list[str], timeout: int = 60) -> dict:
    """Execute an nlm command and return a result dict."""
    result = subprocess.run(
        ["nlm"] + args,
        capture_output=True, text=True, timeout=timeout
    )

    if result.returncode != 0:
        # Try to parse stderr as structured error info
        stderr = result.stderr.strip()
        # Classify known error patterns
        if "expired" in stderr.lower() or "authentication" in stderr.lower():
            return {"status": "auth_error", "error": stderr,
                    "action": "Run 'nlm login' to re-authenticate."}
        if "not found" in stderr.lower():
            return {"status": "not_found", "error": stderr}
        return {"status": "error", "error": stderr}

    stdout = result.stdout.strip()
    if not stdout:
        return {"status": "success", "data": None}

    try:
        parsed = json.loads(stdout)
    except json.JSONDecodeError:
        # Command succeeded but didn't return JSON (e.g., create commands)
        return {"status": "success", "output": stdout}

    # Check if JSON output itself reports an error
    if isinstance(parsed, dict) and parsed.get("status") == "error":
        return {"status": "error", "error": parsed.get("error", "Unknown error"),
                "hint": parsed.get("hint")}

    return {"status": "success", "data": parsed}
```

### Commands Without `--json` Support

For commands that lack `--json` (studio create, research start, research status), use these strategies:

| Command | Strategy |
|---------|----------|
| `nlm audio create --confirm` | Parse exit code only; follow up with `studio status --json` |
| `nlm report create --confirm` | Parse exit code only; follow up with `studio status --json` |
| `nlm research start` | Parse text output for task ID, or follow up with polling |
| `nlm research status` | Parse text output or use polling with service layer directly |

### Recommended: Version Check at Agent Startup

Add a version check to the agent's initialization:

```python
def check_nlm_version() -> str:
    """Return installed nlm version; warn if unexpected."""
    result = subprocess.run(
        ["nlm", "--version"],
        capture_output=True, text=True, timeout=5
    )
    version = result.stdout.strip()
    TESTED_VERSION = "0.5.6"
    if version != TESTED_VERSION:
        logging.warning(
            f"nlm version mismatch: tested against {TESTED_VERSION}, "
            f"found {version}. JSON schemas may differ."
        )
    return version
```

---

## Complete Schema Summary Table

| Command | `--json` Support | Output Type | Top-Level Shape | Stable Fields |
|---------|:---:|:---:|:---:|-------|
| `notebook list` | Yes | Array | `[{id, title, source_count, ?updated_at}]` | `id`, `title`, `source_count` |
| `notebook get` | Yes | Object | `{notebook_id, title, source_count, url, sources[]}` | All fields |
| `notebook describe` | Yes | Object | `{summary, suggested_topics[]}` | All fields |
| `source list` | Yes | Array | `[{id, title, type, url}]` | `id`, `title`, `type` |
| `source describe` | Yes | Object | `{summary, keywords[]}` | All fields |
| `source content` | Yes | Object | `{content, title, source_type, char_count}` | All fields |
| `notebook query` | Yes | Object | `{answer, conversation_id, sources_used[], citations{}, references[]}` | `answer`, `conversation_id` |
| `studio status` | Yes | Array | `[{id, type, status, custom_instructions}]` | `id`, `type`, `status` |
| `audio create` | No | Text | N/A | N/A — parse exit code |
| `report create` | No | Text | N/A | N/A — parse exit code |
| `quiz create` | No | Text | N/A | N/A — parse exit code |
| `flashcards create` | No | Text | N/A | N/A — parse exit code |
| `mindmap create` | No | Text | N/A | N/A — parse exit code |
| `slides create` | No | Text | N/A | N/A — parse exit code |
| `research start` | No | Text | N/A | N/A — parse task ID from text |
| `research status` | No | Text | N/A | N/A — parse text or use service layer |
| `research import` | No | Text | N/A | N/A — parse exit code |
| Error output | Any | Object | `{status: "error", error, ?hint}` | All fields |

---

## Assumptions & Scope

### Assumptions Made

| Assumption | Confidence | Impact if Wrong |
|------------|:---:|-------|
| The installed v0.5.6 source code is authoritative for current behavior | HIGH | None — source was read directly from disk |
| TypedDict field names match JSON output field names | HIGH | Very low — code explicitly maps field names |
| `studio status --json` does not include mind maps | HIGH | Agent would miss mind map artifacts |
| `notebook list --json` does not call the service layer | HIGH | Agent would not receive `owned_count`, `shared_count` etc. |
| `citations` and `references` in query output have unstable structure | MEDIUM | If structure is stable, we could parse more detail |
| The `status` field in error JSON is always `"error"` | HIGH | Error detection logic would break |
| Studio creation commands will never add `--json` in a near future version | LOW | If they do add it, parsing becomes available |

### Scope Exclusions

- `nlm batch *` commands — not covered (out of scope for the agent)
- `nlm cross *` commands — not covered
- `nlm pipeline *` commands — not covered
- `nlm tag *`, `nlm alias *`, `nlm share *` — not covered (return text, not JSON)
- `nlm note *` — not covered (return text)
- Download commands — not covered (binary output)
- Chat configuration — `nlm chat configure` has no `--json`

### Uncertainties and Gaps

1. **`source get <source-id> --json` exact output**: The CLI calls `client.get_source_fulltext()` directly and passes the raw dict to `format_item()`. The exact dict structure from the client is not documented; it depends on the API response. The service layer `SourceContentResult` TypedDict provides a normalized version, but the CLI does not use the service layer here.

2. **`source describe <id> --json` exact output**: Similarly, `describe_source` in the CLI calls `client.get_source_guide()` directly. The raw dict structure may differ from `DescribeResult`. However, the formatter calls `format_item()` which uses `model_dump()` or `__dict__`, so the output should be close to the raw dict.

3. **Research commands without `--json`**: The exact format of `nlm research status` text output is not documented. Parsing it requires regex matching of the Rich-formatted text, which is fragile.

4. **`citations` and `references` structure in query results**: These pass through directly from Google's internal API. No schema is available.

5. **Behavior on non-TTY stdout**: The auto-detection logic `detect_output_format()` switches to JSON when stdout is not a TTY. This was confirmed in source but was not empirically tested via subprocess.

---

## Clarifying Questions for Follow-up

1. **Are research operations in scope for the ADK agent?** If yes, a parsing strategy for `research status` text output is needed, or the agent should directly use the Python service layer for research.

2. **Is the `source get <id>` command needed?** Its output structure is uncertain. `source content <id> --json` is better documented (uses the service layer) and returns the same information more reliably.

3. **Should the agent track `conversation_id` for multi-turn queries?** The `conversation_id` field in query responses is documented but may be null. If multi-turn is needed, the agent must store and forward this ID between turns.

4. **Is `--full` mode needed for `studio status`?** Without `--full`, `title` and `url` are absent. With `--full`, they are present. The `title` field is likely needed for user-facing display.

5. **What is the expected behavior when nlm is upgraded?** Should the agent pin to a specific version, or be designed to tolerate schema changes? This affects whether strict parsing or defensive parsing is appropriate.

---

## References

| # | Source | Path/URL | Information Gathered |
|---|--------|-----|---------------------|
| 1 | `notebooklm_tools/__init__.py` | `~/.local/share/uv/tools/notebooklm-mcp-cli/lib/python3.13/site-packages/notebooklm_tools/__init__.py` | Package version (0.5.6) |
| 2 | `core/models.py` | Same base path + `core/models.py` | Pydantic model definitions: `Notebook`, `Source`, `QueryResponse`, `StudioArtifact`, `ResearchTask`, etc. |
| 3 | `core/data_types.py` | Same base path + `core/data_types.py` | Internal dataclass definitions: `Notebook`, `ShareStatus`, `Collaborator`, `ConversationTurn` |
| 4 | `cli/formatters.py` | Same base path + `cli/formatters.py` | `JsonFormatter` class — exact JSON field selection for all array/list commands |
| 5 | `cli/utils.py` | Same base path + `cli/utils.py` | `handle_error()` — error JSON format `{status, error, hint}` |
| 6 | `cli/commands/notebook.py` | Same base path + `cli/commands/notebook.py` | How `notebook list`, `get`, `describe`, `query` route to formatters |
| 7 | `cli/commands/source.py` | Same base path + `cli/commands/source.py` | How `source list`, `describe`, `content` route to formatters |
| 8 | `cli/commands/studio.py` | Same base path + `cli/commands/studio.py` | How `studio status` routes; confirmed no `--json` on create commands |
| 9 | `cli/commands/research.py` | Same base path + `cli/commands/research.py` | Confirmed no `--json` on research commands |
| 10 | `services/notebooks.py` | Same base path + `services/notebooks.py` | `NotebookInfo`, `NotebookDetailResult`, `NotebookSummaryResult` TypedDicts |
| 11 | `services/sources.py` | Same base path + `services/sources.py` | `AddSourceResult`, `DescribeResult`, `SourceContentResult` TypedDicts |
| 12 | `services/studio.py` | Same base path + `services/studio.py` | `CreateResult`, `MindMapResult`, `ArtifactInfo`, `StatusResult` TypedDicts |
| 13 | `services/research.py` | Same base path + `services/research.py` | `ResearchStartResult`, `ResearchStatusResult`, `ResearchImportResult` TypedDicts |
| 14 | `services/chat.py` | Same base path + `services/chat.py` | `QueryResult` TypedDict |
| 15 | `services/errors.py` | Same base path + `services/errors.py` | `ServiceError`, `ValidationError`, `NotFoundError` hierarchy |
| 16 | GitHub CLI Guide | `https://raw.githubusercontent.com/jacob-bd/notebooklm-mcp-cli/main/docs/CLI_GUIDE.md` | Full command reference for all CLI commands and flags |
| 17 | Investigation document | `/Users/giorgosmarinos/aiwork/TrainingMaterial/108 - Google ADK/docs/reference/investigation-adk-nlm-agent.md` | Project context, approach rationale, architecture overview |
| 18 | Command reference | `/Users/giorgosmarinos/aiwork/TrainingMaterial/107b- NotebookLM/.claude/skills/manage-notebooklm/references/command_reference.md` | Complete task sequences and error handling |

### Recommended for Deep Reading

- **`cli/formatters.py`** (`JsonFormatter` class, lines 286–375): The single most authoritative source for what JSON fields are emitted. Any schema question should start here.
- **`services/notebooks.py`**, **`services/sources.py`**, **`services/chat.py`**, **`services/studio.py`**, **`services/research.py`**: TypedDicts define the contract between the service layer and the CLI/MCP layers. These define what fields _could_ appear in JSON output.
- **`cli/commands/notebook.py`** and **`cli/commands/studio.py`**: Shows where the CLI bypasses the service layer (e.g., `notebook list` and `studio status` call client methods directly), which explains why some TypedDict fields are absent from JSON output.
