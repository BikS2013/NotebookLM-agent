import type {
  EventEntry,
  InteractionSummary,
  InteractionStatus,
  DetailPayload,
  AggregateStats,
} from '@shared/types';

// ── Public API ──

export interface InteractionStore {
  /** Add one or more parsed EventEntry objects. Returns updated/new InteractionSummary[]. */
  addEntries(entries: EventEntry[]): InteractionSummary[];

  /** Get all interaction summaries sorted by first event timestamp. */
  getAllSummaries(): InteractionSummary[];

  /** Get full detail for a specific interaction. */
  getDetail(interactionId: string): DetailPayload | undefined;

  /** Get aggregate statistics across all interactions. */
  getAggregates(): AggregateStats;

  /** Search interactions by user message substring. */
  search(query: string): InteractionSummary[];

  /** Reset the store (for opening a new file). */
  clear(): void;

  /** Total number of interactions. */
  readonly size: number;
}

// ── Summary derivation ──

function deriveSummary(id: string, index: number, events: EventEntry[]): InteractionSummary {
  // Detect format from events
  const isLangGraph = events.some(e =>
    e.event === 'turn_summary' || e.event === 'llm_call_start' || e.event === 'llm_call_end'
  );

  if (isLangGraph) {
    return deriveLangGraphSummary(id, index, events);
  }
  return deriveAdkSummary(id, index, events);
}

function deriveAdkSummary(id: string, index: number, events: EventEntry[]): InteractionSummary {
  const startEvent = events.find(e => e.event === 'interaction_start');
  const endEvent = events.find(e => e.event === 'interaction_end');
  const hasErrors = events.some(e =>
    e.event === 'llm_error' || e.event === 'tool_error'
  );

  const userMessage = (startEvent?.payload?.userMessage as string) ?? '';
  const status: InteractionStatus =
    hasErrors ? 'error' :
    endEvent ? 'complete' : 'in-progress';

  const endRoundTripCount = endEvent?.payload?.roundTripCount as number | undefined;
  const maxRoundTrip = events
    .filter(e => e.roundTrip != null)
    .map(e => e.roundTrip!);
  const roundTripCount = endRoundTripCount ??
    (maxRoundTrip.length > 0 ? Math.max(...maxRoundTrip) : 0);

  const endToolCalls = endEvent?.payload?.toolCalls as string[] | undefined;
  const toolCalls = endToolCalls ??
    events
      .filter(e => e.event === 'tool_start')
      .map(e => (e.payload?.toolName as string) ?? 'unknown');

  return {
    id,
    index,
    userMessage: userMessage.slice(0, 100),
    timestamp: startEvent?.timestamp ?? events[0].timestamp,
    status,
    durationMs: (endEvent?.payload?.durationMs as number) ?? null,
    roundTripCount,
    totalPromptTokens: (endEvent?.payload?.totalPromptTokens as number) ?? 0,
    totalCompletionTokens: (endEvent?.payload?.totalCompletionTokens as number) ?? 0,
    totalTokens: (endEvent?.payload?.totalTokens as number) ?? 0,
    toolCalls,
    hasErrors,
    eventCount: events.length,
  };
}

function deriveLangGraphSummary(id: string, index: number, events: EventEntry[]): InteractionSummary {
  const turnSummary = events.find(e => e.event === 'turn_summary');
  const llmEnds = events.filter(e => e.event === 'llm_call_end');
  const toolStarts = events.filter(e => e.event === 'tool_call_start');
  const hasErrors = false; // LangGraph doesn't have explicit error events in this format

  // User message from turn_summary
  const userMessage = (turnSummary?.payload?.userInput as string) ?? '';

  // Token counts: sum from llm_call_end tokenUsage or from turn_summary totalTokenUsage
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;

  if (turnSummary?.payload?.totalTokenUsage) {
    const usage = turnSummary.payload.totalTokenUsage as Record<string, number>;
    totalPromptTokens = usage.input_tokens ?? 0;
    totalCompletionTokens = usage.output_tokens ?? 0;
  } else {
    for (const llmEnd of llmEnds) {
      const usage = llmEnd.payload?.tokenUsage as Record<string, number> | undefined;
      if (usage) {
        totalPromptTokens += usage.input_tokens ?? 0;
        totalCompletionTokens += usage.output_tokens ?? 0;
      }
    }
  }

  const toolCalls = toolStarts.map(e => (e.payload?.toolName as string) ?? 'unknown');
  const durationMs = (turnSummary?.payload?.turnDurationMs as number) ?? null;

  const status: InteractionStatus = turnSummary ? 'complete' : 'in-progress';

  return {
    id,
    index,
    userMessage: userMessage.slice(0, 100),
    timestamp: turnSummary?.timestamp ?? events[0].timestamp,
    status,
    durationMs,
    roundTripCount: (turnSummary?.payload?.llmCallCount as number) ?? llmEnds.length,
    totalPromptTokens,
    totalCompletionTokens,
    totalTokens: totalPromptTokens + totalCompletionTokens,
    toolCalls,
    hasErrors,
    eventCount: events.length,
  };
}

// ── Factory ──

export function createInteractionStore(): InteractionStore {
  // Internal storage
  const interactions = new Map<string, EventEntry[]>();
  const summaryCache = new Map<string, InteractionSummary>();
  const insertionOrder: string[] = [];
  let nextIndex = 1;

  function addEntries(entries: EventEntry[]): InteractionSummary[] {
    const affectedIds = new Set<string>();

    for (const entry of entries) {
      const id = entry.interactionId;

      let eventList = interactions.get(id);
      if (!eventList) {
        eventList = [];
        interactions.set(id, eventList);
        insertionOrder.push(id);
      }

      eventList.push(entry);
      affectedIds.add(id);
    }

    // Re-derive summaries for all affected interactions
    const updatedSummaries: InteractionSummary[] = [];

    for (const id of affectedIds) {
      const events = interactions.get(id)!;

      // Assign index only if this is a newly seen interaction
      let existingSummary = summaryCache.get(id);
      const index = existingSummary?.index ?? nextIndex++;
      if (!existingSummary) {
        // nextIndex was already incremented above for new interactions
      }

      const summary = deriveSummary(id, index, events);
      summaryCache.set(id, summary);
      updatedSummaries.push(summary);
    }

    return updatedSummaries;
  }

  function getAllSummaries(): InteractionSummary[] {
    return insertionOrder
      .map(id => summaryCache.get(id)!)
      .filter(Boolean);
  }

  function getDetail(interactionId: string): DetailPayload | undefined {
    const events = interactions.get(interactionId);
    if (!events) return undefined;

    const summary = summaryCache.get(interactionId);
    if (!summary) return undefined;

    // Return events sorted by lineIndex
    const sortedEvents = [...events].sort((a, b) => a.lineIndex - b.lineIndex);

    return {
      summary,
      events: sortedEvents,
    };
  }

  function getAggregates(): AggregateStats {
    let totalTokens = 0;
    let totalToolCalls = 0;
    let firstTimestamp: number | null = null;
    let lastTimestamp: number | null = null;

    for (const summary of summaryCache.values()) {
      totalTokens += summary.totalTokens;
      totalToolCalls += summary.toolCalls.length;

      const ts = new Date(summary.timestamp).getTime();
      if (!isNaN(ts)) {
        if (firstTimestamp === null || ts < firstTimestamp) firstTimestamp = ts;
        if (lastTimestamp === null || ts > lastTimestamp) lastTimestamp = ts;
      }
    }

    // Also check the last event timestamps for a more accurate time span
    for (const events of interactions.values()) {
      for (const event of events) {
        const ts = new Date(event.timestamp).getTime();
        if (!isNaN(ts)) {
          if (lastTimestamp === null || ts > lastTimestamp) lastTimestamp = ts;
        }
      }
    }

    return {
      totalInteractions: summaryCache.size,
      totalTokens,
      totalToolCalls,
      timeSpanMs: (firstTimestamp !== null && lastTimestamp !== null)
        ? lastTimestamp - firstTimestamp
        : 0,
    };
  }

  function search(query: string): InteractionSummary[] {
    if (query.trim().length === 0) return getAllSummaries();

    const lowerQuery = query.toLowerCase();
    return getAllSummaries().filter(summary =>
      summary.userMessage.toLowerCase().includes(lowerQuery)
    );
  }

  function clear(): void {
    interactions.clear();
    summaryCache.clear();
    insertionOrder.length = 0;
    nextIndex = 1;
  }

  return {
    addEntries,
    getAllSummaries,
    getDetail,
    getAggregates,
    search,
    clear,
    get size() { return interactions.size; },
  };
}
