/**
 * Tests for resolveKeyAction — the pure function that maps Ink key events to EditActions.
 */

import { describe, it, expect } from 'vitest';
import type { Key } from 'ink';
import { resolveKeyAction, type KeyHandlerContext } from '../notebooklm_agent/tui/hooks/useKeyHandler.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeKey(overrides: Partial<Key> = {}): Key {
  return {
    upArrow: false, downArrow: false, leftArrow: false, rightArrow: false,
    pageUp: false, pageDown: false, home: false, end: false,
    return: false, escape: false, ctrl: false, shift: false,
    tab: false, backspace: false, delete: false, meta: false,
    super: false, hyper: false, capsLock: false, numLock: false,
    ...overrides,
  };
}

/** Default context: non-empty buffer, cursor not on first or last line. */
const CTX: KeyHandlerContext = {
  isBufferEmpty: false,
  isOnFirstLine: false,
  isOnLastLine: false,
};

/** Context where cursor is on the first line. */
const CTX_FIRST_LINE: KeyHandlerContext = { ...CTX, isOnFirstLine: true };

/** Context where cursor is on the last line. */
const CTX_LAST_LINE: KeyHandlerContext = { ...CTX, isOnLastLine: true };

// ---------------------------------------------------------------------------
// 1. Submit / Newline
// ---------------------------------------------------------------------------

describe('Submit / Newline', () => {
  it('Enter -> submit', () => {
    expect(resolveKeyAction('', makeKey({ return: true }), CTX))
      .toEqual({ type: 'submit' });
  });

  it('Shift+Enter -> newline', () => {
    expect(resolveKeyAction('', makeKey({ return: true, shift: true }), CTX))
      .toEqual({ type: 'newline' });
  });

  it('Ctrl+O -> openLine', () => {
    expect(resolveKeyAction('o', makeKey({ ctrl: true }), CTX))
      .toEqual({ type: 'openLine' });
  });
});

// ---------------------------------------------------------------------------
// 2. Cursor Movement
// ---------------------------------------------------------------------------

describe('Cursor Movement', () => {
  // Word movement (Option / meta)
  it('Option+Left (leftArrow+meta) -> move left word', () => {
    expect(resolveKeyAction('', makeKey({ leftArrow: true, meta: true }), CTX))
      .toEqual({ type: 'move', direction: 'left', select: false, word: true, line: false, doc: false });
  });

  it('Option+Left legacy (input="b"+meta) -> move left word', () => {
    expect(resolveKeyAction('b', makeKey({ meta: true }), CTX))
      .toEqual({ type: 'move', direction: 'left', select: false, word: true, line: false, doc: false });
  });

  it('Option+Right (rightArrow+meta) -> move right word', () => {
    expect(resolveKeyAction('', makeKey({ rightArrow: true, meta: true }), CTX))
      .toEqual({ type: 'move', direction: 'right', select: false, word: true, line: false, doc: false });
  });

  it('Option+Right legacy (input="f"+meta) -> move right word', () => {
    expect(resolveKeyAction('f', makeKey({ meta: true }), CTX))
      .toEqual({ type: 'move', direction: 'right', select: false, word: true, line: false, doc: false });
  });

  // Line movement (Cmd / super)
  it('Cmd+Left (leftArrow+super) -> move left line', () => {
    expect(resolveKeyAction('', makeKey({ leftArrow: true, super: true }), CTX))
      .toEqual({ type: 'move', direction: 'left', select: false, word: false, line: true, doc: false });
  });

  // Ctrl movement
  it('Ctrl+A -> move left line', () => {
    expect(resolveKeyAction('a', makeKey({ ctrl: true }), CTX))
      .toEqual({ type: 'move', direction: 'left', select: false, word: false, line: true, doc: false });
  });

  it('Ctrl+E -> move right line', () => {
    expect(resolveKeyAction('e', makeKey({ ctrl: true }), CTX))
      .toEqual({ type: 'move', direction: 'right', select: false, word: false, line: true, doc: false });
  });

  it('Ctrl+F -> move right', () => {
    expect(resolveKeyAction('f', makeKey({ ctrl: true }), CTX))
      .toEqual({ type: 'move', direction: 'right', select: false, word: false, line: false, doc: false });
  });

  it('Ctrl+B -> move left', () => {
    expect(resolveKeyAction('b', makeKey({ ctrl: true }), CTX))
      .toEqual({ type: 'move', direction: 'left', select: false, word: false, line: false, doc: false });
  });

  it('Ctrl+N -> move down', () => {
    expect(resolveKeyAction('n', makeKey({ ctrl: true }), CTX))
      .toEqual({ type: 'move', direction: 'down', select: false, word: false, line: false, doc: false });
  });

  it('Ctrl+P -> move up', () => {
    expect(resolveKeyAction('p', makeKey({ ctrl: true }), CTX))
      .toEqual({ type: 'move', direction: 'up', select: false, word: false, line: false, doc: false });
  });

  // Home / End
  it('Home -> move left line', () => {
    expect(resolveKeyAction('', makeKey({ home: true }), CTX))
      .toEqual({ type: 'move', direction: 'left', select: false, word: false, line: true, doc: false });
  });

  it('End -> move right line', () => {
    expect(resolveKeyAction('', makeKey({ end: true }), CTX))
      .toEqual({ type: 'move', direction: 'right', select: false, word: false, line: true, doc: false });
  });

  // Plain arrows
  it('Left arrow -> move left', () => {
    expect(resolveKeyAction('', makeKey({ leftArrow: true }), CTX))
      .toEqual({ type: 'move', direction: 'left', select: false, word: false, line: false, doc: false });
  });

  it('Right arrow -> move right', () => {
    expect(resolveKeyAction('', makeKey({ rightArrow: true }), CTX))
      .toEqual({ type: 'move', direction: 'right', select: false, word: false, line: false, doc: false });
  });

  it('Up arrow -> move up', () => {
    expect(resolveKeyAction('', makeKey({ upArrow: true }), CTX))
      .toEqual({ type: 'move', direction: 'up', select: false, word: false, line: false, doc: false });
  });

  it('Down arrow -> move down', () => {
    expect(resolveKeyAction('', makeKey({ downArrow: true }), CTX))
      .toEqual({ type: 'move', direction: 'down', select: false, word: false, line: false, doc: false });
  });

  // Shift+Arrow -> movement with select
  it('Shift+Left -> move left with select', () => {
    expect(resolveKeyAction('', makeKey({ leftArrow: true, shift: true }), CTX))
      .toEqual({ type: 'move', direction: 'left', select: true, word: false, line: false, doc: false });
  });

  it('Shift+Right -> move right with select', () => {
    expect(resolveKeyAction('', makeKey({ rightArrow: true, shift: true }), CTX))
      .toEqual({ type: 'move', direction: 'right', select: true, word: false, line: false, doc: false });
  });

  // Shift+Option+Arrow -> word movement with select
  it('Shift+Option+Left -> word left with select', () => {
    expect(resolveKeyAction('', makeKey({ leftArrow: true, shift: true, meta: true }), CTX))
      .toEqual({ type: 'move', direction: 'left', select: true, word: true, line: false, doc: false });
  });

  it('Shift+Option+Right -> word right with select', () => {
    expect(resolveKeyAction('', makeKey({ rightArrow: true, shift: true, meta: true }), CTX))
      .toEqual({ type: 'move', direction: 'right', select: true, word: true, line: false, doc: false });
  });

  // History on first/last line
  it('Up on first line -> historyPrev', () => {
    expect(resolveKeyAction('', makeKey({ upArrow: true }), CTX_FIRST_LINE))
      .toEqual({ type: 'historyPrev' });
  });

  it('Down on last line -> historyNext', () => {
    expect(resolveKeyAction('', makeKey({ downArrow: true }), CTX_LAST_LINE))
      .toEqual({ type: 'historyNext' });
  });
});

// ---------------------------------------------------------------------------
// 3. Deletion
// ---------------------------------------------------------------------------

describe('Deletion', () => {
  it('Option+Backspace -> delete backward word', () => {
    expect(resolveKeyAction('', makeKey({ backspace: true, meta: true }), CTX))
      .toEqual({ type: 'delete', direction: 'backward', word: true, line: false });
  });

  it('Option+Delete -> delete forward word', () => {
    expect(resolveKeyAction('', makeKey({ delete: true, meta: true }), CTX))
      .toEqual({ type: 'delete', direction: 'forward', word: true, line: false });
  });

  it('Cmd+Backspace -> delete backward line', () => {
    expect(resolveKeyAction('', makeKey({ backspace: true, super: true }), CTX))
      .toEqual({ type: 'delete', direction: 'backward', word: false, line: true });
  });

  it('Backspace -> delete backward', () => {
    expect(resolveKeyAction('', makeKey({ backspace: true }), CTX))
      .toEqual({ type: 'delete', direction: 'backward', word: false, line: false });
  });

  it('Delete -> delete forward', () => {
    expect(resolveKeyAction('', makeKey({ delete: true }), CTX))
      .toEqual({ type: 'delete', direction: 'forward', word: false, line: false });
  });

  it('Ctrl+H -> delete backward', () => {
    expect(resolveKeyAction('h', makeKey({ ctrl: true }), CTX))
      .toEqual({ type: 'delete', direction: 'backward', word: false, line: false });
  });

  it('Ctrl+D (non-empty buffer) -> ctrlD', () => {
    expect(resolveKeyAction('d', makeKey({ ctrl: true }), CTX))
      .toEqual({ type: 'ctrlD' });
  });
});

// ---------------------------------------------------------------------------
// 4. Kill Ring
// ---------------------------------------------------------------------------

describe('Kill Ring', () => {
  it('Ctrl+K -> killToEnd', () => {
    expect(resolveKeyAction('k', makeKey({ ctrl: true }), CTX))
      .toEqual({ type: 'killToEnd' });
  });

  it('Ctrl+U -> killToStart', () => {
    expect(resolveKeyAction('u', makeKey({ ctrl: true }), CTX))
      .toEqual({ type: 'killToStart' });
  });

  it('Ctrl+W -> killWord', () => {
    expect(resolveKeyAction('w', makeKey({ ctrl: true }), CTX))
      .toEqual({ type: 'killWord' });
  });

  it('Ctrl+Y -> yank', () => {
    expect(resolveKeyAction('y', makeKey({ ctrl: true }), CTX))
      .toEqual({ type: 'yank' });
  });
});

// ---------------------------------------------------------------------------
// 5. Text Manipulation
// ---------------------------------------------------------------------------

describe('Text Manipulation', () => {
  it('Ctrl+T -> transpose', () => {
    expect(resolveKeyAction('t', makeKey({ ctrl: true }), CTX))
      .toEqual({ type: 'transpose' });
  });
});

// ---------------------------------------------------------------------------
// 6. Selection
// ---------------------------------------------------------------------------

describe('Selection', () => {
  it('Ctrl+Shift+A -> selectAll', () => {
    expect(resolveKeyAction('a', makeKey({ ctrl: true, shift: true }), CTX))
      .toEqual({ type: 'selectAll' });
  });
});

// ---------------------------------------------------------------------------
// 7. Undo / Redo
// ---------------------------------------------------------------------------

describe('Undo / Redo', () => {
  it('Ctrl+Z -> undo', () => {
    expect(resolveKeyAction('z', makeKey({ ctrl: true }), CTX))
      .toEqual({ type: 'undo' });
  });

  it('Ctrl+Shift+Z -> redo', () => {
    expect(resolveKeyAction('z', makeKey({ ctrl: true, shift: true }), CTX))
      .toEqual({ type: 'redo' });
  });
});

// ---------------------------------------------------------------------------
// 8. Scrolling
// ---------------------------------------------------------------------------

describe('Scrolling', () => {
  it('PageUp -> scrollUp page', () => {
    expect(resolveKeyAction('', makeKey({ pageUp: true }), CTX))
      .toEqual({ type: 'scrollUp', amount: 'page' });
  });

  it('PageDown -> scrollDown page', () => {
    expect(resolveKeyAction('', makeKey({ pageDown: true }), CTX))
      .toEqual({ type: 'scrollDown', amount: 'page' });
  });
});

// ---------------------------------------------------------------------------
// 9. App-level
// ---------------------------------------------------------------------------

describe('App-level', () => {
  it('Ctrl+C -> cancel', () => {
    expect(resolveKeyAction('c', makeKey({ ctrl: true }), CTX))
      .toEqual({ type: 'cancel' });
  });
});

// ---------------------------------------------------------------------------
// 10. Character Input
// ---------------------------------------------------------------------------

describe('Character Input', () => {
  it('Regular character -> insert', () => {
    expect(resolveKeyAction('a', makeKey(), CTX))
      .toEqual({ type: 'insert', text: 'a' });
  });

  it('Unknown key combo -> none', () => {
    expect(resolveKeyAction('', makeKey(), CTX))
      .toEqual({ type: 'none' });
  });
});

// ---------------------------------------------------------------------------
// 11. Priority
// ---------------------------------------------------------------------------

describe('Priority', () => {
  it('Ctrl+D wins over character input', () => {
    const action = resolveKeyAction('d', makeKey({ ctrl: true }), CTX);
    expect(action.type).toBe('ctrlD');
  });

  it('Word movement (Option+Left) wins over plain left arrow', () => {
    const action = resolveKeyAction('', makeKey({ leftArrow: true, meta: true }), CTX);
    expect(action).toEqual({ type: 'move', direction: 'left', select: false, word: true, line: false, doc: false });
  });

  it('History wins over plain arrow when on first/last line', () => {
    const upAction = resolveKeyAction('', makeKey({ upArrow: true }), CTX_FIRST_LINE);
    expect(upAction.type).toBe('historyPrev');

    const downAction = resolveKeyAction('', makeKey({ downArrow: true }), CTX_LAST_LINE);
    expect(downAction.type).toBe('historyNext');
  });
});
