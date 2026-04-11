/**
 * Pure formatting functions for TUI slash commands.
 *
 * These functions accept structured data and return formatted strings.
 * No React dependency — suitable for unit testing.
 */

import type { Event } from '@google/adk';
import type { Message } from '../types.ts';

/**
 * Format the conversation history for the /history command.
 */
export function formatHistory(messages: Message[]): string {
  if (messages.length === 0) {
    return 'No messages in the current session.';
  }

  const blocks: string[] = [];

  for (const msg of messages) {
    const roleLabel = msg.role.toUpperCase();
    const timestamp = new Date(msg.timestamp).toISOString();
    const header = `[${roleLabel}] ${timestamp}`;

    const bodyLines = msg.text
      .split('\n')
      .map((line) => `  ${line}`)
      .join('\n');

    let block = `${header}\n${bodyLines}`;

    if (msg.toolCalls.length > 0) {
      block += '\n  Tool calls:';
      for (const tc of msg.toolCalls) {
        block += `\n    ${tc.name}(${JSON.stringify(tc.args)}) [${tc.status}]`;
      }
    }

    blocks.push(block);
  }

  return blocks.join('\n\n');
}

/**
 * Format the ADK session state for the /memory command.
 */
export function formatSessionState(
  state: Record<string, unknown>,
  sessionId: string,
): string {
  const keys = Object.keys(state).sort();

  if (keys.length === 0) {
    return 'Session state is empty.';
  }

  const header = `Session State (session: ${sessionId})`;
  const lines = keys.map((key) => `  ${key}: ${JSON.stringify(state[key])}`);

  return [header, ...lines].join('\n');
}

/**
 * Format the last user-to-model exchange for the /last command.
 *
 * Extracts the last user event and all subsequent response events from the
 * ADK session events array.
 */
export function formatLastExchange(events: Event[]): string {
  if (events.length === 0) {
    return 'No request/response data available.';
  }

  // Find the last user event by scanning backward
  let lastUserIdx = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].author === 'user') {
      lastUserIdx = i;
      break;
    }
  }

  if (lastUserIdx === -1) {
    return 'No request/response data available.';
  }

  // Extract request content
  const userEvent = events[lastUserIdx];
  const requestLines: string[] = [];
  const userParts = userEvent.content?.parts ?? [];
  for (const part of userParts) {
    let handled = false;
    if (part.text) {
      requestLines.push(part.text);
      handled = true;
    }
    if (part.functionCall) {
      requestLines.push(
        `Function Call: ${part.functionCall.name}(${JSON.stringify(part.functionCall.args)})`,
      );
      handled = true;
    }
    if (part.functionResponse) {
      requestLines.push(
        `Function Response: ${part.functionResponse.name}`,
      );
      handled = true;
    }
    if (!handled) {
      const keys = Object.keys(part).filter((k) => part[k as keyof typeof part] !== undefined);
      requestLines.push(`[${keys.join(', ')}]`);
    }
  }

  // Extract response events (everything after the user event)
  const responseEvents = events.slice(lastUserIdx + 1);

  const responseLines: string[] = [];
  let lastUsageMetadata: Event['usageMetadata'] | undefined;

  for (const evt of responseEvents) {
    const parts = evt.content?.parts ?? [];
    for (const part of parts) {
      if (part.text) {
        responseLines.push(part.text);
      }
      if (part.functionCall) {
        responseLines.push(
          `Tool Call: ${part.functionCall.name}(${JSON.stringify(part.functionCall.args)})`,
        );
      }
      if (part.functionResponse) {
        let resultStr = JSON.stringify(part.functionResponse.response);
        if (resultStr && resultStr.length > 500) {
          resultStr = resultStr.slice(0, 500) + '... (truncated)';
        }
        responseLines.push(
          `Tool Result: ${part.functionResponse.name} -> ${resultStr}`,
        );
      }
    }
    if (evt.usageMetadata) {
      lastUsageMetadata = evt.usageMetadata;
    }
  }

  if (responseLines.length === 0 && responseEvents.length === 0) {
    responseLines.push('(awaiting response)');
  }

  // Add token usage if available
  if (lastUsageMetadata) {
    const prompt = lastUsageMetadata.promptTokenCount ?? '?';
    const completion = lastUsageMetadata.candidatesTokenCount;
    if (completion !== undefined) {
      responseLines.push(`\nTokens: ${prompt} prompt / ${completion} completion`);
    } else {
      responseLines.push(`\nTokens: ${prompt} prompt`);
    }
  }

  const sections = [
    '--- Last Request ---',
    requestLines.join('\n') || '(empty)',
    '',
    '--- Last Response ---',
    responseLines.join('\n') || '(empty)',
  ];

  return sections.join('\n');
}
