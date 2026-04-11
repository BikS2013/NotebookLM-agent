import { describe, it, expect } from 'vitest';
import { UndoStack, UndoOperation } from '../notebooklm_agent/tui/lib/undo-stack.ts';

function makeOp(overrides: Partial<UndoOperation> = {}): UndoOperation {
  return {
    type: 'insert',
    position: 0,
    oldText: '',
    newText: 'a',
    cursorBefore: 0,
    selectionBefore: null,
    cursorAfter: 1,
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('UndoStack', () => {
  describe('undo on empty stack', () => {
    it('returns null', () => {
      const stack = new UndoStack();
      expect(stack.undo()).toBeNull();
    });
  });

  describe('push then undo', () => {
    it('returns the pushed operation', () => {
      const stack = new UndoStack();
      const op = makeOp({ newText: 'hello', cursorAfter: 5 });
      stack.push(op);
      const undone = stack.undo();
      expect(undone).toEqual(op);
    });
  });

  describe('redo after undo', () => {
    it('returns the undone operation', () => {
      const stack = new UndoStack();
      const op = makeOp({ newText: 'x', cursorAfter: 1 });
      stack.push(op);
      stack.undo();
      const redone = stack.redo();
      expect(redone).toEqual(op);
    });

    it('redo on empty redo stack returns null', () => {
      const stack = new UndoStack();
      expect(stack.redo()).toBeNull();
    });
  });

  describe('new edit after undo clears redo stack', () => {
    it('clears redo when new op is pushed', () => {
      const stack = new UndoStack();
      stack.push(makeOp({ newText: 'a', timestamp: 1000 }));
      stack.push(makeOp({ newText: 'b', position: 1, cursorBefore: 1, cursorAfter: 2, timestamp: 2000 }));
      stack.undo(); // undo 'b'
      expect(stack.canRedo).toBe(true);

      // New edit should clear redo
      stack.push(makeOp({ newText: 'c', position: 1, cursorBefore: 1, cursorAfter: 2, timestamp: 3000 }));
      expect(stack.canRedo).toBe(false);
      expect(stack.redo()).toBeNull();
    });
  });

  describe('canUndo / canRedo', () => {
    it('both false on empty stack', () => {
      const stack = new UndoStack();
      expect(stack.canUndo).toBe(false);
      expect(stack.canRedo).toBe(false);
    });
    it('canUndo true after push', () => {
      const stack = new UndoStack();
      stack.push(makeOp());
      expect(stack.canUndo).toBe(true);
      expect(stack.canRedo).toBe(false);
    });
    it('canRedo true after undo', () => {
      const stack = new UndoStack();
      stack.push(makeOp());
      stack.undo();
      expect(stack.canUndo).toBe(false);
      expect(stack.canRedo).toBe(true);
    });
  });

  describe('grouping', () => {
    it('groups consecutive single-char inserts within 300ms', () => {
      const stack = new UndoStack();
      const now = 1000;
      stack.push(makeOp({ newText: 'a', position: 0, cursorBefore: 0, cursorAfter: 1, timestamp: now }));
      stack.push(makeOp({ newText: 'b', position: 1, cursorBefore: 1, cursorAfter: 2, timestamp: now + 100 }));
      stack.push(makeOp({ newText: 'c', position: 2, cursorBefore: 2, cursorAfter: 3, timestamp: now + 200 }));

      // All three should be grouped into one operation
      const undone = stack.undo();
      expect(undone!.newText).toBe('abc');
      expect(undone!.position).toBe(0);
      expect(undone!.cursorBefore).toBe(0);
      expect(undone!.cursorAfter).toBe(3);

      // Nothing more to undo
      expect(stack.canUndo).toBe(false);
    });

    it('does not group if time gap exceeds 300ms', () => {
      const stack = new UndoStack();
      stack.push(makeOp({ newText: 'a', position: 0, cursorAfter: 1, timestamp: 1000 }));
      stack.push(makeOp({ newText: 'b', position: 1, cursorBefore: 1, cursorAfter: 2, timestamp: 1500 }));

      const undone1 = stack.undo();
      expect(undone1!.newText).toBe('b');
      const undone2 = stack.undo();
      expect(undone2!.newText).toBe('a');
    });

    it('does not group newline inserts', () => {
      const stack = new UndoStack();
      const now = 1000;
      stack.push(makeOp({ newText: 'a', position: 0, cursorAfter: 1, timestamp: now }));
      stack.push(makeOp({ newText: '\n', position: 1, cursorBefore: 1, cursorAfter: 2, timestamp: now + 50 }));

      const undone1 = stack.undo();
      expect(undone1!.newText).toBe('\n');
      const undone2 = stack.undo();
      expect(undone2!.newText).toBe('a');
    });

    it('groups single-char insert after multi-char insert if positions are consecutive', () => {
      // The grouping only checks if the NEW op is single-char, not the previous.
      // So 'ab' at pos 0 followed by 'c' at pos 2 within 300ms WILL be grouped.
      const stack = new UndoStack();
      const now = 1000;
      stack.push(makeOp({ newText: 'ab', position: 0, cursorAfter: 2, timestamp: now }));
      stack.push(makeOp({ newText: 'c', position: 2, cursorBefore: 2, cursorAfter: 3, timestamp: now + 50 }));

      const undone1 = stack.undo();
      expect(undone1!.newText).toBe('abc');
      expect(stack.canUndo).toBe(false);
    });

    it('does not group when new op is multi-char', () => {
      const stack = new UndoStack();
      const now = 1000;
      stack.push(makeOp({ newText: 'a', position: 0, cursorAfter: 1, timestamp: now }));
      stack.push(makeOp({ newText: 'bc', position: 1, cursorBefore: 1, cursorAfter: 3, timestamp: now + 50 }));

      // 'bc' is multi-char so it should NOT be grouped
      const undone1 = stack.undo();
      expect(undone1!.newText).toBe('bc');
      const undone2 = stack.undo();
      expect(undone2!.newText).toBe('a');
    });

    it('does not group non-consecutive positions', () => {
      const stack = new UndoStack();
      const now = 1000;
      stack.push(makeOp({ newText: 'a', position: 0, cursorAfter: 1, timestamp: now }));
      stack.push(makeOp({ newText: 'b', position: 5, cursorBefore: 5, cursorAfter: 6, timestamp: now + 50 }));

      const undone1 = stack.undo();
      expect(undone1!.newText).toBe('b');
      const undone2 = stack.undo();
      expect(undone2!.newText).toBe('a');
    });

    it('does not group delete operations', () => {
      const stack = new UndoStack();
      const now = 1000;
      stack.push(makeOp({ type: 'delete', newText: '', oldText: 'a', position: 0, cursorAfter: 0, timestamp: now }));
      stack.push(makeOp({ type: 'delete', newText: '', oldText: 'b', position: 0, cursorAfter: 0, timestamp: now + 50 }));

      const undone1 = stack.undo();
      expect(undone1!.type).toBe('delete');
      expect(undone1!.oldText).toBe('b');
      const undone2 = stack.undo();
      expect(undone2!.oldText).toBe('a');
    });
  });

  describe('max depth', () => {
    it('drops oldest when exceeding maxDepth', () => {
      const stack = new UndoStack(3);
      stack.push(makeOp({ newText: 'first', position: 0, cursorAfter: 5, timestamp: 1000 }));
      stack.push(makeOp({ newText: 'second', position: 5, cursorBefore: 5, cursorAfter: 11, timestamp: 2000 }));
      stack.push(makeOp({ newText: 'third', position: 11, cursorBefore: 11, cursorAfter: 16, timestamp: 3000 }));
      stack.push(makeOp({ newText: 'fourth', position: 16, cursorBefore: 16, cursorAfter: 22, timestamp: 4000 }));

      // 'first' should be dropped
      const u1 = stack.undo();
      expect(u1!.newText).toBe('fourth');
      const u2 = stack.undo();
      expect(u2!.newText).toBe('third');
      const u3 = stack.undo();
      expect(u3!.newText).toBe('second');
      expect(stack.undo()).toBeNull(); // 'first' was dropped
    });
  });

  describe('clear', () => {
    it('resets both stacks', () => {
      const stack = new UndoStack();
      stack.push(makeOp({ timestamp: 1000 }));
      stack.push(makeOp({ newText: 'b', position: 1, cursorBefore: 1, cursorAfter: 2, timestamp: 2000 }));
      stack.undo(); // move one to redo

      expect(stack.canUndo).toBe(true);
      expect(stack.canRedo).toBe(true);

      stack.clear();
      expect(stack.canUndo).toBe(false);
      expect(stack.canRedo).toBe(false);
      expect(stack.undo()).toBeNull();
      expect(stack.redo()).toBeNull();
    });
  });
});
