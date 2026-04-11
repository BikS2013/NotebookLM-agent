import { describe, it, expect } from 'vitest';
import { createNdjsonParser } from '../proxy-inspector/src/main/ndjson-parser.js';

// ── Helper: build a valid NDJSON line ──

function makeLine(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    event: 'interaction_start',
    timestamp: '2026-04-11T06:58:50.936Z',
    interactionId: 'id-001',
    payload: { userMessage: 'hi' },
    ...overrides,
  });
}

// ── Single-line parsing (via push with trailing newline) ──

describe('NdjsonParser - single line validation', () => {
  it('parses a valid interaction_start line', () => {
    const parser = createNdjsonParser();
    const results = parser.push(makeLine() + '\n');
    expect(results).toHaveLength(1);
    expect(results[0].event).toBe('interaction_start');
    expect(results[0].interactionId).toBe('id-001');
    expect(results[0].lineIndex).toBe(0);
    expect(results[0].payload).toEqual({ userMessage: 'hi' });
  });

  it('parses all valid event types', () => {
    const types = [
      'interaction_start', 'llm_request', 'llm_response',
      'tool_start', 'tool_result', 'tool_error',
      'llm_error', 'interaction_end',
    ];
    for (const event of types) {
      const parser = createNdjsonParser();
      const results = parser.push(makeLine({ event }) + '\n');
      expect(results).toHaveLength(1);
      expect(results[0].event).toBe(event);
    }
  });

  it('returns empty array for empty line', () => {
    const parser = createNdjsonParser();
    const results = parser.push('\n');
    expect(results).toHaveLength(0);
  });

  it('returns empty array for whitespace-only line', () => {
    const parser = createNdjsonParser();
    const results = parser.push('   \n');
    expect(results).toHaveLength(0);
  });

  it('returns empty for malformed JSON', () => {
    const parser = createNdjsonParser();
    const results = parser.push('{not json\n');
    expect(results).toHaveLength(0);
  });

  it('returns empty for missing event field', () => {
    const parser = createNdjsonParser();
    const line = JSON.stringify({
      timestamp: '2026-04-11T06:58:50.936Z',
      interactionId: 'id-001',
      payload: {},
    });
    const results = parser.push(line + '\n');
    expect(results).toHaveLength(0);
  });

  it('returns empty for invalid event type', () => {
    const parser = createNdjsonParser();
    const results = parser.push(makeLine({ event: 'unknown_event' }) + '\n');
    expect(results).toHaveLength(0);
  });

  it('returns empty for missing interactionId', () => {
    const parser = createNdjsonParser();
    const line = JSON.stringify({
      event: 'interaction_start',
      timestamp: '2026-04-11T06:58:50.936Z',
      payload: {},
    });
    const results = parser.push(line + '\n');
    expect(results).toHaveLength(0);
  });

  it('returns empty for empty interactionId', () => {
    const parser = createNdjsonParser();
    const results = parser.push(makeLine({ interactionId: '' }) + '\n');
    expect(results).toHaveLength(0);
  });

  it('returns empty for missing timestamp', () => {
    const parser = createNdjsonParser();
    const line = JSON.stringify({
      event: 'interaction_start',
      interactionId: 'id-001',
      payload: {},
    });
    const results = parser.push(line + '\n');
    expect(results).toHaveLength(0);
  });

  it('handles extra/unknown fields gracefully', () => {
    const parser = createNdjsonParser();
    const results = parser.push(makeLine({ unknownField: 42, anotherField: 'x' }) + '\n');
    expect(results).toHaveLength(1);
    expect(results[0].event).toBe('interaction_start');
  });

  it('preserves roundTrip when present', () => {
    const parser = createNdjsonParser();
    const results = parser.push(makeLine({ event: 'llm_request', roundTrip: 2 }) + '\n');
    expect(results[0].roundTrip).toBe(2);
  });

  it('sets roundTrip undefined when absent', () => {
    const parser = createNdjsonParser();
    const results = parser.push(makeLine() + '\n');
    expect(results[0].roundTrip).toBeUndefined();
  });

  it('defaults payload to empty object when missing', () => {
    const parser = createNdjsonParser();
    const line = JSON.stringify({
      event: 'interaction_start',
      timestamp: '2026-04-11T06:58:50.936Z',
      interactionId: 'id-001',
    });
    const results = parser.push(line + '\n');
    expect(results).toHaveLength(1);
    expect(results[0].payload).toEqual({});
  });
});

// ── NdjsonStreamParser: buffering / streaming behavior ──

describe('NdjsonParser - stream buffering', () => {
  it('feeds complete lines and parses them all', () => {
    const parser = createNdjsonParser();
    const chunk =
      makeLine({ interactionId: 'a' }) + '\n' +
      makeLine({ interactionId: 'b' }) + '\n';
    const results = parser.push(chunk);
    expect(results).toHaveLength(2);
    expect(results[0].interactionId).toBe('a');
    expect(results[1].interactionId).toBe('b');
  });

  it('buffers partial lines until next push completes them', () => {
    const parser = createNdjsonParser();
    const fullLine = makeLine({ interactionId: 'partial' });
    const half1 = fullLine.slice(0, 30);
    const half2 = fullLine.slice(30) + '\n';

    const r1 = parser.push(half1);
    expect(r1).toHaveLength(0);

    const r2 = parser.push(half2);
    expect(r2).toHaveLength(1);
    expect(r2[0].interactionId).toBe('partial');
  });

  it('feeds multiple lines in one chunk', () => {
    const parser = createNdjsonParser();
    const chunk =
      makeLine({ interactionId: 'x1' }) + '\n' +
      makeLine({ interactionId: 'x2' }) + '\n' +
      makeLine({ interactionId: 'x3' }) + '\n';
    const results = parser.push(chunk);
    expect(results).toHaveLength(3);
  });

  it('flush returns parsed entry from remainder', () => {
    const parser = createNdjsonParser();
    // Push without trailing newline -- stored as remainder
    parser.push(makeLine({ interactionId: 'flush-me' }));
    const flushed = parser.flush();
    expect(flushed).toHaveLength(1);
    expect(flushed[0].interactionId).toBe('flush-me');
  });

  it('flush returns empty for empty remainder', () => {
    const parser = createNdjsonParser();
    parser.push(makeLine() + '\n'); // fully consumed
    const flushed = parser.flush();
    expect(flushed).toHaveLength(0);
  });

  it('assigns sequential lineIndex across pushes', () => {
    const parser = createNdjsonParser();
    parser.push(makeLine({ interactionId: 'a' }) + '\n');
    parser.push(makeLine({ interactionId: 'b' }) + '\n');
    const r3 = parser.push(makeLine({ interactionId: 'c' }) + '\n');
    expect(r3[0].lineIndex).toBe(2);
    expect(parser.lineCount).toBe(3);
  });

  it('reset clears remainder and lineCount', () => {
    const parser = createNdjsonParser();
    parser.push(makeLine() + '\n');
    parser.push('partial');
    expect(parser.lineCount).toBe(1);

    parser.reset();
    expect(parser.lineCount).toBe(0);

    // Remainder should be cleared -- flush returns nothing
    const flushed = parser.flush();
    expect(flushed).toHaveLength(0);
  });
});
