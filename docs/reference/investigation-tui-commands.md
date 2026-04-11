# Investigation: TUI Slash Commands

**Date:** 2026-04-11  
**Status:** Complete  
**Component:** NotebookLM Agent Terminal UI (TUI)

---

## 1. ADK Session API

### 1.1 InMemoryRunner and Session Service

The `InMemoryRunner` extends `Runner`. The `Runner` class exposes `sessionService` as a **public readonly** property:

**File:** `node_modules/@google/adk/dist/types/runner/runner.d.ts`, line 48  
```typescript
readonly sessionService: BaseSessionService;
```

The `useAgent` hook stores the runner in a React ref:

**File:** `notebooklm_agent/tui/hooks/useAgent.ts`, line 59  
```typescript
const runnerRef = useRef<InMemoryRunner | null>(null);
```

The runner is created on mount (line 71) and the ref is assigned (line 75):
```typescript
const runner = new InMemoryRunner({
  agent: rootAgent,
  appName: 'notebooklm-tui',
});
runnerRef.current = runner;
```

**Conclusion:** `runnerRef.current.sessionService` provides full access to all session operations. The runner ref is currently private to the hook but can easily be used internally to expose new methods.

### 1.2 Session Service Methods

The `BaseSessionService` abstract class (and `InMemorySessionService` implementation) provides these methods:

**File:** `node_modules/@google/adk/dist/types/sessions/base_session_service.d.ts`

| Method | Signature | Line |
|---|---|---|
| `createSession` | `(request: CreateSessionRequest) => Promise<Session>` | 93 |
| `getSession` | `(request: GetSessionRequest) => Promise<Session \| undefined>` | 101 |
| `deleteSession` | `(request: DeleteSessionRequest) => Promise<void>` | 122 |
| `listSessions` | `(request: ListSessionsRequest) => Promise<ListSessionsResponse>` | 115 |
| `getOrCreateSession` | `(request: CreateSessionRequest) => Promise<Session>` | 108 |

Request types:

```typescript
// CreateSessionRequest
{ appName: string; userId: string; state?: Record<string, unknown>; sessionId?: string; }

// GetSessionRequest
{ appName: string; userId: string; sessionId: string; config?: GetSessionConfig; }

// DeleteSessionRequest
{ appName: string; userId: string; sessionId: string; }
```

### 1.3 Session Object

**File:** `node_modules/@google/adk/dist/types/sessions/session.d.ts`

```typescript
export interface Session {
    id: string;
    appName: string;
    userId: string;
    state: Record<string, unknown>;
    events: Event[];
    lastUpdateTime: number;
}
```

**Both `state` and `events` are directly available on the Session object.** No pagination is needed for `InMemorySessionService` — it returns the full session with all events.

### 1.4 What Needs to be Exposed from useAgent

Currently, `useAgent` only returns (line 315-324):
```typescript
return {
    messages, agentStatus, activeToolCall,
    sendMessage, cancelRun,
    sessionId, isInitialized, initError,
};
```

Three new methods are needed on the `UseAgentResult` interface:

1. **`getSessionState(): Promise<Record<string, unknown>>`** — calls `runnerRef.current.sessionService.getSession(...)` and returns `session.state`
2. **`getSessionEvents(): Promise<Event[]>`** — calls `runnerRef.current.sessionService.getSession(...)` and returns `session.events`
3. **`resetSession(): Promise<string>`** — calls `deleteSession`, then `createSession`, clears messages, updates session ID refs, returns new session ID

Additionally, the hook needs to expose either `setMessages` or an `addSystemMessage` helper so that `index.tsx` can insert system messages without going through the agent.

---

## 2. Event Structure

### 2.1 Event Interface

**File:** `node_modules/@google/adk/dist/types/events/event.d.ts`

The `Event` interface extends `LlmResponse` and adds:

```typescript
export interface Event extends LlmResponse {
    id: string;
    invocationId: string;
    author?: string;           // "user" or agent name
    actions: EventActions;     // includes stateDelta
    longRunningToolIds?: string[];
    branch?: string;
    timestamp: number;
}
```

### 2.2 LlmResponse (parent interface)

**File:** `node_modules/@google/adk/dist/types/models/llm_response.d.ts`

Key fields inherited by Event:

```typescript
export interface LlmResponse {
    content?: Content;            // from @google/genai — has role + parts[]
    partial?: boolean;
    turnComplete?: boolean;
    errorCode?: string;
    errorMessage?: string;
    usageMetadata?: GenerateContentResponseUsageMetadata;
    finishReason?: FinishReason;
    // ... other fields (grounding, citations, transcriptions)
}
```

### 2.3 Content Structure (from @google/genai)

The `Content` type from `@google/genai` has:
- `role`: string (e.g., "user", "model")
- `parts`: array of `Part` objects (text, function call, function response, inline data, etc.)

### 2.4 EventActions

**File:** `node_modules/@google/adk/dist/types/events/event_actions.d.ts`

```typescript
export interface EventActions {
    skipSummarization?: boolean;
    stateDelta: { [key: string]: unknown };
    artifactDelta: { [key: string]: number };
    transferToAgent?: string;
    escalate?: boolean;
    requestedAuthConfigs: { [key: string]: AuthConfig };
    requestedToolConfirmations: { [key: string]: ToolConfirmation };
}
```

### 2.5 UsageMetadata for Token Counts

**File:** `node_modules/@google/genai/dist/genai.d.ts`, line 4671

```typescript
export declare class GenerateContentResponseUsageMetadata {
    cachedContentTokenCount?: number;
    candidatesTokenCount?: number;     // completion tokens
    promptTokenCount?: number;         // prompt tokens
    // ... other fields
}
```

### 2.6 Helper Functions Available

The ADK exports several useful helper functions for working with events:

**File:** `node_modules/@google/adk/dist/types/events/event.d.ts`

```typescript
export declare function getFunctionCalls(event: Event): FunctionCall[];
export declare function getFunctionResponses(event: Event): FunctionResponse[];
export declare function stringifyContent(event: Event): string;
export declare function isFinalResponse(event: Event): boolean;
```

These are all exported from `@google/adk` (via `common.d.ts` line 50) and can be imported directly.

### 2.7 How to Extract Last User Prompt and Model Response

To implement `/last`:

1. Get `session.events` array
2. Find the last event where `event.author === 'user'` — this is the request
3. All subsequent events (where `event.author !== 'user'` or `author` is the agent name) until the next user event or end-of-list — these are the response events
4. For each event:
   - Text content: use `stringifyContent(event)` or iterate `event.content?.parts`
   - Function calls: use `getFunctionCalls(event)` — returns `FunctionCall[]` with `name` and `args`
   - Function responses: use `getFunctionResponses(event)` — returns `FunctionResponse[]` with `name` and `response`
   - Token usage: check `event.usageMetadata?.promptTokenCount` and `event.usageMetadata?.candidatesTokenCount`

---

## 3. Current Command Routing

### 3.1 Existing Pattern

**File:** `notebooklm_agent/tui/index.tsx`, lines 63-87

```typescript
const handleSubmit = useCallback(() => {
    const text = editor.getText().trim();
    if (text.length === 0) return;

    if (text.startsWith('/')) {
      const command = text.toLowerCase().trim();
      if (command === '/quit' || command === '/exit') {
        exit();
        return;
      }
      if (command === '/clear') {
        editor.clear();
        return;
      }
      if (command === '/help') {
        // placeholder — falls through to agent
      }
    }

    history.addEntry(text);
    agent.sendMessage(text);
    editor.clear();
  }, [editor, history, agent, exit]);
```

### 3.2 Key Observations

1. **Simple if-chain**: Commands are matched via `text.toLowerCase().trim()` equality checks.
2. **Early return pattern**: Handled commands `return` before reaching `agent.sendMessage()`.
3. **Input history is only recorded for agent-sent messages**: `history.addEntry(text)` is called only after the slash-command block. The spec requires slash commands to also be added to input history.
4. **`/clear` only clears the editor**: It does not clear the chat history (no `setMessages([])` call).
5. **Unrecognized commands fall through**: They are sent to the agent.

### 3.3 Pattern for New Commands

New commands should follow this pattern:
1. Match the command string (case-insensitive, with aliases)
2. Check `agent.agentStatus === 'idle'` — if not idle, insert a system message saying "Agent is busy"
3. Add to input history via `history.addEntry(text)`
4. Execute the command logic (may be async for `/memory`, `/new`, `/last`)
5. Insert a system message with the formatted output
6. Clear the editor via `editor.clear()`
7. `return` to prevent falling through to `agent.sendMessage()`

The async nature of `/memory`, `/new`, `/last` is important. The current `handleSubmit` is synchronous. Async commands will need to be handled via an async IIFE within the callback (same pattern as `sendMessage`), or the command handlers can be extracted into separate async functions called from `handleSubmit`.

---

## 4. Message Rendering

### 4.1 Message Type

**File:** `notebooklm_agent/tui/types.ts`, lines 29-42

```typescript
export interface Message {
  readonly id: string;
  readonly role: 'user' | 'agent';
  text: string;
  isPartial: boolean;
  toolCalls: ToolCallInfo[];
  readonly timestamp: number;
}
```

To add system messages, the `role` union must be extended to `'user' | 'agent' | 'system'`.

### 4.2 MessageBubble Component

**File:** `notebooklm_agent/tui/components/MessageBubble.tsx`, lines 9-30

```typescript
export function MessageBubble({ message }: MessageBubbleProps): React.JSX.Element {
  const isUser = message.role === 'user';

  return (
    <Box flexDirection="column" marginBottom={1}>
      {isUser ? (
        <Text color="green" bold>You</Text>
      ) : (
        <Text color="cyan" bold>Agent{message.isPartial ? ' ▌' : ''}</Text>
      )}
      <Text wrap="wrap">{message.text}</Text>
      {message.toolCalls.map((tc, index) => (
        <ToolCallIndicator key={`${tc.name}-${index}`} toolCall={tc} />
      ))}
    </Box>
  );
}
```

Currently uses a binary `isUser` check. A third branch for `role === 'system'` needs to be added. Recommended styling:
- Label: `[system]` in yellow or dim text
- Body: dim text color, no bold
- No tool call indicators (system messages never have tool calls)

### 4.3 ChatHistory Component

**File:** `notebooklm_agent/tui/components/ChatHistory.tsx`

The `estimateLineCount` function (lines 14-23) calculates line counts for scrolling. It uses `msg.toolCalls.length` which will be 0 for system messages (they have empty `toolCalls`), so no change is needed.

The `computeVisibleMessages` function (lines 33-87) operates on the generic `Message[]` array. It does not filter by role. System messages will be included in the visible set automatically.

The `ChatHistory` component (lines 89-132) renders messages via `MessageBubble`. No structural change needed.

### 4.4 System Messages Must Not Be Sent to Agent

The `sendMessage` function in `useAgent` (line 116-313) creates its own user `Message` internally and prepends it to `messages`. System messages in the `messages` array are never passed to the ADK runner's `runAsync()` — they exist only in React state. This is already safe because `sendMessage` constructs the `newMessage` content from its text parameter, not from the `messages` array.

---

## 5. ADK Imports

### 5.1 Package

**File:** `package.json`, line 14
```json
"@google/adk": "^0.6.1"
```

### 5.2 Current Imports in useAgent.ts

**File:** `notebooklm_agent/tui/hooks/useAgent.ts`, lines 9-16

```typescript
import {
  InMemoryRunner,
  StreamingMode,
  toStructuredEvents,
  EventType,
  type Event,
} from '@google/adk';
import { createUserContent } from '@google/genai';
```

### 5.3 Additional Imports Needed

For the new methods in `useAgent`:
```typescript
import {
  type Session,
  type GetSessionRequest,
  type DeleteSessionRequest,
  type CreateSessionRequest,
  getFunctionCalls,
  getFunctionResponses,
  stringifyContent,
} from '@google/adk';
```

Note: `Session`, `GetSessionRequest`, etc. are all exported from `@google/adk` via `common.d.ts` (lines 79-83):
```typescript
export type { CreateSessionRequest, DeleteSessionRequest, GetSessionRequest, ... } from './sessions/base_session_service.js';
export type { Session } from './sessions/session.js';
```

The helper functions `getFunctionCalls`, `getFunctionResponses`, and `stringifyContent` are exported from `@google/adk` via `common.d.ts` line 50.

---

## 6. Recommended Approach for Each Command

### 6.1 `/history`

**Approach:** Synchronous. All data is already in the `messages` state within `useAgent`.

1. Add `addSystemMessage(text: string)` to `UseAgentResult` (wraps `setMessages` to append a system message)
2. Create `formatHistory(messages: Message[]): string` pure function in `lib/format-commands.ts`
3. In `handleSubmit`, match `/history`, call `formatHistory(agent.messages)`, insert via `agent.addSystemMessage()`

**No ADK session access needed** — this uses the TUI's local `messages` array.

### 6.2 `/memory`

**Approach:** Async. Requires calling `sessionService.getSession()`.

1. Add `getSessionState(): Promise<Record<string, unknown>>` to `UseAgentResult`
2. Create `formatSessionState(state: Record<string, unknown>, sessionId: string): string` pure function
3. In `handleSubmit`, match `/memory` or `/state`, call async IIFE that awaits `agent.getSessionState()`, formats, and inserts system message

### 6.3 `/new`

**Approach:** Async. Requires `deleteSession()` + `createSession()`.

1. Add `resetSession(): Promise<string>` to `UseAgentResult`
   - Inside: delete current session, create new session, update `sessionIdRef` and `setSessionId`, clear `setMessages([])`, return new session ID
2. In `handleSubmit`, match `/new` or `/reset`, call async IIFE that awaits `agent.resetSession()`, then inserts a system message with the new session ID
3. Reset scroll offset via `scroll.scrollToTop()`

### 6.4 `/last`

**Approach:** Async. Requires calling `sessionService.getSession()` to access `session.events`.

1. Add `getSessionEvents(): Promise<Event[]>` to `UseAgentResult`
2. Create `formatLastExchange(events: Event[]): string` pure function that:
   - Finds the last user event by scanning backward for `event.author === 'user'`
   - Collects all subsequent events as the response
   - Formats text parts, function calls (via `getFunctionCalls`), function responses (via `getFunctionResponses`), and token usage (via `event.usageMetadata`)
3. In `handleSubmit`, match `/last` or `/raw`, call async IIFE

---

## 7. Technical Research Guidance

**Research needed: No**

The ADK session API is straightforward and fully documented in the TypeScript type definitions. All necessary types (`Session`, `Event`, `EventActions`, `LlmResponse`, `GenerateContentResponseUsageMetadata`) and helper functions (`getFunctionCalls`, `getFunctionResponses`, `stringifyContent`) are exported from `@google/adk` and can be imported directly. The `InMemorySessionService` implements all required methods (`getSession`, `deleteSession`, `createSession`) with well-defined request/response types. No gaps or undocumented APIs were found.

Key confirmations:
- `Session.state` is `Record<string, unknown>` — directly accessible, no special accessor needed
- `Session.events` is `Event[]` — contains all conversation events with `author`, `content`, `actions`, `usageMetadata`, `timestamp`
- `Event` extends `LlmResponse` which carries `content?: Content` (with text/function call parts) and `usageMetadata`
- `InMemorySessionService.getSession()` returns the full session with all events (no pagination for in-memory)
- `InMemorySessionService.deleteSession()` returns `Promise<void>` — simple and clean
- All session service methods are accessed via `runner.sessionService` which is a public readonly property
- The ADK exports helper functions `getFunctionCalls()`, `getFunctionResponses()`, and `stringifyContent()` that simplify event parsing for the `/last` command
