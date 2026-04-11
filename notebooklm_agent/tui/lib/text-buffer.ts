/**
 * Immutable text buffer with cursor and optional selection.
 * All operations are pure functions that return a new TextBuffer.
 */

import { wordBoundaryLeft, wordBoundaryRight } from './word-boundaries.ts';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface TextBuffer {
  readonly content: string;
  readonly cursor: number;
  readonly selection: Selection | null;
}

export interface Selection {
  readonly anchor: number;
  readonly focus: number;
}

export interface SelectionRange {
  readonly start: number;
  readonly end: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function emptyBuffer(): TextBuffer {
  return { content: '', cursor: 0, selection: null };
}

export function getSelectedText(buf: TextBuffer): string {
  const range = getSelectionRange(buf);
  if (!range) return '';
  return buf.content.slice(range.start, range.end);
}

export function getSelectionRange(buf: TextBuffer): SelectionRange | null {
  if (!buf.selection) return null;
  const { anchor, focus } = buf.selection;
  return { start: Math.min(anchor, focus), end: Math.max(anchor, focus) };
}

export function getLines(buf: TextBuffer): string[] {
  return buf.content.split('\n');
}

export function getCursorPosition(buf: TextBuffer): { line: number; col: number } {
  const text = buf.content.slice(0, buf.cursor);
  const lines = text.split('\n');
  return { line: lines.length - 1, col: lines[lines.length - 1]!.length };
}

export function isOnFirstLine(buf: TextBuffer): boolean {
  return getCursorPosition(buf).line === 0;
}

export function isOnLastLine(buf: TextBuffer): boolean {
  const lines = getLines(buf);
  return getCursorPosition(buf).line === lines.length - 1;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Get the offset of the start of a given line index. */
function lineStartOffset(content: string, lineIndex: number): number {
  let offset = 0;
  for (let i = 0; i < lineIndex; i++) {
    const nl = content.indexOf('\n', offset);
    if (nl === -1) return content.length;
    offset = nl + 1;
  }
  return offset;
}

/** Get the offset of the end of a given line index (before the \n). */
function lineEndOffset(content: string, lineIndex: number): number {
  const start = lineStartOffset(content, lineIndex);
  const nl = content.indexOf('\n', start);
  return nl === -1 ? content.length : nl;
}

/** Clamp a value between min and max. */
function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

/** Create a buffer with a new cursor position and no selection. */
function moveTo(buf: TextBuffer, cursor: number): TextBuffer {
  return { content: buf.content, cursor: clamp(cursor, 0, buf.content.length), selection: null };
}

/** Create a buffer extending selection to a new focus position. */
function selectTo(buf: TextBuffer, focus: number): TextBuffer {
  const anchor = buf.selection ? buf.selection.anchor : buf.cursor;
  const clampedFocus = clamp(focus, 0, buf.content.length);
  return { content: buf.content, cursor: clampedFocus, selection: { anchor, focus: clampedFocus } };
}

/** Delete the selected range and return a new buffer. */
function deleteSelection(buf: TextBuffer): TextBuffer {
  const range = getSelectionRange(buf);
  if (!range) return buf;
  const content = buf.content.slice(0, range.start) + buf.content.slice(range.end);
  return { content, cursor: range.start, selection: null };
}

// ---------------------------------------------------------------------------
// Movement (clear selection, move cursor)
// ---------------------------------------------------------------------------

export function moveCursorLeft(buf: TextBuffer): TextBuffer {
  if (buf.selection) {
    const range = getSelectionRange(buf)!;
    return moveTo(buf, range.start);
  }
  return moveTo(buf, buf.cursor - 1);
}

export function moveCursorRight(buf: TextBuffer): TextBuffer {
  if (buf.selection) {
    const range = getSelectionRange(buf)!;
    return moveTo(buf, range.end);
  }
  return moveTo(buf, buf.cursor + 1);
}

export function moveCursorUp(buf: TextBuffer): TextBuffer {
  const { line, col } = getCursorPosition(buf);
  if (line === 0) return moveTo(buf, 0);
  const prevLineStart = lineStartOffset(buf.content, line - 1);
  const prevLineEnd = lineEndOffset(buf.content, line - 1);
  const prevLineLen = prevLineEnd - prevLineStart;
  return moveTo(buf, prevLineStart + Math.min(col, prevLineLen));
}

export function moveCursorDown(buf: TextBuffer): TextBuffer {
  const lines = getLines(buf);
  const { line, col } = getCursorPosition(buf);
  if (line >= lines.length - 1) return moveTo(buf, buf.content.length);
  const nextLineStart = lineStartOffset(buf.content, line + 1);
  const nextLineEnd = lineEndOffset(buf.content, line + 1);
  const nextLineLen = nextLineEnd - nextLineStart;
  return moveTo(buf, nextLineStart + Math.min(col, nextLineLen));
}

export function moveCursorWordLeft(buf: TextBuffer): TextBuffer {
  return moveTo(buf, wordBoundaryLeft(buf.content, buf.cursor));
}

export function moveCursorWordRight(buf: TextBuffer): TextBuffer {
  return moveTo(buf, wordBoundaryRight(buf.content, buf.cursor));
}

export function moveCursorLineStart(buf: TextBuffer): TextBuffer {
  const { line } = getCursorPosition(buf);
  return moveTo(buf, lineStartOffset(buf.content, line));
}

export function moveCursorLineEnd(buf: TextBuffer): TextBuffer {
  const { line } = getCursorPosition(buf);
  return moveTo(buf, lineEndOffset(buf.content, line));
}

export function moveCursorDocStart(buf: TextBuffer): TextBuffer {
  return moveTo(buf, 0);
}

export function moveCursorDocEnd(buf: TextBuffer): TextBuffer {
  return moveTo(buf, buf.content.length);
}

// ---------------------------------------------------------------------------
// Selection (same as movement, but extends selection)
// ---------------------------------------------------------------------------

export function selectLeft(buf: TextBuffer): TextBuffer {
  return selectTo(buf, buf.cursor - 1);
}

export function selectRight(buf: TextBuffer): TextBuffer {
  return selectTo(buf, buf.cursor + 1);
}

export function selectUp(buf: TextBuffer): TextBuffer {
  const { line, col } = getCursorPosition(buf);
  if (line === 0) return selectTo(buf, 0);
  const prevLineStart = lineStartOffset(buf.content, line - 1);
  const prevLineEnd = lineEndOffset(buf.content, line - 1);
  const prevLineLen = prevLineEnd - prevLineStart;
  return selectTo(buf, prevLineStart + Math.min(col, prevLineLen));
}

export function selectDown(buf: TextBuffer): TextBuffer {
  const lines = getLines(buf);
  const { line, col } = getCursorPosition(buf);
  if (line >= lines.length - 1) return selectTo(buf, buf.content.length);
  const nextLineStart = lineStartOffset(buf.content, line + 1);
  const nextLineEnd = lineEndOffset(buf.content, line + 1);
  const nextLineLen = nextLineEnd - nextLineStart;
  return selectTo(buf, nextLineStart + Math.min(col, nextLineLen));
}

export function selectWordLeft(buf: TextBuffer): TextBuffer {
  return selectTo(buf, wordBoundaryLeft(buf.content, buf.cursor));
}

export function selectWordRight(buf: TextBuffer): TextBuffer {
  return selectTo(buf, wordBoundaryRight(buf.content, buf.cursor));
}

export function selectLineStart(buf: TextBuffer): TextBuffer {
  const { line } = getCursorPosition(buf);
  return selectTo(buf, lineStartOffset(buf.content, line));
}

export function selectLineEnd(buf: TextBuffer): TextBuffer {
  const { line } = getCursorPosition(buf);
  return selectTo(buf, lineEndOffset(buf.content, line));
}

export function selectDocStart(buf: TextBuffer): TextBuffer {
  return selectTo(buf, 0);
}

export function selectDocEnd(buf: TextBuffer): TextBuffer {
  return selectTo(buf, buf.content.length);
}

export function selectAll(buf: TextBuffer): TextBuffer {
  return {
    content: buf.content,
    cursor: buf.content.length,
    selection: { anchor: 0, focus: buf.content.length },
  };
}

// ---------------------------------------------------------------------------
// Editing (returns new buffer; replaces selection if active)
// ---------------------------------------------------------------------------

export function insertText(buf: TextBuffer, text: string): TextBuffer {
  if (buf.selection) {
    const range = getSelectionRange(buf)!;
    const content = buf.content.slice(0, range.start) + text + buf.content.slice(range.end);
    return { content, cursor: range.start + text.length, selection: null };
  }
  const content = buf.content.slice(0, buf.cursor) + text + buf.content.slice(buf.cursor);
  return { content, cursor: buf.cursor + text.length, selection: null };
}

export function deleteBackward(buf: TextBuffer): TextBuffer {
  if (buf.selection) return deleteSelection(buf);
  if (buf.cursor === 0) return buf;
  const content = buf.content.slice(0, buf.cursor - 1) + buf.content.slice(buf.cursor);
  return { content, cursor: buf.cursor - 1, selection: null };
}

export function deleteForward(buf: TextBuffer): TextBuffer {
  if (buf.selection) return deleteSelection(buf);
  if (buf.cursor >= buf.content.length) return buf;
  const content = buf.content.slice(0, buf.cursor) + buf.content.slice(buf.cursor + 1);
  return { content, cursor: buf.cursor, selection: null };
}

export function deleteWordBackward(buf: TextBuffer): TextBuffer {
  if (buf.selection) return deleteSelection(buf);
  const target = wordBoundaryLeft(buf.content, buf.cursor);
  if (target === buf.cursor) return buf;
  const content = buf.content.slice(0, target) + buf.content.slice(buf.cursor);
  return { content, cursor: target, selection: null };
}

export function deleteWordForward(buf: TextBuffer): TextBuffer {
  if (buf.selection) return deleteSelection(buf);
  const target = wordBoundaryRight(buf.content, buf.cursor);
  if (target === buf.cursor) return buf;
  const content = buf.content.slice(0, buf.cursor) + buf.content.slice(target);
  return { content, cursor: buf.cursor, selection: null };
}

export function deleteToLineStart(buf: TextBuffer): TextBuffer {
  if (buf.selection) return deleteSelection(buf);
  const { line } = getCursorPosition(buf);
  const start = lineStartOffset(buf.content, line);
  if (start === buf.cursor) return buf;
  const content = buf.content.slice(0, start) + buf.content.slice(buf.cursor);
  return { content, cursor: start, selection: null };
}

export function deleteToLineEnd(buf: TextBuffer): TextBuffer {
  if (buf.selection) return deleteSelection(buf);
  const { line } = getCursorPosition(buf);
  const end = lineEndOffset(buf.content, line);
  if (end === buf.cursor) return buf;
  const content = buf.content.slice(0, buf.cursor) + buf.content.slice(end);
  return { content, cursor: buf.cursor, selection: null };
}

export function transposeChars(buf: TextBuffer): TextBuffer {
  if (buf.selection) return buf;
  if (buf.content.length < 2) return buf;
  // If at end of line or end of content, transpose the two chars before cursor
  let pos = buf.cursor;
  if (pos === 0) return buf;
  if (pos >= buf.content.length) pos = buf.content.length;
  if (pos < 1) return buf;
  // Swap chars at pos-1 and pos (or pos-2 and pos-1 if at end)
  const idx = pos >= buf.content.length ? pos - 1 : pos;
  if (idx < 1) return buf;
  const chars = buf.content.split('');
  const tmp = chars[idx - 1]!;
  chars[idx - 1] = chars[idx]!;
  chars[idx] = tmp;
  return { content: chars.join(''), cursor: idx + 1, selection: null };
}

export function openLine(buf: TextBuffer): TextBuffer {
  // Insert newline at cursor without moving cursor
  const content = buf.content.slice(0, buf.cursor) + '\n' + buf.content.slice(buf.cursor);
  return { content, cursor: buf.cursor, selection: null };
}
