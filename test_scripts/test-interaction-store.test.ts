import { describe, it, expect } from 'vitest';
import { createInteractionStore } from '../proxy-inspector/src/main/interaction-store.js';
import type { EventEntry } from '../proxy-inspector/src/shared/types.js';

// ── Helper: build EventEntry objects ──

function makeEntry(overrides: Partial<EventEntry> & { event: EventEntry['event']; interactionId: string }): EventEntry {
  return {
    timestamp: '2026-04-11T07:00:00.000Z',
    payload: {},
    lineIndex: 0,
    ...overrides,
  };
}

function makeInteraction(id: string, opts: {
  userMessage?: string;
  tokens?: number;
  toolCalls?: string[];
  hasEnd?: boolean;
  hasError?: boolean;
  durationMs?: number;
} = {}): EventEntry[] {
  const entries: EventEntry[] = [];
  let lineIdx = 0;

  entries.push(makeEntry({
    event: 'interaction_start',
    interactionId: id,
    timestamp: '2026-04-11T07:00:00.000Z',
    payload: { userMessage: opts.userMessage ?? 'hello', sessionId: 'sess-1' },
    lineIndex: lineIdx++,
  }));

  entries.push(makeEntry({
    event: 'llm_request',
    interactionId: id,
    roundTrip: 1,
    timestamp: '2026-04-11T07:00:00.100Z',
    payload: { model: 'gemini-2.5-flash' },
    lineIndex: lineIdx++,
  }));

  entries.push(makeEntry({
    event: 'llm_response',
    interactionId: id,
    roundTrip: 1,
    timestamp: '2026-04-11T07:00:01.000Z',
    payload: { usageMetadata: { totalTokenCount: 100 } },
    lineIndex: lineIdx++,
  }));

  if (opts.toolCalls) {
    for (const toolName of opts.toolCalls) {
      entries.push(makeEntry({
        event: 'tool_start',
        interactionId: id,
        roundTrip: 1,
        timestamp: '2026-04-11T07:00:01.100Z',
        payload: { toolName },
        lineIndex: lineIdx++,
      }));
      entries.push(makeEntry({
        event: 'tool_result',
        interactionId: id,
        roundTrip: 1,
        timestamp: '2026-04-11T07:00:01.500Z',
        payload: { toolName },
        lineIndex: lineIdx++,
      }));
    }
  }

  if (opts.hasError) {
    entries.push(makeEntry({
      event: 'llm_error',
      interactionId: id,
      roundTrip: 1,
      timestamp: '2026-04-11T07:00:01.200Z',
      payload: { errorMessage: 'something failed' },
      lineIndex: lineIdx++,
    }));
  }

  if (opts.hasEnd !== false) {
    entries.push(makeEntry({
      event: 'interaction_end',
      interactionId: id,
      timestamp: '2026-04-11T07:00:02.000Z',
      payload: {
        roundTripCount: 1,
        totalPromptTokens: opts.tokens ?? 100,
        totalCompletionTokens: (opts.tokens ?? 100) / 2,
        totalTokens: opts.tokens ?? 150,
        durationMs: opts.durationMs ?? 2000,
        toolCalls: opts.toolCalls ?? [],
      },
      lineIndex: lineIdx++,
    }));
  }

  return entries;
}

// ── Tests ──

describe('InteractionStore - addEntries and getAllSummaries', () => {
  it('adds events and returns summaries sorted by insertion order', () => {
    const store = createInteractionStore();
    store.addEntries(makeInteraction('int-1', { userMessage: 'first' }));
    store.addEntries(makeInteraction('int-2', { userMessage: 'second' }));
    const summaries = store.getAllSummaries();
    expect(summaries).toHaveLength(2);
    expect(summaries[0].userMessage).toBe('first');
    expect(summaries[1].userMessage).toBe('second');
  });

  it('assigns sequential 1-based index to interactions', () => {
    const store = createInteractionStore();
    store.addEntries(makeInteraction('a'));
    store.addEntries(makeInteraction('b'));
    const summaries = store.getAllSummaries();
    expect(summaries[0].index).toBe(1);
    expect(summaries[1].index).toBe(2);
  });

  it('reports size correctly', () => {
    const store = createInteractionStore();
    expect(store.size).toBe(0);
    store.addEntries(makeInteraction('a'));
    expect(store.size).toBe(1);
    store.addEntries(makeInteraction('b'));
    expect(store.size).toBe(2);
  });
});

describe('InteractionStore - summary derivation', () => {
  it('derives userMessage from interaction_start payload', () => {
    const store = createInteractionStore();
    store.addEntries(makeInteraction('id-1', { userMessage: 'list my notebooks' }));
    const summaries = store.getAllSummaries();
    expect(summaries[0].userMessage).toBe('list my notebooks');
  });

  it('truncates userMessage to 100 chars', () => {
    const store = createInteractionStore();
    const longMsg = 'x'.repeat(200);
    store.addEntries(makeInteraction('id-1', { userMessage: longMsg }));
    const summaries = store.getAllSummaries();
    expect(summaries[0].userMessage).toHaveLength(100);
  });

  it('derives tokens from interaction_end', () => {
    const store = createInteractionStore();
    store.addEntries(makeInteraction('id-1', { tokens: 500 }));
    const s = store.getAllSummaries()[0];
    expect(s.totalPromptTokens).toBe(500);
    expect(s.totalTokens).toBe(500);
  });

  it('derives tool calls from interaction_end payload', () => {
    const store = createInteractionStore();
    store.addEntries(makeInteraction('id-1', { toolCalls: ['list_notebooks', 'get_notebook'] }));
    const s = store.getAllSummaries()[0];
    expect(s.toolCalls).toEqual(['list_notebooks', 'get_notebook']);
  });

  it('derives tool calls from tool_start events when no interaction_end', () => {
    const store = createInteractionStore();
    store.addEntries(makeInteraction('id-1', { toolCalls: ['search_youtube'], hasEnd: false }));
    const s = store.getAllSummaries()[0];
    expect(s.toolCalls).toContain('search_youtube');
  });

  it('status is "complete" when interaction_end is present', () => {
    const store = createInteractionStore();
    store.addEntries(makeInteraction('id-1'));
    expect(store.getAllSummaries()[0].status).toBe('complete');
  });

  it('status is "in-progress" when no interaction_end and no errors', () => {
    const store = createInteractionStore();
    store.addEntries(makeInteraction('id-1', { hasEnd: false }));
    expect(store.getAllSummaries()[0].status).toBe('in-progress');
  });

  it('status is "error" when error events present', () => {
    const store = createInteractionStore();
    store.addEntries(makeInteraction('id-1', { hasError: true }));
    expect(store.getAllSummaries()[0].status).toBe('error');
  });
});

describe('InteractionStore - getDetail', () => {
  it('returns all events for an interaction sorted by lineIndex', () => {
    const store = createInteractionStore();
    const entries = makeInteraction('id-1', { toolCalls: ['list_notebooks'] });
    store.addEntries(entries);
    const detail = store.getDetail('id-1');
    expect(detail).toBeDefined();
    expect(detail!.events.length).toBe(entries.length);
    // Verify sorted by lineIndex
    for (let i = 1; i < detail!.events.length; i++) {
      expect(detail!.events[i].lineIndex).toBeGreaterThanOrEqual(detail!.events[i - 1].lineIndex);
    }
  });

  it('returns undefined for unknown interactionId', () => {
    const store = createInteractionStore();
    expect(store.getDetail('nonexistent')).toBeUndefined();
  });
});

describe('InteractionStore - search', () => {
  it('searches by user message case-insensitively', () => {
    const store = createInteractionStore();
    store.addEntries(makeInteraction('id-1', { userMessage: 'List my Notebooks' }));
    store.addEntries(makeInteraction('id-2', { userMessage: 'search youtube' }));

    const results = store.search('notebook');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('id-1');
  });

  it('returns all summaries for empty search query', () => {
    const store = createInteractionStore();
    store.addEntries(makeInteraction('id-1'));
    store.addEntries(makeInteraction('id-2'));
    expect(store.search('')).toHaveLength(2);
    expect(store.search('  ')).toHaveLength(2);
  });
});

describe('InteractionStore - getAggregates', () => {
  it('computes totals across all interactions', () => {
    const store = createInteractionStore();
    store.addEntries(makeInteraction('id-1', { tokens: 100, toolCalls: ['a', 'b'] }));
    store.addEntries(makeInteraction('id-2', { tokens: 200, toolCalls: ['c'] }));

    const agg = store.getAggregates();
    expect(agg.totalInteractions).toBe(2);
    expect(agg.totalTokens).toBe(300);
    expect(agg.totalToolCalls).toBe(3);
    expect(agg.timeSpanMs).toBeGreaterThanOrEqual(0);
  });
});

describe('InteractionStore - incremental adds', () => {
  it('returns only changed summaries on incremental add', () => {
    const store = createInteractionStore();
    store.addEntries(makeInteraction('id-1', { hasEnd: false }));

    // Now add the end event
    const updated = store.addEntries([makeEntry({
      event: 'interaction_end',
      interactionId: 'id-1',
      timestamp: '2026-04-11T07:00:05.000Z',
      payload: {
        roundTripCount: 1,
        totalPromptTokens: 100,
        totalCompletionTokens: 50,
        totalTokens: 150,
        durationMs: 5000,
        toolCalls: [],
      },
      lineIndex: 99,
    })]);

    expect(updated).toHaveLength(1);
    expect(updated[0].id).toBe('id-1');
    expect(updated[0].status).toBe('complete');
  });
});

describe('InteractionStore - clear', () => {
  it('resets store completely', () => {
    const store = createInteractionStore();
    store.addEntries(makeInteraction('id-1'));
    store.addEntries(makeInteraction('id-2'));
    expect(store.size).toBe(2);

    store.clear();
    expect(store.size).toBe(0);
    expect(store.getAllSummaries()).toHaveLength(0);
    expect(store.getAggregates().totalInteractions).toBe(0);

    // Indexes reset after clear
    store.addEntries(makeInteraction('id-3'));
    expect(store.getAllSummaries()[0].index).toBe(1);
  });
});
