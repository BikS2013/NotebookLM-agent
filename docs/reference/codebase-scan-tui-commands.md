# Codebase Scan: TUI Slash Commands

**Date:** 2026-04-11  
**Purpose:** Architecture overview for integrating `/history`, `/memory`, `/new`, `/last` commands into the TUI.

---

## 1. Project Overview

| Aspect | Value |
|---|---|
| Language | TypeScript (ESM, `"type": "module"`) |
| Framework | React 19 + Ink 7 (terminal React renderer) |
| Agent SDK | `@google/adk ^0.6.1` with `InMemoryRunner` |
| Build system | `tsc --noEmit` (type-check only); runtime via `tsx` |
| Test framework | Vitest 3 (`test_scripts/**/*.test.ts`) |
| Entry point | `npx tsx notebooklm_agent/tui.ts` → renders `App` from `notebooklm_agent/tui/index.tsx` |

---

## 2. Module Map

### 2.1 Entry & App Shell

| File | Responsibility |
|---|---|
| `notebooklm_agent/tui.ts` | CLI entry: loads dotenv, calls `render(<App />)` |
| `notebooklm_agent/tui/index.tsx` | **App component**: wires all hooks, handles keyboard dispatch, submit logic, layout (StatusBar / ChatHistory / InputArea) |

### 2.2 Types

| File | Key Symbols |
|---|---|
| `notebooklm_agent/tui/types.ts` | `Message` interface (`id`, `role: 'user' \| 'agent'`, `text`, `isPartial`, `toolCalls`, `timestamp`), `ToolCallInfo` interface, `AgentStatus` type (`'idle' \| 'thinking' \| 'streaming' \| 'tool_call' \| 'error'`) |

### 2.3 Hooks

| File | Hook | Exposed State / Methods |
|---|---|---|
| `hooks/useAgent.ts` | `useAgent()` | `messages`, `agentStatus`, `activeToolCall`, `sendMessage(text)`, `cancelRun()`, `sessionId`, `isInitialized`, `initError` |
| `hooks/useTextEditor.ts` | `useTextEditor()` | `buffer`, `dispatch(action)`, `getText()`, `isEmpty()`, `clear()`, `setContent()`, `insertText()`, `lines` |
| `hooks/useKeyHandler.ts` | `resolveKeyAction()` | Pure function: `(input, key, context) → EditAction` |
| `hooks/useInputHistory.ts` | `useInputHistory()` | `addEntry()`, `recallPrevious()`, `recallNext()` |
| `hooks/useScrollManager.ts` | `useScrollManager()` | `scrollOffset`, `scrollUp()`, `scrollDown()`, `scrollToTop()`, `scrollToBottom()`, `onNewMessage()`, `setTotalLines()` |

### 2.4 Components

| File | Component | Notes |
|---|---|---|
| `components/StatusBar.tsx` | `StatusBar` | Shows agent status, session ID, key hints |
| `components/ChatHistory.tsx` | `ChatHistory` + `estimateLineCount()` + `computeVisibleMessages()` | Scrollable message list with windowing; receives `messages`, `scrollOffset`, `terminalWidth` |
| `components/MessageBubble.tsx` | `MessageBubble` | Renders a single message; branches on `message.role === 'user'` vs agent. **No system role handling yet.** |
| `components/InputArea.tsx` | `InputArea` | Multi-line text input with cursor/selection rendering |
| `components/ToolCallIndicator.tsx` | `ToolCallIndicator` | Animated spinner for in-progress tool calls |

### 2.5 Pure Library (`tui/lib/`)

| File | Purpose |
|---|---|
| `lib/text-buffer.ts` | Immutable `TextBuffer` with 22 pure operations |
| `lib/word-boundaries.ts` | macOS-style word boundary detection |
| `lib/kill-ring.ts` | Circular buffer for Emacs-style kill/yank |
| `lib/undo-stack.ts` | Operation-based undo/redo with 300ms grouping |
| `lib/edit-actions.ts` | `EditAction` discriminated union type |

### 2.6 Worker Protocol (unused, future)

| File | Purpose |
|---|---|
| `worker/agent-protocol.ts` | `MainToWorker`/`WorkerToMain` message types, `SerializedStructuredEvent` |

---

## 3. Conventions

### 3.1 Slash Command Routing (current)

Location: `notebooklm_agent/tui/index.tsx`, `handleSubmit` callback (line 63-87).

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

**Pattern**: Simple if-chain inside `handleSubmit`. Commands that are handled locally `return` early. Unrecognized commands fall through to `agent.sendMessage()`. Input history is only recorded when the message is sent to the agent (after the slash-command block).

### 3.2 Message Creation

Messages are created with `generateId()` (timestamp+random base36), role, text, `isPartial: false`, empty toolCalls, and `Date.now()` timestamp. The `useAgent` hook owns the `messages` state via `setMessages`.

### 3.3 ADK Session Access

The `useAgent` hook stores the runner in `runnerRef` (React ref) and session ID in `sessionIdRef`. The `InMemoryRunner` is created on mount. The runner's `sessionService` provides:
- `createSession({ appName, userId })` → `Session`
- `deleteSession({ ... })` (available on the service)
- `getSession({ ... })` → `Session` (with `.state` and `.events`)

Currently **none of these are exposed** outside the hook. The hook only exposes `sessionId` (string) and `sendMessage`/`cancelRun`.

### 3.4 Testing Pattern

All tests in `test_scripts/`. Pure library functions get dedicated test files (e.g., `test-text-buffer.test.ts`). Tests use Vitest with `vitest run`. No component/hook tests exist — only pure function tests.

### 3.5 File Naming

- Hooks: `use<Name>.ts` in `hooks/`
- Components: `<Name>.tsx` in `components/`
- Pure libs: `<name>.ts` in `lib/`
- Tests: `test-<name>.test.ts` in `test_scripts/`

---

## 4. Integration Points for New Commands

### 4.1 Files That Must Change

| File | Change Required |
|---|---|
| **`notebooklm_agent/tui/types.ts`** | Add `'system'` to `Message.role` union: `'user' \| 'agent' \| 'system'` |
| **`notebooklm_agent/tui/hooks/useAgent.ts`** | Expose three new methods on `UseAgentResult`: `getSessionState()`, `getSessionEvents()`, `resetSession()`. These wrap calls to `runnerRef.current.sessionService` methods. Also expose `setMessages` (or a `addSystemMessage` helper) so index.tsx can insert system messages without going through the agent. |
| **`notebooklm_agent/tui/index.tsx`** | Extend `handleSubmit` slash-command routing with `/history`, `/memory` (+ `/state`), `/new` (+ `/reset`), `/last` (+ `/raw`). Each command creates a system message and inserts it via the agent hook. Must also gate on `agent.agentStatus === 'idle'` for all new commands. Input history should be recorded for slash commands too. |
| **`notebooklm_agent/tui/components/MessageBubble.tsx`** | Add a third branch for `role === 'system'` with distinct styling (e.g., cyan/dim text, `[system]` label). |
| **`notebooklm_agent/tui/components/ChatHistory.tsx`** | No structural change needed — already renders all messages. `estimateLineCount` may need to account for system message formatting if it differs. |

### 4.2 New Files to Create

| File | Purpose |
|---|---|
| **`notebooklm_agent/tui/lib/format-commands.ts`** | Pure formatting functions: `formatHistory(messages)`, `formatSessionState(state, sessionId)`, `formatLastExchange(events)`. No React dependency. |
| **`test_scripts/test-format-commands.test.ts`** | Unit tests for all formatting functions. |

### 4.3 Key Design Decisions

1. **System messages are TUI-local only.** They must NOT be included in `sendMessage` calls. The `sendMessage` function currently prepends a user message to `messages` state — the new system messages must be filtered out when rendering to the agent. Since `sendMessage` creates its own user message internally, this is already safe as long as system messages in the `messages` array are never sent to the ADK runner.

2. **`useAgent` needs to expose session access.** The `runnerRef` is private. Three new async methods are needed:
   - `getSessionState(): Promise<Record<string, unknown>>` — calls `sessionService.getSession()` and returns `session.state`
   - `getSessionEvents(): Promise<Event[]>` — calls `sessionService.getSession()` and returns `session.events`
   - `resetSession(): Promise<string>` — deletes current session, creates new one, clears messages, returns new session ID

3. **Slash command dispatch pattern.** The current if-chain is simple enough to extend. For four new commands with aliases, the pattern remains manageable. A map-based dispatch could be used but is not required.

4. **`/new` must clear messages atomically.** The `resetSession` method in `useAgent` should call `setMessages([systemMsg])` internally after successful session recreation, where the system message confirms the reset. Alternatively, it clears messages and the caller inserts the confirmation.

5. **Scroll reset for `/new`.** After clearing messages, `scroll.scrollToTop()` or reset `scrollOffset` to 0.

### 4.4 ADK API Surface Needed

From `@google/adk`:
- `InMemoryRunner.sessionService.getSession({ appName, userId, sessionId })` → `Session`
- `Session.state` → `Record<string, unknown>`
- `Session.events` → `Event[]`
- `Event.author` → `string` (e.g., `'user'`, agent name)
- `Event.content` → `Content` (from `@google/genai`)
- `Event.actions` → action object with function calls/responses
- `InMemoryRunner.sessionService.deleteSession({ appName, userId, sessionId })`
- `InMemoryRunner.sessionService.createSession({ appName, userId })`

### 4.5 What Does NOT Need to Change

- `lib/text-buffer.ts`, `lib/word-boundaries.ts`, `lib/kill-ring.ts`, `lib/undo-stack.ts`, `lib/edit-actions.ts` — no changes
- `hooks/useKeyHandler.ts` — no new keyboard shortcuts needed (slash commands are typed text)
- `hooks/useTextEditor.ts`, `hooks/useInputHistory.ts`, `hooks/useScrollManager.ts` — no changes
- `components/StatusBar.tsx`, `components/InputArea.tsx`, `components/ToolCallIndicator.tsx` — no changes
- `worker/agent-protocol.ts` — no changes
- Agent tools (`notebooklm_agent/tools/*`) — no changes
