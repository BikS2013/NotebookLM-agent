import type { EventEntry, EventType, LogFormat } from '@shared/types';

// ── Valid event types per format ──

const ADK_EVENTS: Set<string> = new Set([
  'interaction_start', 'llm_request', 'llm_response',
  'tool_start', 'tool_result', 'tool_error',
  'llm_error', 'interaction_end'
]);

const LANGGRAPH_EVENTS: Set<string> = new Set([
  'llm_call_start', 'llm_call_end',
  'tool_call_start', 'tool_call_end',
  'turn_summary'
]);

// ── Format detection ──

function detectFormat(obj: Record<string, unknown>): LogFormat | null {
  // ADK proxy format: { event, timestamp, interactionId, payload }
  if (typeof obj.event === 'string' && ADK_EVENTS.has(obj.event)) {
    return 'adk-proxy';
  }
  // LangGraph format: { type, data }
  if (typeof obj.type === 'string' && LANGGRAPH_EVENTS.has(obj.type)) {
    return 'langgraph';
  }
  return null;
}

// ── ADK proxy entry validation ──

function validateAdkEntry(record: Record<string, unknown>, lineIndex: number): EventEntry | null {
  if (typeof record.interactionId !== 'string' || record.interactionId.length === 0) {
    console.warn('[ndjson-parser] Missing or empty interactionId');
    return null;
  }
  if (typeof record.timestamp !== 'string') {
    console.warn('[ndjson-parser] Missing timestamp');
    return null;
  }

  return {
    event: record.event as EventType,
    timestamp: record.timestamp as string,
    interactionId: record.interactionId as string,
    roundTrip: typeof record.roundTrip === 'number' ? record.roundTrip : undefined,
    payload: (typeof record.payload === 'object' && record.payload !== null
      ? record.payload as Record<string, unknown>
      : {}),
    lineIndex,
  };
}

// ── LangGraph entry normalization ──
// Converts { type, data } into the standard EventEntry shape.
// Uses a temporary interactionId; the groupByTurns() post-processing step
// reassigns proper IDs based on turn_summary boundaries.

function normalizeLangGraphEntry(
  record: Record<string, unknown>,
  lineIndex: number,
): EventEntry | null {
  const eventType = record.type as string;
  const data = record.data as Record<string, unknown> | undefined;
  if (!data || typeof data !== 'object') return null;

  // Temporary interactionId — will be reassigned by groupByTurns()
  const interactionId = `lg-temp-${lineIndex}`;

  // Derive timestamp
  const timestamp = (data.timestamp as string)
    ?? (data.startTime as string)
    ?? new Date().toISOString();

  // Build payload — keep all data fields for the renderers
  const payload: Record<string, unknown> = { ...data };

  return {
    event: eventType as EventType,
    timestamp,
    interactionId,
    roundTrip: undefined,
    payload,
    lineIndex,
  };
}

/**
 * Post-process LangGraph entries: group events by turn_summary boundaries.
 * All events between two turn_summary entries belong to the later turn_summary.
 * Returns entries with corrected interactionIds.
 */
export function groupByTurns(entries: EventEntry[]): EventEntry[] {
  if (entries.length === 0) return entries;

  // Find turn_summary indices
  const turnSummaryIndices: number[] = [];
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].event === 'turn_summary') {
      turnSummaryIndices.push(i);
    }
  }

  if (turnSummaryIndices.length === 0) {
    // No turn summaries — assign all to a single group
    const id = 'lg-turn-pending';
    return entries.map(e => ({ ...e, interactionId: id }));
  }

  const result: EventEntry[] = [];
  let prevBoundary = 0;

  for (const tsIdx of turnSummaryIndices) {
    const ts = entries[tsIdx];
    const data = ts.payload;
    const threadId = (data.threadId as string) ?? 'unknown';
    const turnNumber = data.turnNumber as number ?? 0;
    const turnId = `lg-${threadId}-turn-${turnNumber}`;

    // All events from prevBoundary to tsIdx (inclusive) belong to this turn
    for (let i = prevBoundary; i <= tsIdx; i++) {
      result.push({ ...entries[i], interactionId: turnId });
    }
    prevBoundary = tsIdx + 1;
  }

  // Remaining events after last turn_summary → pending turn
  if (prevBoundary < entries.length) {
    const lastTurn = entries[turnSummaryIndices[turnSummaryIndices.length - 1]];
    const threadId = (lastTurn.payload.threadId as string) ?? 'unknown';
    const lastTurnNum = (lastTurn.payload.turnNumber as number) ?? 0;
    const pendingId = `lg-${threadId}-turn-${lastTurnNum + 1}`;
    for (let i = prevBoundary; i < entries.length; i++) {
      result.push({ ...entries[i], interactionId: pendingId });
    }
  }

  return result;
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

  /** Detected log format (set after first successful parse, null if unknown). */
  readonly detectedFormat: LogFormat | null;
}

export function createNdjsonParser(): NdjsonParser {
  let remainder = '';
  let lineCount = 0;
  let detectedFormat: LogFormat | null = null;

  function parseOne(obj: Record<string, unknown>, lineIndex: number): EventEntry | null {
    // Auto-detect format from first valid entry
    const format = detectFormat(obj);
    if (format === null) {
      console.warn(`[ndjson-parser] Unrecognized format at line ~${lineIndex}`);
      return null;
    }

    if (detectedFormat === null) {
      detectedFormat = format;
      console.log(`[ndjson-parser] Detected log format: ${format}`);
    }

    if (format === 'adk-proxy') {
      return validateAdkEntry(obj, lineIndex);
    } else {
      return normalizeLangGraphEntry(obj, lineIndex);
    }
  }

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
        const entry = parseOne(parsed, lineCount);
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
      const entry = parseOne(parsed, lineCount);
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
    detectedFormat = null;
  }

  return {
    push,
    flush,
    reset,
    get lineCount() { return lineCount; },
    get detectedFormat() { return detectedFormat; },
  };
}
