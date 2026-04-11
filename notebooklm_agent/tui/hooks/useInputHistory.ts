/**
 * React hook for input history recall (Up/Down arrow).
 * Stores up to 50 entries. recallPrevious saves current text before navigating.
 */

import { useState, useCallback, useRef } from 'react';

const MAX_HISTORY = 50;

export interface UseInputHistoryResult {
  /** Navigate to the previous (older) history entry. Returns the entry text or null. */
  recallPrevious(currentText: string): string | null;
  /** Navigate to the next (newer) history entry. Returns the entry text or null. */
  recallNext(): string | null;
  /** Add a new entry to the history (called on submit). */
  addEntry(text: string): void;
}

export function useInputHistory(): UseInputHistoryResult {
  const historyRef = useRef<string[]>([]);
  const indexRef = useRef<number>(-1);
  const savedTextRef = useRef<string>('');

  const recallPrevious = useCallback((currentText: string): string | null => {
    const history = historyRef.current;
    if (history.length === 0) return null;

    // If we are at the bottom (no recall active), save current text
    if (indexRef.current === -1) {
      savedTextRef.current = currentText;
      indexRef.current = history.length - 1;
    } else if (indexRef.current > 0) {
      indexRef.current--;
    } else {
      return null; // already at the oldest entry
    }

    return history[indexRef.current]!;
  }, []);

  const recallNext = useCallback((): string | null => {
    if (indexRef.current === -1) return null;

    const history = historyRef.current;
    indexRef.current++;

    if (indexRef.current >= history.length) {
      // Back to the bottom — restore the saved text
      indexRef.current = -1;
      return savedTextRef.current;
    }

    return history[indexRef.current]!;
  }, []);

  const addEntry = useCallback((text: string): void => {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;

    const history = historyRef.current;

    // Deduplicate: if last entry is the same, skip
    if (history.length > 0 && history[history.length - 1] === trimmed) {
      indexRef.current = -1;
      return;
    }

    history.push(trimmed);
    if (history.length > MAX_HISTORY) {
      history.shift();
    }

    // Reset navigation index
    indexRef.current = -1;
  }, []);

  return { recallPrevious, recallNext, addEntry };
}
