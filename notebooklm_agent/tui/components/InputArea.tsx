/**
 * InputArea component: multi-line text input with cursor and selection rendering.
 * Grows from 1 to 10 lines, then scrolls internally.
 */

import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import type { TextBuffer, SelectionRange } from '../lib/text-buffer.ts';

const MAX_VISIBLE_LINES = 10;
const PROMPT_PREFIX = '> ';

interface InputAreaProps {
  buffer: TextBuffer;
  cursorLine: number;
  cursorCol: number;
  selectionRange: SelectionRange | null;
  isDisabled: boolean;
}

/**
 * Compute which lines are visible when content exceeds MAX_VISIBLE_LINES.
 * Returns a scrollStart index to keep the cursor line visible.
 */
function computeScrollStart(totalLines: number, cursorLine: number): number {
  if (totalLines <= MAX_VISIBLE_LINES) return 0;
  // Keep cursor line within the visible window
  const maxStart = totalLines - MAX_VISIBLE_LINES;
  // Try to put cursor roughly in the middle of the visible area
  const idealStart = cursorLine - Math.floor(MAX_VISIBLE_LINES / 2);
  return Math.max(0, Math.min(idealStart, maxStart));
}

/**
 * Compute absolute character offsets for the start of each line.
 */
function lineOffsets(content: string): number[] {
  const offsets = [0];
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') {
      offsets.push(i + 1);
    }
  }
  return offsets;
}

/**
 * Render a single line with cursor and/or selection highlighting.
 */
function renderLine(
  lineText: string,
  lineIndex: number,
  lineAbsStart: number,
  cursorLine: number,
  cursorCol: number,
  selectionRange: SelectionRange | null,
  isDisabled: boolean,
): React.ReactNode {
  const lineAbsEnd = lineAbsStart + lineText.length;
  const hasCursor = !isDisabled && lineIndex === cursorLine;
  const prefix = lineIndex === 0 ? PROMPT_PREFIX : '  ';

  // Determine if selection intersects this line
  let selStart = -1;
  let selEnd = -1;
  if (selectionRange) {
    selStart = Math.max(selectionRange.start - lineAbsStart, 0);
    selEnd = Math.min(selectionRange.end - lineAbsStart, lineText.length);
    if (selStart >= selEnd || selectionRange.end <= lineAbsStart || selectionRange.start >= lineAbsEnd) {
      selStart = -1;
      selEnd = -1;
    }
  }

  const hasSelection = selStart >= 0 && selEnd >= 0;

  // Simple case: no cursor, no selection
  if (!hasCursor && !hasSelection) {
    return (
      <Box key={lineIndex}>
        <Text dimColor>{prefix}</Text>
        <Text>{lineText || ' '}</Text>
      </Box>
    );
  }

  // Build segments for the line
  const display = lineText || ' ';
  const segments: React.ReactNode[] = [];
  let segKey = 0;

  if (hasSelection && hasCursor) {
    // Both selection and cursor on this line
    const cursorPos = cursorCol;
    // Build character-by-character for simplicity
    for (let i = 0; i < display.length; i++) {
      const ch = display[i]!;
      const inSelection = i >= selStart && i < selEnd;
      const isCursor = i === cursorPos;

      if (isCursor) {
        segments.push(
          <Text key={segKey++} inverse backgroundColor={inSelection ? 'blue' : undefined}>{ch}</Text>,
        );
      } else if (inSelection) {
        segments.push(
          <Text key={segKey++} backgroundColor="blue">{ch}</Text>,
        );
      } else {
        segments.push(
          <Text key={segKey++}>{ch}</Text>,
        );
      }
    }
    // If cursor is at the end of the line
    if (cursorPos >= display.length) {
      segments.push(<Text key={segKey++} inverse>{' '}</Text>);
    }
  } else if (hasCursor) {
    // Cursor only
    const cursorPos = cursorCol;
    const before = display.slice(0, cursorPos);
    const cursorChar = cursorPos < display.length ? display[cursorPos]! : ' ';
    const after = cursorPos < display.length ? display.slice(cursorPos + 1) : '';

    if (before) segments.push(<Text key={segKey++}>{before}</Text>);
    segments.push(<Text key={segKey++} inverse>{cursorChar}</Text>);
    if (after) segments.push(<Text key={segKey++}>{after}</Text>);
  } else {
    // Selection only (no cursor on this line)
    const before = display.slice(0, selStart);
    const selected = display.slice(selStart, selEnd);
    const after = display.slice(selEnd);

    if (before) segments.push(<Text key={segKey++}>{before}</Text>);
    if (selected) segments.push(<Text key={segKey++} backgroundColor="blue">{selected}</Text>);
    if (after) segments.push(<Text key={segKey++}>{after}</Text>);
  }

  return (
    <Box key={lineIndex}>
      <Text dimColor>{prefix}</Text>
      {segments}
    </Box>
  );
}

export function InputArea({ buffer, cursorLine, cursorCol, selectionRange, isDisabled }: InputAreaProps): React.ReactNode {
  const lines = useMemo(() => buffer.content.split('\n'), [buffer.content]);
  const offsets = useMemo(() => lineOffsets(buffer.content), [buffer.content]);

  const scrollStart = computeScrollStart(lines.length, cursorLine);
  const visibleLines = lines.slice(scrollStart, scrollStart + MAX_VISIBLE_LINES);
  const contentHeight = Math.min(lines.length, MAX_VISIBLE_LINES);
  const borderColor = isDisabled ? 'gray' : 'cyan';

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={borderColor}
      height={contentHeight + 2}
      flexShrink={0}
    >
      {visibleLines.map((lineText, i) => {
        const actualLineIndex = scrollStart + i;
        const absStart = offsets[actualLineIndex] ?? 0;
        return renderLine(
          lineText,
          actualLineIndex,
          absStart,
          cursorLine,
          cursorCol,
          selectionRange,
          isDisabled,
        );
      })}
    </Box>
  );
}
