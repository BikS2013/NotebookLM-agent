# Refined Request: Proxy Inspector — Electron Log Viewer

**Date**: 2026-04-11
**Author**: Request Refiner
**Status**: Ready for investigation & planning

---

## 1. Problem Statement

The NotebookLM Agent proxy generates NDJSON log files that capture every LLM interaction: requests, responses, tool calls, errors, and token usage. These files are dense machine-readable JSON — difficult to navigate, correlate, and understand manually. Developers need a visual tool to inspect, monitor, and debug agent behavior by browsing these logs in real time.

The Proxy Inspector is an independent Electron desktop application that lets a developer open any proxy NDJSON log file, view all interactions grouped and correlated, drill into request/response payloads, and live-tail the file as new entries are appended.

---

## 2. Data Model (from proxy-types.ts and actual log files)

### 2.1 Log Entry Envelope (one NDJSON line)

| Field           | Type              | Description                                                    |
|-----------------|-------------------|----------------------------------------------------------------|
| `event`         | `ProxyEventType`  | One of 8 event types (see below)                               |
| `timestamp`     | `string`          | ISO-8601 timestamp                                             |
| `interactionId` | `string`          | Groups all events for one user message                         |
| `roundTrip`     | `number \| null`  | Round trip number within interaction (null for start/end)       |
| `payload`       | `object`          | Event-specific data (varies by event type)                     |

### 2.2 Event Types and Their Payloads

| Event                | Payload Keys (observed)                                                                                     |
|----------------------|-------------------------------------------------------------------------------------------------------------|
| `interaction_start`  | `sessionId`, `userMessage`                                                                                  |
| `llm_request`        | `model`, `contentsCount`, `contents`, `systemInstruction`, `systemInstructionText`, `toolDeclarations`, `toolNames` |
| `llm_response`       | `content`, `usageMetadata` (prompt/candidates/total tokens), `finishReason`, `streamed`, `chunkCount`, `durationMs` |
| `tool_start`         | `toolName`, `functionCallId`, `args`                                                                        |
| `tool_result`        | `toolName`, `functionCallId`, `durationMs`, `resultKeys`                                                    |
| `tool_error`         | `toolName`, `functionCallId`, `error`                                                                       |
| `llm_error`          | `errorCode`, `errorMessage`                                                                                 |
| `interaction_end`    | `roundTripCount`, `totalPromptTokens`, `totalCompletionTokens`, `totalTokens`, `durationMs`, `toolCalls`    |

### 2.3 Interaction Structure (how events group)

```
interaction_start          (1 per interaction)
  ├─ llm_request           (round trip 1)
  ├─ llm_response          (round trip 1)
  ├─ tool_start            (round trip 1, 0..N tool calls)
  ├─ tool_result/error     (round trip 1, matches tool_start)
  ├─ llm_request           (round trip 2, includes tool results)
  ├─ llm_response          (round trip 2)
  └─ ...
interaction_end            (1 per interaction)
```

### 2.4 Observed Data Characteristics

- **Log file naming**: `proxy-<sessionId>-<ISO-timestamp>.ndjson`
- **Payload sizes vary dramatically**: `llm_request` payloads can be 19-35 KB (contain full conversation history and tool declarations); `interaction_start` payloads are ~70-90 bytes
- **Model observed**: `gemini-2.5-flash`
- **Tool count**: Up to 52 tools declared in a single request
- **Token counts**: Prompt tokens 6K-16K, completion tokens 11-4K per round trip
- **Streaming**: Some responses are streamed (chunkCount up to 88), others are not (chunkCount = 1)
- **Content format**: LLM response `content` can be a JSON string (streamed) or a structured object with `parts` array containing `text` or `functionCall`

---

## 3. Functional Requirements

### FR-1: File Selection
- FR-1.1: Provide a file-open dialog to select a `.ndjson` log file from anywhere on the filesystem.
- FR-1.2: Show the file path, session ID (extracted from filename), and creation date in a header bar.
- FR-1.3: Support drag-and-drop of `.ndjson` files onto the window.
- FR-1.4: Maintain a list of recently opened files (last 10) for quick re-opening.

### FR-2: File Watching (Live Tail)
- FR-2.1: After opening a file, watch it for appended content using `fs.watch` or similar.
- FR-2.2: Parse newly appended NDJSON lines incrementally (do not re-read the entire file).
- FR-2.3: Auto-scroll to the latest interaction when new events arrive, unless the user has scrolled up.
- FR-2.4: Show a visual indicator (badge or pulse) when new events arrive while the user is scrolled away.
- FR-2.5: Provide a toggle to pause/resume live watching.

### FR-3: Interaction List (Left Panel / Master View)
- FR-3.1: Parse all NDJSON lines and group them by `interactionId` into interaction cards.
- FR-3.2: Each interaction card displays:
  - Sequential number (1-based)
  - User message (first 100 characters, from `interaction_start` payload)
  - Timestamp (formatted as local time, e.g., "07:00:02")
  - Total duration (from `interaction_end` payload `durationMs`, formatted as "934ms" or "19.1s")
  - Round trip count
  - Total tokens (prompt + completion)
  - Tool call names as small badges/chips (from `interaction_end` payload `toolCalls` array)
  - Status indicator: green check for completed (has `interaction_end`), yellow spinner for in-progress (no `interaction_end` yet), red X for errors (contains `llm_error` or `tool_error`)
- FR-3.3: Clicking an interaction card selects it and shows its detail in the right panel.
- FR-3.4: Highlight errors visually — interactions containing `llm_error` or `tool_error` events should have a distinct error styling.

### FR-4: Interaction Detail (Right Panel / Detail View)
- FR-4.1: Show a timeline/sequence of all events within the selected interaction, ordered by timestamp.
- FR-4.2: Each event in the timeline shows:
  - Event type as a color-coded label (e.g., blue for `llm_request`, green for `llm_response`, orange for `tool_start`, etc.)
  - Timestamp (relative to interaction start, e.g., "+0ms", "+929ms", "+1125ms")
  - Round trip number badge
  - Duration where applicable (LLM response `durationMs`, tool result `durationMs`)
- FR-4.3: Clicking an event in the timeline expands its payload detail below or in a sub-panel.

### FR-5: Payload Rendering
- FR-5.1: **interaction_start**: Display user message in a chat-bubble style. Show session ID.
- FR-5.2: **llm_request**: Display in collapsible sections:
  - Model name (prominent)
  - Contents count and conversation history (collapsible, with individual messages shown as a mini chat view)
  - System instruction text (collapsible, rendered as monospaced text, can be very long)
  - Tool names as a tag/chip list
  - Tool declarations (collapsible, only on first round trip; render as formatted JSON tree)
  - Generation config (if present)
- FR-5.3: **llm_response**: Display:
  - Response text extracted from content (handle both string and structured object formats)
  - Function calls (if present): tool name + args formatted as JSON
  - Token usage: three numbers (prompt / completion / total) with a small bar or badge
  - Duration, streamed flag, chunk count
  - Finish reason
- FR-5.4: **tool_start**: Display tool name (prominent), function call ID, and args as formatted JSON.
- FR-5.5: **tool_result**: Display tool name, duration, and result keys. Note: full result is not logged (only keys), so display the keys list.
- FR-5.6: **tool_error**: Display tool name and error message with red error styling.
- FR-5.7: **llm_error**: Display error code and message with red error styling.
- FR-5.8: **interaction_end**: Display summary: round trip count, token totals, total duration, tool calls used.
- FR-5.9: All JSON payloads must be viewable as formatted/pretty-printed JSON via a "Raw JSON" toggle.

### FR-6: Token Usage Dashboard
- FR-6.1: Show a summary bar at the top or bottom with aggregate stats for the entire file:
  - Total interactions count
  - Total tokens (prompt + completion)
  - Total tool calls
  - Time span (first to last event timestamp)
- FR-6.2: Per-interaction token breakdown visible in the interaction list cards (see FR-3.2).

### FR-7: Search and Filter
- FR-7.1: Text search across user messages to quickly find specific interactions.
- FR-7.2: Filter interactions by: has tool calls, has errors, minimum token count.
- FR-7.3: Filter events within an interaction by event type (e.g., show only tool events).

### FR-8: UI Layout
- FR-8.1: Two-panel master-detail layout: interaction list on the left (narrower, ~300px), event detail on the right (wider).
- FR-8.2: Resizable panel divider.
- FR-8.3: Header bar showing file info and aggregate stats.
- FR-8.4: Dark theme by default (developer tool aesthetic), with readable contrast.
- FR-8.5: Monospaced font for all JSON/code content; proportional font for labels and UI text.

---

## 4. Non-Functional Requirements

### NFR-1: Performance
- NFR-1.1: Must handle log files up to 100 MB without UI freeze. Parse incrementally, not all at once.
- NFR-1.2: Interaction list must use virtual scrolling if there are more than 100 interactions.
- NFR-1.3: Large JSON payloads (30KB+ `llm_request` contents) must be lazy-rendered — only expand on user click.
- NFR-1.4: File watching must not poll more frequently than once per second.

### NFR-2: Usability
- NFR-2.1: The tool must work standalone — no dependency on the agent being running.
- NFR-2.2: Opening a file and seeing interactions must require at most 2 clicks (open dialog + select file).
- NFR-2.3: Keyboard navigation: arrow keys for interaction list, Enter to expand, Escape to collapse.

### NFR-3: Independence
- NFR-3.1: The Electron app lives in its own directory (`proxy-inspector/`) with its own `package.json`.
- NFR-3.2: It may import type definitions from `notebooklm_agent/proxy/proxy-types.ts` at compile time but must not depend on the agent runtime.
- NFR-3.3: No shared `node_modules` — it has its own dependency tree.

### NFR-4: Technology
- NFR-4.1: Electron (latest stable) for the desktop shell.
- NFR-4.2: TypeScript for all code.
- NFR-4.3: Renderer framework: React (preferred for consistency with the TUI's Ink components and developer familiarity) or vanilla HTML — implementation team's choice.
- NFR-4.4: Build tool: Vite, esbuild, or electron-forge — implementation team's choice.

---

## 5. Acceptance Criteria

1. **AC-1**: User can launch the Electron app (`npm start` from `proxy-inspector/`), open a file dialog, select the existing sample log file, and see 2 interactions listed with correct user messages ("hi" and "list my notebooks").
2. **AC-2**: Clicking interaction #2 ("list my notebooks") shows an event timeline with 8 events: interaction_start, llm_request (RT1), llm_response (RT1), tool_start (list_notebooks), tool_result (list_notebooks), llm_request (RT2), llm_response (RT2), interaction_end.
3. **AC-3**: The llm_response for round trip 1 of interaction #2 shows a `functionCall` for `list_notebooks` with empty args.
4. **AC-4**: The interaction_end card for interaction #2 shows: 2 round trips, 16711 prompt tokens, 4062 completion tokens, 19068ms duration, tool calls: ["list_notebooks"].
5. **AC-5**: Token totals in the summary bar show the aggregate across both interactions.
6. **AC-6**: While the app is open, if a new NDJSON line is appended to the file, it appears in the UI within 2 seconds without manual refresh.
7. **AC-7**: The "Raw JSON" toggle on any event shows the full pretty-printed JSON payload.
8. **AC-8**: The app starts and renders the main window in under 3 seconds on a modern Mac.

---

## 6. Scope Boundaries

### In Scope
- File selection, parsing, grouping, rendering, and live watching of NDJSON proxy log files
- Read-only viewer — no editing or modifying log files
- Single-window, single-file-at-a-time viewer (though recently-opened list enables quick switching)
- macOS primary target (Electron is cross-platform but no Linux/Windows testing required)

### Out of Scope
- Connecting to the proxy at runtime or controlling the proxy
- Replaying or re-executing LLM calls
- Comparing two log files side by side
- Exporting or transforming log data
- Network-based log streaming (only local file watching)
- Multi-window or multi-file simultaneous viewing
- Authentication or access control

---

## 7. Assumptions

1. The NDJSON format as defined in `proxy-types.ts` (the `LogEntry` interface) is stable and will not change during implementation.
2. Log files are well-formed: each line is valid JSON conforming to `LogEntry`. Malformed lines should be skipped with a warning, not crash the app.
3. The `interactionId` field reliably groups all events belonging to one interaction. Events for one interaction are contiguous in the file (not interleaved with other interactions).
4. Log files are append-only during a session. The file is not truncated or rewritten while the inspector is watching it.
5. The largest practical log file is ~100 MB (proxy rotation at `maxFileSize`). Files above this threshold may degrade performance.
6. The sample log file at `logs/proxy-36d86b1d-cb79-4609-b8e5-1a777a25db08-2026-04-11T06-58-50.ndjson` (12 lines, 2 interactions) serves as the primary test fixture.
7. The tool result payload (full result data) is intentionally not logged — only `resultKeys` is available. The inspector should display what is available, not attempt to reconstruct missing data.
8. LLM response `content` can appear in two formats: a JSON-serialized string (when streamed) or a structured `{role, parts}` object (when not streamed). The renderer must handle both.
