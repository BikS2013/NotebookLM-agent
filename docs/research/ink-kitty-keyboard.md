# Ink Kitty Keyboard Protocol: Deep Technical Reference

**Research Date:** 2026-04-11
**Ink Version Studied:** 7.x (master branch, commit from April 2026)
**Scope:** Ink keyboard API internals, Kitty keyboard protocol mechanics, macOS escape sequences, terminal compatibility matrix, practical usage patterns

---

## Overview

Ink 7 exposes keyboard input through the `useInput` hook, which normalizes raw terminal byte streams into structured key event objects. By default, the hook uses legacy terminal encoding — a 1978-era scheme that cannot distinguish Tab from Ctrl+I, Enter from Shift+Enter, or Ctrl from plain keys on punctuation. The Kitty keyboard protocol, activated at render time via `kittyKeyboard: {mode: 'enabled'}`, replaces this with unambiguous CSI `u` sequences that expose the full modifier state (Shift, Ctrl, Alt/Meta, Super/Cmd, Hyper, Caps Lock, Num Lock) and event type (press, repeat, release) on every key.

This document covers:
- The actual TypeScript interfaces from the Ink source
- How the protocol is activated and detected
- Escape sequence encoding for all critical macOS key combinations
- Terminal compatibility across macOS terminals
- Practical code patterns for a terminal UI with 50+ keyboard shortcuts

---

## Key Concepts

### Legacy Terminal Encoding Limitations

The Ctrl modifier works by clearing bits 5 and 6 of the ASCII code (an electrical trick from 1963). This creates irresolvable collisions:

| Physical Key | Byte Sent | Also Sent By |
|---|---|---|
| Tab | `0x09` | Ctrl+I |
| Enter | `0x0D` | Ctrl+M |
| Backspace | `0x7F` | Ctrl+? |
| Escape | `0x1B` | Ctrl+[ |
| Shift+Enter | `0x0D` | plain Enter |
| Ctrl+Enter | `0x0D` | plain Enter |

The Alt/Option modifier prefixes any key with `0x1B` (ESC byte), creating timing-ambiguous sequences that the application must parse with a 50-100ms timeout heuristic.

### The Kitty Protocol Solution

The Kitty keyboard protocol (authored by Kovid Goyal, 2021) encodes every key event as a structured CSI `u` sequence:

```
ESC [ keycode ; modifiers : eventType u
```

Where:
- `keycode` = Unicode code point of the key (Enter = 13, Tab = 9, `a` = 97)
- `modifiers` = 1 + bitmask of active modifiers (see table below)
- `eventType` = 1 (press), 2 (repeat), 3 (release)

The protocol is opt-in: the application activates it by sending `ESC [ > flags u` and deactivates on exit with `ESC [ < u`. A push/pop stack means nested applications (editor inside shell inside tmux) do not interfere with each other.

---

## Ink Keyboard API Interfaces (from source)

### The `Key` Type

Source: `src/hooks/use-input.ts`

```typescript
export type Key = {
  // Arrow keys
  upArrow: boolean;
  downArrow: boolean;
  leftArrow: boolean;
  rightArrow: boolean;

  // Navigation keys
  pageDown: boolean;
  pageUp: boolean;
  home: boolean;
  end: boolean;

  // Action keys
  return: boolean;    // Enter key
  escape: boolean;
  tab: boolean;
  backspace: boolean;
  delete: boolean;    // Forward delete (Fn+Backspace on Mac)

  // Modifier state (available in both legacy and Kitty modes)
  ctrl: boolean;
  shift: boolean;
  meta: boolean;      // Alt/Option key

  // Extended modifiers (Kitty keyboard protocol only)
  super: boolean;     // Cmd on Mac, Win on Windows
  hyper: boolean;     // Hyper key (rarely used)
  capsLock: boolean;  // Caps Lock active
  numLock: boolean;   // Num Lock active

  // Event type (Kitty keyboard protocol only -- undefined in legacy mode)
  eventType?: 'press' | 'repeat' | 'release';
};
```

**Critical distinctions:**
- `key.meta` = Alt/Option key (available in both legacy and Kitty modes for arrow keys)
- `key.super` = Cmd/Command key (**Kitty protocol only**)
- `key.eventType` = press/repeat/release (**Kitty protocol only**)
- `key.shift` on arrow keys = Shift+Arrow (**Kitty protocol only**, unreliable in legacy)

### The `useInput` Hook Signature

```typescript
type Handler = (input: string, key: Key) => void;

type Options = {
  isActive?: boolean; // Default: true
};

const useInput = (inputHandler: Handler, options?: Options): void;
```

**The `input` parameter:**
- Kitty protocol: contains the printable character text for printable keys; empty string for control/function keys
- Legacy mode: contains the raw escape sequence for the key
- For non-printable keys (arrows, function keys, modifier-only), `input` is always empty string

### The `RenderOptions` Type (render configuration)

Source: `src/render.ts`

```typescript
export type RenderOptions = {
  stdout?: NodeJS.WriteStream;          // Default: process.stdout
  stdin?: NodeJS.ReadStream;            // Default: process.stdin
  stderr?: NodeJS.WriteStream;          // Default: process.stderr
  debug?: boolean;                      // Non-replacing output mode
  exitOnCtrlC?: boolean;               // Default: true
  patchConsole?: boolean;              // Default: true
  onRender?: (metrics: RenderMetrics) => void;
  isScreenReaderEnabled?: boolean;
  maxFps?: number;                     // Default: 30
  incrementalRendering?: boolean;      // Default: false
  concurrent?: boolean;               // Default: false (React Concurrent Mode)
  kittyKeyboard?: KittyKeyboardOptions;
  isInteractive?: boolean;            // Override TTY detection
};
```

### The `KittyKeyboardOptions` Type

Source: `src/kitty-keyboard.ts`

```typescript
export type KittyKeyboardOptions = {
  mode?: 'auto' | 'enabled' | 'disabled'; // Default: 'auto'
  flags?: KittyFlagName[];
};

export type KittyFlagName =
  | 'disambiguateEscapeCodes'   // Flag bit 1 — resolves Tab/Ctrl+I collision
  | 'reportEventTypes'          // Flag bit 2 — press/repeat/release events
  | 'reportAlternateKeys'       // Flag bit 4 — shifted variants + base layout
  | 'reportAllKeysAsEscapeCodes' // Flag bit 8 — even plain letters use CSI
  | 'reportAssociatedText';     // Flag bit 16 — Unicode text with key events
```

**Default flags when none specified:** `disambiguateEscapeCodes` only (flag value 1).

---

## Modifier Bitmask Encoding

Source: `src/kitty-keyboard.ts` — `kittyModifiers` constant

The modifier value in the CSI `u` sequence is `1 + sum of active bits`:

| Modifier | Bit Value | Ink Property |
|---|---|---|
| Shift | 1 | `key.shift` |
| Alt/Option | 2 | `key.meta` |
| Ctrl | 4 | `key.ctrl` |
| Super (Cmd/Win) | 8 | `key.super` |
| Hyper | 16 | `key.hyper` |
| Meta | 32 | `key.meta` (OR'd with Alt bit) |
| Caps Lock | 64 | `key.capsLock` |
| Num Lock | 128 | `key.numLock` |

**Examples:**
- Shift alone: `1 + 1 = 2`
- Alt alone: `1 + 2 = 3`
- Shift+Alt: `1 + 1 + 2 = 4`
- Ctrl alone: `1 + 4 = 5`
- Ctrl+Shift: `1 + 4 + 1 = 6`
- Super/Cmd alone: `1 + 8 = 9`
- Shift+Super: `1 + 1 + 8 = 10`

The `parseKittyModifiers()` function in Ink's source maps modifier bits to the `Key` object:

```typescript
// From src/parse-keypress.ts
function parseKittyModifiers(modifiers: number) {
  return {
    ctrl:     !!(modifiers & kittyModifiers.ctrl),     // bit 4
    shift:    !!(modifiers & kittyModifiers.shift),    // bit 1
    meta:     !!(modifiers & (kittyModifiers.meta | kittyModifiers.alt)), // bit 32 OR bit 2
    super:    !!(modifiers & kittyModifiers.super),    // bit 8
    hyper:    !!(modifiers & kittyModifiers.hyper),    // bit 16
    capsLock: !!(modifiers & kittyModifiers.capsLock), // bit 64
    numLock:  !!(modifiers & kittyModifiers.numLock),  // bit 128
  };
}
```

---

## Escape Sequence Tables

### Critical macOS Key Combinations

#### Arrow Keys with Modifiers

| Key Combination | Legacy Sequence | Kitty CSI u Sequence | Ink Key Object |
|---|---|---|---|
| Left Arrow | `ESC[D` | `ESC[1;1:1D` (press) | `key.leftArrow=true` |
| Right Arrow | `ESC[C` | `ESC[1;1:1C` | `key.rightArrow=true` |
| Up Arrow | `ESC[A` | `ESC[1;1:1A` | `key.upArrow=true` |
| Down Arrow | `ESC[B` | `ESC[1;1:1B` | `key.downArrow=true` |
| Shift+Left | `ESC[1;2D` | `ESC[1;2:1D` | `key.leftArrow=true, key.shift=true` |
| Shift+Right | `ESC[1;2C` | `ESC[1;2:1C` | `key.rightArrow=true, key.shift=true` |
| Shift+Up | `ESC[1;2A` | `ESC[1;2:1A` | `key.upArrow=true, key.shift=true` |
| Shift+Down | `ESC[1;2B` | `ESC[1;2:1B` | `key.downArrow=true, key.shift=true` |
| Option+Left | `ESC b` | `ESC[1;3:1D` | `key.leftArrow=true, key.meta=true` |
| Option+Right | `ESC f` | `ESC[1;3:1C` | `key.rightArrow=true, key.meta=true` |
| Option+Up | `ESC[1;3A` | `ESC[1;3:1A` | `key.upArrow=true, key.meta=true` |
| Option+Down | `ESC[1;3B` | `ESC[1;3:1B` | `key.downArrow=true, key.meta=true` |
| Shift+Option+Left | `ESC[1;10D` (varies) | `ESC[1;4:1D` | `key.leftArrow=true, key.shift=true, key.meta=true` |
| Shift+Option+Right | `ESC[1;10C` (varies) | `ESC[1;4:1C` | `key.rightArrow=true, key.shift=true, key.meta=true` |
| Ctrl+Left | `ESC[1;5D` | `ESC[1;5:1D` | `key.leftArrow=true, key.ctrl=true` |
| Ctrl+Right | `ESC[1;5C` | `ESC[1;5:1C` | `key.rightArrow=true, key.ctrl=true` |
| Cmd+Left* | NOT SENT | `ESC[1;9:1D` | `key.leftArrow=true, key.super=true` |
| Cmd+Right* | NOT SENT | `ESC[1;9:1C` | `key.rightArrow=true, key.super=true` |
| Cmd+Up* | NOT SENT | `ESC[1;9:1A` | `key.upArrow=true, key.super=true` |
| Cmd+Down* | NOT SENT | `ESC[1;9:1B` | `key.downArrow=true, key.super=true` |

\* Cmd+Arrow only works with Kitty protocol AND iTerm2/Kitty terminal configured to map Cmd as Super. Most terminals intercept Cmd+Arrow for their own navigation.

#### Enter and Tab Variants

| Key Combination | Legacy Sequence | Kitty CSI u Sequence | Ink Key Object |
|---|---|---|---|
| Enter | `0x0D` (`\r`) | `ESC[13u` | `key.return=true` |
| Shift+Enter | `0x0D` **(same!)** | `ESC[13;2u` | `key.return=true, key.shift=true` |
| Ctrl+Enter | `0x0D` **(same!)** | `ESC[13;5u` | `key.return=true, key.ctrl=true` |
| Alt+Enter | `ESC 0x0D` | `ESC[13;3u` | `key.return=true, key.meta=true` |
| Tab | `0x09` | `ESC[9u` | `key.tab=true` |
| Ctrl+I | `0x09` **(same as Tab!)** | `ESC[105;5u` | `input='i', key.ctrl=true` |
| Shift+Tab | `ESC[Z` | `ESC[9;2u` | `key.tab=true, key.shift=true` |

**Shift+Enter** is the most critical use case: it is **completely indistinguishable from Enter** in legacy mode. Kitty protocol is required.

#### Ctrl+Letter Keys

In legacy mode, Ctrl+letter sends bytes 1-26 (Ctrl+A = `0x01`, Ctrl+Z = `0x1A`). In Kitty mode with `reportAllKeysAsEscapeCodes` flag, they send `ESC[codepoint;5u`.

| Key | Legacy Byte | Kitty Sequence | Ink: `input` | Ink: `key` |
|---|---|---|---|---|
| Ctrl+A | `0x01` | `ESC[97;5u` | `'a'` | `key.ctrl=true` |
| Ctrl+B | `0x02` | `ESC[98;5u` | `'b'` | `key.ctrl=true` |
| Ctrl+C | `0x03` | `ESC[99;5u` | `'c'` | `key.ctrl=true` |
| Ctrl+D | `0x04` | `ESC[100;5u` | `'d'` | `key.ctrl=true` |
| Ctrl+E | `0x05` | `ESC[101;5u` | `'e'` | `key.ctrl=true` |
| Ctrl+F | `0x06` | `ESC[102;5u` | `'f'` | `key.ctrl=true` |
| Ctrl+H | `0x08` | `ESC[104;5u` | `'h'` | `key.ctrl=true` |
| Ctrl+K | `0x0B` | `ESC[107;5u` | `'k'` | `key.ctrl=true` |
| Ctrl+L | `0x0C` | `ESC[108;5u` | `'l'` | `key.ctrl=true` |
| Ctrl+N | `0x0E` | `ESC[110;5u` | `'n'` | `key.ctrl=true` |
| Ctrl+P | `0x10` | `ESC[112;5u` | `'p'` | `key.ctrl=true` |
| Ctrl+U | `0x15` | `ESC[117;5u` | `'u'` | `key.ctrl=true` |
| Ctrl+W | `0x17` | `ESC[119;5u` | `'w'` | `key.ctrl=true` |
| Ctrl+Y | `0x19` | `ESC[121;5u` | `'y'` | `key.ctrl=true` |

Note: In legacy mode, Ink's `parseKeypress` decodes bytes 1-26 as `key.ctrl=true` + `input='letter'` already. Ctrl+letter detection works in both modes.

#### Option+Letter (Alt sequences in legacy mode)

In legacy mode, Option+letter sends `ESC + ASCII(letter)`. Ink's parser matches `metaKeyCodeRe = /^(?:\x1b)([a-zA-Z0-9])$/` and sets `key.meta=true`.

| Key | Legacy Sequence | Kitty Sequence | Ink Result |
|---|---|---|---|
| Option+B | `ESC b` | `ESC[98;3u` | `input='b', key.meta=true` |
| Option+F | `ESC f` | `ESC[102;3u` | `input='f', key.meta=true` |
| Option+D | `ESC d` | `ESC[100;3u` | `input='d', key.meta=true` |
| Option+Backspace | `ESC DEL` | `ESC[127;3u` | `key.backspace=true, key.meta=true` |

**Important:** In legacy mode, `ESC b` and `ESC f` are the standard Option+Left and Option+Right sequences from many macOS terminals (iTerm2 with "Option sends ESC+" mode). The Ink key object will show `input='b'` and `key.meta=true`, NOT `key.leftArrow`. To handle Option+Arrow for word navigation in legacy mode, you must check for `input === 'b' && key.meta` (word back) and `input === 'f' && key.meta` (word forward).

With Kitty protocol active, these same combinations produce `key.leftArrow=true, key.meta=true` instead — a cleaner API.

#### Special Keys

| Key | Legacy Sequence | Kitty Sequence | Ink Key Object |
|---|---|---|---|
| Backspace | `0x7F` | `ESC[127u` | `key.backspace=true` |
| Delete (Fn+Backspace) | `ESC[3~` | `ESC[3u` | `key.delete=true` |
| Escape | `ESC` (0x1B) | `ESC[27u` | `key.escape=true` |
| Home | `ESC[H` or `ESC[1~` | `ESC[1;1:1H` | `key.home=true` |
| End | `ESC[F` or `ESC[4~` | `ESC[1;1:1F` | `key.end=true` |
| Page Up | `ESC[5~` | `ESC[5;1:1~` | `key.pageUp=true` |
| Page Down | `ESC[6~` | `ESC[6;1:1~` | `key.pageDown=true` |
| F1-F4 | `ESC OP`-`ESC OS` | `ESC[P`-`ESC[S` | no dedicated property; check `input` |
| F5+ | `ESC[15~`+ | `ESC[57376u`+ | no dedicated property |

---

## Ink Parsing Internals

### Parser Priority Chain

Source: `src/parse-keypress.ts` — `parseKeypress()` function

When a raw byte string arrives, Ink tries parsers in this order:

1. **`parseKittyKeypress(s)`** — matches `\x1b\[(\d+)(?:;(\d+)(?::(\d+))?(?:;([\d:]+))?)?u$` (standard CSI u)
2. **`parseKittySpecialKey(s)`** — matches `\x1b\[(\d+);(\d+):(\d+)([A-Za-z~])$` (legacy CSI with event type annotation)
3. If neither kitty regex matches but the kitty regex shape is present → returns empty safe keypress
4. **Legacy parser** — handles `\r`, `\n`, `\t`, `\b`, `\x7f`, single control bytes (1-26), metaKeyCodeRe, fnKeyRe

### Legacy fnKeyRe Pattern

The fallback pattern for standard CSI sequences:

```
/^(?:\x1b+)(O|N|\[|\[\[)(?:(\d+)(?:;(\d+))?([~^$])|(?:1;)?(\d+)?([a-zA-Z]))/
```

This matches xterm-style sequences like `ESC[1;2D` (Shift+Left) and decodes the modifier field using the standard xterm modifier bitmask (same bit numbering as Kitty, but with different activation mechanism).

### Printability Detection

Kitty protocol keys are classified as `isPrintable`:
- `codepoint === 32` (space): printable
- `codepoint === 13` (return): printable (produces `'\r'` text)
- `codepoint >= 1 && codepoint <= 26` (Ctrl+letters): **not** printable
- Named keys (Escape, Tab, Backspace, F-keys, arrows, media keys): **not** printable
- All other codepoints (letters, digits, punctuation): printable

Non-printable keys produce `input = ''` in the `useInput` handler. You detect them exclusively via `key` object properties.

---

## Activation and Auto-Detection

### Activation Modes

```typescript
// Recommended: explicit enable (most reliable)
render(<App />, {
  kittyKeyboard: { mode: 'enabled' }
});

// Auto-detect (checks $TERM_PROGRAM, then queries terminal)
render(<App />, {
  kittyKeyboard: { mode: 'auto' }
});

// Force disable
render(<App />, {
  kittyKeyboard: { mode: 'disabled' }
});
```

### Why `mode: 'enabled'` is Preferred Over `'auto'`

The `'auto'` mode uses a heuristic that checks the `$TERM_PROGRAM` environment variable for known terminals (kitty, WezTerm, Ghostty). **This fails inside tmux**, because tmux sets `$TERM = tmux-256color`, not the outer terminal's value. Apps running inside tmux that use `'auto'` will not get the Kitty protocol even if the outer terminal supports it.

Use `mode: 'enabled'`. The terminal either supports it and responds to the protocol query, or does not respond (graceful degradation). There is no risk of breaking terminals that do not understand the activation sequence — they simply ignore it.

**Exception:** If your app will run in terminals that have known bugs with the Kitty protocol (e.g., early WezTerm builds), use `'auto'` as a safety measure.

### Protocol Detection Mechanism

Source: `src/ink.tsx` — `matchKittyQueryResponse()` and `hasCompleteKittyQueryResponse()`

Ink sends `ESC [ ? u` (query current flags) to the terminal on startup. If the terminal supports the protocol, it responds with `ESC [ ? <flags> u`. Ink reads and strips this response from stdin before any user input is processed. If no response arrives within a timeout, Ink falls back to legacy mode.

### Cleanup

Ink automatically deactivates the protocol (sends `ESC [ < u` to pop from the stack) when the app unmounts. This is handled internally — you do not need to write cleanup code unless you are handling abnormal termination (SIGINT, SIGTERM). Ink's signal handling covers normal Ctrl+C exits.

---

## Kitty Protocol Flags: When to Use Each

| Flag | Bit | Use Case |
|---|---|---|
| `disambiguateEscapeCodes` | 1 | **Always use this.** Resolves Tab/Ctrl+I, Enter/Shift+Enter, Escape ambiguity. |
| `reportEventTypes` | 2 | Use for **key held detection** (e.g., animation tied to held key, games). Not needed for text editing. |
| `reportAlternateKeys` | 4 | Use for **international keyboard support** — gives you the base unshifted key alongside the shifted variant. |
| `reportAllKeysAsEscapeCodes` | 8 | Use only if you need plain letter keys in CSI u format. Adds significant parsing overhead. |
| `reportAssociatedText` | 16 | Use for **dead key composition** and IME input. Rarely needed. |

**Recommended configuration for a text editor TUI:**

```typescript
render(<App />, {
  kittyKeyboard: {
    mode: 'enabled',
    flags: ['disambiguateEscapeCodes', 'reportEventTypes'],
  },
});
```

This gives you Shift+Enter distinction, modifier state on all keys, and press/repeat/release events (useful for implementing key-repeat behavior in the text buffer).

---

## Graceful Degradation in Terminal.app

macOS Terminal.app does **not** support the Kitty keyboard protocol and has no plans to add it. It also does not support xterm's `modifyOtherKeys`. When your app runs in Terminal.app:

1. Ink's protocol activation sequence (`ESC [ > 1 u`) is silently ignored
2. Ink detects no protocol response and falls back to legacy mode
3. All key events arrive as legacy byte sequences
4. The `key.super`, `key.hyper`, `key.capsLock`, `key.numLock` fields are always `false`
5. `key.eventType` is always `undefined`

### What Works in Legacy Mode (Terminal.app)

| Feature | Status |
|---|---|
| Plain character input | Works |
| Ctrl+letter shortcuts | Works (bytes 1-26 decoded correctly) |
| Arrow key navigation | Works (`key.leftArrow`, etc.) |
| Tab detection | Works (`key.tab=true`) |
| Option+Arrow as `ESC b`/`ESC f` | Works IF Terminal.app "Use Option as Meta Key" is enabled |
| Backspace / Delete | Works |
| Enter | Works |
| **Shift+Enter** | **Does NOT work — identical to Enter** |
| **Ctrl+I vs Tab** | **Does NOT work — identical** |
| Shift+Arrow (selection) | Works for some terminals (standard CSI sequences) |
| Option/Alt modifier on arrows | Requires "Use Option as Meta Key" in Terminal.app prefs |

### Terminal.app Workaround: "Use Option as Meta Key"

Enable this in Terminal.app: **Terminal > Settings > Profiles > Keyboard > "Use Option as Meta Key"**

This makes Option+Enter send `ESC 0x0D` (distinguishable as `key.return=true, key.meta=true`). It also makes Option+Left/Right send `ESC b` / `ESC f`, which Ink decodes as `input='b'/'f', key.meta=true`.

**Caveat:** This disables the ability to type special characters with Option (like `ñ`, `©`, `™`). Non-English keyboard layouts should use iTerm2, Kitty, Ghostty, or WezTerm instead.

---

## Terminal Compatibility Matrix

Support status as of April 2026:

| Terminal | Kitty Protocol | Config Required | `key.super` (Cmd) | `key.shift` on Enter | Notes |
|---|---|---|---|---|---|
| **Kitty** | Full | None | With profile config | Yes | Reference implementation |
| **iTerm2** (3.5+) | Full | None (apps opt in) | With profile config | Yes | Also has legacy CSI u mode (avoid) |
| **Ghostty** (1.0+) | Full | None | With profile config | Yes | First release supported it |
| **Alacritty** (0.13+) | Full | None | With profile config | Yes | |
| **WezTerm** | Full | `enable_kitty_keyboard = true` in wezterm.lua | With profile config | Yes | Must be explicitly enabled |
| **Warp** | Full | None | With profile config | Yes | Added Feb 2026 |
| **Rio** | Full | On by default | With profile config | Yes | `use-kitty-keyboard-protocol = true` |
| **VS Code terminal** | Full | `"terminal.integrated.enableKittyKeyboardProtocol": true` | With profile config | Yes | Since VS Code 1.109 (Jan 2026) |
| **macOS Terminal.app** | **None** | N/A | **Never** | **Never** | No plans to add |
| **xterm** | Partial (modifyOtherKeys) | ~/.Xresources config | No | With xterm config | Not the Kitty push/pop stack |
| **GNOME Terminal** | None (patches pending) | N/A | No | No | Dec 2025: under review |
| **PuTTY** | None | N/A | No | No | No plans |

### Configuring `key.super` (Cmd key) in iTerm2

By default, Cmd+key is intercepted by macOS or iTerm2's own shortcuts. To pass Cmd to your application as `key.super`:

1. Open iTerm2 **Settings > Profiles > Keys**
2. Find the modifier key remap section
3. Set **Left Command** (or Right Command) to act as **Super**
4. This remap is **only active while a Kitty-protocol-aware app is running**

Even with this configured, Cmd+C, Cmd+V, Cmd+Q, and other system-level shortcuts are intercepted before iTerm2 can remap them. The practical set of Cmd+key combinations you can intercept is: Cmd+Left/Right/Up/Down arrows, Cmd+letter keys that are not globally bound.

### tmux Passthrough Configuration

tmux does not implement the Kitty push/pop protocol, but can forward CSI u sequences. Add to `~/.tmux.conf`:

```
set -s extended-keys on
set -as terminal-features 'xterm*:extkeys'
set -s extended-keys-format csi-u
```

**The `terminal-features` glob must match your outer terminal's `$TERM` value.** Without it, tmux will not request extended keys from the outer terminal and has nothing to forward.

---

## Practical Code Examples

### Basic Setup

```typescript
import React from 'react';
import { render, useInput, type Key } from 'ink';

const App = () => {
  useInput((input, key) => {
    // handler code
  });

  return <Box />;
};

render(<App />, {
  kittyKeyboard: {
    mode: 'enabled',
    flags: ['disambiguateEscapeCodes', 'reportEventTypes'],
  },
});
```

### Shift+Enter Detection (Kitty Required)

```typescript
useInput((input, key) => {
  if (key.return && key.shift) {
    // Insert newline in multi-line input
    insertNewline();
  } else if (key.return && !key.shift) {
    // Submit the form
    handleSubmit();
  }
});
```

Without Kitty protocol active, `key.shift` is always `false` on Enter — both cases collapse to the else branch.

### Option+Arrow Word Navigation (Dual Mode)

Handle both legacy (`ESC b`/`ESC f`) and Kitty protocol modes:

```typescript
useInput((input, key) => {
  // Word navigation — works in both legacy and Kitty mode
  const wordLeft =
    (key.leftArrow && key.meta) ||          // Kitty: Option+Left
    (input === 'b' && key.meta);             // Legacy: ESC b

  const wordRight =
    (key.rightArrow && key.meta) ||         // Kitty: Option+Right
    (input === 'f' && key.meta);             // Legacy: ESC f

  if (wordLeft) moveCursorWordLeft();
  if (wordRight) moveCursorWordRight();
});
```

### Full Keyboard Shortcut Handler for Text Editing

```typescript
type EditAction =
  | { type: 'move'; direction: 'left' | 'right' | 'up' | 'down'; select: boolean; word: boolean; line: boolean }
  | { type: 'delete'; direction: 'backward' | 'forward'; word: boolean; line: boolean }
  | { type: 'insert'; text: string }
  | { type: 'newline' }
  | { type: 'submit' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'killLine' }
  | { type: 'killLineBackward' }
  | { type: 'yank' }
  | { type: 'killWord' }
  | { type: 'selectAll' }
  | { type: 'none' };

function resolveKeyAction(input: string, key: Key): EditAction {
  // --- Submit / Newline ---
  if (key.return && key.shift) return { type: 'newline' };
  if (key.return && !key.shift && !key.ctrl && !key.meta) return { type: 'submit' };

  // --- Cursor movement ---
  const wordLeft = (key.leftArrow && key.meta) || (input === 'b' && key.meta);
  const wordRight = (key.rightArrow && key.meta) || (input === 'f' && key.meta);

  if (wordLeft)  return { type: 'move', direction: 'left',  select: key.shift, word: true,  line: false };
  if (wordRight) return { type: 'move', direction: 'right', select: key.shift, word: true,  line: false };

  if (key.leftArrow)  return { type: 'move', direction: 'left',  select: key.shift, word: false, line: false };
  if (key.rightArrow) return { type: 'move', direction: 'right', select: key.shift, word: false, line: false };
  if (key.upArrow)    return { type: 'move', direction: 'up',    select: key.shift, word: false, line: false };
  if (key.downArrow)  return { type: 'move', direction: 'down',  select: key.shift, word: false, line: false };

  // Line start/end — Emacs bindings (work in all terminals)
  if (input === 'a' && key.ctrl) return { type: 'move', direction: 'left',  select: false, word: false, line: true };
  if (input === 'e' && key.ctrl) return { type: 'move', direction: 'right', select: false, word: false, line: true };

  // Home/End keys (when available)
  if (key.home) return { type: 'move', direction: 'left',  select: key.shift, word: false, line: true };
  if (key.end)  return { type: 'move', direction: 'right', select: key.shift, word: false, line: true };

  // Cmd+Arrow — only works with Kitty protocol and terminal configured to send Super
  if (key.leftArrow && key.super)  return { type: 'move', direction: 'left',  select: key.shift, word: false, line: true };
  if (key.rightArrow && key.super) return { type: 'move', direction: 'right', select: key.shift, word: false, line: true };
  if (key.upArrow && key.super)    return { type: 'move', direction: 'up',    select: key.shift, word: false, line: true };
  if (key.downArrow && key.super)  return { type: 'move', direction: 'down',  select: key.shift, word: false, line: true };

  // --- Deletion ---
  if (key.backspace && !key.meta && !key.ctrl) return { type: 'delete', direction: 'backward', word: false, line: false };
  if (key.delete && !key.meta && !key.ctrl)    return { type: 'delete', direction: 'forward',  word: false, line: false };

  // Option+Backspace = delete word backward (Emacs: Ctrl+W alternative)
  if (key.backspace && key.meta) return { type: 'delete', direction: 'backward', word: true, line: false };

  // Ctrl+W = delete word backward (Emacs kill-word-backward)
  if (input === 'w' && key.ctrl) return { type: 'killWord' };

  // --- Kill ring (Emacs) ---
  if (input === 'k' && key.ctrl) return { type: 'killLine' };
  if (input === 'u' && key.ctrl) return { type: 'killLineBackward' };
  if (input === 'y' && key.ctrl) return { type: 'yank' };

  // --- Undo/Redo ---
  if (input === 'z' && key.ctrl) return { type: 'undo' };
  if (input === 'z' && key.ctrl && key.shift) return { type: 'redo' };

  // --- Select all ---
  if (input === 'a' && key.ctrl && key.shift) return { type: 'selectAll' };

  // --- Regular character input ---
  if (input.length > 0 && !key.ctrl && !key.meta) return { type: 'insert', text: input };

  return { type: 'none' };
}
```

### Multiple Active Input Handlers (Focus Management)

When multiple components each use `useInput`, all active handlers receive every key event. Use the `isActive` option to implement focus:

```typescript
const InputArea = ({ isFocused }: { isFocused: boolean }) => {
  useInput((input, key) => {
    // Only handles input when focused
  }, { isActive: isFocused });

  return <Box />;
};

const CommandBar = ({ isFocused }: { isFocused: boolean }) => {
  useInput((input, key) => {
    // Only handles input when focused
  }, { isActive: isFocused });

  return <Box />;
};
```

Alternatively, use Ink's built-in `useFocus` / `useFocusManager` hooks for declarative focus management.

### Detecting eventType for Key Repeat

```typescript
render(<App />, {
  kittyKeyboard: {
    mode: 'enabled',
    flags: ['disambiguateEscapeCodes', 'reportEventTypes'],
  },
});

useInput((input, key) => {
  // Skip repeat events for destructive operations
  if (key.eventType === 'repeat' && key.backspace) {
    // Allow repeating backspace (delete-while-held)
    deleteCharBackward();
    return;
  }

  // Skip repeat events for state toggles
  if (key.eventType === 'repeat') return;

  // Normal handling
  if (key.return && key.shift) insertNewline();
});
```

### Paste Handling with `usePaste`

Clipboard paste via Cmd+V is intercepted by the terminal emulator before your app sees it. Ink provides `usePaste` which uses bracketed paste mode (`ESC[?2004h`) to wrap paste events in delimiters that distinguish them from typed input:

```typescript
import { usePaste } from 'ink';

const InputArea = () => {
  usePaste((text) => {
    // Called when user pastes via Cmd+V in most terminals
    // text is the full pasted string
    insertText(text);
  });

  return <Box />;
};
```

`usePaste` works in Terminal.app, iTerm2, Kitty, Alacritty, and most modern terminals that support bracketed paste mode. This is separate from the Kitty keyboard protocol.

---

## Known Pitfalls

### Pitfall 1: `mode: 'auto'` Fails Inside tmux

**Symptom:** Shift+Enter and modifier keys work when running directly in iTerm2/Ghostty but not when inside a tmux session.

**Cause:** `'auto'` mode checks `$TERM_PROGRAM`. Inside tmux, this variable is unset or set to `tmux`. Ink cannot identify the outer terminal from inside tmux.

**Fix:** Use `mode: 'enabled'`. The protocol detection query (`ESC[?u`) will determine capability at runtime.

### Pitfall 2: Option+Arrow Produces `input='b'/'f'` Not `key.leftArrow`/`key.rightArrow` in Legacy Mode

**Symptom:** Word navigation with Option+Arrow doesn't work in Terminal.app even with "Use Option as Meta Key" enabled.

**Cause:** In legacy mode, iTerm2 with "Option sends ESC+" and Terminal.app with "Use Option as Meta Key" send `ESC b` and `ESC f` — which Ink parses as `input='b'/'f', key.meta=true`, not as arrow keys.

**Fix:** Handle both representations:
```typescript
const wordLeft = (key.leftArrow && key.meta) || (input === 'b' && key.meta);
const wordRight = (key.rightArrow && key.meta) || (input === 'f' && key.meta);
```

### Pitfall 3: Ctrl+C Exits the Process Before Your Handler Runs

**Symptom:** Pressing Ctrl+C exits the app even when `useInput` has a handler.

**Cause:** By default, `exitOnCtrlC: true` in `RenderOptions`. Ink intercepts `input === 'c' && key.ctrl` before calling your `useInput` handler.

**Fix:** Set `exitOnCtrlC: false` in render options and handle process exit yourself:
```typescript
const { exit } = useApp();
useInput((input, key) => {
  if (input === 'c' && key.ctrl) {
    exit();
  }
});
```

### Pitfall 4: `key.shift` is Unreliable on Uppercase Letters in Legacy Mode

**Symptom:** Pressing `A` (Shift+A) sets `key.shift=true`, but pressing `Shift+Left` does not set `key.shift=true` in Terminal.app.

**Cause:** Ink infers `key.shift` from uppercase letters in legacy mode (`if (input.length === 1 && /[A-Z]/.test(input)) key.shift = true`). Arrow key shift state requires proper CSI modifier sequences, which Terminal.app only sends for some combinations.

**Fix:** Kitty protocol resolves this. In Terminal.app, Shift+Arrow sends `ESC[1;2D` which Ink's legacy parser does decode with `key.shift=true` via the modifier field. Test specifically in Terminal.app to confirm.

### Pitfall 5: Non-Printable Key `input` Is Empty String, Not Undefined

**Symptom:** Code checking `if (input)` to detect character input passes for printable characters but also evaluates to `false` for empty string — which is correct. However, code checking `if (input === '')` to detect non-printable keys will falsely match pasted empty strings.

**Cause:** Ink normalizes non-printable keys to `input = ''` in Kitty mode.

**Fix:** Check the `key` object properties for non-printable keys rather than relying on `input` being empty.

### Pitfall 6: `key.super` Requires Terminal-Side Configuration

**Symptom:** `key.super` is always `false` even with Kitty protocol enabled in iTerm2.

**Cause:** The Kitty protocol tells the terminal to report modifier state, but `key.super` (Cmd) only arrives if the terminal remaps Cmd to Super. By default, macOS intercepts Cmd+key at the OS level (for menu shortcuts, window management, etc.) before iTerm2 can remap it.

**Fix:** In iTerm2, go to **Preferences > Profiles > Keys** and remap Left/Right Command to Super. This only takes effect inside Kitty-protocol-aware apps. Even then, Cmd+C/V/Q/W remain intercepted by the OS.

### Pitfall 7: Ink Strips Leading ESC from Unresolved Sequences

From `use-input.ts`:
```typescript
// Strip escape prefix from broken/incomplete sequences that
// parseKeypress did not fully resolve (e.g. a flushed "\u001B[").
if (input.startsWith('\u001B')) {
  input = input.slice(1);
}
```

If a terminal sends an escape sequence that Ink's parser does not recognize, the ESC prefix is stripped from `input`. This prevents confusing downstream handlers but may cause partial sequences to appear as unexpected characters.

---

## Key Detection Quick Reference

A condensed lookup table for the most common shortcuts in a chat/text-editor TUI:

| Shortcut | Ink Detection | Kitty Required? |
|---|---|---|
| Enter (submit) | `key.return && !key.shift` | No |
| Shift+Enter (newline) | `key.return && key.shift` | **Yes** |
| Left Arrow | `key.leftArrow` | No |
| Right Arrow | `key.rightArrow` | No |
| Shift+Left (select) | `key.leftArrow && key.shift` | Recommended |
| Option+Left (word left) | `(key.leftArrow && key.meta) \|\| (input==='b' && key.meta)` | No (dual mode) |
| Option+Right (word right) | `(key.rightArrow && key.meta) \|\| (input==='f' && key.meta)` | No (dual mode) |
| Shift+Option+Left | `key.leftArrow && key.shift && key.meta` | **Yes** |
| Ctrl+A (line start) | `input === 'a' && key.ctrl` | No |
| Ctrl+E (line end) | `input === 'e' && key.ctrl` | No |
| Ctrl+K (kill to EOL) | `input === 'k' && key.ctrl` | No |
| Ctrl+U (kill to BOL) | `input === 'u' && key.ctrl` | No |
| Ctrl+W (kill word back) | `input === 'w' && key.ctrl` | No |
| Ctrl+Y (yank) | `input === 'y' && key.ctrl` | No |
| Ctrl+Z (undo) | `input === 'z' && key.ctrl` | No |
| Backspace | `key.backspace` | No |
| Option+Backspace | `key.backspace && key.meta` | Recommended |
| Delete (forward) | `key.delete` | No |
| Tab | `key.tab` | No |
| Shift+Tab | `key.tab && key.shift` | **Yes** (Kitty) or `ESC[Z` (legacy) |
| Escape | `key.escape` | No |
| Up Arrow (history) | `key.upArrow` | No |
| Down Arrow (history) | `key.downArrow` | No |
| Cmd+Left (line start) | `key.leftArrow && key.super` | **Yes + terminal config** |
| Cmd+Right (line end) | `key.rightArrow && key.super` | **Yes + terminal config** |

---

## Assumptions & Scope

### What Was Included

- Ink source code from the `master` branch on GitHub (vadimdemedes/ink), April 2026
- All TypeScript type definitions for the keyboard API
- Complete modifier bitmask table from `kitty-keyboard.ts`
- Parser logic from `parse-keypress.ts`
- Terminal compatibility data from the blog post "Your Terminal Can't Tell Shift+Enter from Enter" (fsck.com, February 2026)
- iTerm2 CSI u documentation and profile key configuration
- Practical code patterns synthesized from the source code

### What Was Excluded

- Ink's rendering API (Box, Text components, layout)
- Ink's testing utilities (`@inkjs/testing`)
- Screen reader support
- Mouse input handling (not part of the Kitty keyboard protocol)
- Windows-specific behavior (focus on macOS)
- ink-text-input component (excluded per scope — custom component is being built)

### Assumptions Made

| Assumption | Confidence | Impact if Wrong |
|---|---|---|
| Ink master branch reflects v7.x behavior | HIGH | API details may differ from published npm package |
| Kitty protocol behavior described matches actual runtime in iTerm2 3.5+ | HIGH | Modifier handling may have bugs in specific iTerm2 versions |
| `mode: 'enabled'` is safe for non-supporting terminals (graceful degradation) | HIGH | Non-supporting terminals could enter bad state |
| `key.meta` covers both Alt bit (2) and Meta bit (32) in Kitty mode | HIGH | Code from source confirms this OR logic |
| `ESC b` / `ESC f` map to Option+Left/Right in all macOS terminals | MEDIUM | Terminal.app requires "Use Option as Meta Key" enabled; not automatic |
| `key.super` becomes accessible when Cmd is remapped to Super in iTerm2 | MEDIUM | iTerm2 behavior may have changed; not tested at runtime |
| Warp added Kitty protocol support in Feb 2026 as reported | MEDIUM | Release date specifics may vary |

### Uncertainties & Gaps

- **Ink version on npm vs master:** The investigation context references "Ink 7" but the actual npm package version was not confirmed. The source code from GitHub master was used. Verify with `npm info ink version`.
- **`key.shift` on arrow keys in Terminal.app legacy mode:** The standard `ESC[1;2D` sequence is in Ink's legacy parser, but Terminal.app behavior for Shift+Arrow is not confirmed at runtime.
- **`usePaste` coverage in Terminal.app:** Bracketed paste mode support in Terminal.app is assumed to work but was not verified.
- **Key repeat behavior with `reportEventTypes` flag:** The `key.eventType` property behavior was read from source code; actual behavior with held keys in iTerm2 and Ghostty was not tested at runtime.

### Clarifying Questions for Follow-Up

1. **Which version of Ink will be installed?** If using a published npm release (e.g., `ink@7.0.0`), verify that `src/kitty-keyboard.ts` and the `key.super`/`key.hyper` properties are present. The master branch may be ahead of the stable release.

2. **Will the app run inside tmux?** If yes, document the required tmux configuration as part of the setup guide, and use `mode: 'enabled'` rather than `'auto'`.

3. **Is Shift+Arrow text selection required in Terminal.app?** If yes, note that it will work (Terminal.app does send `ESC[1;2D` etc.) but Shift+Enter for newline insertion will not work — users in Terminal.app must use a different key binding for newline (e.g., Ctrl+J).

4. **Is key-release detection needed?** If implementing any animation or behavior that requires knowing when a key is released (not just pressed), the `reportEventTypes` flag must be included. Most text editing does not need this.

5. **Does the TUI need to handle non-US keyboard layouts?** If yes, the `reportAlternateKeys` flag may be needed to correctly identify base key positions independent of keyboard layout.

---

## References

| Source | URL | Information Used |
|---|---|---|
| Ink source: `use-input.ts` | https://github.com/vadimdemedes/ink/blob/master/src/hooks/use-input.ts | Full `Key` type definition, `useInput` hook implementation |
| Ink source: `parse-keypress.ts` | https://github.com/vadimdemedes/ink/blob/master/src/parse-keypress.ts | Complete parser logic, escape sequence tables, kitty regex patterns |
| Ink source: `kitty-keyboard.ts` | https://github.com/vadimdemedes/ink/blob/master/src/kitty-keyboard.ts | `kittyFlags`, `kittyModifiers` constants, `KittyKeyboardOptions` type |
| Ink source: `render.ts` | https://github.com/vadimdemedes/ink/blob/master/src/render.ts | `RenderOptions` type, `kittyKeyboard` option documentation |
| Ink source: `index.ts` | https://github.com/vadimdemedes/ink/blob/master/src/index.ts | Public API surface exported by Ink |
| Ink README | https://github.com/vadimdemedes/ink/blob/master/readme.md | `useInput` usage examples, `kittyKeyboard` configuration examples |
| Kitty Protocol Specification | https://sw.kovidgoyal.net/kitty/keyboard-protocol/ | Canonical protocol definition, modifier bitmask, CSI u encoding format |
| "Your Terminal Can't Tell Shift+Enter from Enter" | https://blog.fsck.com/releases/2026/02/26/terminal-keyboard-protocol/ | Terminal compatibility matrix, framework guide for Ink, per-terminal config, tmux config, escape sequence examples |
| iTerm2 CSI u Documentation | https://iterm2.com/documentation-csiu.html | iTerm2 legacy CSI u mode (deprecated in favor of Kitty protocol) |
| iTerm2 Profile Keys Documentation | https://iterm2.com/documentation-preferences-profiles-keys.html | Super/Hyper/Meta key remapping in iTerm2 |
| Terminal Trove Comparison (2026) | https://terminaltrove.com/compare/terminals/ | Terminal feature comparison table |
