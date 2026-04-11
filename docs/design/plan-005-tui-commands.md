# Plan 005: TUI Slash Commands for Conversation & Session Management

**Date:** 2026-04-11  
**Status:** Draft  
**Dependencies:** refined-request-tui-commands.md, investigation-tui-commands.md, codebase-scan-tui-commands.md  
**Estimated effort:** 6 phases, ~4-6 hours total

---

## Summary

Add four slash commands (`/history`, `/memory`, `/new`, `/last`) to the TUI that give users visibility into and control over the agent conversation session. All commands are handled locally by the TUI (not sent to the agent) and render output as visually distinct system messages.

---

## Phase A: Type and Interface Changes

**Goal:** Extend the type system to support system messages and the new `useAgent` methods.

**Dependencies:** None (foundation phase)

### A.1 — Extend `Message.role` union

**File:** `notebooklm_agent/tui/types.ts`

Change the `role` field from `'user' | 'agent'` to `'user' | 'agent' | 'system'`.

```typescript
// Before:
readonly role: 'user' | 'agent';

// After:
readonly role: 'user' | 'agent' | 'system';
```

**Rationale:** System messages are TUI-local. They exist only in the React `messages` state and are never sent to the ADK runner. The `sendMessage` function in `useAgent` constructs its own `Content` from the text parameter, so system messages in the array are inherently safe — they are never forwarded to the agent.

### A.2 — Extend `UseAgentResult` interface

**File:** `notebooklm_agent/tui/hooks/useAgent.ts`

Add four new methods to the `UseAgentResult` interface:

```typescript
export interface UseAgentResult {
  // ... existing fields ...
  
  /** Retrieve the ADK session state (key-value pairs). */
  getSessionState: () => Promise<Record<string, unknown>>;
  
  /** Retrieve the ADK session events array. */
  getSessionEvents: () => Promise<Event[]>;
  
  /** Delete current session, create a new one, clear messages. Returns new session ID. */
  resetSession: () => Promise<string>;
  
  /** Insert a system message into the chat history. */
  addSystemMessage: (text: string) => void;
}
```

**Notes:**
- `Event` type is already imported from `@google/adk` in this file.
- `addSystemMessage` is a convenience wrapper around `setMessages` that creates a properly-formed system `Message` object with `generateId()`, `role: 'system'`, empty `toolCalls`, and `Date.now()` timestamp.
- The `getSessionState`, `getSessionEvents`, and `resetSession` methods will be implemented in Phase B. In this phase, only the interface definition is added.

### A.3 — Add ADK type imports

**File:** `notebooklm_agent/tui/hooks/useAgent.ts`

Add the following to the existing import from `@google/adk`:

```typescript
import {
  InMemoryRunner,
  StreamingMode,
  toStructuredEvents,
  EventType,
  type Event,
  type Session,           // NEW
} from '@google/adk';
```

The `Session` type is needed for the return type of `sessionService.getSession()`. The request types (`GetSessionRequest`, `DeleteSessionRequest`, `CreateSessionRequest`) are inferred by TypeScript from the method signatures and do not need explicit imports — the inline object literals will type-check correctly.

### Acceptance Criteria

- [ ] `Message.role` accepts `'user'`, `'agent'`, or `'system'`
- [ ] `UseAgentResult` interface declares `getSessionState`, `getSessionEvents`, `resetSession`, `addSystemMessage`
- [ ] `Session` type is imported from `@google/adk`
- [ ] TypeScript compiles without errors: `npx tsc --noEmit`

### Verification

```bash
cd /Users/giorgosmarinos/aiwork/coding-platform/macbook-desktop/NotebookLM-agent
npx tsc --noEmit
```

---

## Phase B: useAgent Hook Extensions

**Goal:** Implement the four new methods in the `useAgent` hook.

**Dependencies:** Phase A (type definitions must exist)

### B.1 — Implement `addSystemMessage`

**File:** `notebooklm_agent/tui/hooks/useAgent.ts`

Add a `useCallback` that wraps `setMessages`:

```typescript
const addSystemMessage = useCallback((text: string) => {
  const sysMsg: Message = {
    id: generateId(),
    role: 'system',
    text,
    isPartial: false,
    toolCalls: [],
    timestamp: Date.now(),
  };
  setMessages((prev) => [...prev, sysMsg]);
}, []);
```

This is a synchronous operation. The `generateId()` helper already exists in the file.

### B.2 — Implement `getSessionState`

**File:** `notebooklm_agent/tui/hooks/useAgent.ts`

```typescript
const getSessionState = useCallback(async (): Promise<Record<string, unknown>> => {
  const runner = runnerRef.current;
  const sid = sessionIdRef.current;
  if (!runner || !sid) return {};

  const session = await runner.sessionService.getSession({
    appName: 'notebooklm-tui',
    userId: effectiveUserId,
    sessionId: sid,
  });
  return session?.state ?? {};
}, [effectiveUserId]);
```

**Key detail:** `getSession` returns `Session | undefined`. The `?.state` handles the undefined case gracefully. The `appName` (`'notebooklm-tui'`) and `userId` are the same values used during session creation in the `useEffect` init block. These values must remain consistent.

### B.3 — Implement `getSessionEvents`

**File:** `notebooklm_agent/tui/hooks/useAgent.ts`

```typescript
const getSessionEvents = useCallback(async (): Promise<Event[]> => {
  const runner = runnerRef.current;
  const sid = sessionIdRef.current;
  if (!runner || !sid) return [];

  const session = await runner.sessionService.getSession({
    appName: 'notebooklm-tui',
    userId: effectiveUserId,
    sessionId: sid,
  });
  return session?.events ?? [];
}, [effectiveUserId]);
```

### B.4 — Implement `resetSession`

**File:** `notebooklm_agent/tui/hooks/useAgent.ts`

```typescript
const resetSession = useCallback(async (): Promise<string> => {
  const runner = runnerRef.current;
  const sid = sessionIdRef.current;
  if (!runner || !sid) {
    throw new Error('Agent not initialized');
  }

  // Step 1: Delete current session
  await runner.sessionService.deleteSession({
    appName: 'notebooklm-tui',
    userId: effectiveUserId,
    sessionId: sid,
  });

  // Step 2: Create new session
  const newSession = await runner.sessionService.createSession({
    appName: 'notebooklm-tui',
    userId: effectiveUserId,
  });

  // Step 3: Update refs and state atomically
  sessionIdRef.current = newSession.id;
  setSessionId(newSession.id);
  setMessages([]);

  return newSession.id;
}, [effectiveUserId]);
```

**Error handling:** If `deleteSession` fails, the error propagates to the caller (Phase D handler in `index.tsx`), which will catch it and display an error system message. The existing session remains intact. If `deleteSession` succeeds but `createSession` fails, the old session is gone. This is an edge case for `InMemorySessionService` (which should never fail on create) but the caller will handle the error.

### B.5 — Update return object

**File:** `notebooklm_agent/tui/hooks/useAgent.ts`

Add the four new methods to the return object:

```typescript
return {
  messages,
  agentStatus,
  activeToolCall,
  sendMessage,
  cancelRun,
  sessionId,
  isInitialized,
  initError,
  getSessionState,    // NEW
  getSessionEvents,   // NEW
  resetSession,       // NEW
  addSystemMessage,   // NEW
};
```

### Acceptance Criteria

- [ ] `addSystemMessage('test')` appends a system message to the `messages` array
- [ ] `getSessionState()` returns the session's state record (empty initially)
- [ ] `getSessionEvents()` returns the session's events array (empty initially)
- [ ] `resetSession()` deletes the old session, creates a new one, clears messages, returns new ID
- [ ] All four methods are included in the hook's return object
- [ ] TypeScript compiles: `npx tsc --noEmit`

### Verification

```bash
cd /Users/giorgosmarinos/aiwork/coding-platform/macbook-desktop/NotebookLM-agent
npx tsc --noEmit
```

---

## Phase C: Format Commands Pure Functions

**Goal:** Create pure formatting functions for all four slash commands, with unit tests.

**Dependencies:** Phase A (uses `Message` type with `'system'` role)

### C.1 — Create `format-commands.ts`

**File to create:** `notebooklm_agent/tui/lib/format-commands.ts`

This module contains three pure functions with no React dependency. Each function accepts structured data and returns a formatted string.

#### C.1.1 — `formatHistory(messages: Message[]): string`

Formats the TUI's local message array for the `/history` command.

**Input:** The `messages` array from `useAgent` (includes user, agent, and system messages).  
**Output:** A multi-line string.

**Format:**
```
[USER] 2026-04-11T10:23:45.000Z
  List my notebooks

[AGENT] 2026-04-11T10:23:47.000Z
  Here are your notebooks:
  1. Research Notes
  2. Project Alpha
  Tool calls:
    list_notebooks({}) [completed]

[SYSTEM] 2026-04-11T10:23:50.000Z
  Session reset. New session started (ID: abc12345).
```

**Rules:**
- Each message block: `[ROLE] <ISO timestamp>` header, then `  ` indented body text (each line).
- If `message.toolCalls` is non-empty, append a "Tool calls:" subsection with each tool name, args (JSON), and status.
- Blank line between message blocks.
- If messages array is empty: return `No messages in the current session.`

#### C.1.2 — `formatSessionState(state: Record<string, unknown>, sessionId: string): string`

Formats the ADK session state for the `/memory` command.

**Input:** `state` from `Session.state`, `sessionId` string.  
**Output:** A multi-line string.

**Format:**
```
Session State (session: abc12345)
  current_notebook_id: "nb-123"
  current_notebook_title: "Research Notes"
  auth_verified: true
  last_conversation_id: null
```

**Rules:**
- Header line with session ID.
- Each key-value pair indented with 2 spaces.
- Values are `JSON.stringify()`-ed (strings quoted, booleans/numbers as-is, objects formatted).
- Keys sorted alphabetically for consistent output.
- If state is empty (no keys): return `Session state is empty.`

#### C.1.3 — `formatLastExchange(events: Event[]): string`

Extracts and formats the last user-to-model exchange from ADK session events for the `/last` command.

**Input:** `Event[]` from `Session.events`.  
**Output:** A multi-line string.

**Algorithm:**
1. Scan `events` array backward to find the last event with `event.author === 'user'`. This is the **request**.
2. All subsequent events (from request index + 1 to end of array) are the **response** events.
3. Format request section:
   - `--- Last Request ---`
   - For each part in `event.content?.parts`: show text parts as-is, function calls as JSON.
4. Format response section:
   - `--- Last Response ---`
   - For each response event:
     - Text content: extract from `event.content?.parts` where part has `text` field.
     - Function calls: use `getFunctionCalls(event)` from `@google/adk` — show `Tool Call: <name>(<args as JSON>)`.
     - Function responses: use `getFunctionResponses(event)` from `@google/adk` — show `Tool Result: <name> -> <result summary>`.
   - Token usage (from last response event with `usageMetadata`):
     - `Tokens: <promptTokenCount> prompt / <candidatesTokenCount> completion`
5. If no events exist: return `No request/response data available.`

**Imports needed:**
```typescript
import { getFunctionCalls, getFunctionResponses } from '@google/adk';
import type { Event } from '@google/adk';
import type { Message } from '../types.ts';
```

### C.2 — Create unit tests

**File to create:** `test_scripts/test-format-commands.test.ts`

**Test cases for `formatHistory`:**
1. Empty messages array returns `No messages in the current session.`
2. Single user message formats correctly with role, timestamp, indented text.
3. Agent message with tool calls includes "Tool calls:" subsection.
4. System message shows `[SYSTEM]` role prefix.
5. Multiple messages have blank line separators.
6. Multi-line message text is properly indented.

**Test cases for `formatSessionState`:**
1. Empty state returns `Session state is empty.`
2. State with string value shows quoted value.
3. State with boolean value shows unquoted.
4. State with null value shows `null`.
5. State with object value shows JSON-stringified.
6. Keys are sorted alphabetically.
7. Session ID appears in header.

**Test cases for `formatLastExchange`:**
1. Empty events array returns `No request/response data available.`
2. Single user event (no response yet) shows request only, empty response section.
3. User event + model text response shows both sections.
4. Response with function calls shows `Tool Call:` lines.
5. Response with function responses shows `Tool Result:` lines.
6. Token usage metadata is displayed when present.
7. Multiple response events are shown in order.

**Estimated test count:** 20-25 tests.

### Acceptance Criteria

- [ ] `format-commands.ts` exports `formatHistory`, `formatSessionState`, `formatLastExchange`
- [ ] All functions are pure (no side effects, no React dependency)
- [ ] All unit tests pass: `npx vitest run test_scripts/test-format-commands.test.ts`
- [ ] Edge cases (empty inputs) produce the specified fallback strings
- [ ] TypeScript compiles: `npx tsc --noEmit`

### Verification

```bash
cd /Users/giorgosmarinos/aiwork/coding-platform/macbook-desktop/NotebookLM-agent
npx tsc --noEmit
npx vitest run test_scripts/test-format-commands.test.ts
```

---

## Phase D: Command Routing in index.tsx

**Goal:** Add slash command handlers for `/history`, `/memory`, `/new`, `/last` (with aliases) to the `handleSubmit` function.

**Dependencies:** Phase B (useAgent methods), Phase C (formatting functions)

### D.1 — Import formatting functions

**File:** `notebooklm_agent/tui/index.tsx`

Add import:
```typescript
import { formatHistory, formatSessionState, formatLastExchange } from './lib/format-commands.ts';
```

### D.2 — Extend `handleSubmit` slash command block

**File:** `notebooklm_agent/tui/index.tsx`

The existing `handleSubmit` has an if-chain for slash commands. The new commands are added after the existing `/clear` and `/help` handlers, but before the fallthrough to `agent.sendMessage()`.

**Important behavioral changes:**
1. All new commands check `agent.agentStatus === 'idle'` before executing. If not idle, insert a system message: `Command unavailable while agent is running.`
2. All slash commands (new and existing) record input in history via `history.addEntry(text)` before executing. Currently `history.addEntry` is called only for agent-sent messages.
3. All slash commands clear the editor via `editor.clear()` after execution.
4. Async commands (`/memory`, `/new`, `/last`) use an async IIFE pattern consistent with `sendMessage`.

**Implementation pattern for each command:**

```typescript
const handleSubmit = useCallback(() => {
  const text = editor.getText().trim();
  if (text.length === 0) return;

  if (text.startsWith('/')) {
    const command = text.toLowerCase().trim();
    
    // Existing commands
    if (command === '/quit' || command === '/exit') {
      exit();
      return;
    }
    if (command === '/clear') {
      editor.clear();
      return;
    }

    // --- NEW: /history ---
    if (command === '/history') {
      history.addEntry(text);
      if (agent.agentStatus !== 'idle') {
        agent.addSystemMessage('Command unavailable while agent is running.');
      } else {
        const output = formatHistory(agent.messages);
        agent.addSystemMessage(output);
      }
      editor.clear();
      return;
    }

    // --- NEW: /memory, /state ---
    if (command === '/memory' || command === '/state') {
      history.addEntry(text);
      if (agent.agentStatus !== 'idle') {
        agent.addSystemMessage('Command unavailable while agent is running.');
      } else {
        void (async () => {
          try {
            const state = await agent.getSessionState();
            const output = formatSessionState(state, agent.sessionId ?? '');
            agent.addSystemMessage(output);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            agent.addSystemMessage(`Error retrieving session state: ${msg}`);
          }
        })();
      }
      editor.clear();
      return;
    }

    // --- NEW: /new, /reset ---
    if (command === '/new' || command === '/reset') {
      history.addEntry(text);
      if (agent.agentStatus !== 'idle') {
        agent.addSystemMessage('Command unavailable while agent is running.');
      } else {
        void (async () => {
          try {
            const newId = await agent.resetSession();
            // After resetSession, messages is empty. We need to add the confirmation.
            agent.addSystemMessage(`Session reset. New session started (ID: ${newId}).`);
            scroll.scrollToTop();
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            agent.addSystemMessage(`Error resetting session: ${msg}`);
          }
        })();
      }
      editor.clear();
      return;
    }

    // --- NEW: /last, /raw ---
    if (command === '/last' || command === '/raw') {
      history.addEntry(text);
      if (agent.agentStatus !== 'idle') {
        agent.addSystemMessage('Command unavailable while agent is running.');
      } else {
        void (async () => {
          try {
            const events = await agent.getSessionEvents();
            const output = formatLastExchange(events);
            agent.addSystemMessage(output);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            agent.addSystemMessage(`Error retrieving session events: ${msg}`);
          }
        })();
      }
      editor.clear();
      return;
    }

    if (command === '/help') {
      // placeholder -- falls through to agent
    }
  }

  history.addEntry(text);
  agent.sendMessage(text);
  editor.clear();
}, [editor, history, agent, exit, scroll]);
```

**Note on dependency array:** `scroll` is added to the `useCallback` dependency array because `/new` calls `scroll.scrollToTop()`.

### D.3 — Case insensitivity

The existing code already lowercases the command via `text.toLowerCase().trim()`, so `/History`, `/MEMORY`, etc. are handled correctly by default.

### Acceptance Criteria

- [ ] `/history` inserts a system message with formatted conversation history
- [ ] `/memory` and `/state` insert a system message with session state key-value pairs
- [ ] `/new` and `/reset` clear messages, create new session, insert confirmation system message
- [ ] `/last` and `/raw` insert a system message with the last request/response exchange
- [ ] Commands are case-insensitive
- [ ] All commands are added to input history (up-arrow recall)
- [ ] All commands rejected with message when agent is not idle
- [ ] Editor is cleared after each command
- [ ] Unrecognized slash commands still fall through to the agent
- [ ] Existing `/quit`, `/exit`, `/clear` continue to work
- [ ] TypeScript compiles: `npx tsc --noEmit`

### Verification

```bash
cd /Users/giorgosmarinos/aiwork/coding-platform/macbook-desktop/NotebookLM-agent
npx tsc --noEmit
npm run tui
# Manual test: type /history, /memory, /new, /last and observe system messages
```

---

## Phase E: System Message Rendering

**Goal:** Update `MessageBubble` to render system messages with distinct styling.

**Dependencies:** Phase A (Message type with `'system'` role)

### E.1 — Add system message branch to MessageBubble

**File:** `notebooklm_agent/tui/components/MessageBubble.tsx`

Add a third branch for `role === 'system'` in the component:

```typescript
export function MessageBubble({ message }: MessageBubbleProps): React.JSX.Element {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* Role label */}
      {isSystem ? (
        <Text color="yellow" dimColor>[system]</Text>
      ) : isUser ? (
        <Text color="green" bold>You</Text>
      ) : (
        <Text color="cyan" bold>Agent{message.isPartial ? ' \u258c' : ''}</Text>
      )}

      {/* Message text */}
      <Text wrap="wrap" dimColor={isSystem}>{message.text}</Text>

      {/* Tool call indicators (agent messages only) */}
      {!isSystem && message.toolCalls.map((tc, index) => (
        <ToolCallIndicator key={`${tc.name}-${index}`} toolCall={tc} />
      ))}
    </Box>
  );
}
```

**Styling decisions:**
- **Label:** `[system]` in yellow with dim color — visually distinct from green "You" and cyan "Agent".
- **Body text:** `dimColor` applied to the `<Text>` — appears muted relative to user/agent messages.
- **Tool calls:** Not rendered for system messages (they never have tool calls, but the guard prevents rendering empty arrays).

### E.2 — Verify ChatHistory compatibility

**File:** `notebooklm_agent/tui/components/ChatHistory.tsx`

The `estimateLineCount` function and `computeVisibleMessages` function operate on the generic `Message[]` array. They do not filter by role. System messages with `toolCalls: []` produce `toolLines = 0`, which is correct. **No changes needed.**

The `ChatHistory` component renders all messages via `MessageBubble`. System messages will appear in the correct scroll position. **No changes needed.**

### Acceptance Criteria

- [ ] System messages display with `[system]` label in yellow/dim
- [ ] System message body text is dimmed
- [ ] Tool call indicators are not rendered for system messages
- [ ] User and agent messages continue to render as before (no regression)
- [ ] System messages participate in scroll/windowing correctly
- [ ] TypeScript compiles: `npx tsc --noEmit`

### Verification

```bash
cd /Users/giorgosmarinos/aiwork/coding-platform/macbook-desktop/NotebookLM-agent
npx tsc --noEmit
npm run tui
# Type /history — observe system message with [system] label and dim styling
```

---

## Phase F: StatusBar Help Text

**Goal:** Update the StatusBar key hints to reference the new slash commands.

**Dependencies:** None (can be done in parallel with any phase)

### F.1 — Update key hints text

**File:** `notebooklm_agent/tui/components/StatusBar.tsx`

Change the current hints text from:

```
Ctrl+C cancel | PgUp/PgDn scroll | /help
```

To:

```
Ctrl+C cancel | PgUp/PgDn scroll | /history /memory /new /last
```

This is a single-line change in the JSX:

```typescript
<Text dimColor>Ctrl+C cancel | PgUp/PgDn scroll | /history /memory /new /last</Text>
```

**Rationale:** The `/help` command is currently a placeholder that falls through to the agent. Replacing it with the actual available commands is more useful. If `/help` is implemented later, it can be added back.

### Acceptance Criteria

- [ ] StatusBar displays the four new command names in the hints area
- [ ] Text fits within a standard 80-column terminal
- [ ] TypeScript compiles: `npx tsc --noEmit`

### Verification

```bash
cd /Users/giorgosmarinos/aiwork/coding-platform/macbook-desktop/NotebookLM-agent
npx tsc --noEmit
npm run tui
# Observe status bar shows /history /memory /new /last
```

---

## Implementation Order & Dependencies

```
Phase A (types)
  |
  +----> Phase B (useAgent methods) ---+
  |                                     |
  +----> Phase C (format functions) ---+--> Phase D (command routing)
  |
  +----> Phase E (system message rendering)
  
Phase F (StatusBar) -- independent, can run in parallel with any phase
```

**Recommended sequential order:** A -> E -> C -> B -> D -> F

- **A first:** Foundation types needed by all other phases.
- **E next:** Small change, provides visual feedback for manual testing of later phases.
- **C next:** Pure functions can be developed and tested independently.
- **B next:** Hook methods depend on Phase A types.
- **D next:** Wiring depends on B (methods) and C (formatters).
- **F last or parallel:** Trivial change, no dependencies.

---

## Files Summary

### Files to Modify

| File | Phase | Change |
|---|---|---|
| `notebooklm_agent/tui/types.ts` | A | Add `'system'` to `Message.role` union |
| `notebooklm_agent/tui/hooks/useAgent.ts` | A, B | Add imports, interface methods, implementation, return object |
| `notebooklm_agent/tui/index.tsx` | D | Add slash command routing, import formatters |
| `notebooklm_agent/tui/components/MessageBubble.tsx` | E | Add system message rendering branch |
| `notebooklm_agent/tui/components/StatusBar.tsx` | F | Update key hints text |
| `docs/design/project-functions.md` | -- | Add FR-TUI-14 through FR-TUI-17 |
| `docs/design/project-design.md` | -- | Add TUI commands section |

### Files to Create

| File | Phase | Purpose |
|---|---|---|
| `notebooklm_agent/tui/lib/format-commands.ts` | C | Pure formatting functions |
| `test_scripts/test-format-commands.test.ts` | C | Unit tests for formatting functions |

### Files That Do NOT Change

- `notebooklm_agent/tui/lib/text-buffer.ts`
- `notebooklm_agent/tui/lib/word-boundaries.ts`
- `notebooklm_agent/tui/lib/kill-ring.ts`
- `notebooklm_agent/tui/lib/undo-stack.ts`
- `notebooklm_agent/tui/lib/edit-actions.ts`
- `notebooklm_agent/tui/hooks/useKeyHandler.ts`
- `notebooklm_agent/tui/hooks/useTextEditor.ts`
- `notebooklm_agent/tui/hooks/useInputHistory.ts`
- `notebooklm_agent/tui/hooks/useScrollManager.ts`
- `notebooklm_agent/tui/components/ChatHistory.tsx`
- `notebooklm_agent/tui/components/InputArea.tsx`
- `notebooklm_agent/tui/components/ToolCallIndicator.tsx`
- `notebooklm_agent/tui/worker/agent-protocol.ts`
- All agent tools (`notebooklm_agent/tools/*`)
- `notebooklm_agent/agent.ts`

---

## Final Verification Checklist

After all phases are complete, run the following:

```bash
cd /Users/giorgosmarinos/aiwork/coding-platform/macbook-desktop/NotebookLM-agent

# 1. Type checking
npx tsc --noEmit

# 2. All existing tests still pass
npx vitest run

# 3. New format-commands tests pass
npx vitest run test_scripts/test-format-commands.test.ts

# 4. Manual TUI verification
npm run tui
# - Type a message, get agent response
# - Type /history — see formatted history as system message
# - Type /memory — see session state as system message
# - Type /last — see last request/response as system message
# - Type /new — messages clear, new session ID in confirmation
# - Type /memory — verify state is empty after reset
# - Press up arrow — verify /new is in input history
# - Type /HISTORY — verify case-insensitivity
# - Scroll through long system messages with PgUp/PgDn
# - Type unknown /foo — verify it falls through to agent
# - Verify /quit and /exit still work
```

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `Session` type not exported from `@google/adk` | Low | Medium | Investigation confirmed it is exported. If not, use `Awaited<ReturnType<...>>` inference. |
| `deleteSession` throws for non-existent session | Low | Low | `InMemorySessionService` likely returns void silently. If it throws, the catch block in Phase D handles it. |
| Large `/history` output causes rendering lag | Low | Low | Ink's windowing in `ChatHistory` limits rendered DOM nodes. System message is a single `Message` object regardless of text length. |
| `session.events` structure differs from investigation | Very Low | High | Investigation examined actual type definitions. If structure differs, `formatLastExchange` tests will catch it immediately. |
