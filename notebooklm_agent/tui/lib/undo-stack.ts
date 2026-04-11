/**
 * Operation-based undo/redo stack.
 * Consecutive character insertions within 300ms are grouped into a single operation.
 */

import type { Selection } from './text-buffer.ts';

/** Grouping threshold in milliseconds. */
const GROUP_THRESHOLD_MS = 300;

export interface UndoOperation {
  readonly type: 'insert' | 'delete' | 'replace';
  readonly position: number;
  readonly oldText: string;
  readonly newText: string;
  readonly cursorBefore: number;
  readonly selectionBefore: Selection | null;
  readonly cursorAfter: number;
  readonly timestamp: number;
}

export class UndoStack {
  private readonly maxDepth: number;
  private undoOps: UndoOperation[] = [];
  private redoOps: UndoOperation[] = [];

  constructor(maxDepth: number = 100) {
    this.maxDepth = maxDepth;
  }

  /** Record an edit operation. Clears redo stack. Groups consecutive inserts. */
  push(op: UndoOperation): void {
    // Try to group with the previous operation
    if (this.undoOps.length > 0) {
      const prev = this.undoOps[this.undoOps.length - 1]!;
      if (
        prev.type === 'insert' &&
        op.type === 'insert' &&
        op.oldText === '' &&
        prev.oldText === '' &&
        op.position === prev.position + prev.newText.length &&
        op.timestamp - prev.timestamp < GROUP_THRESHOLD_MS &&
        op.newText.length === 1 &&
        op.newText !== '\n'
      ) {
        // Merge: extend the previous insert operation
        this.undoOps[this.undoOps.length - 1] = {
          type: 'insert',
          position: prev.position,
          oldText: '',
          newText: prev.newText + op.newText,
          cursorBefore: prev.cursorBefore,
          selectionBefore: prev.selectionBefore,
          cursorAfter: op.cursorAfter,
          timestamp: op.timestamp,
        };
        this.redoOps = [];
        return;
      }
    }

    this.undoOps.push(op);
    if (this.undoOps.length > this.maxDepth) {
      this.undoOps.shift();
    }
    this.redoOps = [];
  }

  /** Undo the last operation. Returns the operation to reverse, or null. */
  undo(): UndoOperation | null {
    const op = this.undoOps.pop();
    if (!op) return null;
    this.redoOps.push(op);
    return op;
  }

  /** Redo the last undone operation. Returns the operation to apply, or null. */
  redo(): UndoOperation | null {
    const op = this.redoOps.pop();
    if (!op) return null;
    this.undoOps.push(op);
    return op;
  }

  get canUndo(): boolean {
    return this.undoOps.length > 0;
  }

  get canRedo(): boolean {
    return this.redoOps.length > 0;
  }

  /** Clear both stacks. */
  clear(): void {
    this.undoOps = [];
    this.redoOps = [];
  }
}
