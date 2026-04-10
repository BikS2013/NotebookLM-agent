# ADK Session State Persistence and Scope

**Date**: 2026-04-10
**Status**: Complete
**Context**: Research to support the NLM CLI ADK agent that tracks "current notebook" across conversation turns.

---

## Overview

Google ADK (Agent Development Kit) provides a structured session state mechanism that allows agents to maintain information across multiple conversation turns. State is stored as a serializable key-value dictionary (`session.state`) associated with a `Session` object, managed by a `SessionService`. Understanding which `SessionService` implementation is in use, how state keys are scoped, and how state is written correctly is critical for building a reliable notebook-tracking agent.

---

## Key Concepts

### The Session Object

Every conversation thread in ADK is represented by a `Session` object with four key properties:

| Property | Description |
|---|---|
| `id` | Unique identifier for the conversation thread |
| `app_name` | Identifies the agent application the conversation belongs to |
| `user_id` | Links the conversation to a particular user |
| `state` | Key-value scratchpad for data relevant to this conversation thread |
| `events` | Chronological list of all interactions (messages, tool calls, responses) |
| `last_update_time` | Timestamp of the last event in the thread |

A single `SessionService` can manage multiple `Session` objects simultaneously.

### The InvocationContext

Each complete user-request-to-final-response cycle is called an **invocation**. The ADK framework creates an `InvocationContext` at the start of each invocation and passes it implicitly to agent code, callbacks, and tools. You typically never create this object yourself.

---

## Session State Persistence: Which Service Keeps State?

### InMemorySessionService (Default)

`InMemorySessionService` is the **default** service used by both `adk run` and `adk web`. It stores all sessions and state entirely in Python process memory.

**Critical behavior**: State is **not persistent across process restarts**. If you stop `adk run` or `adk web` and restart it, all session state is lost. A new session is created for each new run.

```python
from google.adk.sessions import InMemorySessionService

session_service = InMemorySessionService()
# All state lives in memory; lost on restart.
```

**Implication for the NLM agent**: When using `adk run` for development, `current_notebook_id` and other tracked state will reset every time the CLI is restarted. This is expected behavior for development but is a limitation to be aware of.

---

### DatabaseSessionService (Persistent, Self-Managed)

`DatabaseSessionService` connects to a relational database via SQLAlchemy to store sessions persistently. State **survives application restarts**.

```python
from google.adk.sessions import DatabaseSessionService

# SQLite (development/single user)
session_service = DatabaseSessionService(db_url="sqlite:///./my_agent_data.db")

# PostgreSQL (production)
session_service = DatabaseSessionService(
    db_url="postgresql://username:password@localhost:5432/session_db"
)
```

The service creates the required tables on first initialization (no setup scripts needed). The database structure includes tables for session metadata, user state, app state, and raw event history.

Switching from SQLite to PostgreSQL requires only a URL change -- ADK uses SQLAlchemy under the hood and supports all SQLAlchemy-compatible databases.

**Important warning**: Google ADK uses SQLAlchemy internally in `DatabaseSessionService`. This is a framework-level implementation detail, not something you call directly. Avoid using SQLAlchemy in the agent's own code per project conventions.

---

### VertexAiSessionService (Persistent, Google Cloud)

`VertexAiSessionService` stores session data in Vertex AI Agent Engine. Best for production workloads deployed on Google Cloud.

```python
from google.adk.sessions import VertexAiSessionService

session_service = VertexAiSessionService(
    project="your-gcp-project",
    location="us-central1"
)
```

---

### Service Comparison

| Service | Persistence | Restart Survival | Best For |
|---|---|---|---|
| `InMemorySessionService` | In-memory only | No | Development, testing, demos |
| `DatabaseSessionService` | SQL database | Yes | Self-managed production, persistent dev |
| `VertexAiSessionService` | Vertex AI Agent Engine | Yes | Google Cloud production deployments |

---

## State Scope: Key Prefixes

ADK uses **key name prefixes** to control the scope of state values. The `SessionService` routes reads and writes to the correct underlying store based on these prefixes.

| Prefix | Scope | Persistence | Use Case |
|---|---|---|---|
| *(none)* | Current session (`session_id`) only | Only with Database/VertexAI service | Task progress, current step tracking |
| `user:` | All sessions for this `user_id` (within the same `app_name`) | With Database/VertexAI; in-memory with InMemory service (lost on restart) | User preferences, profile data |
| `app:` | All users and all sessions for this `app_name` | With Database/VertexAI; in-memory with InMemory service (lost on restart) | Global settings, shared configuration |
| `temp:` | Current invocation only | Never — discarded after invocation completes | Intermediate calculations, API responses within a single turn |

**Important note**: Even with `InMemorySessionService`, the prefix semantics are respected during a running session. For example, `user:preferred_notebook` will be visible across all sessions for that user within the same process lifetime. The data is still lost on restart regardless.

**For the NLM agent**: `current_notebook_id` and `current_notebook_title` should use **no prefix** (session-scoped). If persistence across restarts is desired during development, use `user:current_notebook_id` with a `DatabaseSessionService`.

### Scoping Examples

```python
# Session-scoped (lost on new session, survives across turns in the same session)
tool_context.state["current_notebook_id"] = "abc123"

# User-scoped (survives across sessions for the same user, if using persistent service)
tool_context.state["user:preferred_notebook_id"] = "abc123"

# App-scoped (shared across ALL users and sessions)
tool_context.state["app:default_model"] = "gemini-2.5-flash"

# Temp (discarded after this invocation/turn completes)
tool_context.state["temp:last_api_response"] = {...}
```

---

## How `adk web` Handles Sessions with Multiple Tabs

### Session Creation

When `adk web` is running, each new chat conversation creates a new session. Each browser tab that starts a new conversation gets a unique `session_id`. State is isolated per session by default.

### The `user_id` Hardcoding Issue

**Known limitation**: In the current `adk web` UI, the `user_id` is **hardcoded to the string `"user"`** for all conversations. This means:

- Multiple browser tabs all share the same `user_id = "user"`.
- The session-scoped state (no prefix) is **isolated per tab** because each tab gets a different `session_id`.
- The `user:`-scoped state is **shared across all open tabs** (since all tabs use `user_id = "user"`).
- The `app:`-scoped state is shared across everything.

This `user_id` hardcoding is a documented limitation in [GitHub Issue #49 on google/adk-web](https://github.com/google/adk-web/issues/49). Proposed workarounds (query parameter, cookie, JS API) have been filed but not yet implemented as of April 2026.

### Practical Implications for Multi-Tab Use

| State Key | Tab A Session | Tab B Session | Same User? |
|---|---|---|---|
| `current_notebook_id` | Isolated | Isolated | N/A (session-scoped) |
| `user:preferred_notebook_id` | Shared | Shared | Yes (both are `user_id="user"`) |
| `app:config_value` | Shared | Shared | Always shared |

**Conclusion**: When using `adk web` for development with multiple tabs, unprefixed state is safely isolated per tab (per session). `user:`-prefixed state will be shared across tabs, which may cause unexpected interactions if two tabs are modifying the same `user:` key simultaneously.

### Setting Default Session State in `adk web`

There are two approaches to pre-populate state before a session starts:

**Approach 1: POST request to the API server**

While `adk web` is running (it exposes an API server on port 8000 by default), create a session with initial state via curl:

```bash
curl -X POST -H "Content-Type: application/json" \
  -d '{"state": {"current_notebook_id": null, "auth_verified": false}}' \
  "http://127.0.0.1:8000/apps/my_agent/users/user/sessions/my_session_001"
```

**Approach 2: Programmatic session creation**

When instantiating the runner programmatically (not via `adk web`):

```python
from google.adk.sessions import InMemorySessionService

session_service = InMemorySessionService()

session = await session_service.create_session(
    app_name="nlm_agent",
    user_id="user",
    session_id="session_001",
    state={
        "current_notebook_id": None,
        "current_notebook_title": None,
        "auth_verified": False,
        "last_conversation_id": None,
    }
)
```

---

## How to Initialize Default State Values

### Pattern 1: At Session Creation (Recommended for Pre-known Defaults)

Pass an initial state dictionary when creating the session:

```python
session = await session_service.create_session(
    app_name="nlm_agent",
    user_id="user123",
    state={
        "current_notebook_id": None,
        "current_notebook_title": None,
        "auth_verified": False,
    }
)
```

### Pattern 2: Conditional Check in Tools (Runtime Initialization)

Check and set a default value the first time a tool reads a state key:

```python
async def get_current_notebook(tool_context: ToolContext) -> dict:
    """Get the currently selected notebook."""
    notebook_id = tool_context.state.get("current_notebook_id")
    if notebook_id is None:
        return {
            "status": "no_notebook_selected",
            "message": "No notebook is currently selected. Use list_notebooks() to see available notebooks."
        }
    return {"status": "success", "notebook_id": notebook_id}
```

### Pattern 3: Using `{key?}` in Agent Instructions (Optional Placeholder)

When referencing state in the agent's instruction string, use `{key?}` (with a trailing `?`) for keys that may or may not be present. This prevents an error if the key is missing:

```python
from google.adk.agents import LlmAgent

agent = LlmAgent(
    name="nlm_agent",
    model="gemini-2.5-flash",
    instruction="""You are a NotebookLM assistant.
The user's currently selected notebook is: {current_notebook_title?}
(If no notebook is selected, the user must select one first.)
""",
    tools=[...]
)
```

If `current_notebook_title` is not in state, the placeholder is replaced with an empty string (or omitted, depending on ADK version). Without the `?`, a missing key raises an error.

---

## The Three State-Writing Mechanisms

### Mechanism 1: `output_key` on the Agent (Easiest)

Setting `output_key` on an `LlmAgent` causes the agent's final text response to be automatically saved to `session.state[output_key]` after each turn. The Runner handles this via `EventActions.state_delta` internally.

```python
from google.adk.agents import LlmAgent

agent = LlmAgent(
    name="notebook_selector",
    model="gemini-2.5-flash",
    instruction="Select the notebook the user is asking about and state its ID.",
    output_key="last_agent_response"  # Saves final text to state["last_agent_response"]
)
```

**Limitations of `output_key`**:
- Saves only the agent's **final text response** (a string).
- Saves to a **single key** only.
- Cannot be used to save structured data like a notebook ID alongside a title.
- Best suited for multi-agent pipeline handoffs, not for tracking complex state.

### Mechanism 2: `tool_context.state` (Standard for Tools)

The most common pattern for tools that need to update session state is to write directly to `tool_context.state`. The ADK framework automatically captures these writes and routes them into the correct `EventActions.state_delta` when the event is appended.

```python
from google.adk.tools import ToolContext

async def select_notebook(notebook_id: str, tool_context: ToolContext) -> dict:
    """Set the currently active notebook for subsequent operations.

    Args:
        notebook_id: The ID of the notebook to select.
        tool_context: ADK tool context (injected automatically).

    Returns:
        Dictionary with status and selected notebook details.
    """
    # Write multiple state keys in a single tool call
    tool_context.state["current_notebook_id"] = notebook_id
    tool_context.state["current_notebook_title"] = notebook_id  # Update after fetching details
    return {
        "status": "success",
        "message": f"Notebook {notebook_id} is now selected."
    }
```

State changes via `tool_context.state` are:
- Immediately available to subsequent callbacks in the same invocation.
- Persisted to the session when the event is processed by the Runner.
- Thread-safe because they go through the event tracking mechanism.

### Mechanism 3: `EventActions.state_delta` (Advanced, Manual)

For complex scenarios — updating multiple keys with different scopes, creating events manually, or updating state outside the normal agent execution flow — you can construct an `EventActions` with a `state_delta` dictionary and call `session_service.append_event()` directly.

```python
from google.adk.sessions import InMemorySessionService
from google.adk.events import Event, EventActions
import time

state_changes = {
    "current_notebook_id": "nb_abc123",
    "current_notebook_title": "My Research Notebook",
    "user:last_used_notebook_id": "nb_abc123",   # Also persist at user level
}

actions = EventActions(state_delta=state_changes)
event = Event(
    invocation_id="inv_001",
    author="system",
    actions=actions,
    timestamp=time.time()
)

await session_service.append_event(session, event)
```

---

## `output_key` vs `tool_context.state`: Can They Coexist?

Yes. `output_key` and `tool_context.state` writes are completely independent mechanisms that can be used together without conflict.

- `output_key` operates at the **agent response level**: after the agent produces its final text output, the Runner saves that text to `session.state[output_key]`.
- `tool_context.state` operates at the **tool execution level**: during tool execution within a turn, the tool writes to state via the context object.

Both changes end up in the same `session.state` dictionary, each under their respective keys. There is no interference unless you use the same key for both, which would result in the `output_key` write overwriting the tool's value (since the agent response is finalized after tool calls).

**Recommended pattern for the NLM agent**: Use `tool_context.state` in tools to track notebook context (structured data with multiple keys), and optionally use `output_key` on a sub-agent if you need to capture intermediate agent text for a pipeline.

```python
# Scenario: tool writes structured state, output_key captures final text response

agent = LlmAgent(
    name="nlm_agent",
    model="gemini-2.5-flash",
    instruction="Manage NotebookLM notebooks. Current notebook: {current_notebook_title?}",
    output_key="last_response",   # Captures final text for potential pipeline use
    tools=[select_notebook, list_notebooks, ...]
)

# In select_notebook tool:
# tool_context.state["current_notebook_id"] = "nb_abc"
# tool_context.state["current_notebook_title"] = "My Notebook"
# These coexist with output_key="last_response" on the agent -- no conflict.
```

---

## Context Objects: Differences and When to Use Each

ADK provides multiple context object types, each scoped to a different execution phase.

| Context Type | Where Used | State Access | Key Use Case |
|---|---|---|---|
| `ToolContext` | Tool function body (when parameter typed as `ToolContext`) | Read + Write via `.state` | Tool logic that needs to read or write session state |
| `CallbackContext` | Agent callbacks (`before_agent_callback`, `after_tool_callback`, etc.) | Read + Write via `.state` | Pre/post processing, guardrails, logging |
| `ReadonlyContext` | `InstructionProvider` function | Read only via `.state` | Building dynamic instructions from state |
| `InvocationContext` | Custom agent `_run_async_impl` method | Full access via `.session.state` | Custom orchestration agents |

### `tool_context.state` vs `tool_context.session`

- `tool_context.state`: The **correct way** to read and write session state from within a tool. Changes are automatically tracked as a `state_delta` on the current event.
- `tool_context.session`: Provides access to the raw `Session` object. **Avoid writing directly to `tool_context.session.state`** -- it bypasses event tracking, is not thread-safe, and will not be persisted correctly by `DatabaseSessionService` or `VertexAiSessionService`.

```python
# CORRECT: Use tool_context.state for writes
tool_context.state["current_notebook_id"] = "nb_abc"

# WRONG: Do not write directly to the session object
tool_context.session.state["current_notebook_id"] = "nb_abc"  # Bypasses event tracking!

# ACCEPTABLE: Direct session.state read (for read-only inspection)
current_id = tool_context.session.state.get("current_notebook_id")
# But prefer: current_id = tool_context.state.get("current_notebook_id")
```

---

## State Injection into Agent Instructions

State values can be injected directly into an agent's `instruction` string using `{key}` syntax. The framework substitutes the placeholder with the current state value before passing the instruction to the LLM.

```python
agent = LlmAgent(
    name="nlm_agent",
    model="gemini-2.5-flash",
    instruction="""You are a NotebookLM management assistant.

Current context:
- Selected notebook: {current_notebook_title?}
- Selected notebook ID: {current_notebook_id?}
- Authentication verified: {auth_verified?}

When the user refers to "the current notebook", "it", or "this notebook",
use the currently selected notebook ID above.
"""
)
```

**Important considerations**:
- Use `{key?}` (with `?`) for keys that may not yet be in state; missing optional keys are treated as empty strings.
- Use `{key}` (without `?`) only for keys guaranteed to always exist in state; a missing key raises an error at runtime.
- If your instruction contains literal curly braces (e.g., JSON examples), use an `InstructionProvider` function instead of a string to avoid accidental substitution.

---

## Best Practices for State Management in ADK Agents

### 1. Always Write State Through Context Objects

Write state only via `tool_context.state`, `callback_context.state`, or `output_key`. Never write directly to `session.state` retrieved from a `SessionService` call -- it bypasses the event tracking pipeline and breaks persistence with `DatabaseSessionService`.

### 2. Keep State Serializable

State values must be JSON-serializable: strings, numbers, booleans, lists, and dicts of these types. Do not store Python objects, class instances, functions, or database connections in state.

```python
# GOOD: serializable values
tool_context.state["current_notebook_id"] = "nb_abc123"
tool_context.state["notebook_ids_visited"] = ["nb_abc", "nb_def"]

# BAD: non-serializable
tool_context.state["notebook_obj"] = NotebookObject(...)   # Will fail
```

### 3. Use Clear, Descriptive Key Names

Adopt a consistent naming convention for state keys. Namespace by domain if multiple agents share state.

```python
# Recommended naming for NLM agent
"current_notebook_id"       # Active notebook for implicit references
"current_notebook_title"    # Display name of active notebook
"last_conversation_id"      # For query follow-ups
"auth_verified"             # Whether auth was checked this session
```

### 4. Use Prefix Scoping Deliberately

Choose the right prefix for each key based on its intended lifetime:

- Use no prefix for data that is specific to the current conversation thread.
- Use `user:` for preferences and settings that should persist across conversations for the same user (requires `DatabaseSessionService`).
- Use `temp:` for intermediate API responses or computed values that are only needed within the current turn.
- Avoid `app:` unless you have a genuine need for global shared state across all users.

### 5. Handle Missing Keys Defensively in Tools

Always use `.get("key", default)` when reading state, as the key may not yet be set:

```python
notebook_id = tool_context.state.get("current_notebook_id")
if not notebook_id:
    return {"status": "error", "error": "No notebook selected. Please select a notebook first."}
```

### 6. Use `DatabaseSessionService` for Any Development Beyond Quick Testing

If you are iterating on agent behavior across multiple sessions and need persistence, set up a local SQLite `DatabaseSessionService` early. The migration from `InMemorySessionService` is trivial (one line of code) and the benefits are significant.

### 7. Avoid Storing Large Data in State

State is loaded with every session fetch. Store only identifiers and small metadata. For large data (notebook content, source lists), fetch fresh from the CLI on each request and store only the result's ID or key in state.

```python
# GOOD: store the ID, fetch content on demand
tool_context.state["current_notebook_id"] = "nb_abc123"

# BAD: storing large payloads in state
tool_context.state["all_notebooks"] = [...]  # Could be hundreds of notebooks
```

---

## DatabaseSessionService Setup for the NLM Agent

To enable state persistence across `adk run` restarts during development:

```python
# agent.py
import os
from google.adk.agents import LlmAgent
from google.adk.sessions import DatabaseSessionService, InMemorySessionService
from google.adk.runners import Runner

# Choose service based on environment
DB_URL = os.environ.get("ADK_SESSION_DB_URL")  # Must be set; no fallback per project conventions

if DB_URL:
    session_service = DatabaseSessionService(db_url=DB_URL)
else:
    # For adk run / adk web without explicit config, raise clearly
    raise EnvironmentError(
        "ADK_SESSION_DB_URL is not set. "
        "Set it to a SQLAlchemy connection URL (e.g., 'sqlite:///./nlm_agent.db') "
        "to enable persistent sessions."
    )

runner = Runner(
    app_name="nlm_agent",
    agent=root_agent,
    session_service=session_service
)
```

**Note**: When using `adk run` or `adk web` without a custom runner, ADK creates its own `InMemorySessionService` internally. To use `DatabaseSessionService` with `adk web`, you must create a custom `App` object and pass it to the runner rather than relying on the auto-discovery mechanism. See the ADK API Server documentation for details.

---

## Common Pitfalls

### Pitfall 1: Expecting State to Persist Across `adk run` Restarts

With the default `InMemorySessionService`, restarting `adk run` or `adk web` erases all state. Do not design workflows that rely on state persisting across restarts unless you have configured `DatabaseSessionService` or `VertexAiSessionService`.

### Pitfall 2: Writing Directly to `session.state` (Bypassing Event Tracking)

```python
# WRONG -- bypasses ADK event tracking, breaks persistence
session = await session_service.get_session(...)
session.state["key"] = "value"   # This will NOT be saved correctly

# CORRECT -- always use the context object within tools/callbacks
tool_context.state["key"] = "value"
```

### Pitfall 3: Using Required State Key References in Instructions Without Guaranteeing the Key Exists

```python
# WRONG -- if "current_notebook_title" is not in state, this raises at runtime
instruction="Current notebook: {current_notebook_title}"

# CORRECT -- use {key?} for potentially absent keys
instruction="Current notebook: {current_notebook_title?}"
```

### Pitfall 4: Storing Non-Serializable Values in State

Storing Python objects, connections, or functions in state will raise serialization errors, especially with `DatabaseSessionService`.

### Pitfall 5: Assuming `user:` State Isolates Between Tabs in `adk web`

Because `adk web` hardcodes `user_id = "user"`, all tabs share the same `user:`-scoped state. Avoid using `user:` keys for values that should be isolated per conversation tab.

### Pitfall 6: `output_key` Overwriting Tool-Written State

If a tool writes to a key and the agent's `output_key` uses the **same key name**, the agent's text response (a string) will overwrite the structured value the tool stored. Use distinct key names for `output_key` and tool state writes.

---

## Recommended State Design for the NLM Agent

Based on the design decisions in the investigation document (Section 6.6), here is the recommended state schema with full prefix reasoning:

| State Key | Prefix | Type | Lifetime | Purpose |
|---|---|---|---|---|
| `current_notebook_id` | None (session) | `str \| None` | Current conversation | Last-used notebook for implicit references ("add source to it") |
| `current_notebook_title` | None (session) | `str \| None` | Current conversation | Human-readable name for display in instructions |
| `last_conversation_id` | None (session) | `str \| None` | Current conversation | For query follow-ups within the session |
| `auth_verified` | None (session) | `bool` | Current conversation | Whether `nlm login --check` was run this session |

If persistence across sessions is desired (e.g., "remember the last notebook I used"), promote `current_notebook_id` to `user:current_notebook_id` and use `DatabaseSessionService`.

### Injecting State into Agent Instructions

```python
from google.adk.agents import LlmAgent

root_agent = LlmAgent(
    name="nlm_agent",
    model="gemini-2.5-flash",
    instruction="""You are a NotebookLM management assistant that helps users manage their
Google NotebookLM notebooks, sources, and studio content via the nlm CLI.

## Current Session Context
- Currently selected notebook: {current_notebook_title?} (ID: {current_notebook_id?})
- Authentication status: {auth_verified?}

## Behavior Rules
- When the user refers to "the current notebook", "it", or "this notebook" without
  specifying which one, use the currently selected notebook (current_notebook_id above).
- If no notebook is selected and the user performs an operation requiring one,
  ask the user to specify or select a notebook first.
- Always use the select_notebook tool to update the current notebook when the user
  explicitly selects or switches to a different notebook.
""",
    tools=[...]
)
```

---

## Assumptions and Scope

| Assumption | Confidence | Impact if Wrong |
|---|---|---|
| `adk web` hardcodes `user_id = "user"` | HIGH | If fixed in newer versions, `user:` prefix scoping across tabs may work as expected |
| `tool_context.state` writes are automatically tracked as `state_delta` | HIGH | State persistence could silently fail if framework behavior changed |
| `output_key` and `tool_context.state` do not interfere unless same key is used | HIGH | Minor re-design to use distinct keys |
| `DatabaseSessionService` works with `adk web` via custom `App` object | MEDIUM | May require additional configuration; not directly tested here |
| State key reference `{key?}` in instructions handles missing keys gracefully | HIGH | Missing keys with `{key}` syntax raise runtime errors |
| `InMemorySessionService` is used by default for `adk run` and `adk web` | HIGH | Core design assumption confirmed in official docs |

### What is Explicitly Out of Scope

- Memory services (`VertexAIMemoryBankService`) -- these provide long-term semantic memory beyond session state and are not relevant for notebook tracking.
- Multi-agent state sharing (SequentialAgent, ParallelAgent) -- the NLM agent is a single-agent design.
- Authentication context objects -- `ToolContext.request_credential()` for OAuth flows (not applicable to nlm CLI auth).

---

## References

| # | Source | URL | Information Gathered |
|---|---|---|---|
| 1 | ADK Official Docs -- State | https://google.github.io/adk-docs/sessions/state/ | Complete state documentation including prefixes, update methods, InstructionProvider, warnings |
| 2 | ADK Official Docs -- Session | https://google.github.io/adk-docs/sessions/session/ | Session object properties, InMemorySessionService creation API, initial state setup |
| 3 | ADK Official Docs -- Context | https://google.github.io/adk-docs/context/ | Context object types (ToolContext, CallbackContext, ReadonlyContext, InvocationContext), their differences and use cases |
| 4 | ADK Official Docs -- Web Interface | https://google.github.io/adk-docs/runtime/web-interface/ | adk web behavior |
| 5 | ADK Official Docs -- API Server | https://google.github.io/adk-docs/runtime/api-server/ | Session creation API endpoint, pre-populating state via POST |
| 6 | Google Cloud Blog -- State and Memory with ADK | https://cloud.google.com/blog/topics/developers-practitioners/remember-this-agent-state-and-memory-with-adk | InMemorySessionService non-persistence, DatabaseSessionService, prefix scoping overview |
| 7 | Medium -- ADK Session and State Management (Feb 2026) | https://medium.com/google-cloud/google-adk-session-and-state-management-understanding-sessions-and-state-a5e05b62f1f1 | State scope prefixes, multi-session behavior |
| 8 | Medium -- Long-Term Memory in ADK (Feb 2026) | https://medium.com/@anushruthikae/long-term-memory-in-adk-inmemory-database-sessionservice-0cef18018692 | InMemory vs DatabaseSessionService comparison |
| 9 | Medium -- Building Persistent Sessions with ADK | https://medium.com/@juanc.olamendy/building-persistent-sessions-with-google-adk-a-comprehensive-guide-c3bab191269d | DatabaseSessionService SQLite setup, table structure |
| 10 | Medium -- Persistent Storage with SQLite (Part 5) | https://medium.com/@dharamai2024/persistent-storage-in-adk-building-memory-agents-with-sqlite-part-5-c0a2e4a058a5 | SQLite DatabaseSessionService practical example |
| 11 | ADK Masterclass Part 6 -- Persisting Sessions | https://saptak.in/writing/2025/05/10/google-adk-masterclass-part6 | DatabaseSessionService configuration, table structure |
| 12 | GitHub Discussion -- Setting Default Session State in adk web | https://github.com/google/adk-python/discussions/2753 | POST API approach and programmatic approach for default state |
| 13 | GitHub Issue -- Customizable User ID in adk web | https://github.com/google/adk-web/issues/49 | user_id hardcoded to "user" in adk web UI, proposed workarounds |
| 14 | Google Developer Forum -- Using DatabaseSessionService | https://discuss.google.dev/t/using-databasesessionservice/287292 | Community usage patterns |
| 15 | Context7 -- ADK Python Docs (session_state_agent README) | https://github.com/google/adk-python/blob/main/contributing/samples/session_state_agent/README.md | State lifecycle, immediate availability after write, persistence timing |
| 16 | Context7 -- ADK Python Docs (llms.txt) | https://context7.com/google/adk-python/llms.txt | output_key with output_schema, save_note async tool pattern |
