import { useState, useEffect } from 'react';
import { Text } from 'ink';
import type { ToolCallInfo } from '../types.ts';

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;
const SPINNER_INTERVAL_MS = 80;

interface ToolCallIndicatorProps {
  toolCall: ToolCallInfo;
}

export function ToolCallIndicator({ toolCall }: ToolCallIndicatorProps): React.JSX.Element {
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    if (toolCall.status !== 'running') return;

    const timer = setInterval(() => {
      setFrameIndex((prev) => (prev + 1) % SPINNER_FRAMES.length);
    }, SPINNER_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [toolCall.status]);

  if (toolCall.status === 'running') {
    return (
      <Text color="yellow">
        {'  '}{SPINNER_FRAMES[frameIndex % SPINNER_FRAMES.length]} Calling {toolCall.name}...
      </Text>
    );
  }

  // Completed or error
  const icon = toolCall.status === 'completed' ? '✓' : '✗';
  return (
    <Text dimColor>
      {'  '}&gt; {icon} {toolCall.name}
    </Text>
  );
}
