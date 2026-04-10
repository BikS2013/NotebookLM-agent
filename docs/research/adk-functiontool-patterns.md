# ADK FunctionTool Advanced Patterns & Agent System Prompt Engineering

**Date**: 2026-04-10
**Status**: Complete
**Research Scope**: Three topics — FunctionTool advanced patterns, `adk web --no-reload` subprocess issue, ADK agent system prompt engineering.
**Context**: Supporting the design of an ADK agent that wraps the `nlm` CLI via `subprocess.run()`.

---

## Table of Contents

1. [FunctionTool Advanced Patterns](#1-functiontool-advanced-patterns)
   - 1.1 [require_confirmation: CLI vs Web UI Behavior](#11-require_confirmation-cli-vs-web-ui-behavior)
   - 1.2 [Sync Tool Blocking: Event Loop Impact](#12-sync-tool-blocking-event-loop-impact)
   - 1.3 [Error Propagation: Exception vs Error Dict](#13-error-propagation-exception-vs-error-dict)
   - 1.4 [Return Types and What the LLM Sees](#14-return-types-and-what-the-llm-sees)
2. [adk web --no-reload Subprocess Issue](#2-adk-web---no-reload-subprocess-issue)
3. [ADK Agent System Prompt Engineering](#3-adk-agent-system-prompt-engineering)
4. [Assumptions & Scope](#4-assumptions--scope)
5. [References](#5-references)

---

## 1. FunctionTool Advanced Patterns

### 1.1 `require_confirmation`: CLI vs Web UI Behavior

#### Overview

`require_confirmation` is a feature of `FunctionTool` that pauses tool execution and waits for explicit user approval before proceeding. It was introduced in ADK Python v1.14.0 and is marked as **experimental** in the official docs. The feature is distinct from "have the LLM ask the user a question" -- it operates at the ADK framework level, injecting a confirmation gate before the tool body runs.

The `require_confirmation` parameter accepts:
- `True` (bool): Requires a simple yes/no for every call.
- A callable that receives tool arguments and a `ToolContext` and returns `bool`: Dynamically decides whether to confirm based on input values.

```python
from google.adk.agents import Agent
from google.adk.tools import FunctionTool, ToolContext

# Simple boolean confirmation
delete_tool = FunctionTool(
    func=delete_notebook,
    require_confirmation=True
)

# Dynamic threshold confirmation (only require when risky)
async def needs_confirmation(notebook_id: str, tool_context: ToolContext) -> bool:
    """Require confirmation only for system notebooks."""
    # Could check state, validate ID prefix, etc.
    return notebook_id.startswith("sys-")

delete_tool = FunctionTool(
    func=delete_notebook,
    require_confirmation=needs_confirmation
)

agent = Agent(
    name="nlm_agent",
    model="gemini-2.5-flash",
    instruction="...",
    tools=[delete_tool]
)
```

#### Behavior in `adk web` (Web UI)

When `adk web` is running and the agent decides to call a tool with `require_confirmation=True`, the web UI displays a **dialog box** prompting the user to approve or reject. The user clicks a confirmation button (labeled with an exclamation mark icon) and the ADK framework sends back a `FunctionResponse` with `{"confirmed": true}` before executing the actual tool function.

This is a first-class UI experience: the agent visibly pauses, a dialog appears, the user confirms, and the tool executes. The specific interaction is:

1. Agent decides to call the guarded tool.
2. ADK framework intercepts and generates a synthetic `adk_request_confirmation` function call event instead of calling the real tool.
3. The web UI renders a confirmation dialog.
4. The user confirms (or rejects).
5. ADK sends a `FunctionResponse` for `adk_request_confirmation` with `{"confirmed": true/false}`.
6. If confirmed, ADK calls the actual tool function. If rejected, the tool is skipped and the agent sees a rejection result.

#### Behavior in `adk run` (CLI)

The official `adk run` command documentation does **not** describe any built-in terminal prompt for `require_confirmation`. The CLI interface is limited to a text-based input/output loop (the user types a message, the agent responds). There is no native CLI dialog for tool confirmation.

**Key implication**: When using `adk run` with a tool that has `require_confirmation=True`, the confirmation request surfaces as a `FunctionCall` event in the event stream. The standard `adk run` terminal interface does not intercept this and present a Y/N prompt. The tool call effectively pauses waiting for a `FunctionResponse` that never arrives via the standard CLI interface.

**Workarounds for CLI:**

Option A — Remote confirmation via REST API: While the agent is paused, send a confirmation `FunctionResponse` via curl to the `/run_sse` endpoint of a running `adk web` instance:
```bash
curl -X POST http://localhost:8000/run_sse \
  -H "Content-Type: application/json" \
  -d '{
    "app_name": "nlm_agent",
    "user_id": "user",
    "session_id": "<session_id>",
    "new_message": {
      "parts": [{
        "function_response": {
          "id": "<function_call_id_from_adk_request_confirmation>",
          "name": "adk_request_confirmation",
          "response": {"confirmed": true, "payload": {}}
        }
      }],
      "role": "user"
    }
  }'
```

Option B — Use `adk web` instead of `adk run` for all workflows involving destructive operations. The web UI has native support.

Option C — Do not use `require_confirmation` in the tool; instead, build confirmation into the LLM's system prompt (e.g., "Always ask the user to confirm before deleting anything"). This is a prompt-engineering-only solution and is less reliable than the framework-level gate.

**Recommendation for the NLM agent**: Since destructive operations (notebook delete, source delete) require user confirmation, use `require_confirmation=True` and develop/test using `adk web`. If CLI-only operation is needed, use the system prompt approach as a fallback and document the limitation.

#### Known Limitations (Official)

- `DatabaseSessionService` is not supported with `require_confirmation`.
- `VertexAiSessionService` has a known issue where giving authorization on ADK Web causes agent execution to fail.
- Only `FunctionTool` supports `require_confirmation`; `McpTool` does not.

---

### 1.2 Sync Tool Blocking: Event Loop Impact

#### ADK Runtime Architecture

ADK is built on an **async-first architecture** using `asyncio`. The runner's core loop is `Runner.run_async`. The synchronous `Runner.run` method is a convenience wrapper that drives the async loop via `asyncio.run()` or similar. All agent reasoning, tool execution, and event streaming happen within this async context.

#### What Happens with Synchronous Tools

ADK supports both `async def` and regular `def` tool functions. When a sync (`def`) tool is invoked within the async runner:

- ADK wraps synchronous tool functions using `asyncio.to_thread()` (Python's standard library mechanism for running blocking functions in a thread pool without blocking the event loop).
- This means the event loop is **not blocked** by the sync tool's execution time for I/O-bound operations.
- The thread pool thread that runs the sync function IS blocked, but the event loop thread remains free.

**Critical warning from official docs (ADK v1.10.0+):**

> Any ADK Tools that use synchronous processing in a set of tool function calls will block other tools from executing in parallel, even if the other tools allow for parallel execution.

Starting from ADK v1.10.0, when the LLM requests multiple tool calls simultaneously (parallel function calls from Gemini), ADK attempts to run them in parallel. A sync tool using `asyncio.to_thread()` will occupy one thread-pool slot. Since the default thread pool is finite, many concurrent long-running sync tools can exhaust the pool and cause queuing. However, a single sync tool running for 60+ seconds will not freeze the main event loop.

#### Practical Impact for subprocess-calling Tools

Our `subprocess.run()` calls are synchronous blocking I/O. Each call blocks its thread (not the event loop) for the subprocess duration. The implications:

| Scenario | Impact |
|----------|--------|
| Single tool call taking 30-60s (e.g., `nlm source add --wait`) | Thread pool thread is occupied for duration; event loop keeps running; agent pauses awaiting the result (correct behavior) |
| Multiple simultaneous tool calls (parallel Gemini function calls) | Each gets its own thread-pool slot; all run concurrently up to thread pool limit |
| Tool call >120s (e.g., audio generation with `--wait`) | Thread occupied until done; no timeout from ADK itself -- relies on `subprocess.run(timeout=...)` |
| Exception during `subprocess.run()` (e.g., `TimeoutExpired`) | Exception propagates in the thread; if not caught, ADK may surface it as an agent error |

**Bottom line**: Sync subprocess tools with timeouts up to 120s are safe to use. The event loop is not blocked. The `subprocess.run(timeout=N)` parameter is the critical safety valve -- never call `subprocess.run()` without an explicit timeout.

#### Best Practice: Async Alternative for Parallel Execution

If parallel tool execution performance matters, convert to async:

```python
import asyncio
import json

async def list_notebooks() -> dict:
    """List all notebooks in the user's NotebookLM collection."""
    try:
        proc = await asyncio.create_subprocess_exec(
            "nlm", "notebook", "list", "--json",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=30)
        if proc.returncode != 0:
            return {"status": "error", "error": stderr.decode().strip()}
        return {"status": "success", "data": json.loads(stdout.decode())}
    except asyncio.TimeoutError:
        return {"status": "error", "error": "Command timed out after 30s"}
```

This is the preferred pattern for production use. However, for v1 with `adk web` (which already handles the Uvicorn event loop concerns via `--no-reload`), synchronous `subprocess.run()` is acceptable.

---

### 1.3 Error Propagation: Exception vs Error Dict

#### The Two Paths

**Path A: Tool function raises an unhandled exception**

When a tool function raises an exception that is not caught internally:
- If using `asyncio.to_thread()` (sync tool), the exception propagates from the thread back to the awaiting coroutine.
- ADK catches the exception at the framework level and converts it to an error event.
- The LLM does **not** see a human-readable error description; it sees a framework-level error response.
- The agent workflow may halt or the runner may surface the error to the caller.
- The LLM cannot reason about the error, retry intelligently, or inform the user constructively.

**Path B: Tool function returns a structured error dict**

When a tool function catches exceptions internally and returns an error dict:
- ADK serializes the dict as the tool's `FunctionResponse`.
- The LLM sees the full dict content in its context window.
- The LLM can read `"status": "error"`, `"error": "Authentication expired"`, `"action": "Run nlm login"` and formulate an intelligent response.
- The agent workflow continues normally.

#### Official ADK Guidance

> Strive to make your return values as descriptive as possible. Instead of returning a numeric error code, return a dictionary with an "error_message" key containing a human-readable explanation. Remember that **the LLM, not a piece of code, needs to understand the result**.

> Include a "status" key in your return dictionary to indicate the overall outcome (e.g., "success", "error", "pending"), providing the LLM with a clear signal about the operation's state.

#### Callback-Level Error Handling

ADK provides `after_tool_callback` and `on_tool_error` (Plugin) callbacks for intercepting errors at the framework level. These are appropriate for cross-cutting concerns (logging, metrics, retry logic) but should not replace tool-internal error handling. The recommended layered approach:

```python
def list_notebooks() -> dict:
    """List all notebooks in the user's NotebookLM collection."""
    try:
        result = subprocess.run(
            ["nlm", "notebook", "list", "--json"],
            capture_output=True, text=True, timeout=30
        )
        if result.returncode != 0:
            stderr = result.stderr.strip()
            # Classify the error for the LLM
            if "expired" in stderr.lower() or "authentication" in stderr.lower():
                return {
                    "status": "auth_error",
                    "error": stderr,
                    "action": "The user must run 'nlm login' to re-authenticate."
                }
            if "not found" in stderr.lower():
                return {"status": "not_found", "error": stderr}
            if "429" in stderr or "rate limit" in stderr.lower():
                return {
                    "status": "rate_limit",
                    "error": "NotebookLM API rate limit reached (~50 queries/day).",
                    "action": "Wait before retrying."
                }
            return {"status": "error", "error": stderr}

        try:
            data = json.loads(result.stdout)
            return {"status": "success", "data": data}
        except json.JSONDecodeError:
            return {"status": "success", "output": result.stdout.strip()}

    except subprocess.TimeoutExpired:
        return {"status": "timeout", "error": "nlm command timed out after 30s."}
    except FileNotFoundError:
        return {
            "status": "config_error",
            "error": "nlm executable not found on PATH.",
            "action": "Verify NLM_CLI_PATH configuration."
        }
    except Exception as e:
        # Last-resort catch — never let unknown exceptions escape
        return {"status": "error", "error": f"Unexpected error: {type(e).__name__}: {e}"}
```

#### Error Classification Table

| Status Value | When to Use | LLM Guidance |
|---|---|---|
| `"success"` | Operation completed normally | Proceed with result |
| `"error"` | Generic failure (see `error` key) | Describe error to user |
| `"auth_error"` | Authentication expired | Tell user to run `nlm login` |
| `"not_found"` | Resource does not exist | Suggest listing available resources |
| `"rate_limit"` | API quota exceeded | Tell user to wait |
| `"timeout"` | Command exceeded timeout | Suggest retry or polling |
| `"config_error"` | CLI not found or misconfigured | Tell user to check configuration |

---

### 1.4 Return Types and What the LLM Sees

#### How ADK Serializes Tool Returns

When a tool function returns a value, ADK:
1. Serializes the return value as a `FunctionResponse.response` object (a dict/JSON structure).
2. Inserts it into the conversation as a `role="tool"` message in the LLM's context.
3. The LLM reads this response when generating its next turn.

**For dict returns**: The dict is passed directly as the response. All keys and values are visible to the LLM.

**For string returns**: ADK wraps the string in a dict: `{"result": "<your_string>"}`.

**For primitive returns (int, float, bool)**: ADK wraps as `{"result": <value>}`.

**For None returns**: ADK sends `{}` or `{"result": null}`. The LLM sees an empty/null result and may be confused. Avoid returning `None`.

#### Parameter Type Handling

ADK auto-generates a JSON schema from the function signature:
- Type-annotated parameters are mapped to JSON Schema types.
- `Optional[str]` (or `str | None`) maps to `{"type": "string", "nullable": true}`.
- Parameters with defaults become optional in the schema.
- `ToolContext`-typed parameters are **not** included in the schema (ADK injects them automatically; the LLM does not provide them).
- Pydantic `BaseModel` parameters are supported and generate nested schemas automatically.

```python
from pydantic import BaseModel
from typing import Optional

class NotebookQuery(BaseModel):
    notebook_id: str
    question: str
    max_results: Optional[int] = 5

def query_notebook(query: NotebookQuery) -> dict:
    """Query a notebook with a natural language question."""
    # ADK generates a nested schema for NotebookQuery
    ...
```

#### Token Efficiency Considerations

The LLM's context window includes all tool responses from the current conversation turn. Large tool responses (e.g., returning all 200 notebooks in a list) consume significant tokens and can degrade reasoning quality or hit context limits.

**Best practices for token efficiency:**

```python
def list_notebooks() -> dict:
    """List all notebooks in the user's NotebookLM collection."""
    result = _run_nlm(["notebook", "list", "--json"])
    if result["status"] == "success" and "data" in result:
        notebooks = result["data"]
        if len(notebooks) > 50:
            # Truncate at the tool level -- the LLM never sees the full list
            result["data"] = notebooks[:50]
            result["truncated"] = True
            result["total_count"] = len(notebooks)
            result["note"] = "List truncated to 50 items. Ask user to filter by name or date if needed."
    return result
```

Recommended truncation limits (from investigation document):
- Notebook list: max 50 items
- Source list: max 30 items per notebook
- Source content: first 2000 characters
- Studio status: all items (typically <20)

---

## 2. `adk web --no-reload` Subprocess Issue

### Problem Description

When using `adk web` (the development web UI powered by FastAPI + Uvicorn) with tools that spawn subprocesses (including `subprocess.run()` calls), the server may raise:

```
NotImplementedError: _make_subprocess_transport
```

The traceback originates from Python's `asyncio.base_events._make_subprocess_transport`.

### Root Cause

The issue has **two distinct manifestations** with the same root cause:

**Manifestation 1 (Windows-specific)**: On Windows, Uvicorn sets the asyncio event loop policy to `WindowsSelectorEventLoopPolicy` at startup. This policy's event loop does not support subprocess transports (`_make_subprocess_transport` raises `NotImplementedError`). This affects any code using `asyncio.create_subprocess_exec()`, which includes MCP stdio transport inside ADK.

**Manifestation 2 (Reload mode, cross-platform)**: When `adk web` runs with hot-reload enabled (the default), Uvicorn spawns a child process for the application. This child process inherits an event loop state that may be incompatible with further subprocess creation -- especially when using `asyncio`-based subprocess creation within tool functions or MCP clients.

### Does This Affect Our Use Case?

Our use case: calling `nlm` via `subprocess.run()` (a synchronous blocking call, not using asyncio subprocess APIs).

| Tool Pattern | Affected by This Issue? |
|---|---|
| `subprocess.run(...)` (sync) | **Typically not directly affected** -- `subprocess.run` uses the standard OS-level process creation, not asyncio's subprocess transport. However, if the reload mechanism spawns processes in a way that interferes, this can be unpredictable. |
| `asyncio.create_subprocess_exec(...)` (async) | **Directly affected** on Windows and potentially on reload mode on macOS. |
| MCP stdio transport | **Directly affected** -- MCP uses `asyncio.create_subprocess_exec()` internally. |

**Assessment**: For synchronous `subprocess.run()` tools, the `--no-reload` issue is less likely to cause errors directly. However, since the official ADK documentation and community guidance recommends `--no-reload` for any subprocess-related work, and since there is no cost to using it during development, the flag should be applied regardless.

### The Fix

Run `adk web` with the `--no-reload` flag:

```bash
adk web --no-reload
```

This disables Uvicorn's hot-reload mechanism, which is what spawns the problematic child processes and interferes with subprocess transports.

### Developer Workflow Impact

The `--no-reload` flag means code changes require manually restarting `adk web`. To mitigate:

```bash
# Start in a shell with easy restart (Ctrl+C and up-arrow)
cd /path/to/agent/parent
adk web --no-reload

# Or use a Makefile target
# Makefile:
# dev:
#     adk web --no-reload
```

**Note**: `adk web` is explicitly documented as a development/debugging tool, not for production deployment. The `--no-reload` flag is appropriate for development purposes and does not affect the agent's behavior or capabilities.

### Additional Fix for Windows

On Windows, if `--no-reload` is insufficient (e.g., for MCP stdio tools), set the Proactor event loop policy before Uvicorn overrides it:

```python
# In agent/__init__.py or a startup script:
import asyncio
import sys
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
```

Note: Uvicorn may override this setting. The more reliable Windows fix is to use SSE-based MCP servers instead of stdio transport, or to run on macOS/Linux/WSL.

---

## 3. ADK Agent System Prompt Engineering

### 3.1 The `instruction` Parameter

The `instruction` parameter of `LlmAgent` (alias: `Agent`) serves as the system prompt. It is the **single most impactful parameter** for shaping agent behavior. Official documentation states:

> The `instruction` parameter is arguably the most critical for shaping an `LlmAgent`'s behavior.

The instruction tells the agent:
- Its role and persona
- Its scope and constraints
- When and why to use each tool (not just that the tools exist)
- Expected output format
- How to handle edge cases

The instruction is a string template. It supports `{var}` syntax to inject values from session state dynamically:

```python
agent = Agent(
    instruction="""You are NotebookLM Manager, helping {user_name?} manage their notebooks.
Current active notebook: {current_notebook_title?} (ID: {current_notebook_id?})
""",
    ...
)
```

The `?` suffix on `{var?}` makes the state variable optional (no error if absent).

### 3.2 Instruction Structure Best Practices

Based on official ADK documentation and real-world sample analysis, the following structure is recommended for tool-using agents:

```
[PERSONA / ROLE DEFINITION]
One or two sentences establishing who the agent is.

[SCOPE AND CONSTRAINTS]
What the agent can and cannot do. What domains it handles.

[TOOL USAGE GUIDANCE]
For each tool or group of tools:
- When to use it
- What parameters to provide
- How to interpret the result
- What to do when the result is an error

[MULTI-STEP WORKFLOW PATTERNS]
For operations that require multiple tool calls in sequence.

[OUTPUT FORMAT]
How to present results to the user.

[ERROR HANDLING CONVENTIONS]
How to respond when tools return errors.
```

### 3.3 Instruction Length and Density

There is no enforced character limit on the instruction. However, the instruction occupies the system prompt slot in the LLM's context window. Key observations from ADK samples:

| Agent Complexity | Typical Instruction Length | Example |
|---|---|---|
| Simple single-purpose agent | 50-200 words | Capital city lookup agent |
| Multi-tool agent | 200-500 words | Customer support, GitHub labeler |
| Complex workflow agent (GEPA sample) | 500-1000 words | Vote taker with PII handling, BigQuery |

**Guideline for the NLM agent** (25-30 tools, complex workflows): Target 400-700 words. Use markdown structure (headings, bullet lists) to improve LLM parsing of the instruction.

### 3.4 Tool Guidance Patterns

The instruction should explicitly explain tools rather than assuming the LLM infers usage from docstrings alone. Two patterns are effective:

**Pattern A: Implicit (docstring-first)**
Rely on well-written docstrings with Google-style `Args:` and `Returns:` sections. Add only brief instruction-level guidance:
```
When the user references "it" or "this notebook" without specifying a name or ID,
use the current_notebook_id from session state to identify the target.
```

**Pattern B: Explicit (instruction-first)**
Name each tool and its usage trigger in the instruction:
```
Use the `list_notebooks` tool when the user asks to see their notebooks.
Use the `create_notebook` tool when the user wants to create a new notebook.
Use the `delete_notebook` tool ONLY after explicit user confirmation.
```

**Recommendation**: Use Pattern A for common operations and Pattern B for critical or non-obvious behaviors (e.g., how to handle implicit notebook references, when to ask for clarification, how to chain tools for multi-step tasks).

### 3.5 Multi-Step Workflow Instruction Patterns

For operations that require multiple tool calls in a defined sequence, explicitly document the workflow in the instruction:

```
## Adding a Source to a Notebook

When the user asks to add a source:
1. If no notebook is specified, check session state for current_notebook_id.
   If not set, ask the user which notebook to use.
2. Call `add_source` with the notebook ID and the source URL/text/file.
3. Inform the user that the source is being processed (processing may take 2-5 minutes).
4. If the user asks for status, call `list_sources` on the notebook to check progress.

## Creating a Studio Output (Audio, Video, Report)

When the user asks to create an audio overview, podcast, or report:
1. Confirm the target notebook (use current_notebook_id or ask).
2. Call the appropriate create tool (e.g., `create_audio`).
3. Inform the user that generation takes 1-5 minutes.
4. When asked about status, call `studio_status` to check progress.
5. When complete, call `download_audio` if the user wants the file.
```

### 3.6 Parallel Tool Call Guidance

ADK v1.10.0+ runs tool calls in parallel when the LLM issues multiple function calls simultaneously. To encourage this behavior, explicitly mention it in the instruction:

```
When the user asks for information about multiple notebooks or multiple sources,
call the relevant tools in parallel rather than sequentially.
```

From the ADK performance documentation, example instruction snippet:
```
When users ask for multiple pieces of information, always call functions in
parallel.

Examples:
- "Get weather for London and currency rate USD to EUR" → Call both functions simultaneously
- "Compare two notebooks" → Call get_notebook for each in parallel
```

### 3.7 State Variable References in Instructions

Session state can be injected directly into the instruction template, which is a powerful pattern for context-aware agents:

```python
instruction = """You are a NotebookLM Manager agent.

## Current Context
Active notebook: {current_notebook_title?} (ID: {current_notebook_id?})
Authentication verified this session: {auth_verified?}

## Your Responsibilities
...
"""
```

When `current_notebook_title` is set in `tool_context.state["current_notebook_title"]`, the instruction automatically reflects it. This eliminates the need to repeat the current notebook in every response.

### 3.8 Complete Instruction Template for the NLM Agent

The following is a recommended starting instruction for the NotebookLM Manager agent based on the research findings:

```python
NLM_AGENT_INSTRUCTION = """You are NotebookLM Manager, an AI assistant that helps users
manage their Google NotebookLM notebooks, sources, queries, and studio outputs
through natural conversation.

## Scope
You manage notebooks, sources, queries, and studio outputs (audio, video, reports,
quizzes, flashcards) using the available tools. You do not have access to the
NotebookLM web interface directly -- you use the `nlm` command-line tool via your
toolset.

## Session Context
Current active notebook: {current_notebook_title?} (ID: {current_notebook_id?})

When the user refers to "this notebook", "it", "the current notebook", or similar,
use the current_notebook_id from the session context above. If no current notebook
is set and the user's intent is ambiguous, ask which notebook they mean.

## Tool Usage Guidelines

### Listing and Finding Notebooks
- Use `list_notebooks` to show all notebooks. Results are limited to 50.
- Use `get_notebook` with a specific ID to get details about one notebook.
- When a user references a notebook by name but you only have IDs, call
  `list_notebooks` first to find the matching ID.

### Creating and Managing Notebooks
- Use `create_notebook` when the user explicitly asks to create a new notebook.
- After creation, store the new notebook ID as the current active notebook.
- Use `delete_notebook` only when the user explicitly confirms the deletion.
  Always state what will be deleted before proceeding.

### Managing Sources
- Use `add_source` to add URLs, files, or text to a notebook.
- Source processing is asynchronous -- inform the user it may take 2-5 minutes.
- Use `list_sources` to check sources in a notebook.

### Querying Notebooks
- Use `query_notebook` when the user asks a question about a notebook's content.
- NotebookLM queries are rate-limited (~50/day). If a rate limit error occurs,
  inform the user and suggest waiting before retrying.

### Studio Outputs
- Generation takes 1-5 minutes. Inform the user and suggest checking status later.
- Use `studio_status` to check on pending generations.
- Use the appropriate download tool once generation completes.

## Error Handling
- `auth_error`: Tell the user to run `nlm login` in their terminal to re-authenticate.
- `not_found`: Suggest listing the relevant resources to find valid IDs.
- `rate_limit`: Inform the user about the daily query limit and suggest waiting.
- `timeout`: Suggest retrying the operation or checking if the CLI is installed correctly.
- `config_error`: Inform the user that the nlm CLI is not configured correctly.

## Output Style
- Be concise and factual. Present lists as bullet points or tables.
- For notebook and source lists, include IDs, titles, and dates.
- For errors, explain what went wrong and what the user can do next.
- Do not narrate your internal reasoning; just present results or ask questions.
"""
```

---

## 4. Assumptions & Scope

### Assumptions Made

| Assumption | Confidence | Impact if Wrong |
|---|---|---|
| `adk run` has no native terminal prompt for `require_confirmation` (user must use `adk web` or REST API) | HIGH | If ADK added CLI prompt support in a recent release, Option C (system prompt approach) becomes less necessary |
| Synchronous `subprocess.run()` tools are wrapped by ADK in `asyncio.to_thread()`, not run on the main event loop thread | HIGH | If not wrapped, sync tools would block the event loop and degrade performance significantly |
| The `--no-reload` requirement for `adk web` is relevant to `subprocess.run()` tools even though it is more commonly cited for MCP stdio | MEDIUM | If sync subprocess tools are completely unaffected, the `--no-reload` flag is still harmless but becomes merely a precaution |
| ADK v1.14.0+ is being used (require_confirmation was introduced in this version) | MEDIUM | If an older version is used, `require_confirmation` is unavailable and the feature must be replaced with prompt engineering |
| Gemini 2.5 Flash is the target model (instruction patterns may vary for other models) | MEDIUM | Other Gemini models or non-Gemini models may respond differently to instruction structures |

### Explicitly Out of Scope

- ADK session state persistence across restarts (separate research topic)
- NLM CLI JSON output schema verification
- MCP integration patterns
- Java, Go, TypeScript ADK variants (Python only)
- Production deployment (Cloud Run, Agent Engine)

### Uncertainties and Gaps

- **`adk run` confirmation behavior**: No direct test was conducted -- the CLI's behavior with `require_confirmation` is inferred from documentation gaps (the docs describe web UI behavior explicitly, CLI behavior is not mentioned). There may be a version-specific CLI prompt that was added after v1.14.0.

- **`asyncio.to_thread()` wrapping**: ADK source code was not read to confirm the exact mechanism. The conclusion is based on official ADK documentation statements about sync tool handling and community reports of sync tools working without blocking the event loop.

- **Instruction length sweet spot**: No A/B testing data was found for optimal instruction length. The 400-700 word recommendation is based on sample analysis and general LLM prompt engineering principles.

---

## 5. References

| # | Source | URL | Information Gathered |
|---|---|---|---|
| 1 | ADK Docs: Tool Confirmation | https://adk.dev/tools-custom/confirmation/ | Complete `require_confirmation` API, boolean/advanced modes, web UI dialog, REST API confirmation, known limitations |
| 2 | ADK Docs: Function Tools | https://adk.dev/tools-custom/function-tools/ | Function signature rules, required/optional parameters, return type handling, long-running tools |
| 3 | ADK Docs: LLM Agents | https://adk.dev/agents/llm-agents/ | `instruction` parameter details, tool guidance, state template injection, `{var?}` syntax |
| 4 | ADK Docs: Tool Performance | https://adk.dev/tools-custom/performance/ | Parallel execution (v1.10.0+), async tool patterns, sync blocking warning, thread pool examples |
| 5 | ADK Docs: Command Line | https://raw.githubusercontent.com/google/adk-docs/main/docs/runtime/command-line.md | `adk run` interface, session save/resume/replay, storage options |
| 6 | ADK GitHub Issue #585 | https://github.com/google/adk-python/issues/585 | `_make_subprocess_transport` NotImplementedError on Windows, root cause analysis |
| 7 | ADK GitHub Issue #3008 | https://github.com/google/adk-python/issues/3008 | `require_confirmation` not supported for MCP tools (FunctionTool only) |
| 8 | ADK GitHub Issue #3290 | https://github.com/google/adk-python/issues/3290 | `require_confirmation` broken with VertexAiSessionService |
| 9 | Medium: Human-in-the-loop Made Easy | https://medium.com/google-cloud/2-minute-adk-human-in-the-loop-made-easy-da9e74d9845a | Practical example of confirmation flow, web UI dialog description |
| 10 | Medium: Fixing NotImplementedError on Windows | https://medium.com/@nilamwadhavane123/fixing-notimplementederror-when-running-remote-mcp-agent-via-adk-on-windows-8bd736adb705 | Detailed root cause of `_make_subprocess_transport`, `--no-reload` workaround |
| 11 | Medium: ADK on Windows Guide | https://medium.com/@ssupinma/implementing-google-adk-and-mcp-on-windows-a-practical-guide-e27e78d1b165 | Alternative fixes (ProactorEventLoop, SSE-based MCP), trade-off analysis |
| 12 | Medium: Prompt Engineering with ADK | https://medium.com/@george_6906/prompt-engineering-with-googles-agent-development-kit-adk-d748ba212440 | System prompt best practices, format guidance, few-shot examples |
| 13 | ADK Docs: Agent Event Loop | https://google.github.io/adk-docs/runtime/event-loop/ | Async-first architecture, yield/pause/resume model |
| 14 | Google Cloud Blog: Multi-Agent Systems | https://cloud.google.com/blog/topics/developers-practitioners/building-collaborative-ai-a-developers-guide-to-multi-agent-systems-with-adk | Agent architecture patterns, "super agent" anti-pattern |
| 15 | Context7 / ADK Python samples | https://context7.com/google/adk-python/llms.txt | FunctionTool examples, ToolContext usage, save_note async pattern, GEPA voter agent instruction template |

### Recommended for Deep Reading

- **[ADK Tool Confirmation Docs](https://adk.dev/tools-custom/confirmation/)**: Complete reference for `require_confirmation`. Essential for implementing safe delete operations.
- **[ADK Tool Performance Docs](https://adk.dev/tools-custom/performance/)**: Covers parallel execution, async patterns, and thread pool examples. Read before converting sync tools to async.
- **[ADK LLM Agents Docs](https://adk.dev/agents/llm-agents/)**: Full `instruction` parameter reference including state template injection.
- **[ADK human_tool_confirmation sample](https://github.com/google/adk-python/blob/fc90ce968f114f84b14829f8117797a4c256d710/contributing/samples/human_tool_confirmation/agent.py)**: Complete working example of advanced confirmation with web UI dialog and REST API confirmation.

---

## Clarifying Questions for Follow-up

1. **`adk run` with `require_confirmation`**: What exactly happens at the terminal when a sync tool with `require_confirmation=True` is called via `adk run`? Does the process hang indefinitely, throw an error, or skip the confirmation? (This would require a direct test.)

2. **ADK version in use**: Which specific ADK version is being installed for this project? Some behaviors (parallel execution v1.10.0, `require_confirmation` v1.14.0) are version-gated.

3. **Target OS**: Is development primarily on macOS or Windows? The `--no-reload` workaround is critical on Windows but is still recommended on macOS for subprocess-based tools.

4. **Parallel tool calls**: Does the Gemini 2.5 Flash model actually emit parallel function calls in practice for the NLM use case, or does it typically call tools sequentially? This affects whether converting tools to `async def` provides measurable performance improvement.

5. **Instruction style preference**: Should the NLM agent instruction be role-focused ("You are...") or task-focused ("Your job is to..."), and how much structured markdown (headings/lists) vs. flowing prose is preferred? This affects readability for developers maintaining the prompt.
