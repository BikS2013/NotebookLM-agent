# Ink Layout and Scrolling for Chat Interface

**Research Date:** 2026-04-11
**Researcher:** Claude Agent
**Status:** Complete
**Ink Version Targeted:** 7.x (requires Node.js 22, React 19.2+)

---

## Overview

This document covers Ink's layout model, scrolling implementation patterns, mouse event handling, terminal resize behavior, and the specific patterns needed for a three-region chat interface (status bar / scrollable history / input area). The research is scoped to Ink 7, the current major version, which introduced `useWindowSize`, `useBoxMetrics`, `usePaste`, `alternateScreen`, `incrementalRendering`, and `useAnimation`.

Ink is React rendered to a terminal. It uses [Yoga](https://github.com/facebook/yoga) (Facebook's Flexbox engine) as its layout engine. Every `<Box>` is implicitly a flex container -- the mental model is identical to `<div style="display: flex">` in the browser.

---

## Key Concepts

### The Yoga / Flexbox Model

Yoga is a cross-platform implementation of the CSS Flexbox specification. Ink exposes it through `<Box>` props.

**Critical mental model differences from the browser:**

| Browser | Ink / Terminal |
|---------|----------------|
| Pixels | Character cells (columns x rows) |
| `display: flex` is opt-in | Every `<Box>` is always a flex container |
| Overflow is automatic (scrollbar, scroll events) | Overflow is clip-only (`hidden`); no native scroll |
| Percentage dimensions work on any element | Percentages require explicit parent dimensions |
| The viewport is the browser window | The viewport is `process.stdout.rows` x `process.stdout.columns` |
| Resize is a CSS media query concern | Resize is a `SIGWINCH` signal; handled via `useWindowSize` |

**All text must be wrapped in `<Text>`.** Raw strings inside `<Box>` throw an error.

```tsx
// WRONG - throws
<Box>Hello world</Box>

// CORRECT
<Box><Text>Hello world</Text></Box>
```

**`<Box>` cannot be nested inside `<Text>`.** Text can only contain text nodes and other `<Text>` components.

---

## Installation and Setup

```bash
npm install ink react
npm install --save-dev @types/react
```

`tsconfig.json` must include:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "esModuleInterop": true
  }
}
```

---

## Core `<Box>` Layout Properties

### Dimensions

```tsx
// Fixed size (character cells)
<Box width={40} height={10}>...</Box>

// Percentage of parent (parent must have explicit dimensions)
<Box width="50%" height="100%">...</Box>

// Min/Max constraints
<Box minHeight={3} maxHeight={10}>...</Box>
```

### Flex Properties for Chat Layout

```tsx
// flexGrow: take all remaining space (like flex: 1 in CSS)
<Box flexGrow={1}>...</Box>

// flexShrink: prevent shrinking below intrinsic size
<Box flexShrink={0}>...</Box>

// flexDirection: column stacking (critical for vertical layouts)
<Box flexDirection="column">...</Box>
```

### Overflow (Clipping Only -- No Native Scroll)

```tsx
// overflow="hidden" clips content -- it does NOT scroll.
// You must implement scrolling manually in userland.
<Box overflow="hidden" height={20}>
  {/* Content taller than 20 rows is simply cut off */}
</Box>

// Separate axes
<Box overflowX="hidden" overflowY="hidden">...</Box>
```

### Position and Borders

```tsx
// Absolute positioning (for overlays, status indicators)
<Box position="absolute" top={0} right={0}>
  <Text>Status</Text>
</Box>

// Borders
<Box borderStyle="single" borderColor="cyan">...</Box>
// borderStyle values: "single" | "double" | "round" | "bold" |
//                     "singleDouble" | "doubleSingle" | "classic"

// Ink 7: independent border background color
<Box borderStyle="round" borderColor="white" borderBackgroundColor="blue">
  ...
</Box>
```

---

## Ink 7 Hooks Reference

### `useWindowSize` -- Terminal Dimensions

Returns current terminal size. Re-renders automatically when the terminal is resized (SIGWINCH).

```tsx
import { Text, useWindowSize } from 'ink';

const Example = () => {
  const { columns, rows } = useWindowSize();
  return <Text>{columns}x{rows}</Text>;
};
```

**Note:** When the terminal is resized narrower, ghost lines may briefly appear depending on the terminal emulator's reflow behavior. This is a terminal behavior outside Ink's control.

### `useBoxMetrics` -- Per-Element Layout Metrics

Returns the measured dimensions and position of a specific `<Box>`. Updates on resize, sibling changes, and content changes. Critical for computing the visible line count of the scrollable history area.

```tsx
import { useRef } from 'react';
import { Box, Text, useBoxMetrics } from 'ink';

const Example = () => {
  const ref = useRef(null);
  const { width, height, left, top, hasMeasured } = useBoxMetrics(ref);

  return (
    <Box ref={ref}>
      <Text>
        {hasMeasured ? `${width}x${height} at ${left},${top}` : 'Measuring...'}
      </Text>
    </Box>
  );
};
```

**Returns `{width: 0, height: 0, left: 0, top: 0}` until the first layout pass.** Use `hasMeasured` to guard against the initial zero values.

### `useStdout` -- Raw Stdout Access

Exposes the stdout stream. Useful for alternate-screen setup, direct writes, and attaching to resize events (see `ink-scroll-view` pattern).

```tsx
import { useStdout } from 'ink';

const Example = () => {
  const { stdout, write } = useStdout();

  // stdout.rows, stdout.columns -- current dimensions
  // write(string) -- write above Ink's output without conflict
  return null;
};
```

### `useInput` -- Keyboard Input Handler

The primary mechanism for all keyboard interactions including scroll navigation.

```tsx
import { useInput } from 'ink';

useInput((input, key) => {
  // input: string -- the character(s) typed
  // key.upArrow, key.downArrow, key.leftArrow, key.rightArrow
  // key.return, key.escape, key.tab, key.backspace, key.delete
  // key.ctrl, key.shift, key.meta (Alt/Option), key.tab
  // key.pageUp, key.pageDown, key.home, key.end
  // key.super (Cmd/Win, requires Kitty protocol)
  // key.eventType ('press' | 'repeat' | 'release', requires Kitty)
}, { isActive: boolean });
```

### `usePaste` -- Clipboard Paste Handler

Ink 7: Activates bracketed paste mode so pasted text arrives as a single string, not individual keystrokes.

```tsx
import { usePaste } from 'ink';

usePaste((text) => {
  // Called with the full pasted string, including newlines
  appendToInput(text);
}, { isActive: true });
```

**`usePaste` and `useInput` operate on separate channels.** Pasted text is never forwarded to `useInput` when `usePaste` is active.

### `useAnimation` -- Frame-Based Animation

Ink 7: Drives spinners and other animations without separate timers. All animated components share a single timer.

```tsx
import { Text, useAnimation } from 'ink';

const Spinner = () => {
  const { frame } = useAnimation({ interval: 80 });
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  return <Text>{frames[frame % frames.length]}</Text>;
};
```

### `useFocus` and `useFocusManager` -- Focus Management

```tsx
import { useFocus, useFocusManager } from 'ink';

// In a component -- makes it focusable via Tab
const { isFocused } = useFocus({ autoFocus: false, id: 'history' });

// Programmatic focus control
const { focus, activeId, focusNext, focusPrevious } = useFocusManager();
focus('history'); // focus by ID
```

---

## Chat Layout Structure

### The Three-Region Layout

```
+------------------------------------------------------------------+
| StatusBar (height=1, flexShrink=0)                               |
+------------------------------------------------------------------+
| ChatHistory (flexGrow=1, overflow="hidden")                      |
|   Message...                                                     |
|   Message...                                                     |
|   Message...                                                     |
+------------------------------------------------------------------+
| InputArea (flexShrink=0, height 1-10 lines)                      |
+------------------------------------------------------------------+
```

**Key insight:** The layout order in the component tree determines rendering order top-to-bottom. Put `StatusBar` first, `ChatHistory` in the middle with `flexGrow={1}`, and `InputArea` last with `flexShrink={0}`.

### Complete Layout Skeleton

```tsx
import React, { useEffect } from 'react';
import { render, Box, Text, useWindowSize } from 'ink';

// Alternate screen buffer -- hides terminal scrollback, restores on exit.
// Ink 7 provides this as a built-in render() option (preferred over manual):
//   render(<App />, { alternateScreen: true })
// Manual approach (for custom teardown logic):
const enterAltScreen = '\x1b[?1049h';
const leaveAltScreen = '\x1b[?1049l';

function AltScreen({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    process.stdout.write(enterAltScreen);
    return () => { process.stdout.write(leaveAltScreen); };
  }, []);
  return <>{children}</>;
}

function App() {
  const { rows } = useWindowSize();

  return (
    <AltScreen>
      {/* Root box must have explicit height=rows to constrain the layout */}
      <Box flexDirection="column" height={rows}>

        {/* 1. Status bar -- fixed 1-line height */}
        <StatusBar />

        {/* 2. Chat history -- takes all remaining space */}
        <Box flexGrow={1} overflow="hidden">
          <ChatHistory />
        </Box>

        {/* 3. Input area -- grows with content, never shrinks below 1 line */}
        <InputArea />

      </Box>
    </AltScreen>
  );
}

render(<App />, {
  alternateScreen: true,          // Ink 7 built-in
  incrementalRendering: true,     // Only redraw changed lines
  kittyKeyboard: { mode: 'auto' } // Enable Kitty protocol where supported
});
```

**Why `height={rows}` on the root box?**
Without an explicit height constraint, Yoga has no anchor for percentage heights or `flexGrow` calculations. The Yoga algorithm needs to know the total available space in the column direction. `useWindowSize().rows` provides the current terminal height and re-renders automatically when the terminal is resized.

**Why `alternateScreen: true`?**
The alternate screen buffer prevents the chat UI from polluting the terminal's scrollback history. When the app exits (normally or via crash), the terminal is restored to its original state. Ink 7 handles this natively -- use the `render()` option rather than manual ANSI sequences unless you need custom teardown logic.

**Why `incrementalRendering: true`?**
Ink 7 added incremental rendering, which only redraws changed lines instead of the entire output. For a chat interface where only the input area updates on each keystroke, this reduces flickering and CPU overhead significantly.

---

## Scrollable Chat History: Implementation Patterns

### Pattern 1: Pure Manual Windowing (Recommended for Chat)

Ink has no native `<ScrollView>`. The `overflow="hidden"` property clips content but does not scroll. The standard pattern is manual windowing: maintain a `scrollOffset` state and render only the visible slice of messages.

For a chat interface, messages have variable heights (multi-line agent responses, tool call blocks). This requires tracking per-message heights.

```tsx
import React, { useState, useRef, useCallback } from 'react';
import { Box, Text, useInput, useBoxMetrics } from 'ink';

interface Message {
  id: string;
  role: 'user' | 'agent';
  content: string;
  // Pre-computed line count. For dynamic computation, use useBoxMetrics.
  lineCount: number;
}

interface ChatHistoryProps {
  messages: Message[];
}

export function ChatHistory({ messages }: ChatHistoryProps) {
  const containerRef = useRef(null);
  const { height: containerHeight, hasMeasured } = useBoxMetrics(containerRef);

  // scrollOffset: number of lines scrolled from the bottom.
  // 0 = showing the most recent messages (bottom).
  const [scrollOffset, setScrollOffset] = useState(0);

  // Total content height in lines
  const totalLines = messages.reduce((sum, m) => sum + m.lineCount, 0);

  // Compute which messages are visible
  // We scroll from the bottom: offset 0 = bottom of content.
  const visibleLines = hasMeasured ? containerHeight : 20; // fallback during first paint
  const scrollFromTop = Math.max(0, totalLines - visibleLines - scrollOffset);

  // Build visible message list from the scrollFromTop position
  const visibleMessages = computeVisibleMessages(messages, scrollFromTop, visibleLines);

  const canScrollUp = scrollOffset < totalLines - visibleLines;
  const canScrollDown = scrollOffset > 0;

  useInput((_, key) => {
    if (key.upArrow) {
      setScrollOffset(prev => Math.min(prev + 1, Math.max(0, totalLines - visibleLines)));
    }
    if (key.downArrow) {
      setScrollOffset(prev => Math.max(0, prev - 1));
    }
    if (key.pageUp) {
      setScrollOffset(prev => Math.min(prev + visibleLines, Math.max(0, totalLines - visibleLines)));
    }
    if (key.pageDown) {
      setScrollOffset(prev => Math.max(0, prev - visibleLines));
    }
  });

  // Auto-scroll to bottom when new messages arrive (if already at bottom)
  // (In practice: reset scrollOffset to 0 when a new message is added,
  // unless the user has manually scrolled up.)

  return (
    <Box ref={containerRef} flexDirection="column" flexGrow={1} overflow="hidden">
      {canScrollUp && (
        <Text dimColor> ^ {scrollOffset} lines above (PgUp to scroll)</Text>
      )}
      {visibleMessages.map(msg => (
        <Message key={msg.id} message={msg} />
      ))}
      {canScrollDown && (
        <Text dimColor> v {scrollOffset} lines below (PgDn to scroll)</Text>
      )}
    </Box>
  );
}

// Helper: slice messages to fit within visibleLines from scrollFromTop
function computeVisibleMessages(
  messages: Message[],
  scrollFromTop: number,
  visibleLines: number
): Message[] {
  let skipped = 0;
  let accumulated = 0;
  const result: Message[] = [];

  for (const msg of messages) {
    if (skipped + msg.lineCount <= scrollFromTop) {
      skipped += msg.lineCount;
      continue;
    }
    if (accumulated >= visibleLines) break;
    result.push(msg);
    accumulated += msg.lineCount;
  }
  return result;
}
```

**Important caveat about `lineCount`:** For pure windowing to work, you need to know how many terminal lines each message occupies. This depends on the message content length, text wrapping at the terminal width, and the presence of borders/margins. For production use, you either:
1. Pre-compute line counts using `Math.ceil(content.length / terminalWidth)` (approximate, ignores ANSI codes and word wrap)
2. Use `ink-scroll-view` which measures actual rendered heights using a virtual DOM pass

### Pattern 2: `<Static>` Component (Append-Only Chat History)

For a chat interface where messages never change after being added, `<Static>` is a perfect fit. It permanently renders its output above the dynamic content (the input area) and only processes new items -- previously rendered items are never re-rendered.

```tsx
import React, { useState } from 'react';
import { render, Static, Box, Text, useInput } from 'ink';

interface Message {
  id: string;
  role: 'user' | 'agent';
  content: string;
}

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');

  useInput((input, key) => {
    if (key.return && inputText.trim()) {
      // Add user message
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'user',
        content: inputText,
      }]);
      setInputText('');
    } else if (key.backspace) {
      setInputText(prev => prev.slice(0, -1));
    } else if (input && !key.ctrl && !key.meta) {
      setInputText(prev => prev + input);
    }
  });

  return (
    <Box flexDirection="column">
      {/* Static: renders each new message once, permanently above dynamic area */}
      <Static items={messages}>
        {(msg) => (
          <Box key={msg.id} flexDirection="column" marginBottom={1}>
            <Text color={msg.role === 'user' ? 'green' : 'cyan'} bold>
              [{msg.role}]
            </Text>
            <Text wrap="wrap">{msg.content}</Text>
          </Box>
        )}
      </Static>

      {/* Dynamic: input area updates on every keystroke */}
      <Box borderStyle="single" borderColor="gray" paddingX={1}>
        <Text color="green">&gt; </Text>
        <Text>{inputText}</Text>
        <Text inverse> </Text>{/* cursor */}
      </Box>
    </Box>
  );
}
```

**`<Static>` tradeoffs:**

| Pro | Con |
|-----|-----|
| Zero re-render cost for history | No scrollback -- history scrolls with terminal |
| Very simple implementation | Cannot update previously rendered messages (streaming text won't work for agent responses) |
| Infinite history at zero memory cost | Cannot implement "scroll up to see history" (uses terminal scrollback instead) |

**Recommendation:** `<Static>` works well only if agent responses arrive as complete messages. For streaming responses (where the agent is still writing), you must keep the in-progress message in the dynamic area and only move it to `<Static>` when complete.

### Pattern 3: `ink-scroll-view` (Recommended for Variable-Height Content)

`ink-scroll-view` is a community package that handles variable-height content measurement automatically. It renders all children but shifts them using `marginTop` and clips with `overflow="hidden"`, avoiding the need to pre-compute line heights.

```bash
npm install ink-scroll-view
```

```tsx
import React, { useRef, useEffect } from 'react';
import { Box, useInput, useStdout } from 'ink';
import { ScrollView, ScrollViewRef } from 'ink-scroll-view';

function ChatHistory({ messages }: { messages: Message[] }) {
  const scrollRef = useRef<ScrollViewRef>(null);
  const { stdout } = useStdout();

  // Required: remeasure when terminal is resized
  useEffect(() => {
    const handleResize = () => scrollRef.current?.remeasure();
    stdout?.on('resize', handleResize);
    return () => { stdout?.off('resize', handleResize); };
  }, [stdout]);

  useInput((_, key) => {
    if (key.upArrow) scrollRef.current?.scrollBy(-1);
    if (key.downArrow) scrollRef.current?.scrollBy(1);
    if (key.pageUp) {
      const h = scrollRef.current?.getViewportHeight() ?? 10;
      scrollRef.current?.scrollBy(-h);
    }
    if (key.pageDown) {
      const h = scrollRef.current?.getViewportHeight() ?? 10;
      scrollRef.current?.scrollBy(h);
    }
  });

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    scrollRef.current?.scrollToBottom();
  }, [messages.length]);

  return (
    <Box flexGrow={1} overflow="hidden">
      <ScrollView ref={scrollRef}>
        {messages.map(msg => (
          <Message key={msg.id} message={msg} />
        ))}
      </ScrollView>
    </Box>
  );
}
```

**How `ink-scroll-view` works internally:**
It renders all children into a container and shifts content vertically using `marginTop` to implement the scroll offset. The parent box with `overflow="hidden"` acts as the viewport. Auto-measurement uses a virtual DOM pass to determine actual rendered heights before clipping.

**Limitation:** Because all children are rendered (not virtualized), very long sessions (thousands of messages) will eventually degrade performance. For the NotebookLM agent use case (tens to hundreds of messages per session), this is not a concern.

---

## Dynamic Input Area: Growing from 1 to 10 Lines

The input area must grow as the user types multi-line content (Shift+Enter) and shrink when lines are deleted.

### Flexbox Behavior for the Input Expansion

The key layout properties:
- Input area: `flexShrink={0}` -- prevents the input area from being compressed by the history area
- History area: `flexGrow={1}` -- takes all remaining space after fixed elements claim theirs
- Root box: `height={rows}` -- sets the total height budget

When the input area grows by one line, Yoga recalculates:
- Total height budget = `rows`
- Subtract: `statusBar.height` (1 line)
- Subtract: `inputArea.height` (grows from 1 to N lines)
- Remainder assigned to: `chatHistory` (shrinks automatically)

```tsx
function InputArea({ lines }: { lines: string[] }) {
  const inputHeight = Math.min(lines.length, 10); // cap at 10 lines

  return (
    <Box
      flexDirection="column"
      flexShrink={0}
      height={inputHeight + 2} // +2 for border
      borderStyle="single"
      borderColor="cyan"
      paddingX={1}
    >
      {lines.map((line, i) => (
        <Text key={i}>{line}</Text>
      ))}
    </Box>
  );
}
```

**Height computation note:** If you use `borderStyle`, the border consumes 2 rows (top and bottom). A 10-line input area with a border needs `height={12}`. If you use `paddingY`, that adds to the height too. The layout math must account for all chrome.

**Alternative: let Yoga compute height naturally.** If you do not set an explicit `height` on the input area and only set `flexShrink={0}`, Yoga computes the height from the content. This works but the input area may grow without bound if content height is not explicitly limited.

```tsx
// Height computed from content, capped with maxHeight
<Box
  flexDirection="column"
  flexShrink={0}
  maxHeight={12} // max 10 lines + 2 border
  overflow="hidden"
  borderStyle="single"
>
  {lines.map((line, i) => <Text key={i}>{line}</Text>)}
</Box>
```

---

## Mouse Event Handling

### Mouse Scroll via `useInput` (Ink 7 -- Experimental)

Ink 7 exposes mouse scroll events through `useInput` when the terminal supports mouse tracking:

```tsx
useInput((input, key) => {
  // Mouse scroll events arrive here when mouse tracking is active
  if ((key as any).mouse) {
    const mouse = (key as any).mouse;
    // mouse.button: 'none' (scroll), 'left', 'right', 'middle'
    // mouse.x, mouse.y: cursor position (1-indexed)
    // Scroll up: mouse.button === 'none' and check raw input for direction
  }
});
```

**Important limitation:** Mouse scroll detection via `useInput` requires the terminal to have mouse tracking enabled. The standard ANSI X10 mouse protocol sends `\x1b[M` followed by button/position bytes. Ink 7 does not expose a stable `useMouse` hook -- the mouse data arrives in the raw input stream and must be parsed from the `key.mouse` object.

### `@zenobius/ink-mouse` -- Community Mouse Package

For full mouse support (clicks, hover, drag, scroll), use the `@zenobius/ink-mouse` package:

```bash
npm install @zenobius/ink-mouse
```

```tsx
import { MouseProvider, useOnMouseClick, useOnMouseHover, useMouse } from '@zenobius/ink-mouse';
import { useRef } from 'react';
import { Box, useInput } from 'ink';

function App() {
  return (
    // Required: MouseProvider must wrap the component tree
    <MouseProvider>
      <ChatHistory />
    </MouseProvider>
  );
}

function ChatHistory() {
  const ref = useRef(null);
  const mouse = useMouse();

  // CRITICAL: useInput must be active to consume escape codes.
  // Without it, mouse movement escape sequences print to the terminal.
  useInput((input, key) => {
    if (key.return) mouse.toggle(); // Example: toggle mouse tracking
  });

  useOnMouseClick(ref, (isClicking) => {
    // isClicking: boolean -- true on press, false on release
    if (isClicking) handleClick();
  });

  return (
    <Box ref={ref} flexGrow={1} overflow="hidden">
      {/* chat messages */}
    </Box>
  );
}
```

**Mouse scroll tracking note:** `@zenobius/ink-mouse` handles position, click, hover, and drag. Scroll wheel events in terminals are encoded as button 64 (scroll up) and button 65 (scroll down) in the SGR mouse protocol. As of 2026, the library's scroll detection should be verified against its current README -- the scroll behavior may require the SGR extended mouse mode (`\x1b[?1006h`).

**`useInput` must be active alongside mouse tracking.** Without `useInput`, the raw mouse escape sequences (e.g., `\x1b[M` bytes) are printed directly to the terminal as garbled characters.

### Practical Recommendation for the Chat Interface

For the NotebookLM agent chat interface, the scroll interaction is expected to be primarily keyboard-driven (arrow keys, Page Up/Down). Mouse scroll is a nice-to-have. Given this:

1. **Phase 1:** Implement keyboard scroll only via `useInput` + manual windowing or `ink-scroll-view`. This covers 95% of use cases.
2. **Phase 2 (optional):** Add `@zenobius/ink-mouse` for mouse scroll wheel support. Wrap the entire app in `<MouseProvider>` and map scroll events to the same `scrollBy` calls.

---

## Terminal Resize Handling

### Automatic via `useWindowSize`

The preferred approach: use `useWindowSize` to read `rows` and `columns` and pass them to the layout. Ink re-renders automatically when the terminal is resized (SIGWINCH).

```tsx
function App() {
  const { rows, columns } = useWindowSize();

  // Pass rows to the root box -- Yoga recalculates the entire layout
  return (
    <Box flexDirection="column" height={rows}>
      <StatusBar width={columns} />
      <ChatHistory />
      <InputArea maxWidth={columns} />
    </Box>
  );
}
```

**This is sufficient for most cases.** Yoga recalculates flexGrow/flexShrink proportions whenever `rows` changes, so all three regions resize correctly without any explicit resize logic.

### Manual Resize Events for `ink-scroll-view`

`ink-scroll-view` measures child heights during initialization. When the terminal is resized, those measurements become stale (because a narrower terminal wraps text more, increasing line counts). The library provides a `remeasure()` method to re-trigger measurement:

```tsx
const { stdout } = useStdout();

useEffect(() => {
  const handleResize = () => {
    scrollRef.current?.remeasure();
  };
  stdout?.on('resize', handleResize);
  return () => { stdout?.off('resize', handleResize); };
}, [stdout]);
```

### Manual Resize via `useBoxMetrics`

`useBoxMetrics` updates automatically on resize. If you need to know the exact pixel-level height of the history area (to compute visible line count for windowing), attach it to the container ref:

```tsx
const containerRef = useRef(null);
const { height: historyHeight, hasMeasured } = useBoxMetrics(containerRef);

// historyHeight is updated automatically on every resize
const visibleLineCount = hasMeasured ? historyHeight : 20;
```

### Ghost Lines on Resize (Known Ink Behavior)

When the terminal is resized **narrower**, ghost lines may appear briefly. This is the terminal emulator's reflow behavior, not an Ink bug. There is no workaround -- the ghost lines clear on the next render cycle.

---

## `render()` API Options Relevant to Chat Interface

```tsx
render(<App />, {
  // Render in alternate screen (restores terminal on exit)
  alternateScreen: true,

  // Only redraw changed lines (reduces flicker for streaming text)
  incrementalRendering: true,

  // Enable Kitty keyboard protocol for modifier key disambiguation
  kittyKeyboard: {
    mode: 'auto', // 'auto' | 'enabled' | 'disabled'
    flags: ['disambiguateEscapeCodes', 'reportEventTypes'],
  },

  // Cap re-render rate (useful if agent streams many tokens/second)
  maxFps: 30,

  // Intercept console.log so it doesn't corrupt Ink's output
  patchConsole: true,

  // Ctrl+C exits the app
  exitOnCtrlC: true,
});
```

**`alternateScreen: true` vs manual ANSI:**
The Ink 7 `alternateScreen` option handles teardown correctly even on crash -- it restores the primary screen as part of unmount. Manual ANSI sequences (`\x1b[?1049h`) will leave the terminal in the alternate buffer if the process crashes without running cleanup. Prefer the built-in option.

**`incrementalRendering: true` for streaming:**
When the agent is streaming tokens, the chat history re-renders on every token append. Without incremental rendering, Ink redraws the entire output on each frame. With it, only the changed lines are redrawn. For a chat interface, this eliminates the "flicker" visible during fast streaming.

---

## Full Chat Interface Example

A complete, annotated implementation of the three-region layout:

```tsx
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { render, Box, Text, useInput, usePaste, useWindowSize,
         useBoxMetrics, useAnimation, Static } from 'ink';

// ============================================================
// Types
// ============================================================

interface Message {
  id: string;
  role: 'user' | 'agent';
  content: string;
  isStreaming?: boolean;
}

// ============================================================
// StatusBar Component (fixed 1-line header)
// ============================================================

interface StatusBarProps {
  status: 'idle' | 'thinking' | 'streaming' | 'error';
  sessionId: string;
}

function StatusBar({ status, sessionId }: StatusBarProps) {
  const { frame } = useAnimation({ interval: 100, isActive: status === 'thinking' });
  const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  const spinner = spinnerFrames[frame % spinnerFrames.length];

  const statusText = {
    idle: '● Ready',
    thinking: `${spinner} Thinking`,
    streaming: '▶ Streaming',
    error: '✗ Error',
  }[status];

  const statusColor = {
    idle: 'green',
    thinking: 'yellow',
    streaming: 'cyan',
    error: 'red',
  }[status] as string;

  return (
    <Box
      flexShrink={0}
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
      justifyContent="space-between"
    >
      <Text color={statusColor}>{statusText}</Text>
      <Text dimColor>Session: {sessionId.slice(0, 8)}</Text>
      <Text dimColor>Ctrl+C quit  |  PgUp/PgDn scroll</Text>
    </Box>
  );
}

// ============================================================
// ChatHistory Component (scrollable, flexGrow=1)
// ============================================================

interface ChatHistoryProps {
  messages: Message[];
  // completedMessages: messages whose content will never change
  // streamingMessage: the current in-progress agent response (if any)
}

function ChatHistory({ messages }: ChatHistoryProps) {
  const containerRef = useRef(null);
  const { height: containerHeight, hasMeasured } = useBoxMetrics(containerRef);
  const [scrollOffset, setScrollOffset] = useState(0);
  const { columns } = useWindowSize();

  // Estimate line count for each message (approximate)
  // For production: use ink-scroll-view for accurate measurement
  const getLineCount = useCallback((msg: Message): number => {
    const contentWidth = columns - 4; // account for margin/padding
    const lines = msg.content.split('\n');
    return lines.reduce((total, line) => {
      return total + Math.max(1, Math.ceil(line.length / contentWidth));
    }, 0) + 2; // +2 for role label and blank line
  }, [columns]);

  const visibleHeight = hasMeasured ? containerHeight : 20;
  const totalLines = messages.reduce((sum, m) => sum + getLineCount(m), 0);
  const maxScrollOffset = Math.max(0, totalLines - visibleHeight);

  // Auto-scroll to bottom when new messages arrive,
  // unless the user has manually scrolled up.
  const isAtBottom = scrollOffset === 0;
  const prevMessageCount = useRef(messages.length);
  useEffect(() => {
    if (messages.length > prevMessageCount.current && isAtBottom) {
      setScrollOffset(0); // stay at bottom
    }
    prevMessageCount.current = messages.length;
  }, [messages.length, isAtBottom]);

  useInput((_, key) => {
    if (key.upArrow) {
      setScrollOffset(prev => Math.min(prev + 1, maxScrollOffset));
    }
    if (key.downArrow) {
      setScrollOffset(prev => Math.max(0, prev - 1));
    }
    if (key.pageUp) {
      setScrollOffset(prev => Math.min(prev + visibleHeight, maxScrollOffset));
    }
    if (key.pageDown) {
      setScrollOffset(prev => Math.max(0, prev - visibleHeight));
    }
  });

  // Compute which messages to show
  const scrollFromTop = Math.max(0, totalLines - visibleHeight - scrollOffset);
  let skipped = 0;
  let shown = 0;
  const visibleMessages: Message[] = [];
  for (const msg of messages) {
    const lc = getLineCount(msg);
    if (skipped + lc <= scrollFromTop) { skipped += lc; continue; }
    if (shown >= visibleHeight) break;
    visibleMessages.push(msg);
    shown += lc;
  }

  return (
    <Box ref={containerRef} flexDirection="column" flexGrow={1} overflow="hidden">
      {scrollOffset > 0 && (
        <Text dimColor>  ↑ Scrolled {scrollOffset} lines back  (PgDn / ↓ to go forward)</Text>
      )}
      {visibleMessages.map(msg => (
        <Box key={msg.id} flexDirection="column" marginBottom={1}>
          <Text
            bold
            color={msg.role === 'user' ? 'green' : 'cyan'}
          >
            {msg.role === 'user' ? 'You' : 'Agent'}
            {msg.isStreaming ? ' ▌' : ''}
          </Text>
          <Text wrap="wrap">{msg.content}</Text>
        </Box>
      ))}
      {scrollOffset === 0 && messages.length === 0 && (
        <Box flexGrow={1} alignItems="center" justifyContent="center">
          <Text dimColor>Type a message and press Enter to begin.</Text>
        </Box>
      )}
    </Box>
  );
}

// ============================================================
// InputArea Component (dynamic height, flexShrink=0)
// ============================================================

interface InputAreaProps {
  lines: string[];      // Multi-line content, split by \n
  cursorLine: number;   // Which line the cursor is on
  cursorCol: number;    // Column position of the cursor
  isDisabled: boolean;  // True while agent is responding
}

function InputArea({ lines, cursorLine, cursorCol, isDisabled }: InputAreaProps) {
  // Height = content lines + 2 (border top + bottom)
  // Capped at 12 (10 content lines + 2 border)
  const contentHeight = Math.min(lines.length, 10);
  const totalHeight = contentHeight + 2;

  const borderColor = isDisabled ? 'gray' : 'cyan';

  return (
    <Box
      flexDirection="column"
      flexShrink={0}
      height={totalHeight}
      borderStyle="single"
      borderColor={borderColor}
      paddingX={1}
      overflow="hidden"
    >
      {isDisabled ? (
        <Text dimColor>Waiting for agent response... (Ctrl+C to cancel)</Text>
      ) : (
        lines.slice(0, 10).map((line, lineIdx) => {
          // Render cursor as a highlighted character
          const isCursorLine = lineIdx === cursorLine;
          if (!isCursorLine) {
            return <Text key={lineIdx}>{line || ' '}</Text>;
          }
          const before = line.slice(0, cursorCol);
          const at = line[cursorCol] ?? ' ';
          const after = line.slice(cursorCol + 1);
          return (
            <Text key={lineIdx}>
              {before}
              <Text inverse>{at}</Text>
              {after}
            </Text>
          );
        })
      )}
    </Box>
  );
}

// ============================================================
// Root App
// ============================================================

function App() {
  const { rows } = useWindowSize();
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputLines, setInputLines] = useState(['']);
  const [cursorLine, setCursorLine] = useState(0);
  const [cursorCol, setCursorCol] = useState(0);
  const [agentStatus, setAgentStatus] = useState<'idle' | 'thinking' | 'streaming'>('idle');
  const sessionId = 'demo-session-1234';

  usePaste((text) => {
    // Paste the text at cursor position
    const newLines = [...inputLines];
    const pastedLines = text.split('\n');
    // Insert first pasted line at cursor
    const currentLine = newLines[cursorLine] ?? '';
    newLines[cursorLine] =
      currentLine.slice(0, cursorCol) + pastedLines[0] +
      (pastedLines.length === 1 ? currentLine.slice(cursorCol) : '');
    // Insert subsequent pasted lines
    if (pastedLines.length > 1) {
      const remainder = currentLine.slice(cursorCol);
      newLines.splice(cursorLine + 1, 0, ...pastedLines.slice(1));
      newLines[cursorLine + pastedLines.length - 1] += remainder;
      setCursorLine(cursorLine + pastedLines.length - 1);
      setCursorCol(pastedLines[pastedLines.length - 1].length);
    } else {
      setCursorCol(cursorCol + pastedLines[0].length);
    }
    setInputLines(newLines);
  });

  // (Full keyboard handler omitted -- see investigation-terminal-ui.md
  //  for the 50+ shortcut mapping. Key patterns below.)
  useInput((input, key) => {
    if (key.return && !key.shift) {
      // Submit
      const text = inputLines.join('\n').trim();
      if (text && agentStatus === 'idle') {
        setMessages(prev => [...prev, { id: Date.now().toString(), role: 'user', content: text }]);
        setInputLines(['']);
        setCursorLine(0);
        setCursorCol(0);
        // Trigger agent... (see useAgent hook)
      }
      return;
    }
    // Shift+Enter: insert newline
    if (key.return && key.shift) {
      const newLines = [...inputLines];
      const current = newLines[cursorLine];
      const before = current.slice(0, cursorCol);
      const after = current.slice(cursorCol);
      newLines.splice(cursorLine, 1, before, after);
      setInputLines(newLines);
      setCursorLine(cursorLine + 1);
      setCursorCol(0);
      return;
    }
    // ... full key handler implementation goes here
  }, { isActive: agentStatus === 'idle' });

  return (
    <Box flexDirection="column" height={rows}>
      <StatusBar status={agentStatus} sessionId={sessionId} />
      <ChatHistory messages={messages} />
      <InputArea
        lines={inputLines}
        cursorLine={cursorLine}
        cursorCol={cursorCol}
        isDisabled={agentStatus !== 'idle'}
      />
    </Box>
  );
}

render(<App />, {
  alternateScreen: true,
  incrementalRendering: true,
  kittyKeyboard: { mode: 'auto' },
  maxFps: 30,
});
```

---

## Best Practices

### Layout

1. **Always set `height={rows}` on the root `<Box>`.** Without it, `flexGrow` has no total height to distribute. Read rows from `useWindowSize()` so the constraint updates on resize.

2. **Use `flexShrink={0}` on the input area and status bar.** This prevents Yoga from compressing them to make room for the history area. Only the history area should ever change size.

3. **Use `overflow="hidden"` on the history container.** Without it, content that overflows the box is printed to the terminal below the UI, corrupting the layout.

4. **Do not set `height` on the `flexGrow={1}` history container.** Let Yoga compute it from the remaining space. Setting an explicit height overrides `flexGrow`.

5. **Account for borders and padding in height math.** A border adds 2 rows (top + bottom). A `paddingY={1}` adds 2 rows. If your input area has `borderStyle` and `height={inputLines + 2}`, the 2 accounts for the border.

### Scrolling

6. **For production, use `ink-scroll-view` over manual windowing.** Manual windowing requires accurate line-count predictions, which are hard to compute correctly for wrapped text with ANSI codes. `ink-scroll-view` measures actual heights.

7. **Always call `remeasure()` when the terminal is resized** (for `ink-scroll-view`). Text wraps differently at different terminal widths, so cached line heights become incorrect.

8. **Auto-scroll to bottom only when the user is at the bottom.** Track whether the user has manually scrolled up (`scrollOffset > 0`) and skip auto-scroll in that case. Forcing auto-scroll while the user is reading history is a serious UX problem.

9. **Show scroll indicators.** When there is content above or below the viewport, display an indicator (e.g., `↑ N lines above`). Terminal users cannot see scrollbars.

### Rendering

10. **Enable `incrementalRendering: true` for streaming UIs.** When the agent is streaming tokens, the chat history re-renders every few frames. Incremental rendering prevents full-screen flicker.

11. **Use `maxFps: 30` to cap update rate.** At 30fps, a streaming agent token update costs ~33ms of rendering budget per frame. Higher FPS values increase CPU usage with diminishing visual returns.

12. **Use `<Static>` for completed messages if you don't need scrollback.** For the append-only chat pattern (never edit previous messages), `<Static>` is dramatically more efficient: completed messages are never re-rendered.

13. **Use `useAnimation` for spinners instead of `setInterval`.** All animation hooks share a single timer, avoiding N separate timers for N concurrent spinners.

---

## Common Pitfalls

### Pitfall 1: Raw Text in `<Box>`

```tsx
// WRONG -- throws: "Text string must be rendered inside <Text> component"
<Box>Hello world</Box>

// CORRECT
<Box><Text>Hello world</Text></Box>
```

### Pitfall 2: `<Box>` Inside `<Text>`

```tsx
// WRONG -- throws
<Text>Hello <Box><Text>world</Text></Box></Text>

// CORRECT
<Box><Text>Hello </Text><Text bold>world</Text></Box>
```

### Pitfall 3: Expecting `overflow="hidden"` to Scroll

```tsx
// WRONG mental model -- overflow="hidden" clips, it does NOT scroll
<Box height={10} overflow="hidden">
  {Array.from({ length: 100 }, (_, i) => <Text key={i}>Line {i}</Text>)}
</Box>
// Only lines 0-9 are shown. There is no way to scroll to lines 10-99
// without implementing scroll state manually.
```

### Pitfall 4: Percentage Dimensions Without Parent Constraints

```tsx
// WRONG -- what is 50% of? Yoga doesn't know.
<Box width="50%">...</Box>

// CORRECT -- parent has explicit width, or use useWindowSize
const { columns } = useWindowSize();
<Box width={columns} flexDirection="row">
  <Box width="50%">Left</Box>
  <Box width="50%">Right</Box>
</Box>
```

### Pitfall 5: Not Cleaning Up Alternate Screen on Crash

```tsx
// WRONG -- crashes leave terminal in alternate screen buffer
useEffect(() => {
  process.stdout.write('\x1b[?1049h');
}, []); // missing cleanup

// CORRECT (manual approach)
useEffect(() => {
  process.stdout.write('\x1b[?1049h');
  return () => { process.stdout.write('\x1b[?1049l'); };
}, []);

// BEST (Ink 7 built-in -- handles crashes too)
render(<App />, { alternateScreen: true });
```

### Pitfall 6: Multiple `useInput` Handlers Conflicting

```tsx
// WRONG -- both handlers receive every keystroke
function Parent() {
  useInput((input) => { console.log('parent:', input); });
  return <Child />;
}
function Child() {
  useInput((input) => { console.log('child:', input); }); // also receives all input
  return null;
}

// CORRECT -- use isActive to disable unused handlers
function Child({ isActive }: { isActive: boolean }) {
  useInput((input) => { ... }, { isActive });
  return null;
}
```

### Pitfall 7: Mouse Escape Codes Printing to Terminal

```tsx
// WRONG -- when using @zenobius/ink-mouse without active useInput
// Mouse movement generates escape sequences that print as garbage
<MouseProvider>
  <MyApp />  // nothing listening to stdin
</MouseProvider>

// CORRECT -- always have an active useInput alongside mouse tracking
function MyApp() {
  useInput(() => {}); // keeps stdin consumed; prevents escape codes printing
  return <MouseProvider>...</MouseProvider>;
}
```

### Pitfall 8: `useBoxMetrics` Returns Zeros on First Render

```tsx
// WRONG -- hasMeasured is false on the first paint, height=0
function ChatHistory() {
  const { height } = useBoxMetrics(ref); // 0 on first render
  const visibleLines = height; // Will be 0!
  ...
}

// CORRECT -- provide a fallback
const { height, hasMeasured } = useBoxMetrics(ref);
const visibleLines = hasMeasured ? height : 20; // 20 line fallback
```

---

## Advanced Topics

### Using `<Static>` with Streaming Agent Responses

The challenge: agent responses arrive as streaming partial text. `<Static>` only accepts completed items. Bridge this with a "pending message" in the dynamic area:

```tsx
function App() {
  const [completedMessages, setCompletedMessages] = useState<Message[]>([]);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);

  return (
    <Box flexDirection="column">
      {/* Completed messages -- never re-rendered */}
      <Static items={completedMessages}>
        {(msg) => <Message key={msg.id} message={msg} />}
      </Static>

      {/* In-progress message -- updates on each token */}
      {pendingMessage !== null && (
        <Box flexDirection="column" marginBottom={1}>
          <Text color="cyan" bold>Agent ▌</Text>
          <Text wrap="wrap">{pendingMessage}</Text>
        </Box>
      )}

      <InputArea />
    </Box>
  );
}
```

When streaming completes, move `pendingMessage` into `completedMessages` and clear `pendingMessage`. The completed messages are then rendered once by `<Static>` and never touched again.

**Tradeoff:** With `<Static>`, there is no scroll-back through history -- the terminal's native scrollback buffer handles it, not Ink. This is acceptable for the NotebookLM use case (the terminal scrollback is fine for reviewing chat history).

### Measuring Text Height Before Rendering

For accurate virtualization without `ink-scroll-view`, estimate line heights:

```tsx
function estimateLineCount(content: string, terminalWidth: number): number {
  const effectiveWidth = terminalWidth - 6; // subtract margins, borders, indentation
  const rawLines = content.split('\n');
  return rawLines.reduce((total, line) => {
    // Account for ANSI escape code length (strip them for width calc)
    const displayWidth = stripAnsi(line).length;
    return total + Math.max(1, Math.ceil(displayWidth / effectiveWidth));
  }, 0);
}
```

For ANSI stripping: use `strip-ansi` package.

### Keyboard Scroll Binding Options

Match scroll bindings to user expectations:

| Key | Action | Notes |
|-----|--------|-------|
| `↑` / `↓` | Scroll 1 line | Primary navigation |
| `PageUp` / `PageDown` | Scroll viewport height | Fast navigation |
| `Home` | Scroll to top | Jump to oldest message |
| `End` | Scroll to bottom | Jump to newest message |
| `Ctrl+U` / `Ctrl+D` | Scroll half viewport | Vim-style |

```tsx
useInput((input, key) => {
  if (key.upArrow) scrollBy(-1);
  if (key.downArrow) scrollBy(1);
  if (key.pageUp) scrollBy(-visibleHeight);
  if (key.pageDown) scrollBy(visibleHeight);
  if (key.home) scrollToTop();
  if (key.end) scrollToBottom();
  if (key.ctrl && input === 'u') scrollBy(-Math.floor(visibleHeight / 2));
  if (key.ctrl && input === 'd') scrollBy(Math.floor(visibleHeight / 2));
});
```

---

## Assumptions and Scope

### Assumptions Made

| Assumption | Confidence | Impact if Wrong |
|------------|------------|-----------------|
| Ink 7 is used (Node.js 22, React 19.2+) | HIGH -- confirmed by investigation doc | Hooks like `useWindowSize`, `useBoxMetrics`, `usePaste` may not be available in Ink 6 |
| Three fixed regions: status bar + history + input | HIGH -- per investigation architecture sketch | More complex layouts would need additional flexbox nesting |
| The chat history uses Ink's output (not terminal scrollback) | MEDIUM -- `<Static>` is an alternative that uses terminal scrollback | If `<Static>` approach is chosen, the manual windowing section is less relevant |
| Messages can be variable height (wrapped text, tool call blocks) | HIGH -- per investigation doc | If messages are always single-line, simple slice-based windowing is trivial |
| `ink-scroll-view` is an acceptable third-party dependency | MEDIUM -- not audited for long-term maintenance | If it's abandoned, manual windowing or a fork is the fallback |
| Mouse scroll is secondary to keyboard scroll | HIGH -- per typical terminal UX | If mouse scroll is primary, more investment in `@zenobius/ink-mouse` is warranted |

### Uncertainties and Gaps

- **`key.mouse` in Ink 7 `useInput`:** Web search mentions `key.mouse` with `mouse.button === 'none'` for scroll events, but the official Ink 7 README does not document this property. It may be from an older version or an undocumented internal. **Confidence: LOW.** Verify against actual Ink 7 type definitions before relying on it.

- **`@zenobius/ink-mouse` scroll detection:** The library's README focuses on click, hover, and drag. Mouse wheel scroll support may require SGR mouse mode (`\x1b[?1006h`). The README's Todo section does not explicitly list scroll as supported. **Confidence: MEDIUM** that it works; needs verification.

- **`ink-scroll-view` maintenance:** The package appears active as of 2025-12, but it has low npm download counts. For a production project, evaluate whether to vendor the approach (copy the `marginTop` + `overflow="hidden"` pattern) rather than depend on it. **Confidence: MEDIUM** it's safe to use short-term.

- **`incrementalRendering` behavior with `flexGrow`:** Incremental rendering (only redraw changed lines) is documented as a render option, but behavior when `flexGrow` causes a layout recalculation (e.g., input area grows) is not explicitly documented. A full-layout recalculation may negate the incremental benefit in those cases. **Confidence: MEDIUM** that it works as described.

### Scope Exclusions

- **Windows support:** Not addressed. Ink works on Windows via Windows Terminal but mouse events, Kitty protocol, and alternate screen may behave differently. This is macOS-only research.
- **Accessibility / screen readers:** Ink 7 has `useIsScreenReaderEnabled()` and `isScreenReaderEnabled` render option, but screen reader support is not researched here.
- **CJK and emoji rendering:** Ink 7 fixed several CJK/emoji bugs. The `useBoxMetrics` and manual line-count estimation code above does not account for wide characters. Use `string-width` package for accurate width calculation.
- **Testing:** Ink has a testing utility (`render` from `ink-testing-library`) not covered here.

### Clarifying Questions for Follow-up

1. **Should chat history use `<Static>` (terminal scrollback) or custom scroll (Ink-managed)?** `<Static>` is dramatically simpler and more efficient, but requires the user to scroll via the terminal's scrollback rather than keyboard bindings inside the app. If the UX requirement is keyboard-controlled scrollback, `<Static>` is not viable.

2. **Are agent responses streamed token-by-token or delivered complete?** If streamed, the `<Static>` + pending message hybrid is the right approach. If complete, pure `<Static>` is sufficient.

3. **What is the expected session length?** For sessions under ~200 messages, any approach works. For sessions with 1000+ messages, virtualization becomes important and `ink-scroll-view`'s "render all children" approach may underperform.

4. **Is mouse scroll a hard requirement or nice-to-have?** If hard requirement, the `@zenobius/ink-mouse` dependency and `<MouseProvider>` wrapper must be planned from the start. If nice-to-have, defer to Phase 2.

5. **Should the alternate screen be used?** The alternate screen prevents history pollution but disables the terminal's native scrollback buffer. If users want to copy-paste from conversation history using the terminal, they cannot with the alternate screen active. Consider whether `alternateScreen: true` is the right default.

---

## References

| # | Source | URL | Information Gathered |
|---|--------|-----|---------------------|
| 1 | Ink README (official, latest) | https://github.com/vadimdemedes/ink/blob/master/readme.md | Full Box API, all hooks (useWindowSize, useBoxMetrics, useInput, usePaste, useAnimation, useFocus, useCursor, useStdout), render() options including alternateScreen, incrementalRendering, kittyKeyboard, maxFps |
| 2 | Ink on npm | https://www.npmjs.com/package/ink | Version info, peer dependencies |
| 3 | Ink GitHub Issues #222 | https://github.com/vadimdemedes/ink/issues/222 | Historical context: native scrolling never added; userland windowing is the established pattern |
| 4 | Combray: Ink TUI Expandable Layouts | https://combray.prose.sh/2025-11-28-ink-tui-expandable-layout | Anti-patterns, complete chat TUI code example, scrollable list pattern, overflow pitfalls |
| 5 | Heise: Ink 7.0 Release | https://www.heise.de/en/news/React-in-the-Terminal-Ink-7-0-fundamentally-revises-input-handling-11249949.html | Ink 7 changes: useWindowSize, usePaste, aspectRatio, alignContent, borderBackgroundColor, hard wrap, key.backspace/delete disambiguation |
| 6 | ink-scroll-view on GitHub | https://github.com/ByteLandTechnology/ink-scroll-view | ScrollView API (ScrollViewRef, scrollBy, scrollToBottom, remeasure, getViewportHeight), architecture (marginTop + overflow="hidden"), resize handling pattern |
| 7 | @zenobius/ink-mouse on GitHub | https://github.com/zenobi-us/ink-mouse | MouseProvider, useOnMouseClick, useOnMouseHover, useMousePosition, useMouse hooks; requirement for active useInput to prevent escape codes printing |
| 8 | Context7 Ink Docs | https://github.com/vadimdemedes/ink | useWindowSize, useBoxMetrics, useInput hook signatures and key object properties |
| 9 | ink-scroll-box on Libraries.io | https://libraries.io/npm/ink-scroll-box | Community package exists at v1.0.2; less documented than ink-scroll-view |
| 10 | fullscreen-ink on npm | https://www.npmjs.com/package/fullscreen-ink | Alternative fullscreen utility using useStdout dimensions |

### Recommended for Deep Reading

- **Ink README** (https://github.com/vadimdemedes/ink/blob/master/readme.md): The authoritative reference. The `render()` options section (alternateScreen, incrementalRendering, kittyKeyboard) is particularly important for the chat interface and is not well-covered in tutorials.
- **ink-scroll-view GitHub** (https://github.com/ByteLandTechnology/ink-scroll-view): The architecture diagram (marginTop + overflow="hidden" approach) and the resize handling example are directly applicable to the ChatHistory component.
- **Combray TUI Article** (https://combray.prose.sh/2025-11-28-ink-tui-expandable-layout): The anti-patterns section is a must-read before writing any Ink layout code. The complete TUI example is a working reference for the exact three-region layout needed.
