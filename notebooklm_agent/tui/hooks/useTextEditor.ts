/**
 * React hook wrapping TextBuffer + KillRing + UndoStack.
 * Provides a dispatch function that maps EditActions to buffer operations.
 */

import { useState, useCallback, useRef } from 'react';
import type { EditAction } from '../lib/edit-actions.ts';
import type { TextBuffer, SelectionRange } from '../lib/text-buffer.ts';
import {
  emptyBuffer,
  getLines,
  getCursorPosition,
  getSelectionRange,
  getSelectedText,
  insertText as bufInsertText,
  deleteBackward,
  deleteForward,
  deleteWordBackward,
  deleteWordForward,
  deleteToLineStart,
  deleteToLineEnd,
  moveCursorLeft,
  moveCursorRight,
  moveCursorUp,
  moveCursorDown,
  moveCursorWordLeft,
  moveCursorWordRight,
  moveCursorLineStart,
  moveCursorLineEnd,
  moveCursorDocStart,
  moveCursorDocEnd,
  selectLeft,
  selectRight,
  selectUp,
  selectDown,
  selectWordLeft,
  selectWordRight,
  selectLineStart,
  selectLineEnd,
  selectDocStart,
  selectDocEnd,
  selectAll,
  transposeChars,
  openLine,
} from '../lib/text-buffer.ts';
import { KillRing } from '../lib/kill-ring.ts';
import { UndoStack } from '../lib/undo-stack.ts';
import type { UndoOperation } from '../lib/undo-stack.ts';

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
  setContent(text: string): void;
}

export function useTextEditor(): UseTextEditorResult {
  const [buffer, setBuffer] = useState<TextBuffer>(emptyBuffer());
  const killRingRef = useRef(new KillRing());
  const undoStackRef = useRef(new UndoStack());

  const lines = getLines(buffer);
  const { line: cursorLine, col: cursorCol } = getCursorPosition(buffer);
  const selectionRange = getSelectionRange(buffer);

  /** Record an undo operation and update the buffer. */
  const applyEdit = useCallback((
    prev: TextBuffer,
    next: TextBuffer,
    type: UndoOperation['type'],
    position: number,
    oldText: string,
    newText: string,
  ): TextBuffer => {
    undoStackRef.current.push({
      type,
      position,
      oldText,
      newText,
      cursorBefore: prev.cursor,
      selectionBefore: prev.selection,
      cursorAfter: next.cursor,
      timestamp: Date.now(),
    });
    return next;
  }, []);

  const doInsertText = useCallback((text: string) => {
    setBuffer(prev => {
      const selectedText = getSelectedText(prev);
      const range = getSelectionRange(prev);
      const next = bufInsertText(prev, text);
      const pos = range ? range.start : prev.cursor;
      return applyEdit(prev, next, selectedText ? 'replace' : 'insert', pos, selectedText, text);
    });
  }, [applyEdit]);

  const dispatch = useCallback((action: EditAction) => {
    switch (action.type) {
      // --- Movement ---
      case 'move': {
        setBuffer(prev => {
          const { direction, select, word, line, doc } = action;
          if (select) {
            // Selection variants
            if (doc) return direction === 'up' || direction === 'left' ? selectDocStart(prev) : selectDocEnd(prev);
            if (line) return direction === 'left' || direction === 'up' ? selectLineStart(prev) : selectLineEnd(prev);
            if (word) return direction === 'left' ? selectWordLeft(prev) : selectWordRight(prev);
            switch (direction) {
              case 'left': return selectLeft(prev);
              case 'right': return selectRight(prev);
              case 'up': return selectUp(prev);
              case 'down': return selectDown(prev);
            }
          } else {
            // Movement variants
            if (doc) return direction === 'up' || direction === 'left' ? moveCursorDocStart(prev) : moveCursorDocEnd(prev);
            if (line) return direction === 'left' || direction === 'up' ? moveCursorLineStart(prev) : moveCursorLineEnd(prev);
            if (word) return direction === 'left' ? moveCursorWordLeft(prev) : moveCursorWordRight(prev);
            switch (direction) {
              case 'left': return moveCursorLeft(prev);
              case 'right': return moveCursorRight(prev);
              case 'up': return moveCursorUp(prev);
              case 'down': return moveCursorDown(prev);
            }
          }
          return prev;
        });
        break;
      }

      // --- Delete ---
      case 'delete': {
        setBuffer(prev => {
          const { direction, word, line } = action;

          const selected = getSelectedText(prev);
          const selRange = getSelectionRange(prev);

          if (selected && selRange) {
            const next = bufInsertText(prev, '');
            return applyEdit(prev, next, 'delete', selRange.start, selected, '');
          }

          let next: TextBuffer;
          let oldText: string;
          let pos: number;

          if (direction === 'backward') {
            if (line) {
              const lineStartIdx = prev.content.lastIndexOf('\n', prev.cursor - 1);
              pos = lineStartIdx === -1 ? 0 : lineStartIdx + 1;
              oldText = prev.content.slice(pos, prev.cursor);
              next = deleteToLineStart(prev);
            } else if (word) {
              next = deleteWordBackward(prev);
              pos = next.cursor;
              oldText = prev.content.slice(next.cursor, prev.cursor);
            } else {
              pos = prev.cursor - 1;
              oldText = pos >= 0 ? prev.content[pos]! : '';
              next = deleteBackward(prev);
            }
          } else {
            pos = prev.cursor;
            if (line) {
              const nlIdx = prev.content.indexOf('\n', prev.cursor);
              oldText = prev.content.slice(prev.cursor, nlIdx === -1 ? prev.content.length : nlIdx);
              next = deleteToLineEnd(prev);
            } else if (word) {
              next = deleteWordForward(prev);
              oldText = prev.content.slice(prev.cursor, prev.cursor + (prev.content.length - next.content.length));
            } else {
              oldText = prev.cursor < prev.content.length ? prev.content[prev.cursor]! : '';
              next = deleteForward(prev);
            }
          }

          if (next === prev) return prev;
          return applyEdit(prev, next, 'delete', Math.max(0, pos), oldText, '');
        });
        break;
      }

      // --- Insert ---
      case 'insert':
        doInsertText(action.text);
        break;

      // --- Newline ---
      case 'newline':
        doInsertText('\n');
        break;

      // --- Kill ring ---
      case 'killToEnd': {
        setBuffer(prev => {
          const content = prev.content;
          const nlIdx = content.indexOf('\n', prev.cursor);
          const lineEnd = nlIdx === -1 ? content.length : nlIdx;
          const killed = content.slice(prev.cursor, lineEnd);
          if (killed.length === 0) return prev;
          killRingRef.current.kill(killed);
          const next = deleteToLineEnd(prev);
          return applyEdit(prev, next, 'delete', prev.cursor, killed, '');
        });
        break;
      }

      case 'killToStart': {
        setBuffer(prev => {
          const content = prev.content;
          const nlIdx = content.lastIndexOf('\n', prev.cursor - 1);
          const lineStart = nlIdx === -1 ? 0 : nlIdx + 1;
          const killed = content.slice(lineStart, prev.cursor);
          if (killed.length === 0) return prev;
          killRingRef.current.kill(killed);
          const next = deleteToLineStart(prev);
          return applyEdit(prev, next, 'delete', lineStart, killed, '');
        });
        break;
      }

      case 'killWord': {
        setBuffer(prev => {
          const next = deleteWordBackward(prev);
          if (next === prev) return prev;
          const killed = prev.content.slice(next.cursor, prev.cursor);
          if (killed.length > 0) {
            killRingRef.current.kill(killed);
          }
          return applyEdit(prev, next, 'delete', next.cursor, killed, '');
        });
        break;
      }

      case 'yank': {
        const text = killRingRef.current.yank();
        if (text) {
          doInsertText(text);
        }
        break;
      }

      // --- Transpose ---
      case 'transpose': {
        setBuffer(prev => {
          const next = transposeChars(prev);
          if (next === prev) return prev;
          // Record as a replace of the two transposed characters
          const pos = Math.max(0, next.cursor - 2);
          const oldText = prev.content.slice(pos, pos + 2);
          const newText = next.content.slice(pos, pos + 2);
          return applyEdit(prev, next, 'replace', pos, oldText, newText);
        });
        break;
      }

      // --- Open line ---
      case 'openLine': {
        setBuffer(prev => {
          const next = openLine(prev);
          return applyEdit(prev, next, 'insert', prev.cursor, '', '\n');
        });
        break;
      }

      // --- Select all ---
      case 'selectAll': {
        setBuffer(prev => selectAll(prev));
        break;
      }

      // --- Undo ---
      case 'undo': {
        const op = undoStackRef.current.undo();
        if (!op) break;
        setBuffer(_prev => {
          // Reverse the operation
          const content = _prev.content.slice(0, op.position) + op.oldText + _prev.content.slice(op.position + op.newText.length);
          return {
            content,
            cursor: op.cursorBefore,
            selection: op.selectionBefore,
          };
        });
        break;
      }

      // --- Redo ---
      case 'redo': {
        const op = undoStackRef.current.redo();
        if (!op) break;
        setBuffer(_prev => {
          const content = _prev.content.slice(0, op.position) + op.newText + _prev.content.slice(op.position + op.oldText.length);
          return {
            content,
            cursor: op.cursorAfter,
            selection: null,
          };
        });
        break;
      }

      // Non-editing actions are handled by the caller (App), not here.
      case 'submit':
      case 'historyPrev':
      case 'historyNext':
      case 'scrollUp':
      case 'scrollDown':
      case 'cancel':
      case 'ctrlD':
      case 'slashCommand':
      case 'none':
        break;
    }
  }, [doInsertText, applyEdit]);

  const getText = useCallback(() => buffer.content, [buffer.content]);

  const clear = useCallback(() => {
    setBuffer(emptyBuffer());
    undoStackRef.current.clear();
  }, []);

  const isEmpty = useCallback(() => buffer.content.length === 0, [buffer.content]);

  const setContent = useCallback((text: string) => {
    setBuffer({ content: text, cursor: text.length, selection: null });
  }, []);

  return {
    buffer,
    lines,
    cursorLine,
    cursorCol,
    selectionRange,
    dispatch,
    insertText: doInsertText,
    getText,
    clear,
    isEmpty,
    setContent,
  };
}
