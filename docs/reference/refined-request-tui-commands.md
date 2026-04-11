# Refined Request: TUI Slash Commands for Conversation & Session Management

**Date:** 2026-04-11  
**Status:** Draft  
**Component:** NotebookLM Agent Terminal UI (TUI)

---

## 1. Scope & Objectives

Add four new slash commands to the TUI that give the user visibility into and control over the agent conversation session. These commands are handled locally by the TUI (they are NOT sent to the agent) and render their output directly into the chat history panel as system messages.

### Objectives

1. Allow the user to review the full conversation history rendered in a readable format.
2. Allow the user to inspect the agent's session state (the key-value pairs stored in `Session.state` by ADK).
3. Allow the user to reset the session entirely, creating a new ADK session and clearing the chat history, so the agent starts fresh with no memory of the prior conversation.
4. Allow the user to inspect the raw request/response of the most recent LLM exchange, including the `Content` objects sent to and received from the model, as well as any function call/response pairs.

---

## 2. Detailed Command Specifications

### 2.1 `/history` — Show Conversation History

**Slash command:** `/history`  
**Aliases:** none  
**Availability:** only when agent status is `idle`

**Behavior:**

1. Collect all `Message[]` currently held in the `useAgent` hook's state.
2. Format each message as a block:
   - Header line: `[<role>] <ISO timestamp>`  
     (role is `USER` or `AGENT`; timestamp is derived from `Message.timestamp`)
   - Body: the `Message.text` content, indented or clearly separated from the header.
   - If the message has `toolCalls` entries, append a "Tool calls" subsection listing each tool name, arguments (JSON), and status.
3. Insert a single system message into the chat history containing the formatted output. The system message uses a new role value `system` (see Section 5 — Types).
4. If the conversation history is empty, display: `No messages in the current session.`

**UI considerations:**
- The output can be long. It is inserted as a single `Message` with role `system` into the messages array so the user can scroll through it using existing PageUp/PageDown.
- The message should be visually distinct from user and agent messages (e.g., dimmed color or a different color like cyan).

---

### 2.2 `/memory` — Show Agent Session State

**Slash command:** `/memory`  
**Aliases:** `/state`  
**Availability:** only when agent status is `idle`

**Behavior:**

1. Retrieve the current ADK session by calling `runner.sessionService.getSession()` with the active `sessionId`, `userId`, and `appName`.
2. Extract the `Session.state` record (key-value pairs).
3. Format the state as a readable list:
   - Header: `Session State (session: <sessionId>)`
   - Each key-value pair on its own line: `  <key>: <JSON-stringified value>`
4. Insert a system message into the chat history with the formatted output.
5. If `Session.state` is empty or contains no keys, display: `Session state is empty.`

**Notes:**
- The ADK `Session.state` is the agent's working memory. It includes keys like `current_notebook_id`, `current_notebook_title`, `last_conversation_id`, and any other state the agent has accumulated via `stateDelta` in events.
- This command requires the `useAgent` hook to expose either the `runner` reference or a dedicated `getSessionState()` method.

---

### 2.3 `/new` — Clear Memory and Start New Conversation

**Slash command:** `/new`  
**Aliases:** `/reset`  
**Availability:** only when agent status is `idle`

**Behavior:**

1. Delete the current ADK session by calling `runner.sessionService.deleteSession()`.
2. Create a new ADK session by calling `runner.sessionService.createSession()` with the same `appName` and `userId`.
3. Clear the local `messages` array (set to empty).
4. Update the `sessionId` state to the new session's ID.
5. Reset scroll position to 0.
6. Insert a single system message: `Session reset. New session started (ID: <new-session-id>).`

**Error handling:**
- If session deletion or creation fails, display an error system message and keep the existing session intact. Do not partially clear state.

**Notes:**
- This is a destructive operation. Because the user explicitly typed the command, no additional confirmation prompt is needed (unlike delete operations sent to the agent). The command name `/new` is self-explanatory and intentional.
- The `useAgent` hook must expose a `resetSession()` method (or equivalent) that performs steps 1-4 atomically from the hook's perspective.

---

### 2.4 `/last` — Show Last Request/Response

**Slash command:** `/last`  
**Aliases:** `/raw`  
**Availability:** only when agent status is `idle`

**Behavior:**

1. Retrieve the current ADK session by calling `runner.sessionService.getSession()` with the active session.
2. From `Session.events`, find the last user-to-model exchange:
   - The last event with `author === 'user'` — this is the **request** (the `Content` sent to the model).
   - All subsequent events until the next user event or end-of-list — these are the **response** events (model content, function calls, function responses, final response).
3. Format the output in two sections:

   **Request section:**
   - `--- Last Request ---`
   - The `Content` object's parts serialized as readable text (text parts shown as-is, function calls shown as JSON).

   **Response section:**
   - `--- Last Response ---`
   - For each response event in order:
     - If it contains text content: show the text.
     - If it contains function calls: show `Tool Call: <name>(<args as JSON>)`
     - If it contains function responses: show `Tool Result: <name> -> <result summary>`
   - Usage metadata (if available): `Tokens: <prompt tokens> prompt / <candidates tokens> completion / <total tokens> total`

4. Insert a system message into the chat history with the formatted output.
5. If no events exist in the session, display: `No request/response data available.`

**Notes:**
- This command accesses the ADK `Session.events` array, which contains the full event log including raw `Content` objects. The `useAgent` hook must expose a method to retrieve the session (or its events).
- The formatted output should be human-readable, not raw JSON dumps. However, function call arguments and function response results should be shown as formatted JSON for completeness.
- Large response text should be shown in full (no truncation) since the user can scroll.

---

## 3. Acceptance Criteria

### 3.1 `/history`
- [ ] Typing `/history` and pressing Enter inserts a system message with all conversation messages formatted with role, timestamp, text, and tool calls.
- [ ] System message is visually distinct from user/agent messages (different color).
- [ ] Works correctly with 0 messages (shows "No messages" text).
- [ ] Works correctly with 50+ messages (renders fully, scrollable).
- [ ] Command is rejected (no-op or "agent busy" message) if agent status is not `idle`.

### 3.2 `/memory`
- [ ] Typing `/memory` or `/state` inserts a system message listing all session state key-value pairs.
- [ ] State values are JSON-stringified for non-string types.
- [ ] Works correctly with empty state.
- [ ] The session ID is displayed in the header.

### 3.3 `/new`
- [ ] Typing `/new` or `/reset` clears all messages from the chat history.
- [ ] A new ADK session is created (verifiable: session ID changes).
- [ ] The agent's state is empty after reset (verifiable: `/memory` shows empty state).
- [ ] A confirmation system message appears with the new session ID.
- [ ] If session creation fails, the old session remains intact and an error is shown.
- [ ] Scroll offset is reset to 0.

### 3.4 `/last`
- [ ] Typing `/last` or `/raw` inserts a system message showing the last user request and the model's response events.
- [ ] Function calls and results are formatted readably.
- [ ] Token usage metadata is shown when available.
- [ ] Works correctly when no conversation has occurred yet.

### 3.5 General
- [ ] All commands are case-insensitive (e.g., `/History`, `/MEMORY` work).
- [ ] All commands are added to input history (up-arrow recall).
- [ ] Unrecognized slash commands continue to be forwarded to the agent (existing behavior).
- [ ] The `/help` command (if implemented later) or status bar hints should reference the new commands.
- [ ] Existing `/quit`, `/exit`, `/clear` commands continue to work unchanged.

---

## 4. Non-Functional Requirements

### 4.1 Performance
- `/history` and `/last` must render within 100ms for sessions with up to 200 messages. No blocking I/O is involved (all data is in-memory via ADK's `InMemoryRunner`).
- `/new` involves async operations (session delete + create) but these are in-memory and should complete within 50ms. The UI should show a brief "Resetting..." status if the operation takes longer than expected.

### 4.2 UX
- System messages must be visually distinct. Recommended: cyan/dim text color, no "bubble" styling, a `[system]` prefix or similar.
- Commands should not pollute the conversation sent to the agent. System messages are local-only and must NOT be included in future `sendMessage` calls to the ADK runner.
- The input area should be cleared after any successful slash command execution.
- Input should be added to the history ring (up-arrow recall) for all slash commands.

### 4.3 Testability
- All formatting logic (message formatting, state formatting, event extraction) should be implemented as pure functions in the `lib/` directory, not inline in hooks or components.
- These pure functions must have unit tests in `test_scripts/`.

---

## 5. Constraints & Assumptions

### 5.1 Constraints

1. **ADK version:** The project uses `@google/adk ^0.6.1`. The `InMemoryRunner` uses an in-memory session service. `Session.events` and `Session.state` are available via `sessionService.getSession()`.
2. **No persistent storage:** `InMemoryRunner` keeps everything in memory. When the TUI process exits, all session data is lost regardless. `/new` simply resets the in-memory state.
3. **System messages are TUI-local:** A new `role: 'system'` value is added to the `Message` type. These messages exist only in the TUI's React state and are never sent to the ADK agent. The `sendMessage` function and `ChatHistory` component must handle this correctly.
4. **Thread safety:** The `useAgent` hook runs on the main thread. All session service calls (`getSession`, `deleteSession`, `createSession`) are async but non-concurrent within a single command execution since the agent must be `idle`.
5. **No raw HTTP capture:** ADK does not expose the raw HTTP request/response to the Gemini API. The `/last` command shows the ADK-level `Event` objects (which contain `Content`, function calls, function responses, and usage metadata). This is the closest available approximation to "raw request/response."

### 5.2 Assumptions

1. The user understands that `/new` is irreversible within the TUI session (no undo).
2. The ADK session's `events` array contains all events from the conversation, including user messages, model responses, function calls, and function responses.
3. The `getSession` call returns the full session object with all events (no pagination needed for in-memory sessions).
4. Adding `'system'` to the `Message.role` union type is a backward-compatible change that will not affect existing code paths since system messages are only created by slash commands.

---

## 6. Out of Scope

1. **Exporting conversation to file** — Saving the conversation history to a file on disk is not part of this request. The filesystem tools exist but this is a separate feature.
2. **Search within history** — No `/search` or filtering within `/history` output.
3. **Session persistence across TUI restarts** — The `InMemoryRunner` does not persist sessions. Cross-session memory is out of scope.
4. **Raw HTTP request/response capture** — Intercepting the actual HTTP calls between ADK and the Gemini API is not feasible with the current ADK architecture. `/last` shows ADK-level events, not HTTP payloads.
5. **Interactive confirmation for `/new`** — No "Are you sure?" prompt. The command executes immediately.
6. **Modifying session state** — No `/set-state` or `/edit-memory` command.
7. **Viewing other sessions** — Only the current active session is accessible.
8. **Streaming output for commands** — All command output is inserted as a complete system message, not streamed incrementally.

---

## 7. Files Expected to Change

| File | Change |
|---|---|
| `notebooklm_agent/tui/types.ts` | Add `'system'` to `Message.role` union |
| `notebooklm_agent/tui/hooks/useAgent.ts` | Expose `getSessionState()`, `getSessionEvents()`, `resetSession()` methods |
| `notebooklm_agent/tui/index.tsx` | Add slash command routing for `/history`, `/memory`, `/state`, `/new`, `/reset`, `/last`, `/raw` |
| `notebooklm_agent/tui/lib/format-commands.ts` | New file: pure formatting functions for all four commands |
| `notebooklm_agent/tui/components/MessageBubble.tsx` | Handle `role: 'system'` with distinct styling |
| `notebooklm_agent/tui/components/ChatHistory.tsx` | Ensure system messages are rendered and measured for scroll |
| `test_scripts/test-format-commands.test.ts` | Unit tests for formatting functions |

---

## 8. Command Summary Table

| Command | Aliases | Description | Async | Destructive |
|---|---|---|---|---|
| `/history` | — | Display full conversation history | No | No |
| `/memory` | `/state` | Display agent session state (key-value pairs) | Yes (getSession) | No |
| `/new` | `/reset` | Delete session, create new one, clear chat | Yes (delete+create) | Yes |
| `/last` | `/raw` | Display last request/response exchange from ADK events | Yes (getSession) | No |
