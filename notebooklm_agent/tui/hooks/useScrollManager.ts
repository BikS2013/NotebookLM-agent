import { useState, useCallback, useRef } from 'react';

export interface UseScrollManagerResult {
  /** Lines scrolled from the bottom (0 = at bottom) */
  scrollOffset: number;
  /** Whether the view is pinned to the bottom */
  isAtBottom: boolean;
  /** Scroll up by the given number of lines */
  scrollUp(lines: number): void;
  /** Scroll down by the given number of lines */
  scrollDown(lines: number): void;
  /** Jump to the very top of the history */
  scrollToTop(): void;
  /** Jump to the very bottom of the history */
  scrollToBottom(): void;
  /** Called when a new message arrives; auto-scrolls if already at bottom */
  onNewMessage(): void;
  /** Update the maximum scroll offset (total lines - visible height) */
  setMaxScroll(max: number): void;
}

export function useScrollManager(): UseScrollManagerResult {
  const [scrollOffset, setScrollOffset] = useState(0);
  const maxScrollRef = useRef(0);

  const isAtBottom = scrollOffset === 0;

  const scrollUp = useCallback((lines: number) => {
    setScrollOffset((prev) => {
      const next = prev + lines;
      return Math.min(next, maxScrollRef.current);
    });
  }, []);

  const scrollDown = useCallback((lines: number) => {
    setScrollOffset((prev) => {
      const next = prev - lines;
      return Math.max(next, 0);
    });
  }, []);

  const scrollToTop = useCallback(() => {
    setScrollOffset(maxScrollRef.current);
  }, []);

  const scrollToBottom = useCallback(() => {
    setScrollOffset(0);
  }, []);

  const onNewMessage = useCallback(() => {
    // Auto-scroll only if already at the bottom
    setScrollOffset((prev) => (prev === 0 ? 0 : prev));
  }, []);

  const setMaxScroll = useCallback((max: number) => {
    maxScrollRef.current = Math.max(0, max);
    // Clamp current offset if it exceeds the new max
    setScrollOffset((prev) => Math.min(prev, Math.max(0, max)));
  }, []);

  return {
    scrollOffset,
    isAtBottom,
    scrollUp,
    scrollDown,
    scrollToTop,
    scrollToBottom,
    onNewMessage,
    setMaxScroll,
  };
}
