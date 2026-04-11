import { describe, it, expect } from 'vitest';
import {
  emptyBuffer,
  TextBuffer,
  getLines,
  getCursorPosition,
  getSelectedText,
  getSelectionRange,
  isOnFirstLine,
  isOnLastLine,
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
  insertText,
  deleteBackward,
  deleteForward,
  deleteWordBackward,
  deleteWordForward,
  deleteToLineStart,
  deleteToLineEnd,
  transposeChars,
  openLine,
} from '../notebooklm_agent/tui/lib/text-buffer.ts';

// Helper to create a buffer with content and cursor at a specific position
function buf(content: string, cursor: number, selection: TextBuffer['selection'] = null): TextBuffer {
  return { content, cursor, selection };
}

describe('emptyBuffer', () => {
  it('returns an empty buffer with cursor at 0 and no selection', () => {
    const b = emptyBuffer();
    expect(b.content).toBe('');
    expect(b.cursor).toBe(0);
    expect(b.selection).toBeNull();
  });
});

describe('helper functions', () => {
  describe('getLines', () => {
    it('splits single line', () => {
      expect(getLines(buf('hello', 0))).toEqual(['hello']);
    });
    it('splits multiple lines', () => {
      expect(getLines(buf('a\nb\nc', 0))).toEqual(['a', 'b', 'c']);
    });
    it('handles empty content', () => {
      expect(getLines(emptyBuffer())).toEqual(['']);
    });
  });

  describe('getCursorPosition', () => {
    it('returns line 0, col 0 for empty buffer', () => {
      expect(getCursorPosition(emptyBuffer())).toEqual({ line: 0, col: 0 });
    });
    it('returns correct position in single line', () => {
      expect(getCursorPosition(buf('hello', 3))).toEqual({ line: 0, col: 3 });
    });
    it('returns correct position in multi-line', () => {
      // "abc\ndef" cursor at 5 => line 1, col 1 (d=4, e=5)
      expect(getCursorPosition(buf('abc\ndef', 5))).toEqual({ line: 1, col: 1 });
    });
    it('cursor at start of second line', () => {
      expect(getCursorPosition(buf('abc\ndef', 4))).toEqual({ line: 1, col: 0 });
    });
  });

  describe('getSelectedText', () => {
    it('returns empty string when no selection', () => {
      expect(getSelectedText(buf('hello', 2))).toBe('');
    });
    it('returns selected text with forward selection', () => {
      expect(getSelectedText(buf('hello', 3, { anchor: 1, focus: 3 }))).toBe('el');
    });
    it('returns selected text with backward selection', () => {
      expect(getSelectedText(buf('hello', 1, { anchor: 3, focus: 1 }))).toBe('el');
    });
  });

  describe('getSelectionRange', () => {
    it('returns null when no selection', () => {
      expect(getSelectionRange(buf('hello', 0))).toBeNull();
    });
    it('normalizes forward selection', () => {
      expect(getSelectionRange(buf('hello', 3, { anchor: 1, focus: 3 }))).toEqual({ start: 1, end: 3 });
    });
    it('normalizes backward selection', () => {
      expect(getSelectionRange(buf('hello', 1, { anchor: 3, focus: 1 }))).toEqual({ start: 1, end: 3 });
    });
  });

  describe('isOnFirstLine / isOnLastLine', () => {
    it('single line: both true', () => {
      const b = buf('hello', 2);
      expect(isOnFirstLine(b)).toBe(true);
      expect(isOnLastLine(b)).toBe(true);
    });
    it('multi-line: first line', () => {
      const b = buf('abc\ndef\nghi', 2);
      expect(isOnFirstLine(b)).toBe(true);
      expect(isOnLastLine(b)).toBe(false);
    });
    it('multi-line: last line', () => {
      const b = buf('abc\ndef\nghi', 9);
      expect(isOnFirstLine(b)).toBe(false);
      expect(isOnLastLine(b)).toBe(true);
    });
    it('multi-line: middle line', () => {
      const b = buf('abc\ndef\nghi', 5);
      expect(isOnFirstLine(b)).toBe(false);
      expect(isOnLastLine(b)).toBe(false);
    });
  });
});

describe('movement functions', () => {
  describe('moveCursorLeft', () => {
    it('moves left by one', () => {
      const result = moveCursorLeft(buf('hello', 3));
      expect(result.cursor).toBe(2);
      expect(result.selection).toBeNull();
    });
    it('clamps at 0', () => {
      const result = moveCursorLeft(buf('hello', 0));
      expect(result.cursor).toBe(0);
    });
    it('collapses selection to start', () => {
      const result = moveCursorLeft(buf('hello', 3, { anchor: 1, focus: 3 }));
      expect(result.cursor).toBe(1);
      expect(result.selection).toBeNull();
    });
  });

  describe('moveCursorRight', () => {
    it('moves right by one', () => {
      const result = moveCursorRight(buf('hello', 2));
      expect(result.cursor).toBe(3);
      expect(result.selection).toBeNull();
    });
    it('clamps at content length', () => {
      const result = moveCursorRight(buf('hello', 5));
      expect(result.cursor).toBe(5);
    });
    it('collapses selection to end', () => {
      const result = moveCursorRight(buf('hello', 1, { anchor: 1, focus: 3 }));
      expect(result.cursor).toBe(3);
      expect(result.selection).toBeNull();
    });
  });

  describe('moveCursorUp', () => {
    it('moves to start on first line', () => {
      const result = moveCursorUp(buf('hello', 3));
      expect(result.cursor).toBe(0);
    });
    it('moves to previous line preserving column', () => {
      // "abc\ndef" cursor at pos 5 (line 1, col 1) => line 0, col 1 => pos 1
      const result = moveCursorUp(buf('abc\ndef', 5));
      expect(result.cursor).toBe(1);
    });
    it('clamps column if previous line is shorter', () => {
      // "ab\ndefgh" cursor at pos 7 (line 1, col 4) => line 0 has len 2, so col=2 => pos 2
      const result = moveCursorUp(buf('ab\ndefgh', 7));
      expect(result.cursor).toBe(2);
    });
  });

  describe('moveCursorDown', () => {
    it('moves to end on last line', () => {
      const result = moveCursorDown(buf('hello', 2));
      expect(result.cursor).toBe(5);
    });
    it('moves to next line preserving column', () => {
      // "abc\ndef" cursor at 1 (line 0, col 1) => line 1, col 1 => pos 5
      const result = moveCursorDown(buf('abc\ndef', 1));
      expect(result.cursor).toBe(5);
    });
    it('clamps column if next line is shorter', () => {
      // "abcde\nfg" cursor at 4 (line 0, col 4) => line 1 has len 2, col=2 => pos 8
      const result = moveCursorDown(buf('abcde\nfg', 4));
      expect(result.cursor).toBe(8);
    });
  });

  describe('moveCursorWordLeft', () => {
    it('jumps to start of current word', () => {
      const result = moveCursorWordLeft(buf('hello world', 8));
      expect(result.cursor).toBe(6);
    });
    it('skips punctuation and whitespace', () => {
      const result = moveCursorWordLeft(buf('foo, bar', 5));
      expect(result.cursor).toBe(0);
    });
    it('returns 0 at start', () => {
      const result = moveCursorWordLeft(buf('hello', 0));
      expect(result.cursor).toBe(0);
    });
  });

  describe('moveCursorWordRight', () => {
    it('jumps to start of next word', () => {
      const result = moveCursorWordRight(buf('hello world', 0));
      expect(result.cursor).toBe(6);
    });
    it('returns end at end', () => {
      const result = moveCursorWordRight(buf('hello', 5));
      expect(result.cursor).toBe(5);
    });
  });

  describe('moveCursorLineStart', () => {
    it('moves to start of current line', () => {
      const result = moveCursorLineStart(buf('abc\ndef', 6));
      expect(result.cursor).toBe(4);
    });
    it('already at start stays', () => {
      const result = moveCursorLineStart(buf('abc\ndef', 4));
      expect(result.cursor).toBe(4);
    });
  });

  describe('moveCursorLineEnd', () => {
    it('moves to end of current line', () => {
      const result = moveCursorLineEnd(buf('abc\ndef', 4));
      expect(result.cursor).toBe(7);
    });
    it('first line end', () => {
      const result = moveCursorLineEnd(buf('abc\ndef', 1));
      expect(result.cursor).toBe(3);
    });
  });

  describe('moveCursorDocStart', () => {
    it('moves to 0', () => {
      expect(moveCursorDocStart(buf('hello', 3)).cursor).toBe(0);
    });
  });

  describe('moveCursorDocEnd', () => {
    it('moves to content length', () => {
      expect(moveCursorDocEnd(buf('hello', 1)).cursor).toBe(5);
    });
  });
});

describe('selection functions', () => {
  describe('selectLeft / selectRight', () => {
    it('selectLeft creates selection', () => {
      const result = selectLeft(buf('hello', 3));
      expect(result.cursor).toBe(2);
      expect(result.selection).toEqual({ anchor: 3, focus: 2 });
    });
    it('selectRight creates selection', () => {
      const result = selectRight(buf('hello', 2));
      expect(result.cursor).toBe(3);
      expect(result.selection).toEqual({ anchor: 2, focus: 3 });
    });
    it('selectLeft extends existing selection', () => {
      const result = selectLeft(buf('hello', 2, { anchor: 4, focus: 2 }));
      expect(result.cursor).toBe(1);
      expect(result.selection).toEqual({ anchor: 4, focus: 1 });
    });
  });

  describe('selectUp / selectDown', () => {
    it('selectUp selects to previous line', () => {
      const result = selectUp(buf('abc\ndef', 5));
      expect(result.cursor).toBe(1);
      expect(result.selection!.anchor).toBe(5);
      expect(result.selection!.focus).toBe(1);
    });
    it('selectDown selects to next line', () => {
      const result = selectDown(buf('abc\ndef', 1));
      expect(result.cursor).toBe(5);
      expect(result.selection!.anchor).toBe(1);
      expect(result.selection!.focus).toBe(5);
    });
  });

  describe('selectWordLeft / selectWordRight', () => {
    it('selectWordLeft selects the word', () => {
      const result = selectWordLeft(buf('hello world', 8));
      expect(result.cursor).toBe(6);
      expect(result.selection).toEqual({ anchor: 8, focus: 6 });
    });
    it('selectWordRight selects to next word start', () => {
      const result = selectWordRight(buf('hello world', 0));
      expect(result.cursor).toBe(6);
      expect(result.selection).toEqual({ anchor: 0, focus: 6 });
    });
  });

  describe('selectLineStart / selectLineEnd', () => {
    it('selectLineStart selects to line start', () => {
      const result = selectLineStart(buf('abc\ndef', 6));
      expect(result.cursor).toBe(4);
      expect(result.selection).toEqual({ anchor: 6, focus: 4 });
    });
    it('selectLineEnd selects to line end', () => {
      const result = selectLineEnd(buf('abc\ndef', 4));
      expect(result.cursor).toBe(7);
      expect(result.selection).toEqual({ anchor: 4, focus: 7 });
    });
  });

  describe('selectDocStart / selectDocEnd', () => {
    it('selectDocStart selects to 0', () => {
      const result = selectDocStart(buf('hello', 3));
      expect(result.cursor).toBe(0);
      expect(result.selection).toEqual({ anchor: 3, focus: 0 });
    });
    it('selectDocEnd selects to end', () => {
      const result = selectDocEnd(buf('hello', 1));
      expect(result.cursor).toBe(5);
      expect(result.selection).toEqual({ anchor: 1, focus: 5 });
    });
  });

  describe('selectAll', () => {
    it('selects entire content', () => {
      const result = selectAll(buf('hello', 2));
      expect(result.cursor).toBe(5);
      expect(result.selection).toEqual({ anchor: 0, focus: 5 });
    });
    it('works on empty buffer', () => {
      const result = selectAll(emptyBuffer());
      expect(result.cursor).toBe(0);
      expect(result.selection).toEqual({ anchor: 0, focus: 0 });
    });
  });
});

describe('editing functions', () => {
  describe('insertText', () => {
    it('inserts at cursor position', () => {
      const result = insertText(buf('hllo', 1), 'e');
      expect(result.content).toBe('hello');
      expect(result.cursor).toBe(2);
    });
    it('inserts at end', () => {
      const result = insertText(buf('hell', 4), 'o');
      expect(result.content).toBe('hello');
      expect(result.cursor).toBe(5);
    });
    it('replaces selection', () => {
      const result = insertText(buf('hello', 3, { anchor: 1, focus: 3 }), 'a');
      expect(result.content).toBe('halo');
      expect(result.cursor).toBe(2);
      expect(result.selection).toBeNull();
    });
    it('inserts newline', () => {
      const result = insertText(buf('ab', 1), '\n');
      expect(result.content).toBe('a\nb');
      expect(result.cursor).toBe(2);
    });
    it('inserts multi-char text', () => {
      const result = insertText(buf('ad', 1), 'bc');
      expect(result.content).toBe('abcd');
      expect(result.cursor).toBe(3);
    });
  });

  describe('deleteBackward', () => {
    it('deletes char before cursor', () => {
      const result = deleteBackward(buf('hello', 3));
      expect(result.content).toBe('helo');
      expect(result.cursor).toBe(2);
    });
    it('does nothing at position 0', () => {
      const b = buf('hello', 0);
      const result = deleteBackward(b);
      expect(result).toBe(b);
    });
    it('deletes selection', () => {
      const result = deleteBackward(buf('hello', 3, { anchor: 1, focus: 3 }));
      expect(result.content).toBe('hlo');
      expect(result.cursor).toBe(1);
      expect(result.selection).toBeNull();
    });
  });

  describe('deleteForward', () => {
    it('deletes char after cursor', () => {
      const result = deleteForward(buf('hello', 2));
      expect(result.content).toBe('helo');
      expect(result.cursor).toBe(2);
    });
    it('does nothing at end', () => {
      const b = buf('hello', 5);
      const result = deleteForward(b);
      expect(result).toBe(b);
    });
    it('deletes selection', () => {
      const result = deleteForward(buf('hello', 1, { anchor: 1, focus: 4 }));
      expect(result.content).toBe('ho');
      expect(result.cursor).toBe(1);
    });
  });

  describe('deleteWordBackward', () => {
    it('deletes previous word', () => {
      const result = deleteWordBackward(buf('hello world', 11));
      expect(result.content).toBe('hello ');
      expect(result.cursor).toBe(6);
    });
    it('does nothing at position 0', () => {
      const b = buf('hello', 0);
      expect(deleteWordBackward(b)).toBe(b);
    });
    it('deletes selection instead of word', () => {
      const result = deleteWordBackward(buf('hello world', 5, { anchor: 2, focus: 5 }));
      expect(result.content).toBe('he world');
      expect(result.cursor).toBe(2);
    });
  });

  describe('deleteWordForward', () => {
    it('deletes next word and trailing non-word chars', () => {
      // wordBoundaryRight from 0: skips 'hello' then skips ' ' => 6
      const result = deleteWordForward(buf('hello world', 0));
      expect(result.content).toBe('world');
      expect(result.cursor).toBe(0);
    });
    it('does nothing at end', () => {
      const b = buf('hello', 5);
      expect(deleteWordForward(b)).toBe(b);
    });
    it('deletes selection instead of word', () => {
      const result = deleteWordForward(buf('hello world', 2, { anchor: 2, focus: 4 }));
      expect(result.content).toBe('heo world');
      expect(result.cursor).toBe(2);
    });
  });

  describe('deleteToLineStart', () => {
    it('deletes from cursor to line start', () => {
      const result = deleteToLineStart(buf('abc\ndef', 6));
      expect(result.content).toBe('abc\nf');
      expect(result.cursor).toBe(4);
    });
    it('does nothing when already at line start', () => {
      const b = buf('abc\ndef', 4);
      expect(deleteToLineStart(b)).toBe(b);
    });
    it('deletes selection when active', () => {
      const result = deleteToLineStart(buf('hello', 3, { anchor: 1, focus: 3 }));
      expect(result.content).toBe('hlo');
      expect(result.cursor).toBe(1);
    });
  });

  describe('deleteToLineEnd', () => {
    it('deletes from cursor to line end', () => {
      const result = deleteToLineEnd(buf('abc\ndef', 5));
      expect(result.content).toBe('abc\nd');
      expect(result.cursor).toBe(5);
    });
    it('does nothing when at line end', () => {
      const b = buf('abc\ndef', 3);
      expect(deleteToLineEnd(b)).toBe(b);
    });
    it('deletes selection when active', () => {
      const result = deleteToLineEnd(buf('hello', 4, { anchor: 1, focus: 4 }));
      expect(result.content).toBe('ho');
      expect(result.cursor).toBe(1);
    });
  });

  describe('transposeChars', () => {
    it('swaps characters around cursor', () => {
      const result = transposeChars(buf('abcd', 2));
      expect(result.content).toBe('acbd');
      expect(result.cursor).toBe(3);
    });
    it('at end of text, swaps last two chars', () => {
      const result = transposeChars(buf('abcd', 4));
      expect(result.content).toBe('abdc');
      expect(result.cursor).toBe(4);
    });
    it('does nothing at position 0', () => {
      const b = buf('abcd', 0);
      expect(transposeChars(b)).toBe(b);
    });
    it('does nothing with less than 2 chars', () => {
      const b = buf('a', 1);
      expect(transposeChars(b)).toBe(b);
    });
    it('does nothing with selection', () => {
      const b = buf('abcd', 2, { anchor: 1, focus: 2 });
      expect(transposeChars(b)).toBe(b);
    });
  });

  describe('openLine', () => {
    it('inserts newline without moving cursor', () => {
      const result = openLine(buf('hello', 3));
      expect(result.content).toBe('hel\nlo');
      expect(result.cursor).toBe(3);
    });
    it('works at start', () => {
      const result = openLine(buf('hello', 0));
      expect(result.content).toBe('\nhello');
      expect(result.cursor).toBe(0);
    });
  });
});

describe('selection-then-edit interactions', () => {
  it('insertText with selection replaces selected text', () => {
    const b = buf('hello world', 5, { anchor: 0, focus: 5 });
    const result = insertText(b, 'goodbye');
    expect(result.content).toBe('goodbye world');
    expect(result.cursor).toBe(7);
    expect(result.selection).toBeNull();
  });

  it('deleteBackward with selection removes selected text', () => {
    const b = buf('abcdef', 4, { anchor: 2, focus: 4 });
    const result = deleteBackward(b);
    expect(result.content).toBe('abef');
    expect(result.cursor).toBe(2);
    expect(result.selection).toBeNull();
  });

  it('deleteForward with selection removes selected text', () => {
    const b = buf('abcdef', 1, { anchor: 1, focus: 5 });
    const result = deleteForward(b);
    expect(result.content).toBe('af');
    expect(result.cursor).toBe(1);
    expect(result.selection).toBeNull();
  });
});
