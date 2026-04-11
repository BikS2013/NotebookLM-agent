# Investigation: Terminal UI for NotebookLM Agent

**Date:** 2026-04-11
**Investigator:** Claude Code
**Status:** Complete

---

## 1. Executive Summary

**Recommended approach: Ink 7 (React for CLI) with the Kitty keyboard protocol enabled, building a custom TextInput component for the full macOS editing experience.**

Ink is the most actively maintained terminal UI library for Node.js, has first-class TypeScript support, uses a React component model that scales well for complex UIs, and -- crucially -- supports the Kitty keyboard protocol which solves the modifier key ambiguity problem that plagues legacy terminal input. Claude Code itself is built on Ink (a custom fork), validating this approach for production-grade terminal applications with sophisticated keyboard handling. The custom TextInput component is necessary because no existing component provides the full macOS text-editing behavior specified in the requirements (50+ shortcuts including kill ring, undo/redo, word/line navigation, and text selection).

---

## 2. Options Evaluated

### 2.1 Ink 7 (React for CLI)

| Attribute | Assessment |
|-----------|-----------|
| **TypeScript support** | Excellent. Written in TypeScript, ships types, scaffold supports TS. |
| **macOS key handling** | Good. Supports Kitty keyboard protocol (v7), exposes `key.shift`, `key.ctrl`, `key.meta`, `key.super` modifiers on `useInput`. Option+Arrow detected as `meta + leftArrow/rightArrow`. |
| **Text input editing** | Basic built-in (`ink-text-input`), but insufficient for spec. Custom component needed. |
| **Async compatibility** | Excellent. React model is inherently async-friendly; rendering never blocks the event loop. |
| **Maintenance** | Active. v7.0.0 released recently, used by Gatsby, Prisma, GitHub Copilot CLI, Claude Code. |
| **Bundle size** | Medium. Pulls in React 18+, Yoga layout engine (JS port). |
| **Community** | Large. 4,500+ dependents on npm. |
| **Suitability** | **9/10** -- Best overall fit. |

**Pros:**
- React component model allows clean separation of concerns (ChatHistory, InputArea, StatusBar as components)
- Flexbox layout via Yoga handles terminal resize naturally
- `useInput` hook provides structured key events with modifier detection
- Kitty keyboard protocol support (`kittyKeyboard: {mode: 'auto'}`) enables disambiguating Ctrl+I vs Tab, Shift+Enter vs Enter, etc.
- `usePaste` hook handles clipboard paste separately from key input
- Battle-tested: Claude Code itself is built on Ink (albeit a custom fork)
- Reactive rendering: only re-renders changed portions of the screen

**Cons:**
- React runtime overhead (startup time, memory) -- mitigated by the fact that this is an AI agent app where LLM calls dominate resource usage
- The built-in `ink-text-input` component is far too simple; a full custom TextInput with 50+ shortcuts must be built
- No built-in text selection rendering (must implement highlight via ANSI reverse/color)
- Cmd+key shortcuts are still intercepted by most terminals (see Section 4.1) -- this is a universal terminal limitation, not Ink-specific

### 2.2 blessed / neo-blessed / neo-neo-blessed

| Attribute | Assessment |
|-----------|-----------|
| **TypeScript support** | Poor. Original blessed has `@types/blessed` but they lag behind. neo-neo-blessed has no TS types. |
| **macOS key handling** | Moderate. Has own terminfo parser, detects many special keys, but no Kitty protocol support. |
| **Text input editing** | Has `Textarea` widget with basic editing, but no word navigation, selection, or kill ring. |
| **Async compatibility** | Moderate. Event-based model works but is not React-like; manual state management. |
| **Maintenance** | Poor. Original blessed abandoned ~2017. neo-blessed abandoned ~2020. neo-neo-blessed updated 7 months ago but tiny community. `@terminal-junkies/neo-blessed` updated recently but unclear longevity. |
| **Bundle size** | Large. 16,000+ lines of code in the original. |
| **Suitability** | **4/10** -- Too risky due to maintenance status and poor TS support. |

**Pros:**
- Most feature-complete widget library (windows, scrollbars, tables, forms)
- Own terminfo/termcap parser -- works with exotic terminals
- Mature screen buffer diffing (painter's algorithm)

**Cons:**
- Effectively abandoned; multiple forks with unclear futures
- No TypeScript first-class support
- No Kitty keyboard protocol support
- Imperative API requires manual state management
- Documentation is outdated and incomplete

### 2.3 terminal-kit

| Attribute | Assessment |
|-----------|-----------|
| **TypeScript support** | Moderate. Ships `.d.ts` files but they are incomplete. |
| **macOS key handling** | Good. `grabInput()` with `'key'` events, handles many special keys, priority system for ambiguous sequences. |
| **Text input editing** | Has `inputField()` with auto-complete, but limited editing shortcuts. |
| **Async compatibility** | Moderate. Event-emitter based, works with async but not as clean as React. |
| **Maintenance** | Moderate. v3.1.2 current, updated periodically by single maintainer (cronvel). |
| **Bundle size** | Medium. |
| **Suitability** | **5/10** -- Viable but lower-level, more work for complex layouts. |

**Pros:**
- Good low-level terminal control
- Handles key sequence ambiguity well (priority system)
- 256-color and true-color support
- Screen buffer with diffing

**Cons:**
- Single maintainer, moderate update frequency
- No component model -- layout management is manual
- No Kitty keyboard protocol support
- Would need to build all UI layout, scrolling, and rendering from scratch
- Incomplete TypeScript types

### 2.4 Raw Node.js (process.stdin raw mode + ANSI escape codes)

| Attribute | Assessment |
|-----------|-----------|
| **TypeScript support** | N/A -- pure Node.js APIs, fully typed. |
| **macOS key handling** | Full control. Must parse all escape sequences manually. |
| **Text input editing** | Must build everything from scratch. |
| **Async compatibility** | Full control via streams and event emitters. |
| **Maintenance** | N/A -- uses only Node.js built-ins. |
| **Bundle size** | Zero dependencies. |
| **Suitability** | **3/10** -- Excessive effort for the scope of this project. |

**Pros:**
- Zero dependencies
- Maximum control over every byte
- Can implement Kitty keyboard protocol from scratch
- No abstraction overhead

**Cons:**
- Enormous implementation effort: must build screen buffering, diffing, layout, scroll, resize handling, color management, and all keyboard parsing
- High risk of terminal compatibility bugs
- Reinventing what Ink already provides
- Estimated 3-5x more development time than Ink approach

### 2.5 Prompts / Enquirer / Inquirer

| Attribute | Assessment |
|-----------|-----------|
| **Suitability** | **1/10** -- Completely wrong tool for the job. |

These are prompt libraries for simple question-answer flows (select from list, type a value, confirm yes/no). They have no concept of persistent multi-region layouts, custom keyboard handling, or continuous chat interfaces. Not evaluated further.

---

## 3. Recommended Approach

### Ink 7 with Custom TextInput Component and Kitty Keyboard Protocol

**Architecture:**
```
notebooklm_agent/
  tui/
    index.tsx              # Entry point, App component, InMemoryRunner setup
    components/
      ChatHistory.tsx      # Scrollable message history with virtualization
      InputArea.tsx        # Custom multi-line text input (the big component)
      StatusBar.tsx        # Agent status, session info
      ToolCallIndicator.tsx # Spinner for active tool calls
      Message.tsx          # Individual message rendering (user vs agent)
    hooks/
      useAgent.ts          # InMemoryRunner wrapper, event stream processing
      useTextEditor.ts     # Text editing state machine (cursor, selection, undo, kill ring)
      useInputHistory.ts   # Up/Down arrow input recall
      useKeyHandler.ts     # Key event routing and shortcut mapping
    lib/
      key-parser.ts        # Escape sequence to action mapping
      text-buffer.ts       # Text buffer with cursor, selection, undo/redo stack
      word-boundaries.ts   # macOS word boundary detection
      kill-ring.ts         # Kill ring (Ctrl+K/W/U/Y) implementation
  tui.ts                   # CLI entry point (imports tui/index.tsx)
```

**Justification:**

1. **Ink is proven at scale.** Claude Code -- a complex terminal application with sophisticated keyboard handling, text input, syntax highlighting, and streaming output -- is built on Ink. This validates Ink as the right foundation for our requirements.

2. **Kitty keyboard protocol solves the modifier key problem.** With `kittyKeyboard: {mode: 'auto'}`, Ink enables unambiguous detection of Shift+Enter (vs Enter), Option+Arrow (vs plain Arrow), Ctrl+I (vs Tab), and other modifier combinations. This is critical for the 50+ keyboard shortcuts in the spec. Terminals that support it (iTerm2, Kitty, Alacritty, Ghostty, WezTerm) will get the full experience; others will get graceful degradation.

3. **React component model fits the layout.** The TUI has clear visual regions (history, input, status bar) that map naturally to React components. State flows down, events flow up. Terminal resize is handled by Ink's Yoga layout engine automatically.

4. **The custom TextInput is the main engineering effort.** This is unavoidable regardless of library choice. The spec requires word navigation, text selection with visual highlighting, kill ring, undo/redo, multi-line editing, and input history -- no existing terminal input component provides all of this. Building it as a React component with custom hooks (`useTextEditor`) is cleaner than building it imperatively.

5. **ADK integration is straightforward.** The `useAgent` hook wraps `InMemoryRunner.runAsync()` and processes the event stream, yielding text chunks and tool call indicators to the React component tree. The async generator pattern maps naturally to React state updates.

---

## 4. Key Technical Challenges

### 4.1 Cmd+Key Interception (CRITICAL)

**Problem:** On macOS, the Cmd (Command) key is intercepted by the OS and the terminal emulator before it reaches the application. Cmd+C, Cmd+V, Cmd+X, Cmd+Z, Cmd+A, Cmd+Left/Right are all consumed by Terminal.app, iTerm2, etc. The terminal pty protocol has **no representation** for the Cmd modifier. This is a fundamental limitation of terminal applications on macOS.

**Impact:** The spec lists Cmd+C (copy), Cmd+V (paste), Cmd+X (cut), Cmd+Z (undo), Cmd+Shift+Z (redo), Cmd+A (select all), Cmd+Left/Right (line start/end), Cmd+Up/Down (document start/end), Cmd+Backspace (delete to line start) as required shortcuts. None of these can be detected by any terminal application in the standard terminal protocol.

**Mitigation strategy (layered):**

1. **Rely on terminal-native behavior for clipboard.** Cmd+C copies selected terminal text, Cmd+V pastes from clipboard -- these work because the terminal handles them. The TUI should detect paste events via `usePaste` hook (Ink) or bracketed paste mode. For copy, the terminal's native text selection works for output text; for input text selection, the TUI must render selected text with ANSI reverse video so the user can Cmd+C copy it from the terminal.

2. **Map Ctrl equivalents for editing shortcuts.** The spec already includes Emacs bindings that map 1:1:
   - Ctrl+A / Ctrl+E = line start / end (replaces Cmd+Left / Cmd+Right)
   - Ctrl+K = kill to end of line (replaces Cmd+Delete)
   - Ctrl+U = delete to beginning of line (replaces Cmd+Backspace)
   - Ctrl+W = delete word backward (replaces Option+Backspace partially)
   - Ctrl+Y = yank from kill ring (replaces Cmd+V for killed text)

3. **Kitty keyboard protocol for Super key.** In terminals that support the Kitty protocol and allow configuring Cmd as Super, the `key.super` property in Ink's `useInput` can detect Cmd+key combinations. iTerm2 supports this when "Kitty keyboard protocol" is enabled in profile settings. This is the path to full Cmd+key support, but requires user terminal configuration.

4. **Document terminal configuration.** Provide a setup guide explaining how to configure iTerm2/Kitty/Alacritty to pass Cmd+key as Super via the Kitty protocol, and which Ctrl equivalents work out of the box.

**Decision needed:** The spec should be revised to acknowledge that Cmd+key shortcuts work only in terminals with Kitty protocol + Super key configuration, and that Ctrl-based Emacs equivalents are the primary binding. This is how every terminal application (Vim, Emacs, tmux, Claude Code) handles this limitation.

### 4.2 Option+Arrow Word Navigation (HIGH)

**Problem:** How Option+Arrow is reported varies by terminal and configuration:
- **iTerm2 with "Left Option sends Esc+"**: Sends `ESC b` (word back) / `ESC f` (word forward) -- readline-style
- **iTerm2 with Kitty protocol**: Sends CSI u sequence with Alt modifier + arrow key
- **Terminal.app**: Sends `ESC b` / `ESC f` by default (if Option sends Meta)
- **Kitty/Alacritty**: Send CSI u with Alt modifier (native Kitty protocol)

**Mitigation:** Handle both legacy (ESC+letter) and modern (Kitty CSI u) sequences. The `useInput` hook in Ink with Kitty protocol enabled reports `key.meta + key.leftArrow` or `key.meta + key.rightArrow`. For legacy terminals, parse `ESC b` and `ESC f` as word navigation. This dual handling covers all major macOS terminals.

### 4.3 execFileSync Blocking the Event Loop (HIGH)

**Problem:** Many tools in the agent use `execFileSync` (in `nlm-runner.ts`), which blocks the Node.js event loop. When a tool is executing, the TUI will freeze -- no rendering, no input handling, no spinner animation.

**Mitigation options:**
1. **Worker thread**: Run the `InMemoryRunner` in a Node.js worker thread. The TUI main thread handles rendering and input; the worker thread runs the agent. Communication via `MessagePort`. This is the most robust solution but adds complexity.
2. **Accept the freeze with UX mitigation**: Since tool calls are typically short (1-5 seconds for CLI commands), display a "tool executing..." message before the call and accept the brief freeze. This is simpler but degrades UX.
3. **Convert tools to async**: Replace `execFileSync` with `execFile` (promisified) in `nlm-runner.ts`. This is the cleanest solution but modifies existing tool code (which the spec says should not be modified).

**Recommendation:** Option 1 (worker thread) for production quality, or Option 2 for a simpler v1 with a note to upgrade later.

### 4.4 Text Selection Rendering (MEDIUM)

**Problem:** Terminals do not have a native "selection" concept for application-controlled text. The TUI must visually highlight selected text using ANSI escape codes (reverse video, background color).

**Mitigation:** Render selected text with ANSI reverse video (`\x1B[7m`) or a distinct background color. The `InputArea` component re-renders on every selection change, splitting the text into three segments: before selection, selected (highlighted), after selection. Ink's React model makes this natural -- selection state change triggers re-render.

### 4.5 Undo/Redo Implementation (MEDIUM)

**Problem:** Full undo/redo requires tracking every edit operation with enough context to reverse it.

**Mitigation:** Implement an operation-based undo stack in `text-buffer.ts`:
- Each edit (insert, delete, replace) is recorded as an operation with `{type, position, oldText, newText}`
- Group rapid consecutive character insertions into single operations (debounce by 300ms of inactivity)
- Undo pops the stack and reverses the operation; redo pushes to a redo stack
- Stack depth: 100 operations (configurable)
- Clear redo stack on any new edit after undo

### 4.6 Multi-line Input Expansion (LOW)

**Problem:** When the user creates multi-line input (Shift+Enter), the input area must grow, reducing the visible message history area.

**Mitigation:** Use Ink's Flexbox layout with the input area set to `flexShrink: 0` and the history area set to `flexGrow: 1`. The input area grows up to a maximum height (e.g., 10 lines), after which it scrolls internally. Ink's Yoga engine handles the layout recalculation automatically.

---

## 5. Architecture Sketch

```
+------------------------------------------------------------------+
|  NotebookLM Agent TUI                                            |
+------------------------------------------------------------------+
|                                                                  |
|  +------------------------------ ChatHistory ----------------+   |
|  | [User] What YouTube videos about AI agents are popular?   |   |
|  |                                                           |   |
|  | [Agent] I'll search YouTube for that.                     |   |
|  |   > Calling search_youtube... (spinner)                   |   |
|  |                                                           |   |
|  | [Agent] Here are the top results:                         |   |
|  |   1. "Building AI Agents" - 1.2M views                   |   |
|  |   2. "Agent Development Kit" - 500K views                 |   |
|  +-----------------------------------------------------------+   |
|                                                                  |
|  +--------------------------- StatusBar ----------------------+   |
|  | Status: idle | Session: abc123 | Shortcuts: Ctrl+? help   |   |
|  +-----------------------------------------------------------+   |
|                                                                  |
|  +--------------------------- InputArea ----------------------+   |
|  | > Tell me more about the first video|                      |   |
|  +-----------------------------------------------------------+   |
+------------------------------------------------------------------+

Data Flow:
                                                                    
  User Input -----> useKeyHandler -----> useTextEditor (state)     
       |                                       |                    
       |                              InputArea re-render           
       |                                                            
       +-- Enter --> useAgent.sendMessage(text)                     
                           |                                        
                    InMemoryRunner.runAsync()                       
                           |                                        
                    for await (event) {                             
                      if (text part) -> append to ChatHistory       
                      if (tool call) -> show ToolCallIndicator      
                      if (tool result) -> update indicator          
                    }                                               
```

### Component Hierarchy

```
<App>                          # Root: sets up InMemoryRunner, session
  <Box flexDirection="column" height="100%">
    <ChatHistory              # flexGrow=1, scrollable
      messages={messages}
      scrollOffset={scrollOffset}
    >
      <Message role="user" />
      <Message role="agent" />
      <ToolCallIndicator />
    </ChatHistory>
    
    <StatusBar                # height=1, fixed
      status={agentStatus}
      sessionId={sessionId}
    />
    
    <InputArea                # flexShrink=0, 1-10 lines
      value={inputText}
      cursor={cursorPos}
      selection={selection}
      onSubmit={handleSubmit}
    />
  </Box>
</App>
```

### Key Module Responsibilities

| Module | Responsibility |
|--------|---------------|
| `tui/index.tsx` | App setup: `import 'dotenv/config'`, create `InMemoryRunner`, create session, render `<App>` |
| `hooks/useAgent.ts` | Wraps `runner.runAsync()`, processes event stream, manages message list and agent status |
| `hooks/useTextEditor.ts` | Full text editing state: cursor position, selection, text buffer, undo/redo stack, kill ring |
| `hooks/useKeyHandler.ts` | Maps raw key events to editing actions (50+ shortcut mappings) |
| `hooks/useInputHistory.ts` | Up/Down arrow recall of previous inputs |
| `lib/text-buffer.ts` | Core data structure: text content, cursor, selection range, insert/delete/replace operations |
| `lib/word-boundaries.ts` | macOS-style word boundary detection (whitespace + punctuation, not camelCase) |
| `lib/kill-ring.ts` | Circular buffer of killed text for Ctrl+K/W/U + Ctrl+Y yanking |
| `components/ChatHistory.tsx` | Virtualized scrollable list of messages with Markdown rendering (optional) |
| `components/InputArea.tsx` | Renders text buffer with cursor and selection highlighting |
| `components/StatusBar.tsx` | Single-line status display |
| `components/ToolCallIndicator.tsx` | Animated spinner with tool name |
| `components/Message.tsx` | Single message: role label, content, timestamp |

---

## 6. Risk Assessment

### High Risk

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| **Cmd+key not detectable** | Certain (for non-Kitty terminals) | High -- many spec shortcuts rely on Cmd | Revise spec to make Ctrl/Emacs bindings primary; Cmd via Kitty protocol as enhancement |
| **execFileSync freezes UI** | Certain | High -- UI unresponsive during tool calls | Worker thread or async tool conversion |
| **Custom TextInput complexity** | Likely | High -- 50+ shortcuts is substantial engineering | Phased implementation: basic editing first, then word nav, then selection, then undo |

### Medium Risk

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| **Terminal escape sequence variance** | Likely | Medium -- some shortcuts may not work in all terminals | Test in Terminal.app, iTerm2, Kitty, Alacritty; provide compatibility matrix |
| **Ink performance with long sessions** | Possible | Medium -- many messages could slow rendering | Virtualized message list (only render visible messages) |
| **ADK event stream structure undocumented** | Possible | Medium -- tool call detection may need experimentation | Inspect event objects at runtime; the codebase scan confirms `event.content?.parts` pattern |

### Low Risk

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| **Ink library breaking changes** | Unlikely | Low -- pin version | Pin to Ink 7.x in package.json |
| **React overhead / startup time** | Unlikely | Low -- 3s requirement is generous | Ink + React loads in <1s typically |
| **Memory usage exceeding 200MB** | Unlikely | Low -- text-based UI is lightweight | Monitor with `process.memoryUsage()` in dev |

---

## 7. Technical Research Guidance

Research needed: **Yes** -- targeted research on three specific topics.

### Topic 1: ADK Event Stream Structure

- **Why**: The codebase scan confirms `InMemoryRunner.runAsync()` works, but the exact event object structure for detecting tool calls vs text responses vs streaming chunks needs verification. The existing research doc (`docs/research/adk-typescript-api.md`) covers the basic pattern but not event field inspection.
- **Focus**: 
  - What fields exist on events yielded by `runAsync()`? (`event.content`, `event.functionCalls`, `event.functionResponses`, `event.partial`)
  - How to distinguish "agent is thinking" from "agent is responding with text" from "agent is calling a tool"
  - Whether streaming partial text events are supported (vs only complete responses)
  - How to cancel an in-progress agent run (for Ctrl+C handling)
- **Depth**: Medium -- inspect `@google/adk` TypeScript type definitions and write a small test script to log event structure.

### Topic 2: Ink Kitty Keyboard Protocol Behavior

- **Why**: The Kitty keyboard protocol is critical for full modifier key support, but its behavior in Ink 7 with various macOS terminals needs practical verification.
- **Focus**:
  - Which exact key combinations are distinguishable with Kitty protocol enabled in iTerm2?
  - Does `key.meta` in Ink's `useInput` correctly report Option+Arrow when Kitty protocol is active?
  - Does `key.super` report Cmd+key when iTerm2 is configured to map Cmd to Super?
  - What is the graceful degradation behavior in Terminal.app (which does not support Kitty protocol)?
  - Shift+Enter detection: does Ink with Kitty protocol distinguish it from plain Enter?
- **Depth**: Medium -- write a small Ink test app that logs all key events and test in iTerm2, Terminal.app, and Kitty.

### Topic 3: Ink Layout and Scrolling for Chat Interface

- **Why**: The chat history area needs to be scrollable (keyboard and mouse), support virtualization for long sessions, and coexist with a dynamically-sized input area. Ink's layout capabilities for this specific pattern need verification.
- **Focus**:
  - How to implement a scrollable region in Ink (Box with overflow handling)
  - Whether Ink supports mouse scroll events for the history area
  - How to implement virtualized rendering (only render visible messages) in Ink
  - How the Flexbox layout behaves when the input area grows from 1 to 10 lines
  - How terminal resize (SIGWINCH) affects Ink's layout recalculation
- **Depth**: Shallow -- Ink's layout is well-documented; a quick prototype should confirm the approach.

### Topic 4: Clipboard Integration on macOS

- **Why**: The spec requires Cmd+C/V/X clipboard operations, but terminal apps cannot directly access the macOS clipboard except through specific mechanisms.
- **Focus**:
  - How Ink's `usePaste` hook works (bracketed paste mode) -- does it capture Cmd+V paste in all terminals?
  - Can the TUI programmatically copy text to the macOS clipboard using `pbcopy` (spawning a subprocess)?
  - How does OSC 52 (terminal clipboard escape sequence) work for programmatic clipboard access?
  - Does iTerm2 support OSC 52 for both copy and paste?
- **Depth**: Shallow -- the approach is known (OSC 52 + pbcopy fallback); just needs confirmation in target terminals.

---

## 8. Appendix: Terminal Escape Sequence Reference

### macOS Terminal Key Encoding Summary

| Key Combination | Terminal.app | iTerm2 (Esc+ mode) | iTerm2 (Kitty protocol) | Kitty / Alacritty |
|----------------|-------------|-------------------|----------------------|------------------|
| **Left Arrow** | `ESC[D` | `ESC[D` | `CSI 1u` with key=D | `CSI 1u` with key=D |
| **Option+Left** | `ESC b` | `ESC b` | `CSI 1;3D` (Alt+Left) | `CSI 1;3D` |
| **Option+Right** | `ESC f` | `ESC f` | `CSI 1;3C` (Alt+Right) | `CSI 1;3C` |
| **Shift+Left** | `ESC[1;2D` | `ESC[1;2D` | `CSI 1;2D` | `CSI 1;2D` |
| **Shift+Option+Left** | varies | `ESC[1;10D` | `CSI 1;4D` (Shift+Alt) | `CSI 1;4D` |
| **Ctrl+A** | `0x01` | `0x01` | `CSI 97;5u` (Ctrl+a) | `CSI 97;5u` |
| **Enter** | `0x0D` | `0x0D` | `CSI 13u` | `CSI 13u` |
| **Shift+Enter** | `0x0D` (same!) | `0x0D` (same!) | `CSI 13;2u` (distinguished!) | `CSI 13;2u` |
| **Cmd+Left** | NOT sent | NOT sent | `CSI 1;9D` (Super+Left)* | `CSI 1;9D`* |
| **Cmd+C** | Intercepted (copy) | Intercepted (copy) | Intercepted** | Intercepted** |

\* Only if terminal is configured to send Cmd as Super modifier
\** Cmd+C/V/X are almost always intercepted by the terminal for native copy/paste

### Kitty Protocol Modifier Encoding

Modifier bits (value = 1 + sum of bits):
| Bit | Modifier |
|-----|----------|
| 1 | Shift |
| 2 | Alt/Option |
| 4 | Ctrl |
| 8 | Super/Cmd |
| 16 | Hyper |
| 32 | Meta |
| 64 | Caps Lock |
| 128 | Num Lock |

Example: Shift+Alt+Left Arrow = `CSI 1;4D` (modifiers = 1 + Shift(1) + Alt(2) = 4)

---

## 9. Appendix: ADK Integration Pattern

Based on the codebase scan and existing research docs:

```typescript
// tui/index.tsx - simplified entry point pattern
import 'dotenv/config';
import { InMemoryRunner } from '@google/adk';
import { createUserContent } from '@google/genai';
import { rootAgent } from '../notebooklm_agent/agent.ts';

const runner = new InMemoryRunner({ agent: rootAgent });
const session = await runner.sessionService.createSession({
  appName: runner.appName,
  userId: 'tui-user',
});

// In the useAgent hook:
async function* sendMessage(text: string) {
  for await (const event of runner.runAsync({
    userId: session.userId,
    sessionId: session.id,
    newMessage: createUserContent(text),
  })) {
    // Detect event type:
    if (event.content?.parts?.length) {
      // Text response (may be partial/streaming)
      yield { type: 'text', content: event.content };
    }
    // Tool call detection (needs verification - see Research Topic 1):
    // if (event.functionCalls?.length) { yield { type: 'tool_call', ... }; }
    // if (event.functionResponses?.length) { yield { type: 'tool_result', ... }; }
  }
}
```

---

## 10. Appendix: Comparison with Claude Code's Approach

Claude Code's terminal UI validates the Ink-based approach and provides useful reference points:

| Aspect | Claude Code | Our TUI |
|--------|-------------|---------|
| **Framework** | Custom Ink fork | Standard Ink 7 (start simple, fork if needed) |
| **Keyboard protocol** | CSIu / Kitty with fallback | Kitty protocol via `kittyKeyboard: {mode: 'auto'}` |
| **Text input** | Custom `useTextInput` hook | Custom `useTextEditor` hook (similar scope) |
| **Layout engine** | Yoga (full TS rewrite) | Yoga (via Ink's built-in) |
| **Rendering** | Custom screen buffer diffing | Ink's built-in rendering (sufficient for our needs) |
| **React Compiler** | Yes | No (unnecessary for our scope) |
| **Complexity** | Very high (general-purpose dev tool) | Moderate (single-purpose chat interface) |

Our TUI is significantly simpler than Claude Code -- we have a fixed layout (history + status + input) rather than Claude Code's dynamic multi-panel interface. Standard Ink 7 should suffice without needing a custom fork.
