# Refined Request: Terminal User Interface (TUI) for NotebookLM Agent

## 1. Title and Summary

**Title:** NotebookLM Agent Terminal User Interface (TUI)

**Summary:** Build a custom terminal-based chat interface for the NotebookLM ADK agent that replaces the default `npx adk web` and `npx adk run` entry points. The TUI must provide a conversational chat experience with the agent while fully respecting macOS text-editing keyboard conventions -- including word/line navigation, selection, deletion shortcuts, and Emacs-style keybindings -- so that the input area behaves identically to a native macOS text field.

---

## 2. Functional Requirements

### FR-1: Chat Interface Layout
The TUI shall present a two-region layout:
- **Message history area** (scrollable) -- displays the conversation between the user and the agent, distinguishing user messages from agent responses visually (e.g., alignment, color, prefix).
- **Input area** (multi-line capable) -- a text input region at the bottom where the user composes messages.

### FR-2: Message Submission
- Pressing **Enter** (without Shift) sends the current input to the agent.
- Pressing **Shift+Enter** inserts a newline in the input area (multi-line input support).

### FR-3: Agent Integration
- The TUI shall invoke the NotebookLM ADK agent programmatically (importing and calling the agent's `run` or equivalent method from `notebooklm_agent/agent.ts`), not by spawning a subprocess.
- The TUI shall stream agent responses token-by-token as they arrive (if ADK supports streaming), or display the complete response once available.

### FR-4: Conversation History Display
- User messages and agent responses shall be displayed with clear visual distinction (different colors, labels, or formatting).
- The message history shall be scrollable (mouse scroll and/or keyboard: Page Up / Page Down / Shift+Page Up / Shift+Page Down).
- Long agent responses shall word-wrap within the terminal width.

### FR-5: Tool Call Visibility
- When the agent invokes a tool (YouTube search, filesystem operation, etc.), the TUI shall display an indication that a tool call is in progress (e.g., a spinner or status line showing "Calling search_youtube...").
- Tool call results may optionally be shown in a collapsed/summarized form.

### FR-6: Input History
- The TUI shall maintain a per-session input history.
- **Up Arrow** (when cursor is on the first line of input) recalls the previous input.
- **Down Arrow** (when cursor is on the last line of input) navigates forward in history.

### FR-7: Graceful Exit
- **Ctrl+C** shall cancel the current agent operation (if running) or exit the TUI (if idle).
- **Ctrl+D** on an empty input line shall exit the TUI.
- A `/quit` or `/exit` command shall also exit.

### FR-8: Status Bar
- A status bar shall display at minimum: connection/agent status (idle, thinking, tool call), current session info.

### FR-9: Slash Commands
- `/clear` -- clear the message history display.
- `/quit` or `/exit` -- exit the TUI.
- `/help` -- display available commands and keyboard shortcuts.

### FR-10: Terminal Resize Handling
- The TUI shall respond to terminal resize events (SIGWINCH) and re-render the layout correctly.

---

## 3. macOS Keyboard Navigation Requirements

This is the core differentiating requirement. The input area must behave exactly as a native macOS text field. Every shortcut below must be implemented.

### 3.1 Cursor Movement

| Shortcut | Behavior |
|---|---|
| **Left Arrow** | Move cursor one character left |
| **Right Arrow** | Move cursor one character right |
| **Up Arrow** | Move cursor one line up (or recall history if on first line) |
| **Down Arrow** | Move cursor one line down (or navigate history forward if on last line) |
| **Option+Left Arrow** | Move cursor one word left (to beginning of previous word) |
| **Option+Right Arrow** | Move cursor one word right (to end of next word) |
| **Cmd+Left Arrow** | Move cursor to beginning of current line |
| **Cmd+Right Arrow** | Move cursor to end of current line |
| **Cmd+Up Arrow** | Move cursor to beginning of input (document start) |
| **Cmd+Down Arrow** | Move cursor to end of input (document end) |
| **Home** | Move cursor to beginning of current line |
| **End** | Move cursor to end of current line |
| **Ctrl+A** | Move cursor to beginning of line (Emacs) |
| **Ctrl+E** | Move cursor to end of line (Emacs) |
| **Ctrl+F** | Move cursor one character forward (Emacs) |
| **Ctrl+B** | Move cursor one character backward (Emacs) |
| **Ctrl+N** | Move cursor to next line (Emacs) |
| **Ctrl+P** | Move cursor to previous line (Emacs) |

### 3.2 Text Selection

| Shortcut | Behavior |
|---|---|
| **Shift+Left Arrow** | Extend selection one character left |
| **Shift+Right Arrow** | Extend selection one character right |
| **Shift+Up Arrow** | Extend selection one line up |
| **Shift+Down Arrow** | Extend selection one line down |
| **Shift+Option+Left Arrow** | Extend selection one word left |
| **Shift+Option+Right Arrow** | Extend selection one word right |
| **Shift+Cmd+Left Arrow** | Extend selection to beginning of line |
| **Shift+Cmd+Right Arrow** | Extend selection to end of line |
| **Shift+Cmd+Up Arrow** | Extend selection to beginning of input |
| **Shift+Cmd+Down Arrow** | Extend selection to end of input |
| **Shift+Home** | Extend selection to beginning of line |
| **Shift+End** | Extend selection to end of line |
| **Cmd+A** | Select all text in input area |

### 3.3 Deletion

| Shortcut | Behavior |
|---|---|
| **Backspace (Delete)** | Delete character before cursor (or delete selection) |
| **Delete (Fn+Backspace)** | Delete character after cursor (or delete selection) |
| **Option+Backspace** | Delete word backward (from cursor to beginning of previous word) |
| **Option+Delete (Fn+Option+Backspace)** | Delete word forward (from cursor to end of next word) |
| **Cmd+Backspace** | Delete from cursor to beginning of line |
| **Cmd+Delete** | Delete from cursor to end of line |
| **Ctrl+H** | Delete character before cursor (Emacs backspace) |
| **Ctrl+D** | Delete character after cursor (Emacs; only when input is non-empty; Ctrl+D on empty input exits) |
| **Ctrl+K** | Kill from cursor to end of line (cut to kill ring/clipboard) |
| **Ctrl+W** | Delete word backward |
| **Ctrl+U** | Delete from cursor to beginning of line |

### 3.4 Text Manipulation

| Shortcut | Behavior |
|---|---|
| **Ctrl+T** | Transpose characters -- swap the two characters surrounding the cursor and advance cursor |
| **Ctrl+O** | Open line -- insert a newline after the cursor without moving the cursor |
| **Ctrl+Y** | Yank -- paste the last killed text (from Ctrl+K / Ctrl+W / Ctrl+U kill ring) |

### 3.5 Clipboard Operations

| Shortcut | Behavior |
|---|---|
| **Cmd+C** | Copy selected text to system clipboard |
| **Cmd+V** | Paste from system clipboard at cursor position (replacing selection if any) |
| **Cmd+X** | Cut selected text to system clipboard |
| **Cmd+Z** | Undo last edit |
| **Cmd+Shift+Z** | Redo last undone edit |

### 3.6 Scrolling (Message History Area)

| Shortcut | Behavior |
|---|---|
| **Page Up** | Scroll message history up one page |
| **Page Down** | Scroll message history down one page |
| **Cmd+Home** or **Fn+Cmd+Up Arrow** | Scroll to top of message history |
| **Cmd+End** or **Fn+Cmd+Down Arrow** | Scroll to bottom of message history |
| **Mouse scroll** | Scroll message history (if terminal supports mouse events) |

### 3.7 Word Boundary Behavior

Word boundaries must follow macOS conventions:
- Words are delimited by whitespace, punctuation, and camelCase/snake_case boundaries should NOT be treated as word boundaries (matching macOS behavior).
- Option+Arrow skips over contiguous whitespace/punctuation to reach the next alphabetic/numeric word.
- Delimiters: spaces, tabs, newlines, and punctuation characters (`.,;:!?'"()[]{}/<>@#$%^&*-+=~\`|`).

### 3.8 Selection Behavior

- Typing any printable character while text is selected replaces the selection.
- Arrow keys without Shift deselect and place cursor at the appropriate edge of the former selection.
- Backspace/Delete with an active selection deletes the selection (regardless of which delete variant).

---

## 4. Non-Functional Requirements

### NFR-1: Performance
- Input latency must be imperceptible (<16ms from keypress to screen update).
- Agent response rendering must not block the input area; the user shall be able to type while a response is streaming.

### NFR-2: Terminal Compatibility
- Must work in macOS Terminal.app, iTerm2, Alacritty, Kitty, and Warp.
- Must handle 256-color and true-color terminals gracefully (with fallback to 16-color).
- Must support terminal widths from 80 to 300+ columns.
- Minimum terminal height: 24 rows.

### NFR-3: No External Runtime Dependencies
- Must run under Node.js (same runtime as the rest of the project).
- May use npm packages for terminal rendering (e.g., blessed, ink, terminal-kit, or raw ANSI).
- Must not require Python, Go, Rust, or any non-Node.js runtime.

### NFR-4: Startup Time
- The TUI must launch and be ready for input within 3 seconds on a modern Mac.

### NFR-5: Memory
- Memory usage should remain under 200MB for typical sessions (excluding agent/LLM overhead).

### NFR-6: Accessibility
- All functionality must be accessible via keyboard alone (no mouse requirement).

---

## 5. Acceptance Criteria

### AC-1: Basic Chat Flow
- User can launch the TUI, type a message, press Enter, and receive a response from the NotebookLM agent displayed in the history area.

### AC-2: Multi-line Input
- User can press Shift+Enter to create multi-line input, and the input area expands to accommodate.

### AC-3: macOS Word Navigation
- Option+Left/Right moves the cursor word-by-word. Option+Backspace deletes the previous word. Verified in at least two terminals (Terminal.app and iTerm2).

### AC-4: macOS Line Navigation
- Cmd+Left moves to line start, Cmd+Right to line end. Cmd+Backspace deletes to line start.

### AC-5: Text Selection
- Shift+Arrow selects text character-by-character. Shift+Option+Arrow selects word-by-word. Selected text is visually highlighted. Typing replaces selection.

### AC-6: Clipboard Integration
- Cmd+C copies selected text to macOS clipboard. Cmd+V pastes from macOS clipboard. Pasted text correctly inserts at cursor and replaces selection.

### AC-7: Emacs Keybindings
- Ctrl+A, Ctrl+E, Ctrl+K, Ctrl+W, Ctrl+T, Ctrl+Y all function as specified.

### AC-8: Undo/Redo
- Cmd+Z undoes the last text change. Cmd+Shift+Z redoes it.

### AC-9: Tool Call Indication
- When the agent calls a tool, the TUI displays an indicator (e.g., spinner with tool name). The indicator disappears when the tool call completes.

### AC-10: History Scrolling
- Page Up/Down scrolls through the conversation history. The user can scroll up while the agent is responding.

### AC-11: Terminal Resize
- Resizing the terminal window causes the TUI to re-layout correctly without crashes or rendering artifacts.

### AC-12: Graceful Exit
- Ctrl+C during an agent operation cancels it. Ctrl+D on empty input exits. `/quit` exits.

---

## 6. Constraints

### C-1: Language
- Must be implemented in TypeScript, consistent with the rest of the project.

### C-2: ADK Integration
- Must integrate with Google ADK `@google/adk` ^0.6.1 programmatically (import the agent, invoke it via ADK's runner API -- not by spawning `npx adk run` as a subprocess).

### C-3: Module System
- Must use ES modules (`"type": "module"` in package.json), matching the project.

### C-4: Configuration
- Must load environment variables from `.env` (same as the existing agent: API keys for YouTube, Google AI, etc.).
- Must not introduce its own fallback/default values for configuration. Missing config must throw.

### C-5: Build Tooling
- Must be runnable via `npx tsx` (for development) and compilable with `tsc`.
- Must integrate as a new npm script in `package.json` (e.g., `"tui": "npx tsx notebooklm_agent/tui.ts"`).

### C-6: Platform
- macOS is the primary and required platform. Linux and Windows compatibility are nice-to-have but not required.

---

## 7. Out of Scope

- **Web-based UI** -- this is strictly a terminal interface.
- **Authentication flows** -- the TUI assumes environment variables / `.env` are already configured.
- **Agent logic changes** -- the agent's tools, prompts, and capabilities remain unchanged; the TUI is purely a new frontend.
- **Persistent conversation storage** -- conversations are session-only (no database, no file-based history between sessions).
- **Multi-user / remote access** -- the TUI runs locally for a single user.
- **Voice input / output** -- text only.
- **Image rendering in terminal** -- agent responses containing image references are displayed as text/URLs only.
- **Custom theming / color scheme configuration** -- a single well-chosen color scheme is sufficient for v1.
- **Plugin / extension system** -- no plugin architecture for the TUI itself.

---

## 8. Open Questions

### OQ-1: ADK Programmatic API
How does `@google/adk` ^0.6.1 expose its runner for programmatic use? The current entry points are `npx adk web` and `npx adk run`. We need to determine:
- Can we import and call the agent directly (e.g., `import { Runner } from '@google/adk'` or similar)?
- Does ADK support streaming responses programmatically?
- If ADK only supports CLI/web modes, do we need to wrap the CLI with a pseudo-terminal, or can we use ADK's internal APIs?

### OQ-2: Terminal Library Choice
Which Node.js terminal UI library should be used? Candidates:
- **blessed / neo-blessed** -- mature, full-featured terminal UI toolkit.
- **ink** -- React-based terminal UI (may be overkill; JSX overhead).
- **terminal-kit** -- lower-level, good keyboard handling.
- **Raw ANSI + readline** -- maximum control, most implementation effort.

The choice impacts how much of the keyboard handling we implement ourselves vs. relying on the library. This needs investigation.

### OQ-3: Terminal Modifier Key Detection
macOS terminals encode Option+Arrow and Cmd+Arrow as escape sequences. The exact sequences vary by terminal emulator and its configuration (e.g., iTerm2's "Option key sends Esc+" setting). We need to determine:
- Which escape sequences correspond to each shortcut in Terminal.app, iTerm2, Alacritty, Kitty, and Warp.
- Whether a normalization layer is needed to unify these across terminals.
- Whether Cmd+key shortcuts are even detectable in all terminals (Cmd is often intercepted by the terminal emulator itself -- e.g., Cmd+C may be intercepted by iTerm2 for copy rather than passed to the application).

### OQ-4: Cmd+Key Interception
In most terminal emulators, Cmd+key combinations are consumed by the terminal application itself (e.g., Cmd+C = copy in iTerm2, Cmd+V = paste in Terminal.app). This means:
- Cmd+C, Cmd+V, Cmd+X may not be detectable by the TUI application.
- Should the TUI rely on the terminal's native clipboard handling for Cmd+C/V/X and only implement Ctrl-based alternatives?
- Or should the TUI document that users must configure their terminal to pass Cmd+key to the application?

### OQ-5: Undo/Redo Complexity
Implementing full undo/redo (Cmd+Z / Cmd+Shift+Z) for a text input area is non-trivial. Questions:
- What granularity of undo? Per-character, per-word, per-action (paste, delete-word, etc.)?
- How deep should the undo stack be?
- Is this a v1 requirement or can it be deferred?

### OQ-6: Multi-line Input Expansion
When the user types multi-line input (via Shift+Enter), how should the input area expand?
- Fixed maximum height (e.g., 10 lines) with internal scrolling?
- Dynamic height that shrinks the message history area?
- What is the maximum input size the TUI should support?

### OQ-7: Markdown Rendering
Should agent responses be rendered with Markdown formatting (bold, italic, code blocks, lists) in the terminal, or displayed as plain text? Markdown rendering adds visual quality but also complexity and dependency.
