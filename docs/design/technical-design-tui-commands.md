# Technical Design: TUI Slash Commands for Session & Conversation Management

**Date:** 2026-04-11  
**Status:** Complete  
**Depends on:** refined-request-tui-commands.md, plan-005-tui-commands.md, investigation-tui-commands.md, codebase-scan-tui-commands.md  
**Implements:** `/history`, `/memory` (`/state`), `/new` (`/reset`), `/last` (`/raw`)

---

## Table of Contents

1. [Type Changes](#1-type-changes)
2. [useAgent Hook Extensions](#2-useagent-hook-extensions)
3. [Format Functions Module](#3-format-functions-module)
4. [Command Routing Changes in index.tsx](#4-command-routing-changes-in-indextsx)
5. [MessageBubble Changes](#5-messagebubble-changes)
6. [StatusBar Changes](#6-statusbar-changes)
7. [ChatHistory Compatibility Analysis](#7-chathistory-compatibility-analysis)
8. [Implementation Units and Parallelization](#8-implementation-units-and-parallelization)
9. [Interface Contracts Between Units](#9-interface-contracts-between-units)
10. [Test Design](#10-test-design)

---

## 1. Type Changes

### 1.1 Extend `Message.role` Union

**File:** `notebooklm_agent/tui/types.ts`, line 33

```typescript
// BEFORE:
readonly role: 'user' | 'agent';

// AFTER:
readonly role: 'user' | 'agent' | 'system';
```

**Impact analysis:**

- **`MessageBubble.tsx`** — Currently uses `const isUser = message.role === 'user'` as a binary check. Without changes, system messages would fall into the `else` (agent) branch and render as "Agent" with cyan bold. Phase E adds a third branch (Section 5).
- **`ChatHistory.tsx`** — `estimateLineCount()` uses `msg.text.split('\n')` and `msg.toolCalls.length`. System messages have `toolCalls: []`, so `toolLines = 0`. No change needed.
- **`computeVisibleMessages()`** — Operates on generic `Message[]` with no role filtering. System messages participate in windowing and scroll automatically. No change needed.
- **`useAgent.sendMessage()`** — Constructs its own `Content` from the `text` parameter and creates its own user `Message` internally (line 123-131). It never reads from the `messages` state array. System messages in `messages` are never sent to the ADK runner. Safe without modification.

### 1.2 Extend `UseAgentResult` Interface

**File:** `notebooklm_agent/tui/hooks/useAgent.ts`, lines 26-35

```typescript
// BEFORE:
export interface UseAgentResult {
  messages: Message[];
  agentStatus: AgentStatus;
  activeToolCall: ToolCallInfo | null;
  sendMessage: (text: string) => void;
  cancelRun: () => void;
  sessionId: string | null;
  isInitialized: boolean;
  initError: string | null;
}

// AFTER:
export interface UseAgentResult {
  messages: Message[];
  agentStatus: AgentStatus;
  activeToolCall: ToolCallInfo | null;
  sendMessage: (text: string) => void;
  cancelRun: () => void;
  sessionId: string | null;
  isInitialized: boolean;
  initError: string | null;

  /** Retrieve the ADK session state (key-value pairs from Session.state). */
  getSessionState: () => Promise<Record<string, unknown>>;

  /** Retrieve the ADK session events array (Session.events). */
  getSessionEvents: () => Promise<Event[]>;

  /**
   * Delete current session, create a new one, clear messages and state.
   * Returns the new session ID.
   * Throws if the runner is not initialized.
   */
  resetSession: () => Promise<string>;

  /** Insert a system message into the chat history (TUI-local, never sent to agent). */
  addSystemMessage: (text: string) => void;
}
```

The `Event` type is already imported from `@google/adk` in `useAgent.ts` (line 14). No new type import is needed for the interface declaration.

### 1.3 New ADK Import: `Session`

**File:** `notebooklm_agent/tui/hooks/useAgent.ts`, lines 9-15

```typescript
// BEFORE:
import {
  InMemoryRunner,
  StreamingMode,
  toStructuredEvents,
  EventType,
  type Event,
} from '@google/adk';

// AFTER:
import {
  InMemoryRunner,
  StreamingMode,
  toStructuredEvents,
  EventType,
  type Event,
  type Session,
} from '@google/adk';
```

The `Session` type is exported from `@google/adk` via `common.d.ts` line 83. It is needed as the return type of `sessionService.getSession()` for internal type-checking. The request types (`GetSessionRequest`, `DeleteSessionRequest`, `CreateSessionRequest`) do not need explicit imports; inline object literals will be structurally typed by TypeScript.

---

## 2. useAgent Hook Extensions

All four new methods are implemented inside the `useAgent` hook function body and added to the return object. They use the existing `runnerRef`, `sessionIdRef`, and `setMessages` state from the hook's closure.

### 2.1 `addSystemMessage(text: string): void`

**Pattern:** Synchronous `useCallback`. Wraps `setMessages` to append a properly-formed system `Message`.

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

**Key details:**
- `generateId()` already exists in `useAgent.ts` (line 41-43) and produces unique timestamp+random IDs.
- `toolCalls: []` ensures `ToolCallIndicator` is not rendered. `estimateLineCount` produces `toolLines = 0`.
- `isPartial: false` ensures no streaming cursor indicator.
- The empty dependency array `[]` is correct because `setMessages` is a React state setter (stable reference) and `generateId` is a module-level function.

**Error handling:** None needed. `setMessages` is synchronous and cannot throw.

### 2.2 `getSessionState(): Promise<Record<string, unknown>>`

**Pattern:** Async `useCallback`. Calls `sessionService.getSession()` and extracts `session.state`.

```typescript
const getSessionState = useCallback(async (): Promise<Record<string, unknown>> => {
  const runner = runnerRef.current;
  const sid = sessionIdRef.current;
  if (!runner || !sid) return {};

  const session: Session | undefined = await runner.sessionService.getSession({
    appName: 'notebooklm-tui',
    userId: effectiveUserId,
    sessionId: sid,
  });
  return session?.state ?? {};
}, [effectiveUserId]);
```

**Key details:**
- `appName: 'notebooklm-tui'` matches the value used during runner creation (line 73) and session creation (line 78).
- `effectiveUserId` is in the dependency array because it is captured from the hook parameter (line 50).
- `getSession` returns `Session | undefined`. The `?.state ?? {}` handles the undefined case.
- For `InMemorySessionService`, `getSession` is O(1) (Map lookup) and returns the full session including all events. No network I/O.

**Error handling:** If `getSession` throws (unexpected for in-memory), the error propagates to the caller (the command handler in `index.tsx`), which wraps all async commands in try/catch.

### 2.3 `getSessionEvents(): Promise<Event[]>`

**Pattern:** Identical to `getSessionState` but extracts `session.events` instead.

```typescript
const getSessionEvents = useCallback(async (): Promise<Event[]> => {
  const runner = runnerRef.current;
  const sid = sessionIdRef.current;
  if (!runner || !sid) return [];

  const session: Session | undefined = await runner.sessionService.getSession({
    appName: 'notebooklm-tui',
    userId: effectiveUserId,
    sessionId: sid,
  });
  return session?.events ?? [];
}, [effectiveUserId]);
```

**Key details:**
- `Session.events` is `Event[]` (confirmed in `session.d.ts` line 75).
- `Event` extends `LlmResponse`, which carries `content?: Content`, `usageMetadata?`, `partial?`, `turnComplete?`.
- The `Event` type itself adds `id`, `invocationId`, `author?`, `actions`, `timestamp`.

**Error handling:** Same as `getSessionState` — propagates to caller.

### 2.4 `resetSession(): Promise<string>`

**Pattern:** Async `useCallback`. Performs delete + create + state reset. Returns the new session ID.

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
  const newSession: Session = await runner.sessionService.createSession({
    appName: 'notebooklm-tui',
    userId: effectiveUserId,
  });

  // Step 3: Update refs and React state
  sessionIdRef.current = newSession.id;
  setSessionId(newSession.id);
  setMessages([]);

  return newSession.id;
}, [effectiveUserId]);
```

**Key details:**
- Steps 1-3 execute sequentially. If step 1 fails, steps 2-3 do not run.
- `setMessages([])` clears the entire message history, including system messages.
- The `addSystemMessage` call for the confirmation message happens in the caller (`index.tsx`), not inside `resetSession`. This is intentional: `resetSession` is a data operation; message display is a UI concern.
- `sessionIdRef.current` and `setSessionId` are both updated. The ref is used by `sendMessage` for immediate access; the state drives React re-renders (StatusBar displays session ID).

**Error handling:**
- If `runner` or `sid` is null: throws `Error('Agent not initialized')`. Caller catches and displays error system message.
- If `deleteSession` throws: error propagates. Existing session remains intact (no state was modified).
- If `createSession` throws after successful delete: the old session is gone but no new session exists. This is a degenerate state. However, `InMemorySessionService.createSession` allocates a new `Session` object in a `Map` — it has no external dependencies and cannot fail under normal circumstances. The caller's catch block will display the error. The user can retry with `/new` (though it will fail again if the runner is broken) or restart the TUI.

### 2.5 Updated Return Object

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

---

## 3. Format Functions Module

### 3.1 Module Location and Structure

**New file:** `notebooklm_agent/tui/lib/format-commands.ts`

This module contains three pure functions with no React dependency. Each accepts structured data and returns a formatted string. The module imports only types and ADK helper functions.

```typescript
// notebooklm_agent/tui/lib/format-commands.ts

import { getFunctionCalls, getFunctionResponses } from '@google/adk';
import type { Event } from '@google/adk';
import type { Message } from '../types.ts';
```

### 3.2 `formatHistory(messages: Message[]): string`

**Purpose:** Formats the TUI's local message array for the `/history` command.

```typescript
export function formatHistory(messages: Message[]): string
```

**Parameters:**
- `messages: Message[]` — The full `messages` array from `useAgent`, including user, agent, and system messages.

**Returns:** A multi-line formatted string, or the empty-state fallback.

**Algorithm:**

1. If `messages.length === 0`, return `'No messages in the current session.'`.
2. For each message, produce a block:
   ```
   [USER] 2026-04-11T10:23:45.000Z
     List my notebooks
   ```
   - Header: `[${role.toUpperCase()}] ${new Date(msg.timestamp).toISOString()}`
   - Body: Each line of `msg.text` prefixed with `'  '` (2-space indent).
   - If `msg.toolCalls.length > 0`, append:
     ```
       Tool calls:
         search_youtube({"query":"AI agents"}) [completed]
         get_video_info({"video_id":"abc123"}) [running]
     ```
     Each tool call: `    ${tc.name}(${JSON.stringify(tc.args)}) [${tc.status}]`
3. Join blocks with `'\n\n'` (blank line between messages).

**Formatting rules:**
- Role labels: `USER`, `AGENT`, `SYSTEM` (uppercase).
- Timestamps: ISO 8601 via `new Date(timestamp).toISOString()`.
- Body indentation: 2 spaces.
- Tool call indentation: 4 spaces (under the 2-space "Tool calls:" header).
- No truncation. The user can scroll through long output.

### 3.3 `formatSessionState(state: Record<string, unknown>, sessionId: string): string`

**Purpose:** Formats the ADK session state for the `/memory` command.

```typescript
export function formatSessionState(
  state: Record<string, unknown>,
  sessionId: string,
): string
```

**Parameters:**
- `state: Record<string, unknown>` — From `Session.state`.
- `sessionId: string` — Current session ID for the header.

**Returns:** A multi-line formatted string, or the empty-state fallback.

**Algorithm:**

1. Get keys via `Object.keys(state)`.
2. If no keys, return `'Session state is empty.'`.
3. Sort keys alphabetically via `.sort()`.
4. Header line: `Session State (session: ${sessionId})`
5. For each key: `  ${key}: ${JSON.stringify(state[key])}` (2-space indent).
6. Join header + key lines with `'\n'`.

**Formatting rules:**
- Keys sorted alphabetically for deterministic output.
- Values are `JSON.stringify()`-ed: strings get quotes, booleans/numbers are bare, objects/arrays are JSON.
- 2-space indent for key-value pairs.
- No truncation.

### 3.4 `formatLastExchange(events: Event[]): string`

**Purpose:** Extracts and formats the last user-to-model exchange from ADK session events for the `/last` command.

```typescript
export function formatLastExchange(events: Event[]): string
```

**Parameters:**
- `events: Event[]` — From `Session.events`.

**Returns:** A multi-line formatted string, or the empty-state fallback.

**Algorithm:**

1. If `events.length === 0`, return `'No request/response data available.'`.
2. **Find the last user event:** Scan backward through `events` for the last index `i` where `events[i].author === 'user'`. If no user event found, return `'No request/response data available.'`.
3. **Extract request content:** The user event at index `i` contains `event.content?.parts`. For each part:
   - If `part.text` exists: append the text.
   - If `part.functionCall` exists: append `Function Call: ${part.functionCall.name}(${JSON.stringify(part.functionCall.args)})`.
   - Other part types (inline data, etc.): append `[${Object.keys(part).join(', ')}]`.
4. **Extract response events:** All events from index `i + 1` to end of array. For each response event:
   - **Text content:** Extract from `event.content?.parts` where `part.text` exists. Show the text.
   - **Function calls:** Use `getFunctionCalls(event)` from `@google/adk`. For each `FunctionCall`, show:
     ```
     Tool Call: search_youtube({"query": "AI agents"})
     ```
   - **Function responses:** Use `getFunctionResponses(event)` from `@google/adk`. For each `FunctionResponse`, show:
     ```
     Tool Result: search_youtube -> {"status":"success","data":[...]}
     ```
     Result values are `JSON.stringify()`-ed. If the stringified result exceeds 500 characters, truncate with `... (truncated)`.
   - **Token usage:** From the last response event that has `event.usageMetadata`, extract:
     ```
     Tokens: 1234 prompt / 567 completion
     ```
     Use `event.usageMetadata?.promptTokenCount` and `event.usageMetadata?.candidatesTokenCount`.
5. If no response events exist (user event is the last event): show the request section and an empty response section with `(awaiting response)`.

**Output format:**

```
--- Last Request ---
List my notebooks

--- Last Response ---
Here are your notebooks:
1. Research Notes
2. Project Alpha

Tool Call: list_notebooks({})
Tool Result: list_notebooks -> {"status":"success","data":[{"id":"nb-1","title":"Research Notes"},{"id":"nb-2","title":"Project Alpha"}]}

Tokens: 1234 prompt / 567 completion
```

**Formatting rules:**
- Section headers: `--- Last Request ---` and `--- Last Response ---` on their own lines.
- Text content shown verbatim (no indent in the request/response sections).
- Function call args: `JSON.stringify()`, single line.
- Function response results: `JSON.stringify()`, truncated at 500 characters with `... (truncated)`.
- Token usage on its own line at the end of the response section, only if `usageMetadata` is present.
- If `candidatesTokenCount` is undefined, omit the completion count.

### 3.5 ADK Helper Functions Used

| Function | Import | Purpose |
|----------|--------|---------|
| `getFunctionCalls(event)` | `@google/adk` | Returns `FunctionCall[]` — extracts function calls from `event.content?.parts` |
| `getFunctionResponses(event)` | `@google/adk` | Returns `FunctionResponse[]` — extracts function responses from `event.content?.parts` |

Both are re-exported from `@google/adk` via `common.d.ts` line 50. `FunctionCall` and `FunctionResponse` are types from `@google/genai`:
- `FunctionCall`: `{ name: string; args: Record<string, unknown> }`
- `FunctionResponse`: `{ name: string; response: unknown }`

---

## 4. Command Routing Changes in `index.tsx`

### 4.1 New Imports

```typescript
// Add to existing imports in index.tsx:
import {
  formatHistory,
  formatSessionState,
  formatLastExchange,
} from './lib/format-commands.ts';
```

### 4.2 Destructured Agent Fields

The `agent` object from `useAgent()` now exposes four new methods. The existing code accesses `agent.messages`, `agent.agentStatus`, `agent.sendMessage`, etc. The new methods are accessed as:
- `agent.getSessionState()`
- `agent.getSessionEvents()`
- `agent.resetSession()`
- `agent.addSystemMessage()`

No destructuring changes needed; the existing `const agent = useAgent()` pattern works.

### 4.3 Modified `handleSubmit` Function

The existing `handleSubmit` (lines 63-87) is extended with four new command handlers. The complete updated function:

```typescript
const handleSubmit = useCallback(() => {
  const text = editor.getText().trim();
  if (text.length === 0) return;

  // Check for slash commands
  if (text.startsWith('/')) {
    const command = text.toLowerCase().trim();

    // --- Existing: /quit, /exit ---
    if (command === '/quit' || command === '/exit') {
      exit();
      return;
    }

    // --- Existing: /clear ---
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
            agent.addSystemMessage(
              `Session reset. New session started (ID: ${newId}).`,
            );
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

    // --- Existing: /help placeholder ---
    if (command === '/help') {
      // Falls through to agent
    }
  }

  // Default: send to agent
  history.addEntry(text);
  agent.sendMessage(text);
  editor.clear();
}, [editor, history, agent, exit, scroll]);
```

### 4.4 Key Behavioral Details

**Async IIFE pattern:** The `/memory`, `/new`, and `/last` commands use `void (async () => { ... })()` — the same fire-and-forget pattern used by `sendMessage` (line 135 of `useAgent.ts`). The `void` operator suppresses the floating promise lint warning. The IIFE runs on the microtask queue; `editor.clear()` and `return` execute synchronously before the async body completes.

**Order of operations for async commands:**
1. `history.addEntry(text)` — synchronous, records in input history immediately.
2. Idle check — synchronous.
3. `editor.clear()` — synchronous, clears the input area immediately.
4. `return` — exits `handleSubmit`.
5. Async IIFE body runs on next microtask: calls `getSessionState`/`getSessionEvents`/`resetSession`, formats output, calls `addSystemMessage`.

The user sees the input area cleared immediately. The system message appears a fraction of a millisecond later when the async body completes and React re-renders.

**`/new` scroll reset:** After `resetSession()` clears all messages and `addSystemMessage()` inserts the confirmation, `scroll.scrollToTop()` resets the scroll offset to 0. This is called inside the async IIFE after the system message is inserted.

**Case insensitivity:** `const command = text.toLowerCase().trim()` on line 69 (existing) handles this. `/History`, `/MEMORY`, `/State` all work.

**Dependency array:** `scroll` is added to the `useCallback` dependency array because `/new` calls `scroll.scrollToTop()`. The existing dependencies (`editor`, `history`, `agent`, `exit`) remain.

**Unrecognized commands:** Any `/foo` that does not match a known command falls through the if-chain and reaches `agent.sendMessage(text)` — the existing behavior.

---

## 5. MessageBubble Changes

### 5.1 System Message Rendering Branch

**File:** `notebooklm_agent/tui/components/MessageBubble.tsx`

The component currently has a binary `isUser` check. A third branch is added for `role === 'system'`.

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

      {/* Tool call indicators (skip for system messages) */}
      {!isSystem && message.toolCalls.map((tc, index) => (
        <ToolCallIndicator key={`${tc.name}-${index}`} toolCall={tc} />
      ))}
    </Box>
  );
}
```

### 5.2 Styling Decisions

| Element | User | Agent | System |
|---------|------|-------|--------|
| Label text | `You` | `Agent` | `[system]` |
| Label color | green, bold | cyan, bold | yellow, dimColor |
| Body color | default | default | dimColor |
| Tool calls | shown | shown | hidden (guard: `!isSystem`) |
| Streaming cursor | n/a | `\u258c` when `isPartial` | n/a |

**Rationale:**
- Yellow+dim for the label makes system messages visually distinct from both user (green) and agent (cyan) messages.
- `dimColor` on the body text mutes the system output so it does not compete with conversation messages.
- Tool calls are never rendered for system messages. Although system messages always have `toolCalls: []`, the `!isSystem` guard is a defensive measure that also clarifies intent.

### 5.3 Integration with Existing Code Paths

The `MessageBubble` component is rendered by `ChatHistory.tsx` via:
```typescript
{visible.map((msg) => (
  <MessageBubble key={msg.id} message={msg} />
))}
```

No change is needed in `ChatHistory.tsx`. System messages flow through the existing rendering pipeline.

---

## 6. StatusBar Changes

### 6.1 Updated Key Hints

**File:** `notebooklm_agent/tui/components/StatusBar.tsx`, line 58

```typescript
// BEFORE:
<Text dimColor>Ctrl+C cancel | PgUp/PgDn scroll | /help</Text>

// AFTER:
<Text dimColor>Ctrl+C cancel | PgUp/PgDn scroll | /history /memory /new /last</Text>
```

**Character count:** `Ctrl+C cancel | PgUp/PgDn scroll | /history /memory /new /last` = 59 characters. Fits well within 80-column terminals.

---

## 7. ChatHistory Compatibility Analysis

### 7.1 `estimateLineCount` (lines 14-23)

```typescript
function estimateLineCount(msg: Message, terminalWidth: number): number {
  const effectiveWidth = Math.max(1, terminalWidth - 4);
  const prefix = 1;
  const gap = 1;
  const contentLines = msg.text.split('\n').reduce(...);
  const toolLines = msg.toolCalls.length;
  return prefix + contentLines + toolLines + gap;
}
```

For system messages:
- `prefix = 1` — correct (the `[system]` label occupies one line).
- `contentLines` — system message text is split by `\n` and line-wrapped. This is correct. Long system messages (e.g., `/history` output with 50+ messages) will produce many content lines, and the scroll system will handle them.
- `toolLines = 0` — system messages have `toolCalls: []`. Correct.
- `gap = 1` — marginBottom={1} applies to all messages. Correct.

**Verdict:** No change needed.

### 7.2 `computeVisibleMessages` (lines 33-87)

Operates on the generic `Message[]` array. Does not filter by role. System messages participate in scroll positioning and windowing.

**Verdict:** No change needed.

### 7.3 Empty State

The empty state display:
```typescript
{messages.length === 0 && (
  <Box flexGrow={1} justifyContent="center" alignItems="center">
    <Text dimColor>Send a message to start the conversation.</Text>
  </Box>
)}
```

After `/new`, `resetSession()` clears messages to `[]`, then `addSystemMessage()` appends the confirmation. So `messages.length` is 1, not 0. The empty state is not shown. This is correct behavior — the user sees the reset confirmation message.

**Verdict:** No change needed.

---

## 8. Implementation Units and Parallelization

### 8.1 Dependency Graph

```
Unit 1: Types + useAgent
   |
   +----> Unit 2: format-commands.ts (pure functions) [can start after types only]
   |
   +----> Unit 3: Command routing + MessageBubble + StatusBar [needs Unit 1 + Unit 2]
```

### 8.2 Unit 1: Types + useAgent Extensions

**Scope:**
- `notebooklm_agent/tui/types.ts` — Add `'system'` to `Message.role`.
- `notebooklm_agent/tui/hooks/useAgent.ts` — Add `Session` import, extend `UseAgentResult` interface, implement `addSystemMessage`, `getSessionState`, `getSessionEvents`, `resetSession`, update return object.

**Must be first.** All other units depend on the `Message` type change and the `UseAgentResult` interface.

**Verification:** `npx tsc --noEmit` must pass.

### 8.3 Unit 2: Format Functions (Pure, No Dependencies Beyond Types)

**Scope:**
- Create `notebooklm_agent/tui/lib/format-commands.ts` — `formatHistory`, `formatSessionState`, `formatLastExchange`.
- Create `test_scripts/test-format-commands.test.ts` — Unit tests.

**Can start after Unit 1 types are committed.** Does not depend on the `useAgent` method implementations (Unit 1 hook changes). Only needs the `Message` type with `'system'` role and the `Event` type from `@google/adk`.

**Verification:** `npx vitest run test_scripts/test-format-commands.test.ts` must pass.

### 8.4 Unit 3: Command Routing + UI Components

**Scope:**
- `notebooklm_agent/tui/index.tsx` — Import format functions, extend `handleSubmit` with four command handlers.
- `notebooklm_agent/tui/components/MessageBubble.tsx` — Add system message rendering branch.
- `notebooklm_agent/tui/components/StatusBar.tsx` — Update key hints text.

**Depends on both Unit 1 and Unit 2.** Uses `addSystemMessage`, `getSessionState`, `getSessionEvents`, `resetSession` from Unit 1, and `formatHistory`, `formatSessionState`, `formatLastExchange` from Unit 2.

**Verification:** `npx tsc --noEmit` and manual TUI testing.

### 8.5 Parallelization Strategy

After Unit 1 (types + interface) is committed:
- Unit 2 (format functions + tests) and Unit 1's hook implementations can proceed in parallel.
- Unit 3 can only begin once both Unit 1 and Unit 2 are complete.

In practice, the recommended sequential order is:
1. **Unit 1** — Types + useAgent (foundation).
2. **Unit 2** — format-commands.ts + tests (can test independently).
3. **Unit 3** — Wiring + UI (integration).

---

## 9. Interface Contracts Between Units

### 9.1 Contract: Unit 1 (useAgent) provides to Unit 3 (index.tsx)

```typescript
// useAgent return object contract for slash commands:

interface UseAgentSlashCommandContract {
  // READ-ONLY state
  messages: Message[];            // Current message history
  agentStatus: AgentStatus;       // Must be 'idle' for commands to execute
  sessionId: string | null;       // Current session ID (displayed in /memory header)

  // METHODS
  addSystemMessage: (text: string) => void;
  getSessionState: () => Promise<Record<string, unknown>>;
  getSessionEvents: () => Promise<Event[]>;
  resetSession: () => Promise<string>;  // Returns new session ID
}
```

**Guarantees from Unit 1:**
- `addSystemMessage` always appends. Never throws.
- `getSessionState` returns `{}` if runner/session not initialized. Throws only on unexpected errors.
- `getSessionEvents` returns `[]` if runner/session not initialized. Throws only on unexpected errors.
- `resetSession` throws `Error('Agent not initialized')` if runner/session is null. Throws if `deleteSession` or `createSession` fails. On success: `messages` state is cleared to `[]`, `sessionId` state is updated, and the new session ID is returned.

**Guarantees from Unit 3:**
- Never calls `getSessionState`, `getSessionEvents`, or `resetSession` unless `agentStatus === 'idle'`.
- Always wraps async calls in try/catch, displaying errors via `addSystemMessage`.
- Never passes system messages to `sendMessage`.

### 9.2 Contract: Unit 2 (format-commands) provides to Unit 3 (index.tsx)

```typescript
// Pure function signatures:

function formatHistory(messages: Message[]): string;
function formatSessionState(state: Record<string, unknown>, sessionId: string): string;
function formatLastExchange(events: Event[]): string;
```

**Guarantees from Unit 2:**
- All functions are pure. No side effects, no I/O, no React dependency.
- All functions return a string. Never throw.
- Empty input produces a human-readable fallback string (not empty string).
- Output is suitable for display in a terminal. No ANSI escape codes. No raw JSON dumps (values are formatted readably).

**Guarantees from Unit 3:**
- Passes the correct data types to each function.
- Does not modify the returned string.
- Passes the string directly to `addSystemMessage`.

### 9.3 Contract: Unit 1 (types.ts) provides to Unit 2 and Unit 3

```typescript
// The Message type contract:

interface Message {
  readonly id: string;
  readonly role: 'user' | 'agent' | 'system';  // <-- 'system' is NEW
  text: string;
  isPartial: boolean;
  toolCalls: ToolCallInfo[];
  readonly timestamp: number;
}
```

**Guarantees:**
- System messages always have `toolCalls: []` and `isPartial: false`.
- System messages always have `role: 'system'`.
- The `id` is unique (generated by `generateId()`).
- The `timestamp` is `Date.now()` at creation time.

---

## 10. Test Design

### 10.1 Test File

**New file:** `test_scripts/test-format-commands.test.ts`

### 10.2 Test Coverage for `formatHistory`

| # | Test Case | Input | Expected Output |
|---|-----------|-------|-----------------|
| 1 | Empty messages | `[]` | `'No messages in the current session.'` |
| 2 | Single user message | 1 user msg | Contains `[USER]`, ISO timestamp, indented text |
| 3 | Single agent message | 1 agent msg | Contains `[AGENT]`, ISO timestamp |
| 4 | System message | 1 system msg | Contains `[SYSTEM]` |
| 5 | Agent with tool calls | agent msg + toolCalls | Contains `Tool calls:` section with name, args, status |
| 6 | Multiple messages | 3 msgs | Blocks separated by blank lines |
| 7 | Multi-line text | msg with `\n` | Each line indented with 2 spaces |
| 8 | Empty tool calls | agent msg, `toolCalls: []` | No "Tool calls:" section |

### 10.3 Test Coverage for `formatSessionState`

| # | Test Case | Input | Expected Output |
|---|-----------|-------|-----------------|
| 1 | Empty state | `{}` | `'Session state is empty.'` |
| 2 | String value | `{key: "val"}` | `  key: "val"` |
| 3 | Boolean value | `{flag: true}` | `  flag: true` |
| 4 | Null value | `{x: null}` | `  x: null` |
| 5 | Number value | `{count: 42}` | `  count: 42` |
| 6 | Object value | `{data: {a:1}}` | `  data: {"a":1}` |
| 7 | Alphabetical sorting | `{z: 1, a: 2}` | `a` before `z` |
| 8 | Session ID in header | sessionId="abc" | `Session State (session: abc)` |

### 10.4 Test Coverage for `formatLastExchange`

| # | Test Case | Input | Expected Output |
|---|-----------|-------|-----------------|
| 1 | Empty events | `[]` | `'No request/response data available.'` |
| 2 | No user events | agent-only events | `'No request/response data available.'` |
| 3 | User event only | 1 user event | Request section + empty response with `(awaiting response)` |
| 4 | User + text response | user + model text | Both sections with text content |
| 5 | Response with function calls | model with functionCall | `Tool Call:` lines |
| 6 | Response with function responses | model with functionResponse | `Tool Result:` lines |
| 7 | Token usage metadata | event with usageMetadata | `Tokens: X prompt / Y completion` |
| 8 | Long function response | result > 500 chars | Truncated with `... (truncated)` |
| 9 | Multiple response events | 3 response events | All shown in order |
| 10 | Multiple user events | selects last one | Only last user event used as request |

**Estimated total:** 26 tests.

### 10.5 Testing Strategy

All tests use Vitest. The format functions are pure, so tests are straightforward:

```typescript
import { describe, it, expect } from 'vitest';
import { formatHistory, formatSessionState, formatLastExchange } from '../notebooklm_agent/tui/lib/format-commands.ts';
import type { Message } from '../notebooklm_agent/tui/types.ts';
```

For `formatLastExchange` tests, mock `Event` objects must be constructed. The minimum viable mock:

```typescript
function makeEvent(overrides: Partial<Event>): Event {
  return {
    id: 'evt-1',
    invocationId: 'inv-1',
    author: 'user',
    actions: {
      stateDelta: {},
      artifactDelta: {},
      requestedAuthConfigs: {},
      requestedToolConfirmations: {},
    },
    timestamp: Date.now(),
    ...overrides,
  } as Event;
}
```

The `as Event` cast is acceptable because `Event extends LlmResponse`, and the omitted `LlmResponse` fields (`content`, `partial`, `turnComplete`, etc.) are all optional.

---

## Appendix: Files Changed Summary

### Files Modified

| File | Section | Change |
|------|---------|--------|
| `notebooklm_agent/tui/types.ts` | 1.1 | Add `'system'` to `Message.role` union |
| `notebooklm_agent/tui/hooks/useAgent.ts` | 1.2, 1.3, 2.1-2.5 | Import `Session`, extend interface, implement 4 methods, update return |
| `notebooklm_agent/tui/index.tsx` | 4.1-4.4 | Import formatters, extend `handleSubmit` with 4 command handlers |
| `notebooklm_agent/tui/components/MessageBubble.tsx` | 5.1-5.2 | Add system message rendering branch |
| `notebooklm_agent/tui/components/StatusBar.tsx` | 6.1 | Update key hints text |
| `docs/design/project-design.md` | -- | Add Section 11.10 TUI Slash Commands (already present, updated) |

### Files Created

| File | Section | Purpose |
|------|---------|---------|
| `notebooklm_agent/tui/lib/format-commands.ts` | 3.1-3.4 | Pure formatting functions |
| `test_scripts/test-format-commands.test.ts` | 10.1-10.5 | Unit tests for formatting functions |
| `docs/design/technical-design-tui-commands.md` | -- | This document |

### Files NOT Changed

| File | Reason |
|------|--------|
| `notebooklm_agent/tui/components/ChatHistory.tsx` | System messages work with existing windowing logic (Section 7) |
| `notebooklm_agent/tui/lib/text-buffer.ts` | No text buffer changes |
| `notebooklm_agent/tui/lib/word-boundaries.ts` | No word boundary changes |
| `notebooklm_agent/tui/lib/kill-ring.ts` | No kill ring changes |
| `notebooklm_agent/tui/lib/undo-stack.ts` | No undo stack changes |
| `notebooklm_agent/tui/lib/edit-actions.ts` | No new edit actions |
| `notebooklm_agent/tui/hooks/useKeyHandler.ts` | No new keyboard shortcuts |
| `notebooklm_agent/tui/hooks/useTextEditor.ts` | No editor changes |
| `notebooklm_agent/tui/hooks/useInputHistory.ts` | No history changes |
| `notebooklm_agent/tui/hooks/useScrollManager.ts` | No scroll changes |
| `notebooklm_agent/tui/components/InputArea.tsx` | No input area changes |
| `notebooklm_agent/tui/components/ToolCallIndicator.tsx` | No tool indicator changes |
| `notebooklm_agent/tui/worker/agent-protocol.ts` | No protocol changes |
| `notebooklm_agent/agent.ts` | No agent changes |
| `notebooklm_agent/tools/*` | No tool changes |
