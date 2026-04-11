# Technical Design: Terminal User Interface (TUI) for NotebookLM Agent

**Version**: 1.0
**Date**: 2026-04-11
**Status**: Draft
**Dependencies**: refined-request-terminal-ui.md, plan-004-terminal-ui.md, investigation-terminal-ui.md, adk-event-stream.md, ink-kitty-keyboard.md, ink-layout-scrolling.md, codebase-scan-terminal-ui.md
**Technology Stack**: Ink 7, React 19, Kitty keyboard protocol, Node.js Worker Threads

---

## Table of Contents

1. [System Architecture](#1-system-architecture)
2. [Data Models](#2-data-models)
3. [Component Design](#3-component-design)
4. [Key Handler Architecture](#4-key-handler-architecture)
5. [ADK Integration](#5-adk-integration)
6. [File Structure and Module Dependency Graph](#6-file-structure-and-module-dependency-graph)
7. [Error Handling](#7-error-handling)
8. [Parallel Implementation Units and Interface Contracts](#8-parallel-implementation-units-and-interface-contracts)
9. [Architectural Decisions Record](#9-architectural-decisions-record)

---

## 1. System Architecture

### 1.1 Component Tree Diagram

```
<App>                                        # Root shell: runner setup, session, layout, key routing
  <Box flexDirection="column" height={rows}>
    <StatusBar                               # height=1, flexShrink=0
      agentStatus={agentStatus}              # 'idle' | 'thinking' | 'streaming' | 'tool_call' | 'error'
      activeToolCall={activeToolCall}         # ToolCallInfo | null
      sessionId={sessionId}                  # string
    />
    <ChatHistory                             # flexGrow=1, overflow="hidden"
      messages={messages}                    # Message[]
      scrollOffset={scrollOffset}            # number (lines from bottom)
      terminalWidth={columns}                # for line-count estimation
    >
      <MessageBubble                         # Rendered per visible message
        message={msg}                        # Message
      />
      <ToolCallIndicator                     # Inline, animated, shown during tool_call
        toolCall={activeToolCall}            # ToolCallInfo
      />
    </ChatHistory>
    <InputArea                               # flexShrink=0, height 1-10 lines + 2 border
      buffer={buffer}                        # TextBuffer
      cursorLine={cursorLine}                # number
      cursorCol={cursorCol}                  # number
      selectionRange={selectionRange}        # SelectionRange | null
      isDisabled={agentStatus !== 'idle'}    # boolean
    />
  </Box>
</App>
```

### 1.2 Data Flow: User Input to Render

```
                    Keystroke (stdin)
                         |
                         v
                  useInput(input, key)
                         |
                         v
              resolveKeyAction(input, key, context)
                         |
                         v
                 EditAction discriminated union
                         |
              +----------+----------+----------+
              |          |          |          |
              v          v          v          v
          textEditor   scroll    submit    app-level
          .dispatch()  Manager   handler   (cancel/exit)
              |          |          |
              v          v          v
         TextBuffer   scrollOffset  useAgent.sendMessage()
         state update  update              |
              |          |                 v
              v          v          InMemoryRunner.runAsync()
         InputArea    ChatHistory         |
         re-render    re-render    event stream (AsyncGenerator)
                                         |
                                         v
                                  toStructuredEvents()
                                         |
                          +--------------+--------------+
                          |              |              |
                          v              v              v
                      CONTENT       TOOL_CALL      FINISHED
                      update        update         finalize
                      messages[]    activeToolCall messages[]
                          |              |              |
                          v              v              v
                      ChatHistory   StatusBar +   agentStatus
                      re-render    ToolCallIndicator  = 'idle'
                                    re-render
```

### 1.3 Event Flow: User Message to Agent Response

```
User types text + presses Enter
  |
  v
App detects 'submit' EditAction
  |
  +--> textEditor.getText() retrieves input
  +--> textEditor.clear() resets buffer
  +--> inputHistory.addEntry(text) saves for Up/Down recall
  +--> useAgent.sendMessage(text) dispatches to agent
         |
         v
    [Main Thread -> Worker Thread via MessagePort]
         |
         v
    Worker: runner.runAsync({ ..., streamingMode: SSE })
         |
         v
    Worker iterates AsyncGenerator<Event>
         |
         +--> For each raw Event:
         |      toStructuredEvents(event) -> StructuredEvent[]
         |      Post events to main thread via MessagePort
         |
         v
    Main Thread receives WorkerToMain messages
         |
         +--> 'event' with CONTENT -> append streaming text to messages[]
         +--> 'event' with TOOL_CALL -> set activeToolCall, agentStatus='tool_call'
         +--> 'event' with TOOL_RESULT -> clear activeToolCall, agentStatus='thinking'
         +--> 'event' with THOUGHT -> store for optional dimmed display
         +--> 'done' -> finalize message, agentStatus='idle'
         +--> 'error' -> display error, agentStatus='error'
```

### 1.4 Thread Architecture

```
+--------------------------------------------------+
|  MAIN THREAD (Node.js Event Loop)                |
|                                                  |
|  Ink 7 React render loop                         |
|  useInput -> key events at 30fps                 |
|  useAnimation -> spinner frames                  |
|  All React state + re-renders                    |
|                                                  |
|  MessagePort <-----> Worker Thread               |
+--------------------------------------------------+
         |                    ^
         | MainToWorker       | WorkerToMain
         | messages           | messages
         v                    |
+--------------------------------------------------+
|  WORKER THREAD (node:worker_threads)             |
|                                                  |
|  InMemoryRunner instance                         |
|  rootAgent import                                |
|  Session management                              |
|  runAsync() iteration                            |
|  toStructuredEvents() classification             |
|  execFileSync tool calls (blocking is OK here)   |
+--------------------------------------------------+
```

**Rationale**: The worker thread isolates `execFileSync` calls in tool implementations (e.g., `nlm-runner.ts`). Without this, every `nlm` CLI invocation blocks the main thread event loop for 1-5 seconds, freezing the TUI (no rendering, no input, no spinner). With the worker, the main thread remains responsive at all times.

---

## 2. Data Models

All TypeScript interfaces are defined as shared contracts between parallel implementation units. Each interface is assigned to a specific file.

### 2.1 TextBuffer (`tui/lib/text-buffer.ts`)

```typescript
/**
 * Immutable text buffer with cursor and optional selection.
 * All operations are pure functions that return a new TextBuffer.
 */
export interface TextBuffer {
  /** Full text content of the input area */
  readonly content: string;
  /** Absolute character offset of the cursor within content (0-based) */
  readonly cursor: number;
  /** Active text selection, or null if no selection */
  readonly selection: Selection | null;
}

export interface Selection {
  /** Character offset where the selection started (fixed point, does not move with cursor) */
  readonly anchor: number;
  /** Character offset where the selection ends (moves with cursor, equals cursor position) */
  readonly focus: number;
}

/**
 * Computed selection range (always start <= end).
 * Derived from Selection for rendering purposes.
 */
export interface SelectionRange {
  readonly start: number;
  readonly end: number;
}

/** Create an empty TextBuffer */
export function emptyBuffer(): TextBuffer;

/** Get the selected text, or empty string if no selection */
export function getSelectedText(buf: TextBuffer): string;

/** Get the selection range (ordered start/end), or null */
export function getSelectionRange(buf: TextBuffer): SelectionRange | null;

/** Split content into lines */
export function getLines(buf: TextBuffer): string[];

/** Get the line index and column of the cursor */
export function getCursorPosition(buf: TextBuffer): { line: number; col: number };

/** Check if cursor is on the first line */
export function isOnFirstLine(buf: TextBuffer): boolean;

/** Check if cursor is on the last line */
export function isOnLastLine(buf: TextBuffer): boolean;
```

#### TextBuffer Operations (pure functions)

All operations return a new `TextBuffer`. They never mutate the input.

```typescript
// --- Movement (clear selection, move cursor) ---
export function moveCursorLeft(buf: TextBuffer): TextBuffer;
export function moveCursorRight(buf: TextBuffer): TextBuffer;
export function moveCursorUp(buf: TextBuffer): TextBuffer;
export function moveCursorDown(buf: TextBuffer): TextBuffer;
export function moveCursorWordLeft(buf: TextBuffer): TextBuffer;
export function moveCursorWordRight(buf: TextBuffer): TextBuffer;
export function moveCursorLineStart(buf: TextBuffer): TextBuffer;
export function moveCursorLineEnd(buf: TextBuffer): TextBuffer;
export function moveCursorDocStart(buf: TextBuffer): TextBuffer;
export function moveCursorDocEnd(buf: TextBuffer): TextBuffer;

// --- Selection (same as movement, but extends selection) ---
export function selectLeft(buf: TextBuffer): TextBuffer;
export function selectRight(buf: TextBuffer): TextBuffer;
export function selectUp(buf: TextBuffer): TextBuffer;
export function selectDown(buf: TextBuffer): TextBuffer;
export function selectWordLeft(buf: TextBuffer): TextBuffer;
export function selectWordRight(buf: TextBuffer): TextBuffer;
export function selectLineStart(buf: TextBuffer): TextBuffer;
export function selectLineEnd(buf: TextBuffer): TextBuffer;
export function selectDocStart(buf: TextBuffer): TextBuffer;
export function selectDocEnd(buf: TextBuffer): TextBuffer;
export function selectAll(buf: TextBuffer): TextBuffer;

// --- Editing (returns new buffer; replaces selection if active) ---
export function insertText(buf: TextBuffer, text: string): TextBuffer;
export function deleteBackward(buf: TextBuffer): TextBuffer;
export function deleteForward(buf: TextBuffer): TextBuffer;
export function deleteWordBackward(buf: TextBuffer): TextBuffer;
export function deleteWordForward(buf: TextBuffer): TextBuffer;
export function deleteToLineStart(buf: TextBuffer): TextBuffer;
export function deleteToLineEnd(buf: TextBuffer): TextBuffer;
export function transposeChars(buf: TextBuffer): TextBuffer;
export function openLine(buf: TextBuffer): TextBuffer;
```

### 2.2 Word Boundaries (`tui/lib/word-boundaries.ts`)

```typescript
/**
 * Find the start of the previous word boundary from position.
 * macOS convention: words are alphanumeric sequences;
 * delimiters are whitespace and punctuation.
 * camelCase and snake_case are NOT word boundaries.
 *
 * @param text The full text content
 * @param position Current character offset
 * @returns New character offset at the beginning of the previous word
 */
export function wordBoundaryLeft(text: string, position: number): number;

/**
 * Find the end of the next word boundary from position.
 *
 * @param text The full text content
 * @param position Current character offset
 * @returns New character offset at the end of the next word
 */
export function wordBoundaryRight(text: string, position: number): number;

/**
 * Check if a character is a word character (alphanumeric or underscore).
 * Underscore is included because camelCase/snake_case should not be word boundaries.
 */
export function isWordChar(ch: string): boolean;
```

### 2.3 Kill Ring (`tui/lib/kill-ring.ts`)

```typescript
/**
 * Circular buffer for killed text (Ctrl+K, Ctrl+U, Ctrl+W).
 * Ctrl+Y yanks the most recent entry.
 */
export class KillRing {
  constructor(maxSize?: number); // default: 10

  /** Push text onto the kill ring */
  kill(text: string): void;

  /** Get the most recent killed text, or null if empty */
  yank(): string | null;

  /** Rotate to the previous kill ring entry (for future Esc+Y support) */
  yankRotate(): string | null;

  /** Get the current size of the ring */
  get size(): number;
}
```

### 2.4 Undo Stack (`tui/lib/undo-stack.ts`)

```typescript
/**
 * Operation recorded for undo/redo.
 */
export interface UndoOperation {
  /** The type of operation (for grouping consecutive inserts) */
  readonly type: 'insert' | 'delete' | 'replace';
  /** Character offset where the operation occurred */
  readonly position: number;
  /** Text that was removed (empty string for pure inserts) */
  readonly oldText: string;
  /** Text that was added (empty string for pure deletes) */
  readonly newText: string;
  /** Cursor position before the operation */
  readonly cursorBefore: number;
  /** Selection before the operation (null if none) */
  readonly selectionBefore: Selection | null;
  /** Cursor position after the operation */
  readonly cursorAfter: number;
  /** Timestamp of the operation (for grouping) */
  readonly timestamp: number;
}

/**
 * Operation-based undo/redo stack.
 * Consecutive character insertions within 300ms are grouped into a single operation.
 */
export class UndoStack {
  constructor(maxDepth?: number); // default: 100

  /** Record an edit operation */
  push(op: UndoOperation): void;

  /** Undo the last operation. Returns the operation to reverse, or null. */
  undo(): UndoOperation | null;

  /** Redo the last undone operation. Returns the operation to apply, or null. */
  redo(): UndoOperation | null;

  /** Whether undo is available */
  get canUndo(): boolean;

  /** Whether redo is available */
  get canRedo(): boolean;

  /** Clear both stacks (called on buffer clear/reset) */
  clear(): void;
}
```

### 2.5 EditAction (`tui/lib/edit-actions.ts`)

```typescript
/**
 * Discriminated union of all possible editing and navigation actions.
 * This is the bridge between key handling (Phase 3) and text buffer operations (Phase 2).
 * The App component dispatches EditActions to the useTextEditor hook.
 */
export type EditAction =
  // Cursor movement
  | { type: 'move'; direction: 'left' | 'right' | 'up' | 'down';
      select: boolean; word: boolean; line: boolean; doc: boolean }
  // Text deletion
  | { type: 'delete'; direction: 'backward' | 'forward';
      word: boolean; line: boolean }
  // Text insertion (printable characters, paste)
  | { type: 'insert'; text: string }
  // Line operations
  | { type: 'newline' }                 // Shift+Enter or Ctrl+O (via openLine)
  | { type: 'submit' }                  // Enter (send message)
  // Kill ring operations (Emacs)
  | { type: 'killToEnd' }              // Ctrl+K
  | { type: 'killToStart' }            // Ctrl+U
  | { type: 'killWord' }              // Ctrl+W
  | { type: 'yank' }                   // Ctrl+Y
  // Text manipulation
  | { type: 'transpose' }             // Ctrl+T
  | { type: 'openLine' }              // Ctrl+O (insert newline without moving cursor)
  // Selection
  | { type: 'selectAll' }             // Cmd+A / Ctrl+Shift+A
  // Undo/Redo
  | { type: 'undo' }                   // Ctrl+Z
  | { type: 'redo' }                   // Ctrl+Shift+Z
  // Input history
  | { type: 'historyPrev' }           // Up arrow on first line
  | { type: 'historyNext' }           // Down arrow on last line
  // Chat history scrolling
  | { type: 'scrollUp'; amount: 'line' | 'page' | 'top' }
  | { type: 'scrollDown'; amount: 'line' | 'page' | 'bottom' }
  // Application-level
  | { type: 'cancel' }                // Ctrl+C
  | { type: 'ctrlD' }                 // Ctrl+D (caller decides: delete forward or exit)
  | { type: 'slashCommand'; command: string }
  | { type: 'none' };                 // Unrecognized key, no action
```

### 2.6 Message and AgentStatus (`tui/hooks/useAgent.ts`)

```typescript
/**
 * Agent execution status state machine.
 *
 * Transitions:
 *   idle -> thinking       (user sends message)
 *   thinking -> streaming  (first partial text event arrives)
 *   thinking -> tool_call  (tool call event arrives)
 *   streaming -> tool_call (tool call after partial text)
 *   tool_call -> thinking  (tool result arrives, LLM processes result)
 *   streaming -> idle      (FINISHED event)
 *   thinking -> idle       (FINISHED event, no streaming text)
 *   thinking -> error      (ERROR event)
 *   streaming -> error     (ERROR event during streaming)
 *   error -> idle          (user sends new message)
 */
export type AgentStatus = 'idle' | 'thinking' | 'streaming' | 'tool_call' | 'error';

/**
 * A chat message in the conversation history.
 */
export interface Message {
  /** Unique identifier (nanoid or timestamp-based) */
  readonly id: string;
  /** Who sent the message */
  readonly role: 'user' | 'agent';
  /** The text content (accumulates during streaming) */
  text: string;
  /** True while the agent is still streaming this message */
  isPartial: boolean;
  /** Tool calls made during this agent response */
  toolCalls: ToolCallInfo[];
  /** Unix timestamp when the message was created */
  readonly timestamp: number;
}

/**
 * Information about a tool call in progress or completed.
 */
export interface ToolCallInfo {
  /** Tool function name (e.g., "search_youtube") */
  readonly name: string;
  /** Arguments passed to the tool */
  readonly args: Record<string, unknown>;
  /** Current execution status */
  status: 'running' | 'completed' | 'error';
}
```

### 2.7 Worker Protocol (`tui/worker/agent-protocol.ts`)

```typescript
/**
 * Messages sent from the main thread to the worker thread.
 */
export type MainToWorker =
  | { type: 'init' }
  | { type: 'send'; text: string; messageId: string }
  | { type: 'cancel' };

/**
 * Messages sent from the worker thread to the main thread.
 * All objects must be serializable (no class instances, no functions).
 */
export type WorkerToMain =
  | { type: 'ready'; sessionId: string }
  | { type: 'event'; messageId: string; event: SerializedStructuredEvent }
  | { type: 'partial'; messageId: string; isPartial: boolean }
  | { type: 'done'; messageId: string }
  | { type: 'error'; messageId: string; error: string }
  | { type: 'initError'; error: string };

/**
 * Serialized form of a StructuredEvent (plain object, no class instances).
 * Maps 1:1 to the ADK EventType enum values.
 */
export interface SerializedStructuredEvent {
  eventType: 'thought' | 'content' | 'tool_call' | 'tool_result'
           | 'call_code' | 'code_result' | 'error' | 'activity'
           | 'tool_confirmation' | 'finished';
  /** Text content for 'thought' and 'content' events */
  content?: string;
  /** Function call info for 'tool_call' events */
  call?: { name: string; args: Record<string, unknown> };
  /** Function response info for 'tool_result' events */
  result?: { name: string; response: Record<string, unknown> };
  /** Error message for 'error' events */
  error?: string;
}
```

---

## 3. Component Design

### 3.1 App (`tui/index.tsx`) -- Root Shell

**Responsibilities:**
1. Create `InMemoryRunner` and session (or delegate to worker on Phase 9)
2. Set up the three-region Flexbox layout with `height={rows}`
3. Route all keyboard input via `useInput` to `resolveKeyAction`
4. Dispatch `EditAction` to the appropriate handler:
   - Text editing actions -> `useTextEditor.dispatch()`
   - Scroll actions -> `useScrollManager.scrollUp/Down()`
   - Submit -> extract text, send to agent
   - Cancel -> cancel agent run or exit
   - ctrlD -> delete forward (non-empty) or exit (empty)
   - slashCommand -> handle `/clear`, `/quit`, `/exit`, `/help`
5. Handle paste via `usePaste` -> `textEditor.insertText()`
6. Show initialization state ("Initializing agent...") while runner/session load
7. Manage exit sequence via `useApp().exit()`

**Props:** None (root component)

**State:**
- `runner: InMemoryRunner | null` -- null during initialization
- `sessionId: string | null`
- All state from hooks: `useAgent`, `useTextEditor`, `useInputHistory`, `useScrollManager`

**Layout:**
```tsx
<Box flexDirection="column" height={rows}>
  <StatusBar />           {/* flexShrink=0, height auto (1 line + optional border) */}
  <ChatHistory />         {/* flexGrow=1, overflow="hidden" */}
  <InputArea />           {/* flexShrink=0, height 3-12 (1-10 lines + 2 border) */}
</Box>
```

**Startup Sequence:**
1. `tui.ts` runs `import 'dotenv/config'` (loads `.env`)
2. `tui.ts` imports `App` from `./tui/index.tsx`
3. `render(<App />, { alternateScreen: true, ... })`
4. App mounts, renders "Initializing..." placeholder
5. `useEffect` creates runner + session async
6. On success: `setRunner(runner)`, `setSessionId(id)`
7. On error (missing env var): display error message, offer `/quit`

**Exit Sequence:**
1. User triggers exit (Ctrl+C idle, Ctrl+D empty, `/quit`, `/exit`)
2. If worker is active, send `{ type: 'cancel' }` then terminate worker
3. Call `useApp().exit()`
4. Ink restores alternate screen buffer
5. Process exits cleanly

### 3.2 InputArea (`tui/components/InputArea.tsx`)

**Responsibilities:**
- Render the text buffer as multi-line text with visible cursor and selection
- Show prompt prefix (`> `) on the first line
- Show disabled state when agent is processing
- Grow from 1 to 10 lines of content, then scroll internally

**Props:**
```typescript
interface InputAreaProps {
  buffer: TextBuffer;
  cursorLine: number;
  cursorCol: number;
  selectionRange: SelectionRange | null;
  isDisabled: boolean;
}
```

**Rendering Logic:**

For each visible line (up to 10):
1. If no selection intersects this line and cursor is not on this line:
   - Render as plain `<Text>{line || ' '}</Text>`
2. If cursor is on this line (no selection):
   - Split: `before | cursor_char (inverse) | after`
   - `<Text>{before}<Text inverse>{cursorChar}</Text>{after}</Text>`
3. If selection intersects this line:
   - Compute which portion of the line is selected
   - Split: `before_selection | selected (backgroundColor="blue") | after_selection`
   - If cursor is also on this line, overlay the cursor rendering

**Height Calculation:**
```
contentHeight = Math.min(buffer.content.split('\n').length, 10)
totalHeight = contentHeight + 2  // +2 for border top + bottom
```

**Border:**
- Active: `borderStyle="single" borderColor="cyan"`
- Disabled: `borderStyle="single" borderColor="gray"`

**Internal Scrolling (>10 lines):**
When content exceeds 10 lines, only render lines `[scrollStart..scrollStart+10)` where `scrollStart` is computed to keep the cursor line visible.

### 3.3 ChatHistory (`tui/components/ChatHistory.tsx`)

**Responsibilities:**
- Render visible portion of messages based on scroll offset
- Compute per-message line counts for windowing
- Show scroll indicators when content exists above/below viewport
- Auto-scroll to bottom on new messages (only when at bottom)

**Props:**
```typescript
interface ChatHistoryProps {
  messages: Message[];
  scrollOffset: number;          // lines from bottom (0 = at bottom)
  terminalWidth: number;
  onScrollChange: (offset: number) => void;
}
```

**Windowing Algorithm:**

```
totalLines = sum of estimateLineCount(msg, terminalWidth) for all messages
visibleHeight = container height (from useBoxMetrics)
maxScrollOffset = max(0, totalLines - visibleHeight)
scrollFromTop = max(0, totalLines - visibleHeight - scrollOffset)

Iterate messages, skip lines until scrollFromTop reached,
then render messages until visibleHeight lines accumulated.
```

**Line Count Estimation:**
```typescript
function estimateLineCount(msg: Message, terminalWidth: number): number {
  const effectiveWidth = terminalWidth - 4; // margins, padding
  const prefix = 1; // "You:" or "Agent:" label line
  const gap = 1;    // blank line between messages
  const contentLines = msg.text.split('\n').reduce((total, line) => {
    return total + Math.max(1, Math.ceil(line.length / effectiveWidth));
  }, 0);
  const toolLines = msg.toolCalls.length; // one line per tool call indicator
  return prefix + contentLines + toolLines + gap;
}
```

**Scroll Indicators:**
- Top: `<Text dimColor>  ^ {N} lines above (PgUp to scroll)</Text>` when `scrollOffset < maxScrollOffset`
- Bottom: `<Text dimColor>  v Scrolled back {scrollOffset} lines (PgDn)</Text>` when `scrollOffset > 0`

**Auto-scroll:**
- Track `isAtBottom = scrollOffset === 0`
- When `messages.length` increases and `isAtBottom`, keep `scrollOffset` at 0
- When user manually scrolls up (`scrollOffset > 0`), do not auto-scroll

### 3.4 MessageBubble (`tui/components/MessageBubble.tsx`)

**Responsibilities:**
- Render a single message with role-based styling
- Show streaming indicator for partial messages
- Display tool call indicators inline

**Props:**
```typescript
interface MessageBubbleProps {
  message: Message;
}
```

**Rendering:**
```
User messages:
  <Text color="green" bold>You</Text>
  <Text wrap="wrap">{message.text}</Text>

Agent messages:
  <Text color="cyan" bold>Agent{message.isPartial ? ' |' : ''}</Text>
  <Text wrap="wrap">{message.text}</Text>
  {message.toolCalls.map(tc =>
    <Text dimColor>  > {tc.status === 'running' ? spinner : checkmark} {tc.name}</Text>
  )}
```

### 3.5 StatusBar (`tui/components/StatusBar.tsx`)

**Responsibilities:**
- Display agent status with color-coded indicator
- Show active tool call name
- Display session ID (abbreviated)
- Show keyboard hints

**Props:**
```typescript
interface StatusBarProps {
  agentStatus: AgentStatus;
  activeToolCall: ToolCallInfo | null;
  sessionId: string;
}
```

**Layout (single line, three sections):**
```
[Left: Status indicator]  [Center: Session ID]  [Right: Key hints]
```

**Status Display:**
| AgentStatus | Display | Color |
|-------------|---------|-------|
| `idle` | `Ready` | green |
| `thinking` | `{spinner} Thinking...` | yellow |
| `streaming` | `Streaming` | cyan |
| `tool_call` | `{spinner} Calling {toolName}...` | yellow |
| `error` | `Error` | red |

Uses `useAnimation({ interval: 80 })` from Ink for spinner frames.

**Key Hints:** `Ctrl+C cancel | PgUp/PgDn scroll | /help`

### 3.6 ToolCallIndicator (`tui/components/ToolCallIndicator.tsx`)

**Responsibilities:**
- Display an animated spinner with the active tool name
- Shown inline in ChatHistory during tool execution
- Disappears when tool result arrives

**Props:**
```typescript
interface ToolCallIndicatorProps {
  toolCall: ToolCallInfo;
}
```

**Rendering:**
```tsx
const { frame } = useAnimation({ interval: 80, isActive: true });
const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
return (
  <Text color="yellow">
    {'  '}{frames[frame % frames.length]} Calling {toolCall.name}...
  </Text>
);
```

---

## 4. Key Handler Architecture

### 4.1 `resolveKeyAction` Function (`tui/hooks/useKeyHandler.ts`)

The key handler maps raw Ink key events to `EditAction` values. It is a pure function with no side effects, making it fully testable.

**Signature:**
```typescript
import type { Key } from 'ink';

export interface KeyHandlerContext {
  /** Whether the input buffer is empty (for Ctrl+D decision) */
  isBufferEmpty: boolean;
  /** Whether the cursor is on the first line (for Up arrow history) */
  isOnFirstLine: boolean;
  /** Whether the cursor is on the last line (for Down arrow history) */
  isOnLastLine: boolean;
}

export function resolveKeyAction(
  input: string,
  key: Key,
  context: KeyHandlerContext,
): EditAction;
```

### 4.2 Complete Shortcut Mapping Table

The table below lists all 55+ key bindings, organized by category. Priority is resolved top-to-bottom: the first matching rule wins.

#### Submit / Newline

| # | Detection | EditAction | Kitty Required? | Notes |
|---|-----------|------------|-----------------|-------|
| 1 | `key.return && key.shift` | `{ type: 'newline' }` | Yes | Shift+Enter |
| 2 | `key.return && !key.shift && !key.ctrl && !key.meta` | `{ type: 'submit' }` | No | Enter |
| 3 | `input === 'o' && key.ctrl` | `{ type: 'openLine' }` | No | Ctrl+O |

#### Cursor Movement (highest priority after submit)

| # | Detection | EditAction | Kitty Required? | Notes |
|---|-----------|------------|-----------------|-------|
| 4 | `(key.leftArrow && key.meta) \|\| (input === 'b' && key.meta)` | `move left, word, select=key.shift` | No (dual) | Option+Left |
| 5 | `(key.rightArrow && key.meta) \|\| (input === 'f' && key.meta)` | `move right, word, select=key.shift` | No (dual) | Option+Right |
| 6 | `key.leftArrow && key.super` | `move left, line, select=key.shift` | Yes+config | Cmd+Left |
| 7 | `key.rightArrow && key.super` | `move right, line, select=key.shift` | Yes+config | Cmd+Right |
| 8 | `key.upArrow && key.super` | `move up, doc, select=key.shift` | Yes+config | Cmd+Up |
| 9 | `key.downArrow && key.super` | `move down, doc, select=key.shift` | Yes+config | Cmd+Down |
| 10 | `input === 'a' && key.ctrl && !key.shift` | `move left, line` | No | Ctrl+A |
| 11 | `input === 'e' && key.ctrl` | `move right, line` | No | Ctrl+E |
| 12 | `input === 'f' && key.ctrl` | `move right` | No | Ctrl+F |
| 13 | `input === 'b' && key.ctrl` | `move left` | No | Ctrl+B |
| 14 | `input === 'n' && key.ctrl` | `move down` | No | Ctrl+N |
| 15 | `input === 'p' && key.ctrl` | `move up` | No | Ctrl+P |
| 16 | `key.home` | `move left, line, select=key.shift` | No | Home |
| 17 | `key.end` | `move right, line, select=key.shift` | No | End |
| 18 | `key.upArrow && context.isOnFirstLine && !key.shift && !key.meta && !key.ctrl` | `{ type: 'historyPrev' }` | No | Up on first line |
| 19 | `key.downArrow && context.isOnLastLine && !key.shift && !key.meta && !key.ctrl` | `{ type: 'historyNext' }` | No | Down on last line |
| 20 | `key.leftArrow && !key.meta && !key.super && !key.ctrl` | `move left, select=key.shift` | No | Left |
| 21 | `key.rightArrow && !key.meta && !key.super && !key.ctrl` | `move right, select=key.shift` | No | Right |
| 22 | `key.upArrow && !key.meta && !key.super && !key.ctrl` | `move up, select=key.shift` | No | Up |
| 23 | `key.downArrow && !key.meta && !key.super && !key.ctrl` | `move down, select=key.shift` | No | Down |

#### Deletion

| # | Detection | EditAction | Kitty Required? | Notes |
|---|-----------|------------|-----------------|-------|
| 24 | `key.backspace && key.meta` | `delete backward, word` | Recommended | Option+Backspace |
| 25 | `key.delete && key.meta` | `delete forward, word` | Recommended | Option+Delete |
| 26 | `key.backspace && key.super` | `delete backward, line` | Yes+config | Cmd+Backspace |
| 27 | `key.delete && key.super` | `delete forward, line` | Yes+config | Cmd+Delete |
| 28 | `key.backspace && !key.meta && !key.super` | `delete backward` | No | Backspace |
| 29 | `key.delete && !key.meta && !key.super` | `delete forward` | No | Delete |
| 30 | `input === 'h' && key.ctrl` | `delete backward` | No | Ctrl+H |
| 31 | `input === 'd' && key.ctrl` | `{ type: 'ctrlD' }` | No | Ctrl+D (context-dependent) |

#### Kill Ring (Emacs)

| # | Detection | EditAction | Kitty Required? | Notes |
|---|-----------|------------|-----------------|-------|
| 32 | `input === 'k' && key.ctrl` | `{ type: 'killToEnd' }` | No | Ctrl+K |
| 33 | `input === 'u' && key.ctrl` | `{ type: 'killToStart' }` | No | Ctrl+U |
| 34 | `input === 'w' && key.ctrl` | `{ type: 'killWord' }` | No | Ctrl+W |
| 35 | `input === 'y' && key.ctrl` | `{ type: 'yank' }` | No | Ctrl+Y |

#### Text Manipulation

| # | Detection | EditAction | Kitty Required? | Notes |
|---|-----------|------------|-----------------|-------|
| 36 | `input === 't' && key.ctrl` | `{ type: 'transpose' }` | No | Ctrl+T |

#### Selection

| # | Detection | EditAction | Kitty Required? | Notes |
|---|-----------|------------|-----------------|-------|
| 37 | `input === 'a' && key.ctrl && key.shift` | `{ type: 'selectAll' }` | Recommended | Ctrl+Shift+A |
| 38 | `key.leftArrow && key.super && key.shift` | `move left, line, select` | Yes+config | Shift+Cmd+Left |

(Note: Shift+Arrow selection is handled by the `select=key.shift` parameter in movement actions #20-23.)

#### Undo / Redo

| # | Detection | EditAction | Kitty Required? | Notes |
|---|-----------|------------|-----------------|-------|
| 39 | `input === 'z' && key.ctrl && key.shift` | `{ type: 'redo' }` | Recommended | Ctrl+Shift+Z |
| 40 | `input === 'z' && key.ctrl && !key.shift` | `{ type: 'undo' }` | No | Ctrl+Z |

#### Scrolling

| # | Detection | EditAction | Kitty Required? | Notes |
|---|-----------|------------|-----------------|-------|
| 41 | `key.pageUp` | `scrollUp, page` | No | Page Up |
| 42 | `key.pageDown` | `scrollDown, page` | No | Page Down |
| 43 | `key.home && key.super` | `scrollUp, top` | Yes+config | Cmd+Home |
| 44 | `key.end && key.super` | `scrollDown, bottom` | Yes+config | Cmd+End |

#### Application-Level

| # | Detection | EditAction | Kitty Required? | Notes |
|---|-----------|------------|-----------------|-------|
| 45 | `input === 'c' && key.ctrl` | `{ type: 'cancel' }` | No | Ctrl+C |

#### Character Input (lowest priority)

| # | Detection | EditAction | Kitty Required? | Notes |
|---|-----------|------------|-----------------|-------|
| 46 | `input.length > 0 && !key.ctrl && !key.meta` | `{ type: 'insert', text: input }` | No | Any printable char |
| 47 | (default) | `{ type: 'none' }` | No | Unrecognized |

### 4.3 Dual-Mode Handling (Legacy ESC + Kitty CSI u)

Option+Arrow must be detected in two ways:

**Kitty mode:** `key.leftArrow === true && key.meta === true`
The Kitty protocol reports `CSI 1;3D` which Ink parses as `leftArrow + meta`.

**Legacy mode:** `input === 'b' && key.meta === true`
iTerm2 with "Option sends ESC+" and Terminal.app with "Use Option as Meta Key" send `ESC b`. Ink parses this as `input='b', key.meta=true`. This is NOT `key.leftArrow`.

The key handler uses OR logic: `(key.leftArrow && key.meta) || (input === 'b' && key.meta)`.

This dual detection must be applied to:
- Option+Left: `leftArrow+meta` OR `input='b'+meta`
- Option+Right: `rightArrow+meta` OR `input='f'+meta`

### 4.4 Priority Resolution

Rules are evaluated in the order listed above. The first match wins. This prevents conflicts:

1. **Ctrl+D before character input**: `input === 'd' && key.ctrl` matches before the `input.length > 0` catch-all because Ctrl checks come before the character input rule.
2. **Word movement before plain arrow**: Option+Arrow rules (#4, #5) are checked before plain arrow rules (#20-23).
3. **History navigation before plain arrow**: History rules (#18, #19) check `isOnFirstLine`/`isOnLastLine` before falling through to plain up/down (#22, #23).
4. **Redo before undo**: `key.shift && key.ctrl && input==='z'` (#39) is checked before `!key.shift && key.ctrl && input==='z'` (#40).

### 4.5 Graceful Degradation for Terminal.app

Terminal.app does not support the Kitty keyboard protocol. The following features are unavailable:

| Feature | Terminal.app Behavior | Workaround |
|---------|----------------------|------------|
| Shift+Enter (newline) | Indistinguishable from Enter | Use **Ctrl+O** (openLine) instead |
| Cmd+Arrow (line/doc nav) | Not sent to application | Use **Ctrl+A/E** (line), **Home/End** |
| Cmd+Backspace (delete to line start) | Not sent | Use **Ctrl+U** |
| Shift+Arrow (selection) | Works (legacy CSI) | No workaround needed |
| Option+Arrow (word nav) | Requires "Use Option as Meta Key" | Document in setup guide |
| Ctrl+Shift+Z (redo) | May not distinguish Shift | Redo may not work |

---

## 5. ADK Integration

### 5.1 `useAgent` Hook Design (`tui/hooks/useAgent.ts`)

**State Machine:**

```
                    sendMessage()
                         |
            idle --------+-------> thinking
              ^                      |
              |          +-----------+----------+
              |          |                      |
              |     (CONTENT,               (TOOL_CALL)
              |      partial=true)              |
              |          |                      v
              |          v                  tool_call
              |      streaming                  |
              |          |              (TOOL_RESULT)
              |          |                      |
              |          +----------+-----------+
              |                     |
              |               (FINISHED)
              |                     |
              +---------------------+
              |
              |     (ERROR from any state)
              |          |
              +----------+
                     error
```

**Hook Interface:**
```typescript
export interface UseAgentResult {
  messages: Message[];
  agentStatus: AgentStatus;
  activeToolCall: ToolCallInfo | null;
  sendMessage: (text: string) => void;
  cancelRun: () => void;
}

export function useAgent(
  runner: InMemoryRunner | null,
  sessionId: string | null,
  userId: string,
): UseAgentResult;
```

**Implementation Strategy (Phase 5, before Worker Thread):**

In Phase 5, the hook calls `runner.runAsync()` directly on the main thread. This means `execFileSync` in tools will block the event loop temporarily. The implementation is simpler and allows validating the event processing logic before adding worker thread complexity in Phase 9.

```typescript
const sendMessage = useCallback(async (text: string) => {
  if (!runner || !sessionId) return;

  // 1. Append user message
  appendMessage({ role: 'user', text, ... });
  setAgentStatus('thinking');

  // 2. Create and store generator reference for cancellation
  const gen = runner.runAsync({
    userId,
    sessionId,
    newMessage: createUserContent(text),
    runConfig: { streamingMode: StreamingMode.SSE },
  });
  generatorRef.current = gen;

  // 3. Process events
  let agentText = '';
  let agentMsgIndex = -1;
  try {
    for await (const event of gen) {
      if (!generatorRef.current) break; // cancelled
      for (const se of toStructuredEvents(event)) {
        switch (se.type) {
          case EventType.CONTENT:
            if (event.partial) {
              setAgentStatus('streaming');
              agentText += se.content;
              upsertAgentMessage(agentText, true);
            } else {
              agentText += se.content;
            }
            break;
          case EventType.TOOL_CALL:
            setAgentStatus('tool_call');
            setActiveToolCall({ name: se.call.name, args: se.call.args, status: 'running' });
            break;
          case EventType.TOOL_RESULT:
            setActiveToolCall(null);
            setAgentStatus('thinking');
            break;
          case EventType.FINISHED:
            finalizeAgentMessage(agentText);
            setAgentStatus('idle');
            break;
          case EventType.ERROR:
            appendErrorMessage(se.error.message);
            setAgentStatus('error');
            break;
        }
      }
    }
  } catch (e) { /* error handling */ }
  finally { generatorRef.current = null; }
}, [runner, sessionId, userId]);
```

**Implementation Strategy (Phase 9, with Worker Thread):**

In Phase 9, `sendMessage` posts to the worker via `MessagePort` instead of calling `runAsync` directly. The event processing logic moves to the worker, and the main thread receives pre-classified `SerializedStructuredEvent` objects.

### 5.2 Worker Thread Architecture (`tui/worker/agent-worker.ts`)

**Worker Lifecycle:**

1. Worker starts, waits for `init` message
2. On `init`: imports `dotenv/config`, imports `rootAgent`, creates `InMemoryRunner` and session, posts `ready` back
3. On `send`: starts `runAsync()` iteration, posts each classified event back
4. On `cancel`: calls `gen.return(undefined)`, posts `done`
5. On process exit: worker terminates naturally

**Module Loading Challenge:**

Workers in Node.js do not natively support `.ts` imports. Two approaches:

**Approach A (Preferred): Use `tsx` as worker exec args**
```typescript
const worker = new Worker(
  new URL('./worker/agent-worker.ts', import.meta.url),
  { execArgv: ['--import', 'tsx/esm'] }
);
```

**Approach B (Fallback): Compile worker to JS**
Pre-compile `agent-worker.ts` to `agent-worker.js` via `tsc`, and load the JS file.

**Serialization:**

`StructuredEvent` objects from `toStructuredEvents()` may contain non-serializable fields (class instances). The worker must convert them to `SerializedStructuredEvent` (plain objects) before posting via `MessagePort`.

```typescript
function serializeEvent(se: StructuredEvent): SerializedStructuredEvent {
  switch (se.type) {
    case EventType.CONTENT:
      return { eventType: 'content', content: se.content };
    case EventType.TOOL_CALL:
      return { eventType: 'tool_call', call: { name: se.call.name ?? 'unknown', args: se.call.args ?? {} } };
    case EventType.TOOL_RESULT:
      return { eventType: 'tool_result', result: { name: se.result.name ?? 'unknown', response: se.result.response ?? {} } };
    case EventType.THOUGHT:
      return { eventType: 'thought', content: se.content };
    case EventType.ERROR:
      return { eventType: 'error', error: se.error?.message ?? String(se.error) };
    case EventType.FINISHED:
      return { eventType: 'finished' };
    default:
      return { eventType: se.type };
  }
}
```

### 5.3 Session Management

- **Session creation:** `runner.sessionService.createSession({ appName: runner.appName, userId })` in the worker on `init`
- **Session state persistence:** ADK `InMemorySessionService` maintains state across turns within the same session. The session tracks `current_notebook_id`, `current_notebook_title`, `last_conversation_id`.
- **Session resume:** Not supported in v1. Each TUI launch creates a new session.

### 5.4 Cancellation

**Ctrl+C flow:**
1. Main thread receives `cancel` EditAction
2. If `agentStatus !== 'idle'`:
   - Phase 5 (no worker): `generatorRef.current.return(undefined)`
   - Phase 9 (worker): post `{ type: 'cancel' }` to worker
3. Worker calls `gen.return(undefined)` on its generator
4. Main thread: `setAgentStatus('idle')`, `setActiveToolCall(null)`
5. Finalize any partial agent message with what has been received so far

**Ctrl+C when idle:**
- Exit the TUI (same as `/quit`)

---

## 6. File Structure and Module Dependency Graph

### 6.1 Complete File List

```
notebooklm_agent/
  tui.ts                                    # CLI entry point
  tui/
    index.tsx                               # <App> root component
    components/
      ChatHistory.tsx                       # Scrollable message list with windowing
      InputArea.tsx                         # Multi-line text input with cursor/selection
      StatusBar.tsx                         # Agent status, session info, key hints
      ToolCallIndicator.tsx                 # Animated spinner for tool calls
      MessageBubble.tsx                     # Single message rendering
    hooks/
      useAgent.ts                           # InMemoryRunner wrapper, event processing
      useTextEditor.ts                      # TextBuffer state + undo + kill ring
      useInputHistory.ts                    # Up/Down arrow input recall
      useKeyHandler.ts                      # resolveKeyAction function
      useScrollManager.ts                   # Scroll state for chat history
    lib/
      text-buffer.ts                        # Pure TextBuffer data structure + operations
      word-boundaries.ts                    # macOS word boundary detection
      kill-ring.ts                          # Circular buffer for killed text
      undo-stack.ts                         # Operation-based undo/redo
      edit-actions.ts                       # EditAction union type definition
    worker/
      agent-worker.ts                       # Worker thread: runs InMemoryRunner
      agent-protocol.ts                     # Shared MainToWorker/WorkerToMain types

test_scripts/
  test-text-buffer.test.ts                  # TextBuffer pure function tests
  test-word-boundaries.test.ts              # Word boundary edge cases
  test-kill-ring.test.ts                    # Kill ring behavior
  test-undo-stack.test.ts                   # Undo/redo behavior
  test-key-handler.test.ts                  # Shortcut mapping (55+ cases)
  test-edit-actions.test.ts                 # EditAction type validation
```

**Total: 22 new source files, 6 new test files**

### 6.2 Module Dependency Graph

```
tui.ts
  |
  +--> tui/index.tsx (App)
         |
         +--> hooks/useAgent.ts
         |      +--> worker/agent-protocol.ts (types)
         |      +--> @google/adk (InMemoryRunner, StreamingMode, toStructuredEvents, EventType)
         |      +--> @google/genai (createUserContent)
         |
         +--> hooks/useTextEditor.ts
         |      +--> lib/text-buffer.ts
         |      |      +--> lib/word-boundaries.ts
         |      +--> lib/kill-ring.ts
         |      +--> lib/undo-stack.ts
         |      +--> lib/edit-actions.ts
         |
         +--> hooks/useKeyHandler.ts
         |      +--> lib/edit-actions.ts
         |
         +--> hooks/useInputHistory.ts
         |
         +--> hooks/useScrollManager.ts
         |
         +--> components/ChatHistory.tsx
         |      +--> components/MessageBubble.tsx
         |      +--> components/ToolCallIndicator.tsx
         |
         +--> components/InputArea.tsx
         |
         +--> components/StatusBar.tsx
         |      +--> components/ToolCallIndicator.tsx (shared spinner logic)
         |
         +--> worker/agent-worker.ts (loaded at runtime, not import-time)
                +--> worker/agent-protocol.ts (types)
                +--> ../../notebooklm_agent/agent.ts (rootAgent)
                +--> @google/adk
                +--> @google/genai
```

**Key Observation:** The `lib/` modules have zero external dependencies (only `node:` builtins and each other). This makes them independently testable and implementable.

---

## 7. Error Handling

### 7.1 Configuration Errors (Missing Env Vars)

`agent.ts` calls `getConfig()` at module load time, which calls `requireEnv()` for each variable. If any variable is missing, an exception is thrown immediately.

**TUI handling:**
1. The `tui.ts` entry point wraps the `render()` call in a try/catch
2. If the error message contains "Missing required environment variable", display a formatted error:
   ```
   Configuration Error: Missing required environment variable GOOGLE_GENAI_API_KEY
   
   Ensure your .env file contains all required variables:
     GOOGLE_GENAI_API_KEY=...
     NLM_CLI_PATH=...
     GEMINI_MODEL=...
     NLM_DOWNLOAD_DIR=...
     YOUTUBE_API_KEY=...
   ```
3. No fallback values. No default values. The TUI exits with code 1.

**Per project convention:** Configuration errors always throw. No fallback solutions.

### 7.2 Agent Errors (API Failures, Timeout)

These are caught inside `useAgent`:

| Error Type | Detection | TUI Response |
|------------|-----------|--------------|
| API authentication | `event.errorCode === 'PERMISSION_DENIED'` or similar | Display "Authentication error. Check your GOOGLE_GENAI_API_KEY." |
| Rate limit | `event.errorCode === 'RESOURCE_EXHAUSTED'` | Display "Rate limit reached. Please wait before trying again." |
| Network error | `catch` block on `for await` loop | Display "Network error: {message}. Check your connection." |
| Tool timeout | Tool returns `{ status: 'timeout' }` | Agent handles this internally; TUI shows the agent's response |
| Model error | `EventType.ERROR` structured event | Display "Agent error: {message}" |

After any error:
- `agentStatus` transitions to `'error'`
- Error message appended to message list as an agent message
- User can send a new message to retry (status transitions to `'idle'` then `'thinking'`)

### 7.3 Worker Thread Errors

| Error | Detection | TUI Response |
|-------|-----------|--------------|
| Worker fails to start | `worker.on('error', ...)` | Display "Failed to start agent worker: {message}" and exit |
| Worker crashes mid-run | `worker.on('exit', code)` with non-zero code | Display "Agent worker crashed unexpectedly." Attempt restart. |
| Init timeout | No `ready` message within 10 seconds | Display "Agent initialization timed out." and exit |
| `initError` message | Worker posts `{ type: 'initError' }` | Display the error message to the user |

### 7.4 Terminal Compatibility Issues

| Issue | Detection | TUI Response |
|-------|-----------|--------------|
| Terminal too narrow (<80 cols) | `useWindowSize().columns < 80` | Show warning: "Terminal too narrow. Minimum 80 columns required." |
| Terminal too short (<24 rows) | `useWindowSize().rows < 24` | Show warning: "Terminal too short. Minimum 24 rows required." |
| Kitty protocol not supported | Shift+Enter produces `submit` instead of `newline` | Graceful degradation; document Ctrl+O as newline alternative |

---

## 8. Parallel Implementation Units and Interface Contracts

### 8.1 Four Parallel Lanes

After Phase 1 (setup), four lanes can proceed independently:

```
Lane A: Input System          Lane B: Agent Integration     Lane C: Display              Lane D: Chrome
Phase 2: TextBuffer lib       Phase 5: useAgent hook        Phase 6: ChatHistory         Phase 7: StatusBar +
Phase 3: Key Handler          (connects to ADK runner)      (windowing, scroll)          ToolCallIndicator
Phase 4: InputArea component                                MessageBubble rendering      (spinner animation)
```

**Convergence point:** Phase 8 (App Shell) requires all four lanes complete.

### 8.2 Interface Contracts Between Lanes

#### Contract 1: EditAction (Lane A <-> Lane A internal, shared with Phase 8)

File: `tui/lib/edit-actions.ts` -- must be created first (Phase 2), consumed by Phase 3 (key handler), Phase 4 (InputArea), and Phase 8 (App).

See Section 2.5 for full type definition.

#### Contract 2: TextBuffer + Operations (Lane A: Phase 2 <-> Phase 4)

File: `tui/lib/text-buffer.ts`

The `useTextEditor` hook (Phase 4) wraps `TextBuffer` operations. The contract is:
- `TextBuffer` interface (Section 2.1)
- All pure functions (`moveCursorLeft`, `insertText`, etc.)
- `getLines()`, `getCursorPosition()`, `getSelectionRange()`

#### Contract 3: Message + AgentStatus + ToolCallInfo (Lane B <-> Lane C <-> Lane D <-> Phase 8)

Files: `tui/hooks/useAgent.ts` (definitions), consumed by `ChatHistory`, `StatusBar`, `MessageBubble`, `ToolCallIndicator`, `App`.

See Section 2.6 for full type definitions.

The key contract point: `useAgent` returns `{ messages, agentStatus, activeToolCall, sendMessage, cancelRun }`. All consuming components depend on these types.

#### Contract 4: UseTextEditorResult (Lane A: Phase 4 <-> Phase 8)

File: `tui/hooks/useTextEditor.ts`

```typescript
export interface UseTextEditorResult {
  buffer: TextBuffer;
  lines: string[];
  cursorLine: number;
  cursorCol: number;
  selectionRange: SelectionRange | null;
  dispatch(action: EditAction): void;
  insertText(text: string): void;
  getText(): string;
  clear(): void;
  isEmpty(): boolean;
  setContent(text: string): void;  // For input history recall
}
```

#### Contract 5: UseScrollManagerResult (Lane C <-> Phase 8)

File: `tui/hooks/useScrollManager.ts`

```typescript
export interface UseScrollManagerResult {
  scrollOffset: number;
  isAtBottom: boolean;
  scrollUp(lines: number): void;
  scrollDown(lines: number): void;
  scrollToTop(): void;
  scrollToBottom(): void;
  onNewMessage(): void;  // auto-scroll if at bottom
}
```

#### Contract 6: UseInputHistoryResult (Lane A: Phase 4 <-> Phase 8)

File: `tui/hooks/useInputHistory.ts`

```typescript
export interface UseInputHistoryResult {
  recallPrevious(currentText: string): string | null;
  recallNext(): string | null;
  addEntry(text: string): void;
}
```

#### Contract 7: Worker Protocol (Lane B: Phase 5 <-> Phase 9)

File: `tui/worker/agent-protocol.ts`

See Section 2.7 for full type definitions. Phase 5 implements `useAgent` with direct `runAsync()` calls. Phase 9 replaces the internals with worker communication using the same protocol types.

### 8.3 Shared Type Files (Create First)

These files must be created at the start of Phase 2 and shared across all lanes:

1. `tui/lib/edit-actions.ts` -- EditAction union type
2. `tui/worker/agent-protocol.ts` -- Worker message types (can be stubbed initially)

These two files have no implementation logic, only type definitions. They can be created in 5 minutes and distributed to all lanes.

---

## 9. Architectural Decisions Record

### ADR-1: Ink 7 as UI Framework

**Decision:** Use Ink 7 (React for CLI) with standard npm package (no custom fork).

**Context:** Options evaluated: Ink, blessed/neo-blessed, terminal-kit, raw ANSI. See investigation-terminal-ui.md Section 2.

**Rationale:**
- Battle-tested at scale (Claude Code uses a custom Ink fork)
- React component model maps naturally to three-region layout
- Flexbox layout via Yoga handles resize automatically
- TypeScript-first, ships type definitions
- Active maintenance, large community (4,500+ npm dependents)
- Kitty keyboard protocol support built in

**Consequences:**
- Adds React 19 as a dependency (~150KB)
- JSX compilation required (`"jsx": "react-jsx"` in tsconfig)
- Developers must understand React hooks model

### ADR-2: Kitty Keyboard Protocol with `mode: 'enabled'`

**Decision:** Activate Kitty protocol with `mode: 'enabled'` (not `'auto'`), flags `['disambiguateEscapeCodes', 'reportEventTypes']`.

**Context:** `'auto'` mode checks `$TERM_PROGRAM` which fails inside tmux.

**Rationale:**
- `'enabled'` triggers the protocol detection query regardless of `$TERM_PROGRAM`
- Terminals that do not support it silently ignore the activation and fall back to legacy
- `'auto'` would fail inside tmux, degrading the experience unnecessarily
- `disambiguateEscapeCodes` resolves critical ambiguities (Shift+Enter vs Enter, Ctrl+I vs Tab)
- `reportEventTypes` enables press/repeat/release detection for future key repeat handling

**Consequences:**
- Shift+Enter for newline requires Kitty-capable terminal; Terminal.app uses Ctrl+O
- Must document terminal requirements in setup guide

### ADR-3: Ctrl/Emacs Keybindings as Primary, Cmd+Key as Enhancement

**Decision:** All primary keybindings use Ctrl and Emacs conventions. Cmd+key shortcuts are supported only in terminals with Kitty protocol + Super key configuration.

**Context:** Cmd+key is intercepted by macOS at the OS level before reaching the terminal application. This is a fundamental limitation of all terminal applications.

**Rationale:**
- Ctrl+A/E/K/U/W/Y/T/D/H/F/B/N/P work in all terminals (they send bytes 1-26)
- Cmd+key requires Kitty protocol + iTerm2/Kitty/Alacritty configured to remap Cmd to Super
- Even with Super remapping, Cmd+C/V/Q/W remain intercepted by the OS
- This matches how every other terminal application (vim, emacs, tmux) handles the limitation

**Consequences:**
- The spec's Cmd+key shortcuts are supported as enhancements, not primary bindings
- Documentation must clearly state the primary bindings and how to enable Cmd+key
- Clipboard: Cmd+C/V handled by terminal natively; Ctrl+K/Y for kill ring

### ADR-4: Manual Windowing for Chat History Scroll

**Decision:** Implement manual windowing (compute visible messages from scroll offset) rather than using `<Static>` or `ink-scroll-view`.

**Context:** Three options: `<Static>` (append-only, terminal scrollback), `ink-scroll-view` (third-party), manual windowing.

**Rationale:**
- Spec requires keyboard-controlled scrollback (PageUp/Down) which `<Static>` cannot provide
- Streaming agent responses need in-place updates which `<Static>` does not support (items are write-once)
- `ink-scroll-view` is a small community package with uncertain maintenance
- Manual windowing provides full control over scroll behavior and auto-scroll logic
- Line count estimation is approximate but sufficient for the chat use case

**Consequences:**
- Must estimate line counts per message (approximate, may have off-by-one visual glitches)
- More code than `ink-scroll-view`, but no third-party dependency
- Can switch to `ink-scroll-view` later if line estimation proves inadequate

### ADR-5: Worker Thread for Agent Execution

**Decision:** Run `InMemoryRunner` in a Node.js Worker thread to keep the main thread responsive during `execFileSync` tool calls.

**Context:** `nlm-runner.ts` uses `execFileSync` which blocks the event loop for 1-5 seconds per tool call.

**Rationale:**
- Without worker: TUI freezes completely during tool execution (no rendering, no input, no spinner)
- Worker isolates blocking calls; main thread remains responsive at all times
- `MessagePort` communication is efficient and type-safe
- Phase 9 adds worker after Phase 8 validates the full integration, reducing debugging complexity

**Consequences:**
- Two instances of the agent module in memory (main + worker)
- Worker module loading may require `tsx` exec args or pre-compilation
- `StructuredEvent` objects must be serialized to plain objects for `MessagePort`
- Adds ~100 lines of worker setup + protocol code

### ADR-6: `toStructuredEvents()` for Event Classification

**Decision:** Use the ADK's official `toStructuredEvents()` utility for classifying raw events.

**Context:** Could manually inspect `event.content.parts`, `event.partial`, `getFunctionCalls()`, etc.

**Rationale:**
- Official API, maintained by the ADK team
- Handles edge cases: multi-part events, thought vs content distinction, function call + text in same event
- Reduces risk of incorrect event classification
- Single switch statement in the consumer vs scattered field checks

**Consequences:**
- Dependency on `toStructuredEvents` remaining stable across ADK versions
- Pin `@google/adk` version to avoid breaking changes

### ADR-7: SSE Streaming Mode

**Decision:** Use `StreamingMode.SSE` for `runAsync()` to enable token-by-token text display.

**Context:** Default `StreamingMode.NONE` delivers complete responses only.

**Rationale:**
- Streaming provides responsive UX (text appears as it is generated)
- `event.partial === true` cleanly indicates streaming chunks
- `isFinalResponse()` correctly ignores partial events
- Same API cost as non-streaming (same model call)

**Consequences:**
- Must manage partial message state (accumulating text buffer)
- Must handle edge cases: streaming interrupted by tool call (text buffer flushed)
- Slightly more complex state management in `useAgent`

### ADR-8: Alternate Screen Buffer

**Decision:** Use `alternateScreen: true` in Ink render options.

**Context:** Alternate screen hides terminal scrollback; restores on exit.

**Rationale:**
- Clean terminal state on exit (no TUI artifacts left behind)
- Prevents chat UI from polluting terminal scrollback history
- Ink 7 handles cleanup even on crash
- Standard practice for full-screen terminal applications (vim, htop, etc.)

**Consequences:**
- Users cannot scroll through conversation using terminal's native scrollback
- Must implement in-app scroll (PageUp/Down) -- already required by spec
- Terminal scrollback history before TUI launch is preserved

### ADR-9: Undo Granularity

**Decision:** Per-action undo with 300ms grouping for consecutive character inserts.

**Context:** Options: per-character (every keystroke undoable), per-action (insert/delete/paste as units), time-based grouping.

**Rationale:**
- Per-character undo is tedious (dozens of Ctrl+Z to undo a word)
- Per-action groups natural editing units: paste, delete-word, kill-line
- 300ms grouping merges rapid character typing into a single undo unit (matches macOS TextEdit behavior)
- 100-operation stack depth is generous for a chat input field

**Consequences:**
- Undo stack records both old and new text for each operation
- Timer-based grouping requires tracking `Date.now()` in operations
- Clear redo stack on any new edit after undo (standard behavior)

### ADR-10: No New Configuration Variables

**Decision:** The TUI does not introduce any new environment variables. It reuses the existing `AgentConfig` from `config.ts`.

**Context:** Per project convention, no fallback values and no default values.

**Rationale:**
- The TUI is purely a new frontend; it does not change agent behavior
- All configuration (API keys, model, paths) is already handled by `config.ts`
- Adding TUI-specific config (colors, key bindings) is out of scope for v1

**Consequences:**
- TUI behavior is not configurable in v1 (fixed color scheme, fixed key bindings)
- Future versions could add `~/.notebooklm-tui.json` for customization

---

## Appendix A: New Dependencies

| Package | Version | Purpose | Phase |
|---------|---------|---------|-------|
| `ink` | ^7.0.0 | Terminal UI framework (React for CLI) | 1 |
| `react` | ^19.2.0 | React (peer dependency of Ink 7) | 1 |
| `@types/react` | ^19.x | TypeScript types for React (dev dependency) | 1 |

No other new dependencies. The project already has `@google/adk`, `@google/genai`, `dotenv`, `tsx`, `vitest`, `typescript`.

## Appendix B: Modified Existing Files

| File | Change | Phase |
|------|--------|-------|
| `package.json` | Add `ink`, `react` to dependencies; `@types/react` to devDependencies; add `"tui"` script | 1 |
| `tsconfig.json` | Add `"jsx": "react-jsx"` to compilerOptions | 1 |
| `CLAUDE.md` | Add TUI tool documentation | 10 |
| `docs/design/project-design.md` | Append TUI architecture section | 10 |

All existing source files (`agent.ts`, `config.ts`, `tools/*`) remain **unchanged**.
