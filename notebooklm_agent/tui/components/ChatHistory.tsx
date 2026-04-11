import { Box, Text } from 'ink';
import type { Message } from '../types.ts';
import { MessageBubble } from './MessageBubble.tsx';

interface ChatHistoryProps {
  messages: Message[];
  scrollOffset: number;
  terminalWidth: number;
}

/**
 * Estimate how many terminal lines a message will occupy.
 */
function estimateLineCount(msg: Message, terminalWidth: number): number {
  const effectiveWidth = Math.max(1, terminalWidth - 4);
  const prefix = 1; // role label line ("You" or "Agent")
  const gap = 1;    // blank line between messages (marginBottom)
  const contentLines = msg.text.split('\n').reduce((total, line) => {
    return total + Math.max(1, Math.ceil(line.length / effectiveWidth));
  }, 0);
  const toolLines = msg.toolCalls.length;
  return prefix + contentLines + toolLines + gap;
}

/**
 * Determine which messages are visible given the scroll offset.
 *
 * scrollOffset is measured in lines from the bottom (0 = at bottom).
 * We assume a generous visible height; the container's `overflow="hidden"`
 * handles clipping. We aim to render messages that would fall inside
 * the visible viewport.
 */
function computeVisibleMessages(
  messages: Message[],
  scrollOffset: number,
  terminalWidth: number,
  visibleHeight: number,
): { visible: Message[]; linesAbove: number; linesBelow: number } {
  if (messages.length === 0) {
    return { visible: [], linesAbove: 0, linesBelow: 0 };
  }

  // Compute per-message line counts
  const lineCounts = messages.map((m) => estimateLineCount(m, terminalWidth));
  const totalLines = lineCounts.reduce((a, b) => a + b, 0);

  if (totalLines <= visibleHeight) {
    // Everything fits
    return { visible: [...messages], linesAbove: 0, linesBelow: 0 };
  }

  // scrollOffset is lines from bottom. Convert to "skip from bottom".
  // The bottom-most `scrollOffset` lines are hidden below the viewport.
  // The top of the viewport starts at `totalLines - visibleHeight - scrollOffset` lines from the top.
  const scrollFromTop = Math.max(0, totalLines - visibleHeight - scrollOffset);

  // Walk from the top, skipping lines until we reach scrollFromTop
  let accumulated = 0;
  let startIdx = 0;
  for (startIdx = 0; startIdx < messages.length; startIdx++) {
    if (accumulated + lineCounts[startIdx]! > scrollFromTop) {
      break;
    }
    accumulated += lineCounts[startIdx]!;
  }

  const linesAbove = accumulated;

  // Collect messages that fit in visibleHeight
  let remaining = visibleHeight;
  let endIdx = startIdx;
  for (endIdx = startIdx; endIdx < messages.length && remaining > 0; endIdx++) {
    remaining -= lineCounts[endIdx]!;
  }

  // Lines below the viewport
  let linesBelow = 0;
  for (let i = endIdx; i < messages.length; i++) {
    linesBelow += lineCounts[i]!;
  }

  return {
    visible: messages.slice(startIdx, endIdx),
    linesAbove,
    linesBelow: linesBelow + Math.max(0, -remaining), // partial overflow counts as below
  };
}

export function ChatHistory({
  messages,
  scrollOffset,
  terminalWidth,
}: ChatHistoryProps): React.JSX.Element {
  // Use a reasonable default visible height; the actual clipping is
  // handled by the parent Box with overflow="hidden".
  // We estimate based on a typical terminal (rows minus status bar and input area).
  // The parent layout controls the real height; we use 40 as a safe estimation ceiling.
  const estimatedVisibleHeight = 40;

  const { visible, linesAbove } = computeVisibleMessages(
    messages,
    scrollOffset,
    terminalWidth,
    estimatedVisibleHeight,
  );

  return (
    <Box flexGrow={1} flexDirection="column" overflow="hidden">
      {/* Scroll-up indicator */}
      {linesAbove > 0 && (
        <Text dimColor>  ↑ {linesAbove} lines above</Text>
      )}

      {/* Visible messages */}
      {visible.map((msg) => (
        <MessageBubble key={msg.id} message={msg} />
      ))}

      {/* Empty state */}
      {messages.length === 0 && (
        <Box flexGrow={1} justifyContent="center" alignItems="center">
          <Text dimColor>Send a message to start the conversation.</Text>
        </Box>
      )}

      {/* Scroll-down indicator */}
      {scrollOffset > 0 && (
        <Text dimColor>  ↓ Scrolled {scrollOffset} lines</Text>
      )}
    </Box>
  );
}

export { estimateLineCount };
