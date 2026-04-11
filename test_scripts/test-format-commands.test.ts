import { describe, it, expect } from 'vitest';
import {
  formatHistory,
  formatSessionState,
  formatLastExchange,
} from '../notebooklm_agent/tui/lib/format-commands.ts';
import type { Message } from '../notebooklm_agent/tui/types.ts';
import type { Event } from '@google/adk';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMessage(overrides: Partial<Message> & { role: Message['role']; text: string }): Message {
  const { role, text, ...rest } = overrides;
  return {
    id: 'msg-' + Math.random().toString(36).slice(2),
    role,
    text,
    isPartial: false,
    toolCalls: [],
    timestamp: Date.now(),
    ...rest,
  };
}

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: 'evt-' + Math.random().toString(36).slice(2),
    invocationId: 'inv-1',
    author: 'user',
    actions: {
      stateDelta: {},
      artifactDelta: {},
      requestedAuthConfigs: {},
    },
    timestamp: Date.now(),
    ...overrides,
  } as Event;
}

// ---------------------------------------------------------------------------
// formatHistory
// ---------------------------------------------------------------------------

describe('formatHistory', () => {
  it('returns fallback for empty messages', () => {
    expect(formatHistory([])).toBe('No messages in the current session.');
  });

  it('formats a single user message', () => {
    const msg = makeMessage({ role: 'user', text: 'Hello', timestamp: 1712836800000 });
    const result = formatHistory([msg]);
    expect(result).toContain('[USER]');
    expect(result).toContain('  Hello');
  });

  it('formats a single agent message', () => {
    const msg = makeMessage({ role: 'agent', text: 'Hi there' });
    const result = formatHistory([msg]);
    expect(result).toContain('[AGENT]');
    expect(result).toContain('  Hi there');
  });

  it('formats a system message', () => {
    const msg = makeMessage({ role: 'system', text: 'System info' });
    const result = formatHistory([msg]);
    expect(result).toContain('[SYSTEM]');
    expect(result).toContain('  System info');
  });

  it('includes ISO timestamp', () => {
    const ts = 1712836800000; // 2024-04-11T12:00:00.000Z
    const msg = makeMessage({ role: 'user', text: 'Test', timestamp: ts });
    const result = formatHistory([msg]);
    expect(result).toContain(new Date(ts).toISOString());
  });

  it('formats agent message with tool calls', () => {
    const msg = makeMessage({
      role: 'agent',
      text: 'Working on it',
      toolCalls: [
        { name: 'search_youtube', args: { query: 'AI agents' }, status: 'completed' },
        { name: 'get_video_info', args: { video_id: 'abc123' }, status: 'running' },
      ],
    });
    const result = formatHistory([msg]);
    expect(result).toContain('Tool calls:');
    expect(result).toContain('search_youtube({"query":"AI agents"}) [completed]');
    expect(result).toContain('get_video_info({"video_id":"abc123"}) [running]');
  });

  it('separates multiple messages with blank lines', () => {
    const msgs = [
      makeMessage({ role: 'user', text: 'First' }),
      makeMessage({ role: 'agent', text: 'Second' }),
      makeMessage({ role: 'user', text: 'Third' }),
    ];
    const result = formatHistory(msgs);
    expect(result.split('\n\n').length).toBe(3);
  });

  it('indents multi-line text with 2 spaces', () => {
    const msg = makeMessage({ role: 'user', text: 'Line one\nLine two\nLine three' });
    const result = formatHistory([msg]);
    expect(result).toContain('  Line one\n  Line two\n  Line three');
  });

  it('does not show tool calls section when toolCalls is empty', () => {
    const msg = makeMessage({ role: 'agent', text: 'No tools', toolCalls: [] });
    const result = formatHistory([msg]);
    expect(result).not.toContain('Tool calls:');
  });
});

// ---------------------------------------------------------------------------
// formatSessionState
// ---------------------------------------------------------------------------

describe('formatSessionState', () => {
  it('returns fallback for empty state', () => {
    expect(formatSessionState({}, 'sess-1')).toBe('Session state is empty.');
  });

  it('formats a string value', () => {
    const result = formatSessionState({ name: 'test' }, 'sess-1');
    expect(result).toContain('  name: "test"');
  });

  it('formats a boolean value', () => {
    const result = formatSessionState({ flag: true }, 'sess-1');
    expect(result).toContain('  flag: true');
  });

  it('formats a null value', () => {
    const result = formatSessionState({ x: null }, 'sess-1');
    expect(result).toContain('  x: null');
  });

  it('formats a number value', () => {
    const result = formatSessionState({ count: 42 }, 'sess-1');
    expect(result).toContain('  count: 42');
  });

  it('formats an object value as JSON', () => {
    const result = formatSessionState({ data: { a: 1 } }, 'sess-1');
    expect(result).toContain('  data: {"a":1}');
  });

  it('sorts keys alphabetically', () => {
    const result = formatSessionState({ z: 1, a: 2, m: 3 }, 'sess-1');
    const lines = result.split('\n').slice(1); // skip header
    expect(lines[0]).toContain('a:');
    expect(lines[1]).toContain('m:');
    expect(lines[2]).toContain('z:');
  });

  it('includes session ID in header', () => {
    const result = formatSessionState({ key: 'val' }, 'abc-123');
    expect(result).toContain('Session State (session: abc-123)');
  });
});

// ---------------------------------------------------------------------------
// formatLastExchange
// ---------------------------------------------------------------------------

describe('formatLastExchange', () => {
  it('returns fallback for empty events', () => {
    expect(formatLastExchange([])).toBe('No request/response data available.');
  });

  it('returns fallback when no user events exist', () => {
    const events = [
      makeEvent({ author: 'agent', content: { parts: [{ text: 'Hello' }], role: 'model' } }),
    ];
    expect(formatLastExchange(events)).toBe('No request/response data available.');
  });

  it('shows request with awaiting response when user event is last', () => {
    const events = [
      makeEvent({ author: 'user', content: { parts: [{ text: 'List notebooks' }], role: 'user' } }),
    ];
    const result = formatLastExchange(events);
    expect(result).toContain('--- Last Request ---');
    expect(result).toContain('List notebooks');
    expect(result).toContain('--- Last Response ---');
    expect(result).toContain('(awaiting response)');
  });

  it('shows both request and text response', () => {
    const events = [
      makeEvent({ author: 'user', content: { parts: [{ text: 'Hello' }], role: 'user' } }),
      makeEvent({ author: 'agent', content: { parts: [{ text: 'Hi there!' }], role: 'model' } }),
    ];
    const result = formatLastExchange(events);
    expect(result).toContain('--- Last Request ---');
    expect(result).toContain('Hello');
    expect(result).toContain('--- Last Response ---');
    expect(result).toContain('Hi there!');
  });

  it('shows function calls in response', () => {
    const events = [
      makeEvent({ author: 'user', content: { parts: [{ text: 'Search' }], role: 'user' } }),
      makeEvent({
        author: 'agent',
        content: {
          parts: [{ functionCall: { name: 'search_youtube', args: { query: 'AI' } } }],
          role: 'model',
        },
      }),
    ];
    const result = formatLastExchange(events);
    expect(result).toContain('Tool Call: search_youtube({"query":"AI"})');
  });

  it('shows function responses in response', () => {
    const events = [
      makeEvent({ author: 'user', content: { parts: [{ text: 'Search' }], role: 'user' } }),
      makeEvent({
        author: 'agent',
        content: {
          parts: [{
            functionResponse: {
              name: 'search_youtube',
              response: { status: 'success', results: [] },
            },
          }],
          role: 'model',
        },
      }),
    ];
    const result = formatLastExchange(events);
    expect(result).toContain('Tool Result: search_youtube ->');
    expect(result).toContain('"status":"success"');
  });

  it('shows token usage when usageMetadata is present', () => {
    const events = [
      makeEvent({ author: 'user', content: { parts: [{ text: 'Hi' }], role: 'user' } }),
      makeEvent({
        author: 'agent',
        content: { parts: [{ text: 'Hello' }], role: 'model' },
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 50,
        },
      } as Partial<Event>),
    ];
    const result = formatLastExchange(events);
    expect(result).toContain('Tokens: 100 prompt / 50 completion');
  });

  it('truncates long function response results', () => {
    const longValue = 'x'.repeat(600);
    const events = [
      makeEvent({ author: 'user', content: { parts: [{ text: 'Go' }], role: 'user' } }),
      makeEvent({
        author: 'agent',
        content: {
          parts: [{
            functionResponse: { name: 'big_tool', response: { data: longValue } },
          }],
          role: 'model',
        },
      }),
    ];
    const result = formatLastExchange(events);
    expect(result).toContain('... (truncated)');
  });

  it('shows multiple response events in order', () => {
    const events = [
      makeEvent({ author: 'user', content: { parts: [{ text: 'Go' }], role: 'user' } }),
      makeEvent({ author: 'agent', content: { parts: [{ text: 'First' }], role: 'model' } }),
      makeEvent({ author: 'agent', content: { parts: [{ text: 'Second' }], role: 'model' } }),
      makeEvent({ author: 'agent', content: { parts: [{ text: 'Third' }], role: 'model' } }),
    ];
    const result = formatLastExchange(events);
    const firstIdx = result.indexOf('First');
    const secondIdx = result.indexOf('Second');
    const thirdIdx = result.indexOf('Third');
    expect(firstIdx).toBeLessThan(secondIdx);
    expect(secondIdx).toBeLessThan(thirdIdx);
  });

  it('uses the last user event when multiple exist', () => {
    const events = [
      makeEvent({ author: 'user', content: { parts: [{ text: 'First question' }], role: 'user' } }),
      makeEvent({ author: 'agent', content: { parts: [{ text: 'First answer' }], role: 'model' } }),
      makeEvent({ author: 'user', content: { parts: [{ text: 'Second question' }], role: 'user' } }),
      makeEvent({ author: 'agent', content: { parts: [{ text: 'Second answer' }], role: 'model' } }),
    ];
    const result = formatLastExchange(events);
    // Should show the last user event, not the first
    expect(result).toContain('Second question');
    expect(result).toContain('Second answer');
    // First exchange should NOT be in the output
    expect(result).not.toContain('First question');
    expect(result).not.toContain('First answer');
  });
});
