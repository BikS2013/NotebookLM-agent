# Refined Request: LLM Proxy — Agent-to-LLM Traffic Monitor

**Version**: 1.0  
**Date**: 2026-04-11  
**Status**: Draft  
**Source**: User request for an optional proxy component to capture full agent-LLM message payloads

---

## 1. Problem Statement

When developing and debugging the NotebookLM agent, the developer has no visibility into the exact messages exchanged between the ADK agent and the LLM (Gemini). The ADK runner abstracts away the raw requests and responses, making it impossible to inspect:

- What system prompt, conversation history, and tool schemas are actually sent to the LLM in each request
- What additional data the ADK framework injects (e.g., state-injected instructions, tool definitions, function call/response content)
- The exact structure and format of the LLM's response (content, function calls, finish reasons, token usage)
- How many round trips occur during a single user interaction (initial request, tool calls triggering follow-up requests, etc.)
- Whether the agent is sending redundant data or exceeding token budgets

The existing `/last` slash command shows a high-level summary of session events but does not expose the raw LLM request/response payloads as they are sent to and received from the Gemini API.

---

## 2. Functional Requirements

### FR-PROXY-01: ADK Plugin Implementation

The LLM proxy must be implemented as an ADK `BasePlugin` subclass that intercepts all agent-to-LLM communication via the plugin callback mechanism. The plugin must implement at minimum:

- `beforeModelCallback` — captures the full `LlmRequest` before it is sent to the model
- `afterModelCallback` — captures the full `LlmResponse` after it is received from the model
- `beforeToolCallback` — captures tool invocations (name, arguments) triggered by the LLM
- `afterToolCallback` — captures tool results returned to the LLM
- `onModelErrorCallback` — captures errors during LLM calls

The plugin must NOT modify any requests or responses (purely observational — all callbacks must return `undefined`).

### FR-PROXY-02: Round Trip Tracking

Each interaction (from user message to final agent response) may involve multiple LLM round trips (initial request, tool call responses fed back, follow-up generation). The proxy must:

- Assign a unique interaction ID to each user message submission
- Track and number each LLM round trip within an interaction (round trip 1, 2, 3, ...)
- Record the timestamp of each round trip (request sent, response received)
- Link tool calls and tool results to the round trip that triggered them

### FR-PROXY-03: Full Payload Capture

For each LLM round trip, the proxy must capture:

**Request payload:**
- Model name
- System instruction (the full resolved instruction including injected state)
- Conversation history (`contents` array) — all `Content` objects with their roles and parts
- Tool declarations (names, descriptions, parameter schemas from `config.tools`)
- Generation config (temperature, top-p, safety settings, etc., from `config`)

**Response payload:**
- Content (text parts, function call parts)
- Token usage metadata (prompt tokens, completion tokens, total tokens)
- Finish reason
- Grounding metadata (if present)
- Error code and message (if error response)
- Partial/streaming flags

**Tool call details (within a round trip):**
- Tool name
- Arguments (full JSON)
- Result (full JSON)
- Duration (time between before/after tool callbacks)
- Errors (if tool execution failed)

### FR-PROXY-04: Structured Log Storage

Captured data must be written to a structured log file. Requirements:

- One log file per session (named with session ID and timestamp)
- Log format: NDJSON (newline-delimited JSON) — one JSON object per event
- Each log entry must have: event type, timestamp, interaction ID, round trip number, and the payload
- Log file location: configurable output directory
- Log files must be human-readable when pretty-printed with standard tools (e.g., `jq`)

### FR-PROXY-05: Optional Activation

The proxy must be optional and disabled by default:

- Activated via an environment variable (e.g., `LLM_PROXY_ENABLED=true`)
- When disabled, zero overhead: the plugin is not registered with the runner at all
- When enabled, the plugin is passed to `InMemoryRunner` via the `plugins` array
- Both the TUI (`useAgent.ts`) and CLI (`cli.ts`) must support the proxy activation

### FR-PROXY-06: Console Summary Output

When the proxy is active, it must optionally print a concise summary to stderr after each interaction completes:

- Number of LLM round trips
- Total prompt tokens and completion tokens
- Tool calls made (names only)
- Duration of the full interaction

This summary output must be controlled by a separate configuration (e.g., `LLM_PROXY_VERBOSE=true`) and must use stderr to avoid interfering with the agent's stdout output.

### FR-PROXY-07: Slash Command `/inspect`

A new slash command `/inspect` (alias `/proxy`) must be added to both the TUI and CLI:

- When the proxy is active: displays a summary of the last interaction's round trips (count, tokens, tool calls, durations)
- When the proxy is not active: displays a message indicating the proxy is disabled and how to enable it
- Does not require the agent to be idle (reads from the proxy's in-memory buffer)

### FR-PROXY-08: In-Memory Buffer

The proxy must maintain an in-memory circular buffer of the last N interactions (default: 10) for the `/inspect` command. This allows inspection without reading log files. The buffer size must be configurable.

---

## 3. Non-Functional Requirements

### NFR-PROXY-01: Zero Performance Impact When Disabled

When the proxy is not enabled, there must be zero runtime overhead. The plugin must not be instantiated or registered.

### NFR-PROXY-02: Minimal Performance Impact When Enabled

When enabled, the proxy must:
- Use asynchronous/non-blocking file I/O for log writing
- Not introduce measurable latency to LLM calls (< 1ms overhead per callback)
- Buffer writes and flush periodically rather than on every event

### NFR-PROXY-03: No Data Mutation

The proxy must be purely observational. It must never modify, filter, or short-circuit any request, response, tool call, or tool result. All plugin callbacks must return `undefined`.

### NFR-PROXY-04: Serialization Safety

LLM request and response objects may contain circular references or non-serializable values. The proxy must handle serialization gracefully:
- Use a safe JSON serializer that handles circular references
- Truncate extremely large payloads (e.g., tool results > 50KB) with a `[truncated]` marker
- Never crash or throw during serialization

### NFR-PROXY-05: Log File Management

- Log files must not grow unbounded; include a configurable max file size (default: 50MB)
- When max size is reached, rotate to a new file
- Old log files are not automatically deleted (developer's responsibility)

---

## 4. Acceptance Criteria

1. **AC-01**: When `LLM_PROXY_ENABLED=true` is set, the proxy captures all LLM round trips and writes them to an NDJSON log file in the configured directory.

2. **AC-02**: A simple user query (e.g., "list my notebooks") that triggers one tool call produces a log with at least 2 round trips: (1) initial request leading to a function call, (2) function result leading to the final text response.

3. **AC-03**: Each log entry for a request contains the full system instruction, conversation history (all Content objects), tool declarations, and generation config.

4. **AC-04**: Each log entry for a response contains the content, token usage, and finish reason.

5. **AC-05**: The `/inspect` command in the TUI and CLI displays a readable summary of the last interaction's round trips.

6. **AC-06**: When `LLM_PROXY_ENABLED` is not set or set to `false`, the proxy adds zero overhead — it is not instantiated.

7. **AC-07**: The proxy never modifies any data flowing between the agent and the LLM. All callbacks return `undefined`.

8. **AC-08**: The proxy handles serialization of complex objects (circular references, binary data) without crashing.

9. **AC-09**: Log files are valid NDJSON and can be processed with `jq` and similar tools.

10. **AC-10**: A test suite validates: event capture correctness, round trip counting, serialization safety, log file format, and the `/inspect` command output.

---

## 5. Scope

### In Scope

- ADK `BasePlugin` subclass for LLM traffic interception
- Round trip tracking with interaction IDs
- NDJSON log file output
- Configuration via environment variables
- Integration into both TUI (`useAgent.ts`) and CLI (`cli.ts`)
- `/inspect` slash command for both interfaces
- In-memory circular buffer for recent interactions
- Console summary output (optional, via `LLM_PROXY_VERBOSE`)
- Test suite for the proxy plugin
- Documentation in CLAUDE.md

### Out of Scope

- Web UI for log visualization (future enhancement)
- Real-time WebSocket streaming of proxy data
- Modification of the agent's behavior based on proxy observations
- Automatic analysis or anomaly detection on captured data
- Log file compression or archival
- Replay functionality (sending captured requests back to the LLM)
- Changes to the `agent.ts` file (the agent definition must remain untouched)

---

## 6. Configuration Variables

| Variable | Purpose | Required | Default |
|----------|---------|:--------:|---------|
| `LLM_PROXY_ENABLED` | Enable/disable the LLM proxy plugin | No | `false` (proxy disabled) |
| `LLM_PROXY_LOG_DIR` | Directory for NDJSON log files | Only when enabled | Must be provided; no fallback |
| `LLM_PROXY_VERBOSE` | Print per-interaction summary to stderr | No | `false` |
| `LLM_PROXY_BUFFER_SIZE` | Number of interactions kept in memory for `/inspect` | No | `10` |
| `LLM_PROXY_MAX_FILE_SIZE` | Maximum log file size in bytes before rotation | No | `52428800` (50MB) |

**Note on fallback policy exception**: `LLM_PROXY_ENABLED`, `LLM_PROXY_VERBOSE`, `LLM_PROXY_BUFFER_SIZE`, and `LLM_PROXY_MAX_FILE_SIZE` use default values because the proxy is an optional developer tool, not a core configuration. `LLM_PROXY_LOG_DIR` follows the strict no-fallback policy: when the proxy is enabled, the log directory must be explicitly provided. This exception must be recorded in the project memory before implementation.

---

## 7. Assumptions

1. The ADK `BasePlugin` mechanism (available in `@google/adk >= 0.6.1`) is stable and will not change its callback signatures in minor releases.

2. The `LlmRequest` and `LlmResponse` interfaces exposed to plugin callbacks contain the full data sent to/from the Gemini API (i.e., the ADK does not strip data before passing it to callbacks).

3. The `InMemoryRunner` constructor's `plugins` parameter accepts any array of `BasePlugin` subclass instances and invokes them in registration order.

4. The `beforeModelCallback` in the plugin fires after all request processors have run (meaning the captured request reflects the final state including instruction injection, tool schemas, etc.).

5. Streaming mode (`StreamingMode.SSE`) may trigger `afterModelCallback` multiple times per round trip (once per partial response). The proxy must handle partial responses correctly by accumulating them into a single round trip record.

6. The `agent.ts` file must not be modified — the proxy is injected at the runner level, not the agent level.

---

## 8. Technical Constraints

1. The proxy must be implemented in TypeScript (project convention).
2. The proxy must not add any new npm dependencies. It must use only Node.js built-in modules (`node:fs`, `node:path`, `node:crypto`) and existing project dependencies.
3. The proxy must work with both the TUI (Ink/React) and CLI (readline) interfaces without special-casing.
4. File I/O must use `node:fs/promises` for non-blocking writes.
5. The proxy must be a single, self-contained module (or a small set of modules under a `proxy/` directory) that can be imported conditionally.

---

## 9. Open Questions

1. **Streaming partial responses**: The ADK fires `afterModelCallback` for each partial (streamed) response chunk. Should the proxy log each partial chunk separately (high granularity, large logs) or accumulate them into a single complete response per round trip (more compact, easier to read)? **Recommendation**: Accumulate into a single entry per round trip, with a flag indicating it was streamed.

2. **System instruction capture detail**: The `LlmRequest.config` field contains a `systemInstruction` which may be a `Content` object. Should this be serialized as-is, or should the proxy extract and format the text for readability? **Recommendation**: Serialize the raw `Content` object as-is (preserves fidelity) but also include a flattened text version for quick inspection.

3. **Tool declaration verbosity**: Tool schemas in the request can be large (40+ tools with descriptions and parameter schemas). Should the proxy always log full tool schemas, or only on the first round trip of each interaction? **Recommendation**: Log full schemas on first round trip, then only tool names on subsequent round trips within the same interaction.

4. **Sensitive data in logs**: Tool results may contain user content, notebook data, or YouTube transcripts. Should the proxy provide any redaction mechanism? **Recommendation**: No redaction in v1 — the developer using the proxy is expected to be the agent developer who has access to this data. Add a note in documentation about log file sensitivity.
