# Plan 004: Terminal User Interface (TUI) for NotebookLM Agent

**Version**: 1.0
**Date**: 2026-04-11
**Status**: Draft
**Dependencies**: refined-request-terminal-ui.md, investigation-terminal-ui.md, adk-event-stream.md, ink-kitty-keyboard.md, ink-layout-scrolling.md, codebase-scan-terminal-ui.md
**Technology**: Ink 7 + React 19 + Kitty keyboard protocol

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Phase Summary](#2-phase-summary)
3. [Phase 1: Project Setup and Skeleton](#3-phase-1-project-setup-and-skeleton)
4. [Phase 2: Text Buffer and Core Editing Logic](#4-phase-2-text-buffer-and-core-editing-logic)
5. [Phase 3: Key Handler and Shortcut Mapping](#5-phase-3-key-handler-and-shortcut-mapping)
6. [Phase 4: InputArea Component](#6-phase-4-inputarea-component)
7. [Phase 5: ADK Agent Integration Hook](#7-phase-5-adk-agent-integration-hook)
8. [Phase 6: ChatHistory and Message Rendering](#8-phase-6-chathistory-and-message-rendering)
9. [Phase 7: StatusBar and ToolCallIndicator](#9-phase-7-statusbar-and-toolcallindicator)
10. [Phase 8: App Shell and Layout Assembly](#10-phase-8-app-shell-and-layout-assembly)
11. [Phase 9: Worker Thread for Agent Execution](#11-phase-9-worker-thread-for-agent-execution)
12. [Phase 10: Polish and Terminal Compatibility](#12-phase-10-polish-and-terminal-compatibility)
13. [Dependency Graph](#13-dependency-graph)
14. [Risk Register](#14-risk-register)
15. [Interface Contracts](#15-interface-contracts)
16. [Open Decisions](#16-open-decisions)

---

## 1. Architecture Overview

### Component Hierarchy

```
<App>                                  # Root: InMemoryRunner setup, session, layout
  <Box flexDirection="column" height={rows}>
    <StatusBar />                      # height=1, flexShrink=0
    <ChatHistory />                    # flexGrow=1, overflow="hidden", manual windowing
    <InputArea />                      # flexShrink=0, 1-10 lines + border
  </Box>
</App>
```

### File Structure

```
notebooklm_agent/
  tui.ts                               # CLI entry point (import dotenv, render <App>)
  tui/
    index.tsx                           # <App> component, runner/session setup
    components/
      ChatHistory.tsx                   # Scrollable message history
      InputArea.tsx                     # Multi-line text input with cursor/selection
      StatusBar.tsx                     # Agent status, session info, keyboard hints
      ToolCallIndicator.tsx             # Spinner with active tool name
      Message.tsx                       # Single message (user vs agent styling)
    hooks/
      useAgent.ts                       # InMemoryRunner wrapper, event stream via toStructuredEvents
      useTextEditor.ts                  # Text editing state machine (cursor, selection, undo, kill ring)
      useInputHistory.ts                # Up/Down arrow previous input recall
      useKeyHandler.ts                  # Raw key events -> EditAction mapping
      useScrollManager.ts              # Scroll state for chat history
    lib/
      text-buffer.ts                   # Pure data structure: text, cursor, selection, insert/delete
      word-boundaries.ts               # macOS-style word boundary detection
      kill-ring.ts                     # Circular buffer for Ctrl+K/W/U/Y
      undo-stack.ts                    # Operation-based undo/redo
      edit-actions.ts                  # EditAction union type definition
    worker/
      agent-worker.ts                  # Worker thread: runs InMemoryRunner
      agent-protocol.ts                # MessagePort protocol types (shared)
test_scripts/
  test-text-buffer.test.ts             # Unit tests for text-buffer
  test-word-boundaries.test.ts         # Unit tests for word boundary detection
  test-kill-ring.test.ts               # Unit tests for kill ring
  test-undo-stack.test.ts              # Unit tests for undo/redo
  test-key-handler.test.ts             # Unit tests for shortcut mapping
  test-agent-protocol.test.ts          # Integration tests for worker protocol
```

### Key Architectural Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| UI framework | Ink 7 | Battle-tested (Claude Code uses it), React model, Kitty protocol support |
| Keyboard protocol | Kitty `mode: 'enabled'` | Unambiguous Shift+Enter, modifier detection; graceful degradation |
| Scrolling | Manual windowing (not `<Static>`, not `ink-scroll-view`) | Full control over scroll position, keyboard nav; streaming messages need updates |
| Agent execution | Worker thread | `execFileSync` in tools blocks event loop; worker keeps TUI responsive |
| Event classification | `toStructuredEvents()` from `@google/adk` | Official API, handles all event types correctly |
| Streaming | `StreamingMode.SSE` | Token-by-token display for responsive UX |
| Primary keybindings | Ctrl/Emacs style | Cmd+key intercepted by macOS; Ctrl works in all terminals |
| Alternate screen | Yes (`alternateScreen: true`) | Clean terminal state on exit |

---

## 2. Phase Summary

| Phase | Name | Est. Effort | Dependencies | Parallelizable With |
|-------|------|-------------|--------------|---------------------|
| 1 | Project Setup and Skeleton | Small | None | - |
| 2 | Text Buffer and Core Editing Logic | Medium | Phase 1 | Phase 5 |
| 3 | Key Handler and Shortcut Mapping | Medium | Phase 2 | Phase 5, 6, 7 |
| 4 | InputArea Component | Medium | Phase 2, 3 | Phase 6, 7 |
| 5 | ADK Agent Integration Hook | Medium | Phase 1 | Phase 2, 3 |
| 6 | ChatHistory and Message Rendering | Medium | Phase 1 | Phase 2, 3, 5 |
| 7 | StatusBar and ToolCallIndicator | Small | Phase 1 | Phase 2, 3, 5, 6 |
| 8 | App Shell and Layout Assembly | Medium | Phase 4, 5, 6, 7 | - |
| 9 | Worker Thread for Agent Execution | Large | Phase 5, 8 | - |
| 10 | Polish and Terminal Compatibility | Medium | Phase 8 | - |

**Critical path**: 1 -> 2 -> 3 -> 4 -> 8 -> 9 -> 10

**Parallelization opportunities**:
- After Phase 1: Phases 2, 5, 6, 7 can start simultaneously (different developers/agents)
- After Phase 2: Phase 3 starts; Phases 5, 6, 7 continue in parallel
- Phase 9 requires Phase 8 (full integration) but can be designed in parallel with earlier phases

---

## 3. Phase 1: Project Setup and Skeleton

### Objective

Set up the build environment, install dependencies, create the entry point, and verify that a minimal Ink app renders in the terminal.

### Files to Create

| File | Purpose |
|------|---------|
| `notebooklm_agent/tui.ts` | CLI entry point |
| `notebooklm_agent/tui/index.tsx` | Root `<App>` component (placeholder) |

### Files to Modify

| File | Change |
|------|--------|
| `package.json` | Add `"tui"` script, add `ink`, `react`, `@types/react` dependencies |
| `tsconfig.json` | Add `"jsx": "react-jsx"` to compilerOptions |

### Tasks

1. **Install dependencies**:
   ```bash
   npm install ink react
   npm install --save-dev @types/react
   ```

2. **Update `tsconfig.json`**: Add `"jsx": "react-jsx"` to `compilerOptions`. Verify that `"module": "NodeNext"` and `"moduleResolution": "NodeNext"` are compatible with JSX (they are with tsx).

3. **Create `notebooklm_agent/tui.ts`** (entry point):
   ```typescript
   import 'dotenv/config';
   import { render } from 'ink';
   import React from 'react';
   import { App } from './tui/index.tsx';
   
   render(React.createElement(App), {
     alternateScreen: true,
     kittyKeyboard: { mode: 'enabled', flags: ['disambiguateEscapeCodes', 'reportEventTypes'] },
     exitOnCtrlC: false,  // We handle Ctrl+C ourselves
     patchConsole: true,
     incrementalRendering: true,
     maxFps: 30,
   });
   ```

4. **Create `notebooklm_agent/tui/index.tsx`** (placeholder App):
   ```tsx
   import React from 'react';
   import { Box, Text, useWindowSize } from 'ink';
   
   export function App() {
     const { rows, columns } = useWindowSize();
     return (
       <Box flexDirection="column" height={rows}>
         <Box flexShrink={0}><Text bold>NotebookLM Agent TUI</Text></Box>
         <Box flexGrow={1}><Text dimColor>Chat history will appear here</Text></Box>
         <Box flexShrink={0} borderStyle="single" borderColor="cyan" paddingX={1}>
           <Text>&gt; </Text>
         </Box>
       </Box>
     );
   }
   ```

5. **Add npm script** to `package.json`:
   ```json
   "tui": "npx tsx notebooklm_agent/tui.ts"
   ```

### Acceptance Criteria

- [ ] `npm run tui` launches the app in the alternate screen buffer
- [ ] Three regions visible: header, body, input border
- [ ] Terminal resize causes re-layout (no crash, no artifacts)
- [ ] Ctrl+C exits the process cleanly (terminal restored)
- [ ] `npx tsc --noEmit` passes with no type errors

### Verification Commands

```bash
npm run tui          # Visual check: renders three regions
npx tsc --noEmit     # Type check passes
```

---

## 4. Phase 2: Text Buffer and Core Editing Logic

### Objective

Implement the pure data structures for text editing: a text buffer with cursor management, selection, word boundary detection, kill ring, and undo/redo stack. These are pure functions with no UI dependency, making them highly testable.

### Files to Create

| File | Purpose |
|------|---------|
| `notebooklm_agent/tui/lib/text-buffer.ts` | Core text buffer: content, cursor, selection, insert/delete/replace |
| `notebooklm_agent/tui/lib/word-boundaries.ts` | macOS-style word boundary detection |
| `notebooklm_agent/tui/lib/kill-ring.ts` | Circular buffer for killed text (Ctrl+K/W/U/Y) |
| `notebooklm_agent/tui/lib/undo-stack.ts` | Operation-based undo/redo |
| `notebooklm_agent/tui/lib/edit-actions.ts` | `EditAction` union type |
| `test_scripts/test-text-buffer.test.ts` | Text buffer unit tests |
| `test_scripts/test-word-boundaries.test.ts` | Word boundary unit tests |
| `test_scripts/test-kill-ring.test.ts` | Kill ring unit tests |
| `test_scripts/test-undo-stack.test.ts` | Undo/redo unit tests |

### Design Details

#### TextBuffer Interface

```typescript
interface TextBuffer {
  content: string;          // Full text content
  cursor: number;           // Absolute character offset in content
  selection: Selection | null; // null = no selection
}

interface Selection {
  anchor: number;   // Where selection started (fixed point)
  focus: number;    // Where selection ends (moves with cursor)
}

// Selection range: min(anchor, focus) to max(anchor, focus)
```

#### Operations (pure functions, return new TextBuffer)

```typescript
// Movement
moveCursorLeft(buf: TextBuffer): TextBuffer
moveCursorRight(buf: TextBuffer): TextBuffer
moveCursorUp(buf: TextBuffer, terminalWidth: number): TextBuffer
moveCursorDown(buf: TextBuffer, terminalWidth: number): TextBuffer
moveCursorWordLeft(buf: TextBuffer): TextBuffer
moveCursorWordRight(buf: TextBuffer): TextBuffer
moveCursorLineStart(buf: TextBuffer): TextBuffer
moveCursorLineEnd(buf: TextBuffer): TextBuffer
moveCursorDocStart(buf: TextBuffer): TextBuffer
moveCursorDocEnd(buf: TextBuffer): TextBuffer

// Selection (same as movement but extends selection)
selectLeft(buf: TextBuffer): TextBuffer
selectRight(buf: TextBuffer): TextBuffer
selectWordLeft(buf: TextBuffer): TextBuffer
selectWordRight(buf: TextBuffer): TextBuffer
selectLineStart(buf: TextBuffer): TextBuffer
selectLineEnd(buf: TextBuffer): TextBuffer
selectAll(buf: TextBuffer): TextBuffer
// ... etc.

// Editing
insertText(buf: TextBuffer, text: string): TextBuffer  // replaces selection if any
deleteBackward(buf: TextBuffer): TextBuffer
deleteForward(buf: TextBuffer): TextBuffer
deleteWordBackward(buf: TextBuffer): TextBuffer
deleteWordForward(buf: TextBuffer): TextBuffer
deleteToLineStart(buf: TextBuffer): TextBuffer
deleteToLineEnd(buf: TextBuffer): TextBuffer
transposeChars(buf: TextBuffer): TextBuffer
openLine(buf: TextBuffer): TextBuffer    // Ctrl+O: insert newline without moving cursor
```

#### Word Boundary Rules (macOS conventions)

- Words are sequences of alphanumeric characters
- Delimiters: whitespace, punctuation (`.,;:!?'"()[]{}/<>@#$%^&*-+=~\`|`)
- camelCase and snake_case are NOT word boundaries (matching macOS behavior)
- Option+Left: move to beginning of previous word (skip delimiters, then skip word chars)
- Option+Right: move to end of next word (skip word chars, then skip delimiters)

#### Kill Ring

- Circular buffer of max 10 entries
- `kill(text: string)`: push text onto ring
- `yank(): string | null`: return most recent killed text
- `yankRotate(): string | null`: cycle to previous kill (not required for v1)

#### Undo Stack

- Each operation records `{ type, position, oldText, newText, cursor, selection }`
- Consecutive character insertions grouped into single operation (300ms debounce)
- Stack depth: 100 operations
- Redo stack cleared on any new edit after undo

### Acceptance Criteria

- [ ] TextBuffer operations are pure functions (no side effects, no mutation)
- [ ] Word boundary detection matches macOS behavior (tested with edge cases: punctuation, whitespace, start/end of text)
- [ ] Selection operations correctly maintain anchor/focus semantics
- [ ] Insert with active selection replaces the selection
- [ ] Delete with active selection removes the selection regardless of delete direction
- [ ] Arrow keys without Shift deselect and place cursor at the appropriate edge
- [ ] Kill ring stores killed text and yank retrieves it
- [ ] Undo reverses the last operation; redo restores it
- [ ] Consecutive character insertions are grouped for undo
- [ ] All tests pass: `npx vitest run test_scripts/test-text-buffer.test.ts test_scripts/test-word-boundaries.test.ts test_scripts/test-kill-ring.test.ts test_scripts/test-undo-stack.test.ts`

### Verification Commands

```bash
npx vitest run test_scripts/test-text-buffer.test.ts
npx vitest run test_scripts/test-word-boundaries.test.ts
npx vitest run test_scripts/test-kill-ring.test.ts
npx vitest run test_scripts/test-undo-stack.test.ts
npx tsc --noEmit
```

---

## 5. Phase 3: Key Handler and Shortcut Mapping

### Objective

Map raw Ink key events (`input: string, key: Key`) to `EditAction` values. This is the bridge between terminal input and the text buffer. Must handle dual-mode Option+Arrow (legacy ESC b/f + Kitty CSI u) and graceful degradation for terminals without Kitty protocol.

### Files to Create

| File | Purpose |
|------|---------|
| `notebooklm_agent/tui/hooks/useKeyHandler.ts` | `resolveKeyAction(input, key): EditAction` function |
| `test_scripts/test-key-handler.test.ts` | Unit tests for shortcut resolution |

### Design Details

#### EditAction Union Type (from `edit-actions.ts`)

```typescript
type EditAction =
  | { type: 'move'; direction: 'left' | 'right' | 'up' | 'down'; select: boolean; word: boolean; line: boolean; doc: boolean }
  | { type: 'delete'; direction: 'backward' | 'forward'; word: boolean; line: boolean }
  | { type: 'insert'; text: string }
  | { type: 'newline' }
  | { type: 'submit' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'killToEnd' }          // Ctrl+K
  | { type: 'killToStart' }        // Ctrl+U
  | { type: 'killWord' }           // Ctrl+W
  | { type: 'yank' }               // Ctrl+Y
  | { type: 'transpose' }          // Ctrl+T
  | { type: 'openLine' }           // Ctrl+O
  | { type: 'selectAll' }
  | { type: 'historyPrev' }        // Up arrow when on first line
  | { type: 'historyNext' }        // Down arrow when on last line
  | { type: 'scrollUp'; amount: 'line' | 'page' | 'top' }
  | { type: 'scrollDown'; amount: 'line' | 'page' | 'bottom' }
  | { type: 'cancel' }             // Ctrl+C
  | { type: 'exit' }               // Ctrl+D on empty
  | { type: 'slashCommand'; command: string }
  | { type: 'none' };
```

#### Shortcut Mapping (50+ mappings)

The `resolveKeyAction` function must handle:

**Submit / Newline**:
- Enter (no Shift) -> `submit`
- Shift+Enter -> `newline`
- Ctrl+O -> `openLine`

**Cursor Movement**:
- Arrow keys (plain) -> `move` with `select: false`
- Arrow keys + Shift -> `move` with `select: true`
- Option+Left/Right -> `move` with `word: true` (dual-mode: Kitty `key.meta + arrow` OR legacy `input === 'b'/'f' && key.meta`)
- Shift+Option+Left/Right -> `move` with `word: true, select: true`
- Ctrl+A / Ctrl+E -> `move` with `line: true`
- Ctrl+F / Ctrl+B -> `move` left/right
- Ctrl+N / Ctrl+P -> `move` down/up
- Home / End -> `move` with `line: true`
- Cmd+Arrow (Kitty `key.super`) -> `move` with `line: true` or `doc: true`

**Deletion**:
- Backspace -> `delete backward`
- Delete (Fn+Backspace) -> `delete forward`
- Option+Backspace -> `delete backward word`
- Ctrl+H -> `delete backward` (Emacs backspace)
- Ctrl+D (non-empty input) -> `delete forward`
- Ctrl+K -> `killToEnd`
- Ctrl+U -> `killToStart`
- Ctrl+W -> `killWord`

**Other**:
- Ctrl+Y -> `yank`
- Ctrl+T -> `transpose`
- Ctrl+Z -> `undo`
- Ctrl+Shift+Z -> `redo` (Kitty only for Shift detection)
- Cmd+A / Ctrl+Shift+A -> `selectAll`
- PageUp/PageDown -> `scrollUp`/`scrollDown` with `page`
- Ctrl+C -> `cancel`
- Ctrl+D (empty input) -> `exit`

**Note on priority**: Ctrl+D must check if input is empty to decide between `delete forward` and `exit`. This requires the key handler to receive the current buffer state or delegate the decision to the caller. The recommended approach is to have `resolveKeyAction` return `{ type: 'ctrlD' }` and let the caller decide based on buffer content.

### Acceptance Criteria

- [ ] All 50+ shortcuts from the spec are mapped to EditAction values
- [ ] Dual-mode Option+Arrow works: both `key.meta + arrow` (Kitty) and `input='b'/'f' + key.meta` (legacy)
- [ ] Shift+Enter correctly maps to `newline` (requires Kitty; in legacy mode maps to `submit`)
- [ ] Ctrl+letter keys correctly detected in both legacy and Kitty modes
- [ ] Super/Cmd+Arrow maps to line/doc movement (Kitty only; no-op in legacy)
- [ ] Regular character input maps to `insert` with the character text
- [ ] All tests pass

### Verification Commands

```bash
npx vitest run test_scripts/test-key-handler.test.ts
npx tsc --noEmit
```

---

## 6. Phase 4: InputArea Component

### Objective

Build the visual input component that renders the text buffer with cursor highlighting, selection highlighting, multi-line support, and paste handling. Connects the key handler and text editor hook to the visual display.

### Files to Create

| File | Purpose |
|------|---------|
| `notebooklm_agent/tui/components/InputArea.tsx` | Visual input component |
| `notebooklm_agent/tui/hooks/useTextEditor.ts` | React hook wrapping TextBuffer + undo + kill ring |
| `notebooklm_agent/tui/hooks/useInputHistory.ts` | Up/Down arrow input recall |

### Design Details

#### `useTextEditor` Hook

```typescript
interface UseTextEditorResult {
  // State
  buffer: TextBuffer;
  lines: string[];            // content split by newline
  cursorLine: number;         // line index of cursor
  cursorCol: number;          // column index on current line
  selectionRange: { startLine: number; startCol: number; endLine: number; endCol: number } | null;
  
  // Actions
  dispatch(action: EditAction): void;
  insertText(text: string): void;   // For paste handler
  getText(): string;                // Get full content
  clear(): void;                    // Clear after submit
  isEmpty(): boolean;               // For Ctrl+D exit check
}
```

This hook internally manages:
- `TextBuffer` state (via `useState` or `useReducer`)
- `KillRing` instance (via `useRef`)
- `UndoStack` instance (via `useRef`)
- Dispatches `EditAction` to the appropriate text buffer operations

#### `useInputHistory` Hook

```typescript
interface UseInputHistoryResult {
  recallPrevious(currentText: string): string | null;
  recallNext(): string | null;
  addEntry(text: string): void;
}
```

- Stores up to 50 previous inputs
- Up arrow on first line recalls previous input
- Down arrow on last line recalls next or returns to current draft
- Preserves the "draft" input when navigating history

#### InputArea Component

Renders each line of text with:
- Cursor: character at cursor position rendered with `<Text inverse>` (block cursor)
- Selection: selected range rendered with `<Text backgroundColor="blue">` or `<Text inverse>`
- Border: `borderStyle="single"` with color indicating focus/disabled state
- Height: `Math.min(lineCount, 10) + 2` (border)
- Prompt: `> ` prefix on first line
- Disabled state: shows "Waiting for agent..." when agent is processing

### Acceptance Criteria

- [ ] Cursor is visible as a block character (inverse video)
- [ ] Text selection is visually highlighted
- [ ] Multi-line input works via Shift+Enter (Kitty terminals) or Ctrl+O
- [ ] Input area grows from 1 to 10 lines, then scrolls internally
- [ ] Paste via Cmd+V (terminal-native) inserts text at cursor
- [ ] Up/Down arrow recalls previous inputs when on first/last line
- [ ] All Ctrl+key Emacs bindings work: A, E, F, B, N, P, K, U, W, Y, T, O, D, H
- [ ] Word navigation via Option+Arrow works in both legacy and Kitty terminals
- [ ] Typing replaces active selection
- [ ] Undo/Redo works (Ctrl+Z / Ctrl+Shift+Z)

### Verification Commands

```bash
npm run tui    # Manual testing of input behavior
npx tsc --noEmit
```

---

## 7. Phase 5: ADK Agent Integration Hook

### Objective

Build the `useAgent` hook that wraps `InMemoryRunner.runAsync()` and processes the event stream using `toStructuredEvents()`. This hook manages the message list, agent status, and active tool call state.

### Files to Create

| File | Purpose |
|------|---------|
| `notebooklm_agent/tui/hooks/useAgent.ts` | Agent runner wrapper |

### Design Details

#### Hook Interface

```typescript
type AgentStatus = 'idle' | 'thinking' | 'streaming' | 'tool_call' | 'error';

interface Message {
  id: string;
  role: 'user' | 'agent';
  text: string;
  isPartial?: boolean;     // true while streaming
  toolCalls?: ToolCallInfo[];  // tool calls made during this response
}

interface ToolCallInfo {
  name: string;
  args: Record<string, unknown>;
  status: 'running' | 'completed' | 'error';
}

interface UseAgentResult {
  messages: Message[];
  agentStatus: AgentStatus;
  activeToolCall: ToolCallInfo | null;
  sendMessage(text: string): Promise<void>;
  cancelRun(): void;
}
```

#### Implementation Pattern

Uses `toStructuredEvents()` from `@google/adk` for event classification:

```typescript
import { toStructuredEvents, EventType, StreamingMode, InMemoryRunner } from '@google/adk';
import { createUserContent } from '@google/genai';
```

Key behaviors:
1. Append user message immediately on `sendMessage`
2. Set status to `'thinking'`
3. Iterate `runner.runAsync()` with `StreamingMode.SSE`
4. Process each event via `toStructuredEvents()`:
   - `CONTENT` + `event.partial === true` -> append streaming text, set status `'streaming'`
   - `TOOL_CALL` -> set `activeToolCall`, set status `'tool_call'`
   - `TOOL_RESULT` -> clear `activeToolCall`, set status `'thinking'`
   - `THOUGHT` -> optionally store for collapsible display
   - `FINISHED` -> finalize message, set status `'idle'`
   - `ERROR` -> show error message, set status `'error'`
5. Cancel via `generatorRef.current.return(undefined)` for Ctrl+C

#### Runner and Session Setup

```typescript
// In App component or a setup hook
import { rootAgent } from '../../notebooklm_agent/agent.ts';

const runner = new InMemoryRunner({ agent: rootAgent });
const session = await runner.sessionService.createSession({
  appName: runner.appName,
  userId: 'tui-user',
});
```

**Note**: The `import 'dotenv/config'` in `tui.ts` must execute before `agent.ts` is imported, since `agent.ts` calls `getConfig()` at module level.

### Acceptance Criteria

- [ ] `sendMessage` sends text to the agent and receives responses
- [ ] Streaming text appears token-by-token in the message list
- [ ] Tool calls are detected and reported via `activeToolCall`
- [ ] Tool results clear the `activeToolCall` state
- [ ] `cancelRun` stops the agent's async generator
- [ ] Error events are captured and displayed
- [ ] Agent status transitions correctly: idle -> thinking -> streaming/tool_call -> idle
- [ ] Session state persists across turns (notebook context maintained)

### Verification Commands

```bash
# Integration test: manually send a message via the hook
npx tsc --noEmit
# Manual test via npm run tui (once integrated with Phase 8)
```

---

## 8. Phase 6: ChatHistory and Message Rendering

### Objective

Build the scrollable chat history area with manual windowing, message rendering with role-based styling, and keyboard scroll navigation.

### Files to Create

| File | Purpose |
|------|---------|
| `notebooklm_agent/tui/components/ChatHistory.tsx` | Scrollable message list |
| `notebooklm_agent/tui/components/Message.tsx` | Individual message rendering |
| `notebooklm_agent/tui/hooks/useScrollManager.ts` | Scroll state management |

### Design Details

#### Scroll Manager

```typescript
interface UseScrollManagerResult {
  scrollOffset: number;           // lines from bottom (0 = at bottom)
  isAtBottom: boolean;
  scrollUp(lines: number): void;
  scrollDown(lines: number): void;
  scrollToTop(): void;
  scrollToBottom(): void;
  resetOnNewMessage(): void;      // auto-scroll if at bottom
}
```

#### ChatHistory Component

- Uses `useBoxMetrics` to determine visible height
- Computes per-message line counts using terminal width (approximate: `Math.ceil(lineLength / width)`)
- Renders only visible messages based on scroll offset
- Shows scroll indicators when content exists above or below viewport
- Auto-scrolls to bottom on new messages (only if user is at bottom)

#### Message Component

- User messages: green prefix `You:`, left-aligned
- Agent messages: cyan prefix `Agent:`, left-aligned
- Streaming indicator: `Agent:` with blinking cursor `|`
- Text wraps with `<Text wrap="wrap">`
- Tool call indicators inline: `  > Calling search_youtube...`

#### Scroll Keyboard Bindings

| Key | Action |
|-----|--------|
| PageUp | Scroll up one page |
| PageDown | Scroll down one page |
| Home (when history focused) | Scroll to top |
| End (when history focused) | Scroll to bottom |

**Focus management**: The scroll keys (PageUp/PageDown) are always active. Arrow keys are routed to the input area (for cursor movement) unless the cursor is on the first/last line (then they become input history navigation, not scroll).

### Acceptance Criteria

- [ ] Messages display with visual distinction between user and agent
- [ ] Long messages word-wrap correctly
- [ ] PageUp/PageDown scrolls the history
- [ ] Scroll indicators show when content exists above/below viewport
- [ ] Auto-scroll to bottom on new message (when user is at bottom)
- [ ] Manual scroll-up is preserved (does not auto-scroll back)
- [ ] Streaming messages update in real-time
- [ ] Terminal resize re-layouts correctly

### Verification Commands

```bash
npm run tui    # Manual testing with scroll
npx tsc --noEmit
```

---

## 9. Phase 7: StatusBar and ToolCallIndicator

### Objective

Build the fixed-height status bar and the animated tool call spinner.

### Files to Create

| File | Purpose |
|------|---------|
| `notebooklm_agent/tui/components/StatusBar.tsx` | Status bar component |
| `notebooklm_agent/tui/components/ToolCallIndicator.tsx` | Animated spinner for tool calls |

### Design Details

#### StatusBar

Single-line bar showing:
- Left: Agent status with color-coded indicator
  - `idle`: green `Ready`
  - `thinking`: yellow spinner `Thinking...`
  - `streaming`: cyan `Streaming`
  - `tool_call`: yellow spinner `Calling <tool_name>...`
  - `error`: red `Error`
- Center: Session info (abbreviated session ID)
- Right: Key hints (`Ctrl+C cancel | PgUp/Dn scroll | /help`)

Uses `useAnimation` from Ink for spinner animation (shared timer, no `setInterval`).

#### ToolCallIndicator

Displayed inline in the chat history when a tool call is active:
```
  > Calling search_youtube... [spinner]
```

Uses the same `useAnimation` timer. Shows tool name and animated spinner. Disappears when tool result arrives.

### Acceptance Criteria

- [ ] Status bar shows current agent status with appropriate color
- [ ] Spinner animates during `thinking` and `tool_call` states
- [ ] Tool name is displayed during tool calls
- [ ] Status bar is always 1 line height, never wraps
- [ ] Key hints are visible in the status bar

### Verification Commands

```bash
npm run tui    # Visual check
npx tsc --noEmit
```

---

## 10. Phase 8: App Shell and Layout Assembly

### Objective

Wire all components together into the final App component. Implement slash commands, Ctrl+C handling, Ctrl+D exit, and the full event routing between components.

### Files to Modify

| File | Change |
|------|--------|
| `notebooklm_agent/tui/index.tsx` | Full App implementation replacing placeholder |

### Design Details

#### App Component Responsibilities

1. **Runner setup**: Create `InMemoryRunner` with `rootAgent`, create session
2. **Layout**: Three-region Flexbox with `height={rows}` from `useWindowSize`
3. **Key routing**: 
   - `useInput` with Kitty protocol handles all keys
   - Route to `resolveKeyAction` -> dispatch to `useTextEditor`
   - Special actions: `cancel` (Ctrl+C), `exit` (Ctrl+D), slash commands
   - PageUp/PageDown -> scroll manager
4. **Paste handling**: `usePaste` -> `textEditor.insertText`
5. **Slash commands**: Parse `/clear`, `/quit`, `/exit`, `/help` from submitted text
6. **Ctrl+C behavior**:
   - If agent is running: cancel the run
   - If agent is idle: exit the TUI
7. **Ctrl+D behavior**:
   - If input is empty: exit the TUI
   - If input is non-empty: delete forward (Emacs)

#### Startup Sequence

1. `tui.ts` imports `dotenv/config` (loads `.env`)
2. `tui.ts` imports `App` from `tui/index.tsx`
3. `App` component mounts, creates runner and session asynchronously
4. While loading: shows "Initializing agent..." message
5. On ready: shows input prompt
6. Config errors (missing env vars) caught and displayed as error message

#### Exit Sequence

1. User triggers exit (Ctrl+C idle, Ctrl+D empty, /quit)
2. App calls `useApp().exit()` (Ink's exit mechanism)
3. Ink restores alternate screen automatically
4. Process exits cleanly

### Acceptance Criteria

- [ ] Full chat flow works: type message -> Enter -> agent responds -> response displayed
- [ ] `/clear` clears message history
- [ ] `/quit` and `/exit` exit the TUI
- [ ] `/help` shows available commands and shortcuts
- [ ] Ctrl+C cancels running agent operation
- [ ] Ctrl+C when idle exits the TUI
- [ ] Ctrl+D on empty input exits the TUI
- [ ] Ctrl+D on non-empty input deletes forward
- [ ] Paste via Cmd+V inserts text
- [ ] Tool call indicator appears during tool execution
- [ ] Terminal resize re-layouts correctly
- [ ] Config errors show a helpful message at startup

### Verification Commands

```bash
npm run tui                    # Full integration test
echo "Hello" | npm run tui     # Non-interactive input (if supported)
npx tsc --noEmit
```

---

## 11. Phase 9: Worker Thread for Agent Execution

### Objective

Move the `InMemoryRunner` execution to a Node.js Worker thread so that `execFileSync` calls in tools do not block the main thread (and thus do not freeze the TUI rendering and input handling).

### Files to Create

| File | Purpose |
|------|---------|
| `notebooklm_agent/tui/worker/agent-worker.ts` | Worker thread script |
| `notebooklm_agent/tui/worker/agent-protocol.ts` | Shared message types for MessagePort |

### Files to Modify

| File | Change |
|------|--------|
| `notebooklm_agent/tui/hooks/useAgent.ts` | Replace direct `runAsync` with worker communication |

### Design Details

#### Worker Protocol (MessagePort messages)

```typescript
// Main thread -> Worker
type MainToWorker =
  | { type: 'init' }                                    // Initialize runner + session
  | { type: 'send'; text: string; messageId: string }   // Send user message
  | { type: 'cancel' };                                 // Cancel current run

// Worker -> Main thread
type WorkerToMain =
  | { type: 'ready'; sessionId: string }                // Initialization complete
  | { type: 'event'; messageId: string; structured: StructuredEvent[]; isPartial: boolean }
  | { type: 'done'; messageId: string }                 // Run complete
  | { type: 'error'; messageId: string; error: string } // Error
  | { type: 'initError'; error: string };               // Initialization error
```

#### Worker Thread (`agent-worker.ts`)

```typescript
import { parentPort } from 'node:worker_threads';
import 'dotenv/config';
import { InMemoryRunner, StreamingMode, toStructuredEvents } from '@google/adk';
import { createUserContent } from '@google/genai';
import { rootAgent } from '../../notebooklm_agent/agent.ts';

// Initialize on 'init' message
// Run agent on 'send' message
// Cancel on 'cancel' message (gen.return())
// Post structured events back to main thread
```

#### Updated `useAgent` Hook

Replace direct `runAsync` iteration with Worker communication:
1. On mount: create Worker, send `init`
2. On `sendMessage`: post `{ type: 'send', text, messageId }`
3. On worker `event` message: update React state with structured events
4. On `cancelRun`: post `{ type: 'cancel' }`
5. On unmount: terminate worker

**Key benefit**: The main thread event loop stays responsive during `execFileSync` tool calls. Spinner animations continue, user can type, and Ctrl+C is responsive.

### Acceptance Criteria

- [ ] TUI remains responsive (spinner animates, input works) during tool execution
- [ ] Agent responses arrive correctly via worker messages
- [ ] Ctrl+C cancels the worker's current run
- [ ] Worker initialization errors are caught and displayed
- [ ] Worker thread terminates cleanly on TUI exit
- [ ] Session state persists across turns (worker maintains session)
- [ ] Streaming text still appears token-by-token

### Verification Commands

```bash
npm run tui    # Test with a tool-calling query (e.g., "list my notebooks")
# Verify spinner animates during tool execution
# Verify typing is possible during tool execution
npx tsc --noEmit
```

### Risks

- **Module loading in Worker**: Workers may not support `tsx` transform for `.ts` imports. Mitigation: use `tsx` as the `execArgv` for the Worker, or compile to JS first.
- **Serialization**: `StructuredEvent` objects may not serialize cleanly over `MessagePort` (functions, class instances). Mitigation: serialize to plain objects before posting.
- **Memory**: Two copies of the agent module (main + worker). Mitigation: acceptable for this use case; agent module is small.

---

## 12. Phase 10: Polish and Terminal Compatibility

### Objective

Final polish: terminal compatibility testing, documentation, edge case handling, and configuration guide.

### Tasks

1. **Terminal compatibility testing**: Test in at least 3 terminals:
   - iTerm2 (with Kitty protocol)
   - macOS Terminal.app (legacy mode, graceful degradation)
   - One other: Kitty, Alacritty, Warp, or VS Code terminal

2. **Graceful degradation documentation**: Document what works and what does not in Terminal.app:
   - Shift+Enter not available -> document Ctrl+O as alternative for newline
   - Cmd+key not available -> document Ctrl equivalents
   - Option+Arrow requires "Use Option as Meta Key" enabled

3. **Markdown rendering** (optional, deferred if complex):
   - Bold/italic via ANSI
   - Code blocks with background color
   - Lists with indentation
   - Links displayed as text

4. **Error handling edge cases**:
   - Agent throws during initialization (missing API key, invalid model)
   - Network error during LLM call
   - Tool timeout
   - Very long agent responses (> 100 lines)
   - Very long user input (> 10 lines)

5. **Performance check**:
   - Startup time < 3 seconds
   - Memory < 200MB during typical session
   - No visible lag on keystroke (<16ms)

6. **Documentation updates**:
   - Update `CLAUDE.md` with TUI tool documentation
   - Update `docs/design/project-design.md` with TUI architecture
   - Create terminal setup guide (which settings to configure in each terminal)

### Files to Create/Modify

| File | Change |
|------|--------|
| `CLAUDE.md` | Add TUI tool documentation |
| `docs/design/project-design.md` | Add TUI section to architecture |
| `docs/design/configuration-guide.md` | Add terminal configuration section |

### Acceptance Criteria

- [ ] Works in iTerm2 with full keyboard shortcuts
- [ ] Works in Terminal.app with Ctrl-based shortcuts (graceful degradation)
- [ ] Startup time < 3 seconds
- [ ] Memory < 200MB during typical session
- [ ] Config errors show helpful messages (not stack traces)
- [ ] Long sessions (50+ messages) do not degrade performance noticeably
- [ ] Documentation is complete
- [ ] All type checks pass: `npx tsc --noEmit`

### Verification Commands

```bash
npm run tui         # Full manual test
npx tsc --noEmit    # Type check
time npm run tui &  # Startup time measurement (exit immediately)
npx vitest run      # All tests pass
```

---

## 13. Dependency Graph

```
Phase 1 (Setup)
  |
  +-----> Phase 2 (Text Buffer) ------> Phase 3 (Key Handler) ------> Phase 4 (InputArea)
  |                                                                         |
  +-----> Phase 5 (Agent Hook) -------------------------------------------+|
  |                                                                        ||
  +-----> Phase 6 (ChatHistory) ------------------------------------------+|
  |                                                                       ||
  +-----> Phase 7 (StatusBar) -------------------------------------------+|
                                                                          |
                                                                    Phase 8 (App Shell)
                                                                          |
                                                                    Phase 9 (Worker Thread)
                                                                          |
                                                                    Phase 10 (Polish)
```

**Parallel execution lanes after Phase 1**:

| Lane A (Input) | Lane B (Agent) | Lane C (Display) | Lane D (Chrome) |
|-----------------|----------------|-------------------|------------------|
| Phase 2: Text Buffer | Phase 5: Agent Hook | Phase 6: ChatHistory | Phase 7: StatusBar |
| Phase 3: Key Handler | | | |
| Phase 4: InputArea | | | |

All four lanes converge at Phase 8 (App Shell).

---

## 14. Risk Register

### High Risk

| # | Risk | Likelihood | Impact | Mitigation | Phase |
|---|------|-----------|--------|------------|-------|
| R1 | Cmd+key not detectable in terminals | Certain | High | Primary bindings are Ctrl/Emacs; Cmd via Kitty as enhancement; document in setup guide | 3, 10 |
| R2 | `execFileSync` freezes TUI | Certain | High | Worker thread (Phase 9); Phase 8 works with brief freezes as fallback | 9 |
| R3 | Custom TextInput complexity underestimated | Likely | High | Phased: basic editing (P2), then word nav (P2), then selection (P2), then undo (P2); each testable independently | 2, 3, 4 |
| R4 | Worker thread + tsx module loading | Possible | High | Test early; fallback: compile worker to JS; or use `node --import tsx` | 9 |

### Medium Risk

| # | Risk | Likelihood | Impact | Mitigation | Phase |
|---|------|-----------|--------|------------|-------|
| R5 | Terminal escape sequence variance | Likely | Medium | Dual-mode handlers; test in 3+ terminals; Kitty protocol normalizes most cases | 3, 10 |
| R6 | Ink performance with long sessions | Possible | Medium | Manual windowing (only render visible); cap message list at 500 entries | 6 |
| R7 | `toStructuredEvents` API changes | Unlikely | Medium | Pin `@google/adk` version; have manual fallback classification | 5 |
| R8 | Ink 7 not yet published to npm | Possible | Medium | Check `npm info ink version`; if v6, adjust API usage (some hooks may differ) | 1 |

### Low Risk

| # | Risk | Likelihood | Impact | Mitigation | Phase |
|---|------|-----------|--------|------------|-------|
| R9 | Startup time > 3 seconds | Unlikely | Low | Ink + React loads < 1s; ADK agent init is the bottleneck | 10 |
| R10 | Memory > 200MB | Unlikely | Low | Text-only UI is lightweight; monitor with `process.memoryUsage()` | 10 |

---

## 15. Interface Contracts

These contracts allow different phases to be developed independently.

### Contract 1: EditAction (Phase 2 <-> Phase 3 <-> Phase 4)

```typescript
// File: notebooklm_agent/tui/lib/edit-actions.ts
// All phases must agree on this type

type EditAction =
  | { type: 'move'; direction: 'left' | 'right' | 'up' | 'down'; select: boolean; word: boolean; line: boolean; doc: boolean }
  | { type: 'delete'; direction: 'backward' | 'forward'; word: boolean; line: boolean }
  | { type: 'insert'; text: string }
  | { type: 'newline' }
  | { type: 'submit' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'killToEnd' }
  | { type: 'killToStart' }
  | { type: 'killWord' }
  | { type: 'yank' }
  | { type: 'transpose' }
  | { type: 'openLine' }
  | { type: 'selectAll' }
  | { type: 'historyPrev' }
  | { type: 'historyNext' }
  | { type: 'scrollUp'; amount: 'line' | 'page' | 'top' }
  | { type: 'scrollDown'; amount: 'line' | 'page' | 'bottom' }
  | { type: 'cancel' }
  | { type: 'exit' }
  | { type: 'slashCommand'; command: string }
  | { type: 'none' };
```

### Contract 2: Message Type (Phase 5 <-> Phase 6 <-> Phase 8)

```typescript
interface Message {
  id: string;
  role: 'user' | 'agent';
  text: string;
  isPartial?: boolean;
  toolCalls?: ToolCallInfo[];
  timestamp: number;
}

interface ToolCallInfo {
  name: string;
  args: Record<string, unknown>;
  status: 'running' | 'completed' | 'error';
}
```

### Contract 3: AgentStatus (Phase 5 <-> Phase 7 <-> Phase 8)

```typescript
type AgentStatus = 'idle' | 'thinking' | 'streaming' | 'tool_call' | 'error';
```

### Contract 4: TextBuffer (Phase 2 <-> Phase 4)

```typescript
interface TextBuffer {
  content: string;
  cursor: number;
  selection: { anchor: number; focus: number } | null;
}
```

### Contract 5: Worker Protocol (Phase 5 <-> Phase 9)

```typescript
// Main -> Worker
type MainToWorker =
  | { type: 'init' }
  | { type: 'send'; text: string; messageId: string }
  | { type: 'cancel' };

// Worker -> Main
type WorkerToMain =
  | { type: 'ready'; sessionId: string }
  | { type: 'event'; messageId: string; events: SerializedStructuredEvent[]; isPartial: boolean }
  | { type: 'done'; messageId: string }
  | { type: 'error'; messageId: string; error: string }
  | { type: 'initError'; error: string };

// Serialized form (no class instances, no functions)
interface SerializedStructuredEvent {
  eventType: string;  // EventType enum value
  content?: string;
  call?: { name: string; args: Record<string, unknown> };
  result?: { name: string; response: Record<string, unknown> };
  error?: string;
}
```

---

## 16. Open Decisions

These decisions should be made before or during implementation. Each can be deferred until the relevant phase begins.

| # | Decision | Options | Recommendation | Relevant Phase |
|---|----------|---------|---------------|----------------|
| OD-1 | Use `<Static>` vs full manual windowing for chat history | `<Static>` (simpler, uses terminal scrollback) vs manual windowing (custom scroll, keyboard nav) | Manual windowing: the spec requires keyboard-driven scrollback (PageUp/Down) | 6 |
| OD-2 | `ink-scroll-view` vs pure manual windowing | Third-party package vs custom line-count computation | Start with manual windowing; switch to `ink-scroll-view` if line-count estimation is too inaccurate | 6 |
| OD-3 | Markdown rendering in agent responses | Plain text vs basic Markdown (bold, code blocks) vs full Markdown | Plain text for v1; add basic Markdown (bold via ANSI, code blocks) in Phase 10 if time permits | 6, 10 |
| OD-4 | Shift+Enter fallback in Terminal.app | No newline support vs Ctrl+O as alternative | Ctrl+O always works (insert newline without moving cursor); document as primary for Terminal.app | 3 |
| OD-5 | Worker thread implementation timing | Phase 9 (after full integration) vs Phase 5 (build from start) | Phase 9: get everything working first with brief freezes, then add worker; reduces risk of debugging two complex systems at once | 5, 9 |
| OD-6 | Undo granularity | Per-character vs per-action (insert, delete-word, paste) | Per-action with 300ms grouping of consecutive character inserts | 2 |
| OD-7 | Mouse scroll support | Include in v1 vs defer | Defer to post-v1; keyboard scroll covers the requirement | 10 |
| OD-8 | Thought event display | Hide vs show collapsed | Show as dimmed text with "Thinking:" prefix; collapse by default | 5, 6 |

---

## Appendix A: New Dependencies

| Package | Version | Purpose | Phase |
|---------|---------|---------|-------|
| `ink` | ^7.0.0 | Terminal UI framework | 1 |
| `react` | ^19.2.0 | React (peer dep of Ink) | 1 |
| `@types/react` | ^19.x | TypeScript types for React (dev dep) | 1 |

No other new dependencies are required. The project already has `@google/adk`, `@google/genai`, `dotenv`, `tsx`, and `vitest`.

## Appendix B: Files Changed Summary

### New Files (22 files)

```
notebooklm_agent/tui.ts
notebooklm_agent/tui/index.tsx
notebooklm_agent/tui/components/ChatHistory.tsx
notebooklm_agent/tui/components/InputArea.tsx
notebooklm_agent/tui/components/StatusBar.tsx
notebooklm_agent/tui/components/ToolCallIndicator.tsx
notebooklm_agent/tui/components/Message.tsx
notebooklm_agent/tui/hooks/useAgent.ts
notebooklm_agent/tui/hooks/useTextEditor.ts
notebooklm_agent/tui/hooks/useInputHistory.ts
notebooklm_agent/tui/hooks/useKeyHandler.ts
notebooklm_agent/tui/hooks/useScrollManager.ts
notebooklm_agent/tui/lib/text-buffer.ts
notebooklm_agent/tui/lib/word-boundaries.ts
notebooklm_agent/tui/lib/kill-ring.ts
notebooklm_agent/tui/lib/undo-stack.ts
notebooklm_agent/tui/lib/edit-actions.ts
notebooklm_agent/tui/worker/agent-worker.ts
notebooklm_agent/tui/worker/agent-protocol.ts
test_scripts/test-text-buffer.test.ts
test_scripts/test-word-boundaries.test.ts
test_scripts/test-kill-ring.test.ts
test_scripts/test-undo-stack.test.ts
test_scripts/test-key-handler.test.ts
```

### Modified Files (3 files)

```
package.json          # Add dependencies, add "tui" script
tsconfig.json         # Add "jsx": "react-jsx"
CLAUDE.md             # Add TUI tool documentation (Phase 10)
```

### Unchanged Files

All existing source files (`agent.ts`, `config.ts`, `tools/*`) remain unchanged. The TUI is purely a new frontend.
