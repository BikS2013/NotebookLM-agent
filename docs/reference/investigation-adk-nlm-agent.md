# Investigation: Google ADK Agent Wrapping NLM CLI

**Date**: 2026-04-10
**Status**: Complete
**Investigator**: Technical Research Phase 3a

---

## 1. Executive Summary

Building a Google ADK agent that wraps the `nlm` CLI to manage NotebookLM is straightforward and well-supported by the framework. ADK's `FunctionTool` mechanism automatically converts Python functions into LLM-callable tools using their signatures, docstrings, and type hints -- making subprocess-based CLI wrapping a natural fit. Four approaches were evaluated: direct CLI subprocess wrapping, MCP integration via ADK's native `McpToolset`, direct Python library import of `nlm`'s service layer, and a hybrid approach. **The recommended approach is Approach A (Direct CLI Wrapping via subprocess)** for its simplicity, reliability, and alignment with the project's constraints, with Approach C (Library Import) noted as a strong future alternative if deeper integration is needed.

---

## 2. Google ADK Analysis

### 2.1 Architecture Overview

Google ADK (Agent Development Kit) is an open-source, code-first Python framework for building AI agents. Key components:

- **LlmAgent** (aliased as `Agent`): The core agent class that uses an LLM for reasoning and tool selection. It is non-deterministic -- the LLM decides which tools to invoke based on instructions, conversation context, and tool descriptions.
- **FunctionTool**: Wraps a Python function as an agent-callable tool. ADK auto-inspects the function's name, docstring, parameters, type hints, and defaults to generate a tool schema for the LLM.
- **Runner**: Orchestrates the agent's reason-act loop, yielding event streams.
- **Session/State**: `InMemorySessionService` (or persistent alternatives) maintains conversation state across turns.
- **MCPToolset**: First-class integration with MCP servers (stdio and SSE/HTTP transports).

### 2.2 Project Structure Convention

ADK expects a specific directory structure for `adk run` and `adk web` to discover agents:

```
parent_directory/
  my_agent/
    __init__.py      # Must export `root_agent` (or the agent variable)
    agent.py         # Agent definition
    .env             # GOOGLE_API_KEY and other config
```

The `__init__.py` typically contains:
```python
from .agent import root_agent
```

Running: `adk run my_agent` (from `parent_directory`) or `adk web` (serves all agent subdirectories).

### 2.3 FunctionTool Mechanics

Functions are automatically wrapped when passed to `Agent(tools=[...])`. Key rules:

- **Docstring is critical**: The LLM uses the function's docstring to understand what the tool does and when to call it. Google-style docstrings with `Args:` and `Returns:` sections are recommended.
- **Type hints are required**: Parameter types and return types inform the schema. `dict` is the preferred return type.
- **Return value best practice**: Return a dictionary with a `"status"` key (e.g., `"success"`, `"error"`) to give the LLM a clear signal.
- **`ToolContext` parameter**: If a function includes a parameter typed as `ToolContext`, ADK injects it automatically. This provides access to `tool_context.state` for session state management.
- **`require_confirmation`**: `FunctionTool` supports a `require_confirmation=True` flag that asks the user before executing (useful for destructive operations).

Example pattern for a subprocess-wrapping tool:
```python
def list_notebooks() -> dict:
    """List all notebooks in the user's NotebookLM collection.

    Returns:
        Dictionary with status and list of notebooks.
    """
    result = subprocess.run(["nlm", "notebook", "list", "--json"],
                            capture_output=True, text=True, timeout=30)
    if result.returncode != 0:
        return {"status": "error", "error": result.stderr.strip()}
    return {"status": "success", "notebooks": json.loads(result.stdout)}
```

### 2.4 Session State

ADK provides session state via `tool_context.state`, which is a dictionary persisted across conversation turns:

```python
async def save_note(content: str, tool_context: ToolContext) -> str:
    tool_context.state["current_notebook_id"] = "abc123"
```

State changes are cached immediately in the context and persisted to the session when the event is processed by the Runner. This enables "current notebook" tracking across turns.

For `adk run` and `adk web`, ADK uses `InMemorySessionService` by default. For production, persistent session services (database-backed) are available.

### 2.5 Configuration

ADK reads a `.env` file from the agent directory. Key variables:

| Variable | Purpose |
|----------|---------|
| `GOOGLE_API_KEY` | API key for Gemini models (ML Dev backend) |
| `GOOGLE_GENAI_USE_VERTEXAI` | Set to `1` to use Vertex AI instead |
| `GOOGLE_CLOUD_PROJECT` | GCP project ID (Vertex AI only) |
| `GOOGLE_CLOUD_LOCATION` | GCP region (Vertex AI only) |

The model is specified in the `Agent()` constructor (e.g., `model="gemini-2.5-flash"`).

### 2.6 Error Handling in Tools

No built-in error-handling framework exists in ADK tools beyond what the function itself implements. Best practices:
- Catch exceptions in the tool function and return error dictionaries
- Include `"status": "error"` and a descriptive `"error_message"` key
- Never let exceptions propagate unhandled -- the LLM cannot reason about Python tracebacks

### 2.7 Known Gotcha: `adk web --no-reload`

When using subprocess-based tools with `adk web`, the `--no-reload` flag may be needed to avoid `_make_subprocess_transport` NotImplementedError due to how the reload mechanism interacts with asyncio event loops.

---

## 3. NLM CLI Analysis

### 3.1 Capabilities Summary

The `nlm` CLI (v0.4.4+, package `notebooklm-mcp-cli`) provides comprehensive programmatic access to Google NotebookLM. It is installed via `uv tool install notebooklm-mcp-cli`.

| Category | Key Commands | Output Formats |
|----------|-------------|----------------|
| **Auth** | `login`, `login --check`, `login --profile` | Text |
| **Notebooks** | `list`, `get`, `create`, `rename`, `delete`, `describe` | `--json`, `--quiet`, `--title`, `--full` |
| **Sources** | `add --url/--text/--file/--drive`, `list`, `describe`, `content`, `delete`, `stale`, `sync` | `--json`, `--quiet` |
| **Query** | `notebook query <nb> "question"` | `--json` |
| **Studio** | `audio/video/report/quiz/flashcards/mindmap/slides/infographic/data-table create` | `--json` |
| **Status** | `studio status` | `--json`, `--full` |
| **Download** | `download audio/video/report/...` | Binary files |
| **Sharing** | `share status/public/private/invite` | Text |
| **Aliases** | `alias list/set/get/delete` | Text |
| **Research** | `research start/status/import` | `--json` |
| **Notes** | `note list/create/update/delete` | Text |
| **Config** | `config show/get/set` | Text |
| **Diagnostics** | `doctor` | Text |

### 3.2 Output Formats

The `--json` flag is available on most commands and returns structured JSON, making it ideal for programmatic parsing. The `--quiet` flag returns only IDs (useful for piping). Default output is a compact table format that is more token-efficient but harder to parse reliably.

### 3.3 Authentication Model

- Browser-based Google cookie auth via `nlm login`
- 3-layer automatic recovery: CSRF refresh, token reload, headless auth
- Sessions last ~20 minutes with auto-recovery extending effective lifetime to 2-4 weeks
- Tokens stored at `~/.notebooklm-mcp-cli/`
- Multi-profile support (`--profile <name>`)
- Cannot be automated by the agent -- user must run `nlm login` manually

### 3.4 Rate Limits

- Free tier: ~50 API queries/day
- Server errors (429, 500, 502, 503, 504) are retried up to 3x with exponential backoff by the CLI itself

### 3.5 Timing Considerations

| Operation | Typical Duration |
|-----------|-----------------|
| Notebook list/get/create | 1-3 seconds |
| Source add | 2-5 seconds (+ processing time) |
| Source add `--wait` | 10-60 seconds |
| Query | 3-10 seconds |
| Audio/video generation | 1-5 minutes |
| Research deep mode | ~5 minutes |
| Report/quiz/flashcards | 30-60 seconds |

### 3.6 Internal Architecture (for Approach C evaluation)

The `notebooklm-mcp-cli` package has a layered architecture:

```
core/client.py      # Low-level batchexecute API calls
core/auth.py        # AuthManager, token management
core/constants.py   # API code-name mappings
services/*.py       # Business logic (notebooks.py, sources.py, studio.py, etc.)
cli/                # Thin CLI wrapper over services
mcp/                # Thin MCP wrapper over services
```

The `services/` layer is the key integration point -- it returns TypedDicts and raises `ServiceError`/`ValidationError`. The CLI and MCP layers are both thin wrappers over this same service layer.

### 3.7 MCP Server Mode (for Approach B evaluation)

The package includes a built-in MCP server (`notebooklm-mcp`) supporting:
- **Stdio transport**: `notebooklm-mcp` (default)
- **HTTP transport**: `notebooklm-mcp --transport http --port 8000`
- 35 tools covering all NotebookLM operations
- Setup via `nlm setup` for various AI clients (claude-code, gemini, cursor, etc.)

---

## 4. Approach Evaluation

### 4.1 Comparison Matrix

| Criteria | A: CLI Subprocess | B: MCP Integration | C: Library Import | D: Hybrid (MCP + CLI) |
|----------|:-:|:-:|:-:|:-:|
| **Simplicity** | High | Medium | Medium | Low |
| **Reliability** | High | Medium | High | Medium |
| **Performance** | Low (process spawn overhead) | Medium (server overhead) | High (in-process) | Medium |
| **Maintainability** | High | Medium | Low | Low |
| **Testability** | High (mock subprocess) | Medium | High (mock service calls) | Low |
| **Coupling to nlm internals** | None | None | High | Medium |
| **Error handling control** | Full (parse stderr) | Limited (MCP error format) | Full | Mixed |
| **Output control** | Full (`--json` flag) | Limited (MCP tool returns) | Full | Mixed |
| **Token efficiency** | Full control (truncation) | Limited | Full control | Mixed |
| **Setup complexity** | Low (just `nlm` on PATH) | Medium (MCP server mgmt) | Medium (import path mgmt) | High |
| **Alignment with refined-request** | Exact match | Deviation (OQ-7 said out of scope) | Deviation | Deviation |

### 4.2 Approach A: Direct CLI Wrapping (Subprocess)

Each `nlm` command becomes a Python function that calls `subprocess.run()`, passes `--json` for structured output, parses the JSON response, and returns a clean dictionary.

**Pros:**
- Simplest implementation -- each tool is a self-contained function
- Zero coupling to `nlm` internals -- treats it as a black box
- Easy to test with `subprocess` mocking (`unittest.mock.patch`)
- Full control over output parsing, truncation, and error handling
- Aligns exactly with the refined request specification
- Works with any `nlm` version without code changes (as long as CLI interface is stable)
- Naturally handles `--confirm` flags for non-interactive execution

**Cons:**
- Process spawn overhead per command (~100-200ms on macOS)
- No connection reuse -- each call is independent
- Cannot leverage `nlm`'s internal retry/recovery logic programmatically
- Long-running operations (research deep, audio generation) block the subprocess

### 4.3 Approach B: MCP Integration (McpToolset)

Use ADK's native `McpToolset` to connect to the `notebooklm-mcp` server, which exposes 35 tools.

**Pros:**
- ADK has first-class MCP support via `McpToolset`
- Stdio transport works locally with no network overhead
- All 35 nlm tools are immediately available
- Server manages its own auth recovery and connection lifecycle

**Cons:**
- MCP server must be running alongside the ADK agent (lifecycle management)
- 35 tools consume significant LLM context window (context window warning noted in nlm docs)
- Limited control over tool descriptions and return formats -- MCP tools have their own schemas
- Cannot easily truncate large outputs before they reach the LLM
- Cannot add custom pre/post-processing logic per tool
- MCP timeout defaults to 5 seconds -- many nlm operations exceed this
- The refined request explicitly marked MCP integration as out of scope (Section 3.2, bullet 7)
- Debugging is harder -- errors flow through MCP protocol layers
- `adk web` may have reload issues with MCP subprocess transport

### 4.4 Approach C: Library Import (Direct Service Layer)

Import `notebooklm_tools.services.*` directly and call the Python service functions.

**Pros:**
- Best performance -- no process spawn or server overhead
- Access to full Python objects (not just JSON strings)
- Can leverage internal retry logic and auth recovery
- Type-safe with TypedDict returns
- Can use async natively (services are async)

**Cons:**
- Tight coupling to `notebooklm-mcp-cli` internals -- breaking changes in service layer APIs
- The package is installed as a `uv tool` (isolated environment), not as a library dependency; importing from it requires either: (a) adding it as a project dependency instead, or (b) manipulating sys.path to find the tool's environment
- Service layer API is internal and not guaranteed to be stable
- Auth management (`AuthManager`) would need to be initialized correctly
- Async services require the ADK agent to also be async (ADK supports this but adds complexity)
- Different mental model from how the refined request envisioned the integration

### 4.5 Approach D: Hybrid (MCP + CLI)

Use MCP for some operations and direct CLI for others.

**Pros:**
- Could optimize per-operation (MCP for fast ops, CLI for slow ones)

**Cons:**
- Two integration mechanisms to maintain
- Inconsistent error handling and output formatting
- Complex lifecycle management
- Highest cognitive overhead for developers
- No clear benefit over a single consistent approach

---

## 5. Recommended Approach

### Recommendation: Approach A -- Direct CLI Wrapping via Subprocess

**Justification:**

1. **Alignment with specification**: The refined request (Section 3.2, C-3) explicitly specifies subprocess wrapping with `subprocess.run()` and `--json` output parsing. This is not an accident -- it was a deliberate design decision.

2. **Simplicity**: Each tool is a self-contained Python function. No server lifecycle management, no import path manipulation, no async complexity. A junior developer can understand and modify any individual tool in isolation.

3. **Decoupling**: The `nlm` CLI is treated as a stable external interface. The CLI's command syntax and `--json` output format are the public API contract. Internal refactors of `notebooklm-mcp-cli` (which has happened -- it was "completely refactored" in January 2026) do not affect the agent.

4. **Testability**: Subprocess calls are trivially mockable. Each tool function can be unit-tested by mocking `subprocess.run` to return known JSON outputs. No need to set up MCP servers or manage auth state in tests.

5. **Full control**: Tool wrappers can truncate large outputs before returning to the LLM (critical for token efficiency with 100+ notebooks), add custom error classification, and format results optimally for LLM consumption.

6. **Performance is acceptable**: The 100-200ms subprocess overhead is negligible compared to the 1-10 second nlm API call latency. The user is interacting conversationally, not running batch operations.

7. **Future upgrade path**: If performance becomes a concern later, migrating individual tools from subprocess to library import (Approach C) is straightforward -- the tool function signature stays the same, only the implementation changes.

### Implementation Pattern

```python
import subprocess
import json
from typing import Optional

def _run_nlm(args: list[str], timeout: int = 60) -> dict:
    """Execute an nlm CLI command and return parsed result."""
    try:
        result = subprocess.run(
            ["nlm"] + args,
            capture_output=True, text=True, timeout=timeout
        )
        if result.returncode != 0:
            stderr = result.stderr.strip()
            if "expired" in stderr.lower() or "authentication" in stderr.lower():
                return {"status": "auth_error", "error": stderr,
                        "action": "Please run 'nlm login' to re-authenticate."}
            return {"status": "error", "error": stderr}
        
        # Try JSON parse, fall back to raw text
        try:
            data = json.loads(result.stdout)
            return {"status": "success", "data": data}
        except json.JSONDecodeError:
            return {"status": "success", "output": result.stdout.strip()}
    except subprocess.TimeoutExpired:
        return {"status": "error", "error": f"Command timed out after {timeout}s"}

def list_notebooks() -> dict:
    """List all notebooks in the user's NotebookLM collection.

    Returns a summary of all notebooks including their IDs, titles,
    and last update timestamps.
    """
    result = _run_nlm(["notebook", "list", "--json"])
    if result["status"] == "success" and "data" in result:
        notebooks = result["data"]
        if len(notebooks) > 50:
            result["data"] = notebooks[:50]
            result["truncated"] = True
            result["total_count"] = len(notebooks)
    return result
```

---

## 6. Key Design Decisions

### 6.1 Tool Granularity

**Decision**: One tool per action (e.g., `list_notebooks`, `create_notebook`, `delete_notebook`).

**Rationale**: Individual tools give the LLM clearer descriptions and reduce ambiguity. A grouped tool like `manage_notebook(action="delete", ...)` requires the LLM to understand internal dispatching, increasing error rates. ADK's FunctionTool works best when each tool has a focused docstring.

**Estimated tool count**: ~25-30 tools covering all nlm command categories.

### 6.2 Synchronous vs Asynchronous

**Decision**: Use `subprocess.run()` (synchronous) for v1.

**Rationale**: 
- Long-running operations (audio/video generation, deep research) are already async on the NotebookLM server side -- the CLI just initiates and returns
- Status polling is a separate tool call (`studio_status`)
- `asyncio.create_subprocess_exec()` would add complexity for minimal benefit
- ADK supports both sync and async tools; sync tools are simpler

### 6.3 Error Handling Strategy

**Decision**: Classify errors into categories and return structured error dicts.

Categories:
- `auth_error`: Authentication expired -- instruct user to run `nlm login`
- `not_found`: Notebook/source/artifact not found -- suggest listing available items
- `rate_limit`: Rate limit hit -- inform user about ~50/day limit
- `timeout`: Command timed out -- suggest retrying or checking status
- `error`: Generic error -- include raw stderr message

### 6.4 Output Truncation

**Decision**: Tool wrappers truncate large outputs before returning to the LLM.

Rules:
- Notebook list: Return max 50 items with `truncated: true` and `total_count`
- Source list: Return max 30 items
- Source content: Return first 2000 characters with `truncated: true`
- Studio status: Return all items (typically <20)

### 6.5 Destructive Operation Handling

**Decision**: Use ADK's `require_confirmation=True` on `FunctionTool` for delete operations, AND require the `--confirm` flag in the subprocess call.

This provides a double safeguard:
1. ADK asks the user for confirmation before calling the tool
2. The CLI receives `--confirm` to execute non-interactively

### 6.6 Session State Usage

**Decision**: Track these items in `tool_context.state`:

| Key | Purpose |
|-----|---------|
| `current_notebook_id` | Last-used notebook for implicit references ("add a source to it") |
| `current_notebook_title` | Display name for the current notebook |
| `last_conversation_id` | For query follow-ups |
| `auth_verified` | Whether auth was checked this session |

### 6.7 NLM CLI Path Configuration

**Decision**: Configurable via environment variable, no fallback default.

Per project conventions, if the `NLM_CLI_PATH` config variable is not provided, raise an exception. However, a pragmatic approach is to check if `nlm` is on PATH as the configured value, making the config variable effectively "the path to the nlm executable."

**Note**: Per project convention rules, this must be documented as an explicit exception in the project's memory file before implementation, since it involves a PATH lookup that could be considered a default behavior.

### 6.8 Timeout Configuration

**Decision**: Different timeouts per operation category.

| Category | Timeout (seconds) |
|----------|-------------------|
| List/get/create/delete | 30 |
| Source add (no --wait) | 30 |
| Source add (--wait) | 120 |
| Query | 60 |
| Studio create | 60 |
| Research start | 30 |
| Research status (polling) | 360 |
| Download | 120 |

---

## 7. Technical Research Guidance

Research needed: Yes

### Topic 1: ADK FunctionTool Advanced Patterns
- **Why**: The investigation confirmed basic FunctionTool usage, but the implementation phase needs precise details on: (a) how `require_confirmation` interacts with `adk run` vs `adk web` (does CLI prompt? does web UI show a button?), (b) whether sync functions with long timeouts (>30s) block the ADK event loop, (c) exact error propagation behavior when a tool function raises vs returns an error dict.
- **Focus**: Test `require_confirmation` in both `adk run` and `adk web`. Test a sync tool that takes 60+ seconds. Test what happens when a tool raises an exception vs returns `{"status": "error"}`.
- **Depth**: moderate

### Topic 2: ADK Session State Persistence and Scope
- **Why**: The investigation confirmed `tool_context.state` exists and works, but needs clarity on: (a) whether state persists across `adk run` restarts (it likely does not with `InMemorySessionService`), (b) how state is scoped when using `adk web` with multiple browser tabs, (c) whether `output_key` on the agent itself can be used alongside tool-level state writes.
- **Focus**: Read ADK source code for `InMemorySessionService` behavior. Test multi-tab behavior in `adk web`. Document state lifecycle for the design doc.
- **Depth**: moderate

### Topic 3: NLM CLI `--json` Output Schema Stability
- **Why**: The entire subprocess approach depends on reliably parsing `--json` output. The investigation did not find formal JSON schema documentation for nlm output. If the JSON structure changes between nlm versions, tool wrappers will break silently.
- **Focus**: Run each nlm command with `--json` and capture actual output schemas. Document the expected JSON structure for each command used by the agent. Determine if nlm has schema versioning or stability guarantees.
- **Depth**: comprehensive

### Topic 4: `adk web --no-reload` Requirement
- **Why**: Web search surfaced a known issue where subprocess-based tools fail with `_make_subprocess_transport` NotImplementedError when using `adk web` without `--no-reload`. This needs to be verified for our specific subprocess usage pattern (calling external CLI, not an MCP stdio server).
- **Focus**: Test `adk web` with a simple subprocess-calling tool. Determine if `--no-reload` is needed. Document the workaround if so.
- **Depth**: quick

### Topic 5: ADK Agent System Prompt Engineering
- **Why**: The agent's effectiveness depends heavily on the system prompt (the `instruction` parameter). The investigation focused on architecture, not on what makes an effective ADK agent instruction. Gemini models may have specific prompt patterns that work better for tool-using agents.
- **Focus**: Review ADK samples and codelabs for system prompt patterns. Test different instruction styles (concise vs detailed, explicit tool guidance vs open-ended). Determine optimal instruction length and structure.
- **Depth**: moderate

---

## Appendix A: References

### Google ADK
- Official Documentation: https://google.github.io/adk-docs/
- GitHub Repository: https://github.com/google/adk-python
- PyPI Package: https://pypi.org/project/google-adk/
- FunctionTool Docs: https://google.github.io/adk-docs/tools-custom/function-tools/
- MCP Tools Docs: https://google.github.io/adk-docs/tools-custom/mcp-tools/
- LlmAgent Docs: https://google.github.io/adk-docs/agents/llm-agents/
- Getting Started (Python): https://google.github.io/adk-docs/get-started/python/
- ADK Samples: https://github.com/google/adk-samples
- ADK + MCP Codelab: https://codelabs.developers.google.com/codelabs/currency-agent
- ADK + MCP Blog: https://cloud.google.com/blog/topics/developers-practitioners/use-google-adk-and-mcp-with-an-external-server
- ADK Setting Up Agents: https://arjunprabhulal.com/adk-setting-up-agent/
- ADK Custom Function Tools: https://arjunprabhulal.com/adk-custom-tools-function/

### NLM CLI
- GitHub Repository: https://github.com/jacob-bd/notebooklm-mcp-cli
- PyPI Package: https://pypi.org/project/notebooklm-mcp-cli/
- API Reference: https://github.com/jacob-bd/notebooklm-mcp-cli/blob/main/docs/API_REFERENCE.md
- CLI Guide: https://github.com/jacob-bd/notebooklm-mcp-cli/blob/main/docs/CLI_GUIDE.md
- MCP Guide: https://github.com/jacob-bd/notebooklm-mcp-cli/blob/main/docs/MCP_GUIDE.md

### Alternative: notebooklm-py
- GitHub: https://github.com/teng-lin/notebooklm-py
- PyPI: https://pypi.org/project/notebooklm-py/
- Python API Docs: https://github.com/teng-lin/notebooklm-py/blob/main/docs/python-api.md
