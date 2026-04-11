import { Box, Text } from 'ink';
import type { Message } from '../types.ts';
import { ToolCallIndicator } from './ToolCallIndicator.tsx';

interface MessageBubbleProps {
  message: Message;
}

export function MessageBubble({ message }: MessageBubbleProps): React.JSX.Element {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* Role label */}
      {isSystem ? (
        <Text color="yellow" dimColor>[system]</Text>
      ) : isUser ? (
        <Text color="green" bold>You</Text>
      ) : (
        <Text color="cyan" bold>Agent{message.isPartial ? ' ▌' : ''}</Text>
      )}

      {/* Message text */}
      <Text wrap="wrap" dimColor={isSystem}>{message.text}</Text>

      {/* Tool call indicators (skip for system messages) */}
      {!isSystem && message.toolCalls.map((tc, index) => (
        <ToolCallIndicator key={`${tc.name}-${index}`} toolCall={tc} />
      ))}
    </Box>
  );
}
