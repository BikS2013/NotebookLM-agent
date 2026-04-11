import { Box, Text, useAnimation } from 'ink';
import type { AgentStatus, ToolCallInfo } from '../types.ts';

interface StatusBarProps {
  agentStatus: AgentStatus;
  activeToolCall: ToolCallInfo | null;
  sessionId: string;
}

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;

function StatusIndicator({
  agentStatus,
  activeToolCall,
  frame,
}: {
  agentStatus: AgentStatus;
  activeToolCall: ToolCallInfo | null;
  frame: number;
}) {
  const spinner = SPINNER_FRAMES[frame % SPINNER_FRAMES.length];

  switch (agentStatus) {
    case 'idle':
      return <Text color="green">{'● Ready'}</Text>;
    case 'thinking':
      return <Text color="yellow">{spinner} Thinking...</Text>;
    case 'streaming':
      return <Text color="cyan">{'◉ Streaming'}</Text>;
    case 'tool_call': {
      const toolName = activeToolCall?.name ?? 'unknown';
      return <Text color="yellow">{spinner} Calling {toolName}...</Text>;
    }
    case 'error':
      return <Text color="red">{'✗ Error'}</Text>;
  }
}

export default function StatusBar({ agentStatus, activeToolCall, sessionId }: StatusBarProps) {
  const isAnimating = agentStatus === 'thinking' || agentStatus === 'tool_call';
  const { frame } = useAnimation({ interval: 80, isActive: isAnimating });

  const abbreviatedSession = sessionId.slice(0, 8);

  return (
    <Box flexDirection="row" justifyContent="space-between" flexShrink={0}>
      <Box>
        <StatusIndicator
          agentStatus={agentStatus}
          activeToolCall={activeToolCall}
          frame={frame}
        />
      </Box>
      <Box>
        <Text dimColor>Session: {abbreviatedSession}</Text>
      </Box>
      <Box>
        <Text dimColor>Ctrl+C cancel | PgUp/PgDn scroll | /history /memory /new /last</Text>
      </Box>
    </Box>
  );
}

export type { StatusBarProps };
