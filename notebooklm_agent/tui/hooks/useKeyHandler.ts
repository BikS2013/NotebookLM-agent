/**
 * Pure function that maps Ink key events to EditAction values.
 * No side effects — fully testable.
 */

import type { Key } from 'ink';
import type { EditAction } from '../lib/edit-actions.ts';

export interface KeyHandlerContext {
  /** Whether the input buffer is empty (for Ctrl+D decision). */
  isBufferEmpty: boolean;
  /** Whether the cursor is on the first line (for Up arrow history). */
  isOnFirstLine: boolean;
  /** Whether the cursor is on the last line (for Down arrow history). */
  isOnLastLine: boolean;
}

/**
 * Resolve a keystroke into an EditAction.
 * Priority is evaluated top-to-bottom; first match wins.
 */
export function resolveKeyAction(
  input: string,
  key: Key,
  context: KeyHandlerContext,
): EditAction {

  // -----------------------------------------------------------------------
  // 1. Submit / Newline
  // -----------------------------------------------------------------------

  // #1 Shift+Enter -> newline (Kitty only)
  if (key.return && key.shift) {
    return { type: 'newline' };
  }

  // #2 Enter -> submit
  if (key.return && !key.shift && !key.ctrl && !key.meta) {
    return { type: 'submit' };
  }

  // #3 Ctrl+O -> openLine
  if (input === 'o' && key.ctrl) {
    return { type: 'openLine' };
  }

  // -----------------------------------------------------------------------
  // 2. Cursor Movement
  // -----------------------------------------------------------------------

  // #4 Option+Left (dual mode): word left
  if ((key.leftArrow && key.meta) || (input === 'b' && key.meta)) {
    return { type: 'move', direction: 'left', select: key.shift, word: true, line: false, doc: false };
  }

  // #5 Option+Right (dual mode): word right
  if ((key.rightArrow && key.meta) || (input === 'f' && key.meta)) {
    return { type: 'move', direction: 'right', select: key.shift, word: true, line: false, doc: false };
  }

  // #6 Cmd+Left -> line start (Kitty + super)
  if (key.leftArrow && key.super) {
    return { type: 'move', direction: 'left', select: key.shift, word: false, line: true, doc: false };
  }

  // #7 Cmd+Right -> line end
  if (key.rightArrow && key.super) {
    return { type: 'move', direction: 'right', select: key.shift, word: false, line: true, doc: false };
  }

  // #8 Cmd+Up -> doc start
  if (key.upArrow && key.super) {
    return { type: 'move', direction: 'up', select: key.shift, word: false, line: false, doc: true };
  }

  // #9 Cmd+Down -> doc end
  if (key.downArrow && key.super) {
    return { type: 'move', direction: 'down', select: key.shift, word: false, line: false, doc: true };
  }

  // #10 Ctrl+A -> line start (not Shift — #37 handles Ctrl+Shift+A)
  if (input === 'a' && key.ctrl && !key.shift) {
    return { type: 'move', direction: 'left', select: false, word: false, line: true, doc: false };
  }

  // #11 Ctrl+E -> line end
  if (input === 'e' && key.ctrl) {
    return { type: 'move', direction: 'right', select: false, word: false, line: true, doc: false };
  }

  // #12 Ctrl+F -> move right
  if (input === 'f' && key.ctrl) {
    return { type: 'move', direction: 'right', select: false, word: false, line: false, doc: false };
  }

  // #13 Ctrl+B -> move left
  if (input === 'b' && key.ctrl) {
    return { type: 'move', direction: 'left', select: false, word: false, line: false, doc: false };
  }

  // #14 Ctrl+N -> move down
  if (input === 'n' && key.ctrl) {
    return { type: 'move', direction: 'down', select: false, word: false, line: false, doc: false };
  }

  // #15 Ctrl+P -> move up
  if (input === 'p' && key.ctrl) {
    return { type: 'move', direction: 'up', select: false, word: false, line: false, doc: false };
  }

  // #16 Home -> line start
  if (key.home && !key.super) {
    return { type: 'move', direction: 'left', select: key.shift, word: false, line: true, doc: false };
  }

  // #17 End -> line end
  if (key.end && !key.super) {
    return { type: 'move', direction: 'right', select: key.shift, word: false, line: true, doc: false };
  }

  // #18 Up on first line -> history previous
  if (key.upArrow && context.isOnFirstLine && !key.shift && !key.meta && !key.ctrl && !key.super) {
    return { type: 'historyPrev' };
  }

  // #19 Down on last line -> history next
  if (key.downArrow && context.isOnLastLine && !key.shift && !key.meta && !key.ctrl && !key.super) {
    return { type: 'historyNext' };
  }

  // #20 Left arrow (plain or shift)
  if (key.leftArrow && !key.meta && !key.super && !key.ctrl) {
    return { type: 'move', direction: 'left', select: key.shift, word: false, line: false, doc: false };
  }

  // #21 Right arrow (plain or shift)
  if (key.rightArrow && !key.meta && !key.super && !key.ctrl) {
    return { type: 'move', direction: 'right', select: key.shift, word: false, line: false, doc: false };
  }

  // #22 Up arrow (plain or shift)
  if (key.upArrow && !key.meta && !key.super && !key.ctrl) {
    return { type: 'move', direction: 'up', select: key.shift, word: false, line: false, doc: false };
  }

  // #23 Down arrow (plain or shift)
  if (key.downArrow && !key.meta && !key.super && !key.ctrl) {
    return { type: 'move', direction: 'down', select: key.shift, word: false, line: false, doc: false };
  }

  // -----------------------------------------------------------------------
  // 3. Deletion
  // -----------------------------------------------------------------------

  // #24 Option+Backspace -> delete word backward
  if (key.backspace && key.meta) {
    return { type: 'delete', direction: 'backward', word: true, line: false };
  }

  // #25 Option+Delete -> delete word forward
  if (key.delete && key.meta) {
    return { type: 'delete', direction: 'forward', word: true, line: false };
  }

  // #26 Cmd+Backspace -> delete to line start
  if (key.backspace && key.super) {
    return { type: 'delete', direction: 'backward', word: false, line: true };
  }

  // #27 Cmd+Delete -> delete to line end
  if (key.delete && key.super) {
    return { type: 'delete', direction: 'forward', word: false, line: true };
  }

  // #28 Backspace
  if (key.backspace && !key.meta && !key.super) {
    return { type: 'delete', direction: 'backward', word: false, line: false };
  }

  // #29 Delete
  if (key.delete && !key.meta && !key.super) {
    return { type: 'delete', direction: 'forward', word: false, line: false };
  }

  // #30 Ctrl+H -> delete backward
  if (input === 'h' && key.ctrl) {
    return { type: 'delete', direction: 'backward', word: false, line: false };
  }

  // #31 Ctrl+D -> context-dependent
  if (input === 'd' && key.ctrl) {
    return { type: 'ctrlD' };
  }

  // -----------------------------------------------------------------------
  // 4. Kill Ring (Emacs)
  // -----------------------------------------------------------------------

  // #32 Ctrl+K -> kill to end of line
  if (input === 'k' && key.ctrl) {
    return { type: 'killToEnd' };
  }

  // #33 Ctrl+U -> kill to start of line
  if (input === 'u' && key.ctrl) {
    return { type: 'killToStart' };
  }

  // #34 Ctrl+W -> kill word backward
  if (input === 'w' && key.ctrl) {
    return { type: 'killWord' };
  }

  // #35 Ctrl+Y -> yank
  if (input === 'y' && key.ctrl) {
    return { type: 'yank' };
  }

  // -----------------------------------------------------------------------
  // 5. Text Manipulation
  // -----------------------------------------------------------------------

  // #36 Ctrl+T -> transpose
  if (input === 't' && key.ctrl) {
    return { type: 'transpose' };
  }

  // -----------------------------------------------------------------------
  // 6. Selection
  // -----------------------------------------------------------------------

  // #37 Ctrl+Shift+A -> select all
  if (input === 'a' && key.ctrl && key.shift) {
    return { type: 'selectAll' };
  }

  // -----------------------------------------------------------------------
  // 7. Undo / Redo
  // -----------------------------------------------------------------------

  // #39 Ctrl+Shift+Z -> redo (checked before undo)
  if (input === 'z' && key.ctrl && key.shift) {
    return { type: 'redo' };
  }

  // #40 Ctrl+Z -> undo
  if (input === 'z' && key.ctrl && !key.shift) {
    return { type: 'undo' };
  }

  // -----------------------------------------------------------------------
  // 8. Scrolling
  // -----------------------------------------------------------------------

  // #41 Page Up
  if (key.pageUp) {
    return { type: 'scrollUp', amount: 'page' };
  }

  // #42 Page Down
  if (key.pageDown) {
    return { type: 'scrollDown', amount: 'page' };
  }

  // #43 Cmd+Home -> scroll to top
  if (key.home && key.super) {
    return { type: 'scrollUp', amount: 'top' };
  }

  // #44 Cmd+End -> scroll to bottom
  if (key.end && key.super) {
    return { type: 'scrollDown', amount: 'bottom' };
  }

  // -----------------------------------------------------------------------
  // 9. Application-Level
  // -----------------------------------------------------------------------

  // #45 Ctrl+C -> cancel
  if (input === 'c' && key.ctrl) {
    return { type: 'cancel' };
  }

  // -----------------------------------------------------------------------
  // 10. Character Input (lowest priority)
  // -----------------------------------------------------------------------

  // #46 Printable character
  if (input.length > 0 && !key.ctrl && !key.meta) {
    return { type: 'insert', text: input };
  }

  // #47 Default: unrecognized
  return { type: 'none' };
}
