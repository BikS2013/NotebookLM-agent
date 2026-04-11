import type { EventEntry, ProxyEventType } from '@shared/types';

const VALID_EVENTS: Set<string> = new Set([
  'interaction_start', 'llm_request', 'llm_response',
  'tool_start', 'tool_result', 'tool_error',
  'llm_error', 'interaction_end'
]);

/**
 * Validates a parsed JSON object as a valid EventEntry.
 * Returns null if the object is not a valid log entry.
 */
function validateEntry(obj: unknown, lineIndex: number): EventEntry | null {
  if (obj === null || typeof obj !== 'object') return null;

  const record = obj as Record<string, unknown>;

  if (typeof record.event !== 'string' || !VALID_EVENTS.has(record.event)) {
    console.warn(`[ndjson-parser] Invalid event type: ${String(record.event)}`);
    return null;
  }

  if (typeof record.interactionId !== 'string' || record.interactionId.length === 0) {
    console.warn('[ndjson-parser] Missing or empty interactionId');
    return null;
  }

  if (typeof record.timestamp !== 'string') {
    console.warn('[ndjson-parser] Missing timestamp');
    return null;
  }

  return {
    event: record.event as ProxyEventType,
    timestamp: record.timestamp as string,
    interactionId: record.interactionId as string,
    roundTrip: typeof record.roundTrip === 'number' ? record.roundTrip : undefined,
    payload: (typeof record.payload === 'object' && record.payload !== null
      ? record.payload as Record<string, unknown>
      : {}),
    lineIndex,
  };
}

// ── Public API ──

export interface NdjsonParser {
  /** Push a raw text chunk. Returns an array of successfully parsed EventEntry objects. */
  push(rawChunk: string): EventEntry[];

  /** Flush any remaining partial line. Returns 0 or 1 EventEntry. */
  flush(): EventEntry[];

  /** Reset internal state (remainder buffer and line counter). */
  reset(): void;

  /** Current line index (number of successfully parsed lines so far). */
  readonly lineCount: number;
}

export function createNdjsonParser(): NdjsonParser {
  let remainder = '';
  let lineCount = 0;

  function push(rawChunk: string): EventEntry[] {
    const combined = remainder + rawChunk;
    const segments = combined.split('\n');

    // Last segment is either empty (chunk ended with \n) or a partial line
    remainder = segments.pop()!;

    const results: EventEntry[] = [];

    for (const segment of segments) {
      const trimmed = segment.trim();
      if (trimmed.length === 0) continue;

      try {
        const parsed = JSON.parse(trimmed);
        const entry = validateEntry(parsed, lineCount);
        if (entry !== null) {
          results.push(entry);
          lineCount++;
        }
      } catch {
        console.warn(`[ndjson-parser] Malformed JSON at line ~${lineCount}: ${trimmed.slice(0, 80)}...`);
      }
    }

    return results;
  }

  function flush(): EventEntry[] {
    if (remainder.trim().length === 0) {
      remainder = '';
      return [];
    }

    const trimmed = remainder.trim();
    remainder = '';

    try {
      const parsed = JSON.parse(trimmed);
      const entry = validateEntry(parsed, lineCount);
      if (entry !== null) {
        lineCount++;
        return [entry];
      }
    } catch {
      console.warn(`[ndjson-parser] Malformed JSON in flush: ${trimmed.slice(0, 80)}...`);
    }

    return [];
  }

  function reset(): void {
    remainder = '';
    lineCount = 0;
  }

  return {
    push,
    flush,
    reset,
    get lineCount() { return lineCount; },
  };
}
