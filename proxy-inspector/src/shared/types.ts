// Re-declared from parent project's proxy-types.ts to avoid cross-project rootDir issues.
// Keep in sync with notebooklm_agent/proxy/proxy-types.ts if event types change.

// ADK proxy event types
export type ProxyEventType =
  | 'interaction_start'
  | 'llm_request'
  | 'llm_response'
  | 'tool_start'
  | 'tool_result'
  | 'tool_error'
  | 'llm_error'
  | 'interaction_end';

// LangGraph monitoring event types
export type LangGraphEventType =
  | 'llm_call_start'
  | 'llm_call_end'
  | 'tool_call_start'
  | 'tool_call_end'
  | 'turn_summary';

// Union of all supported event types
export type EventType = ProxyEventType | LangGraphEventType;

// Log file format detected during parsing
export type LogFormat = 'adk-proxy' | 'langgraph';

// ── Interaction status ──

export type InteractionStatus = 'complete' | 'in-progress' | 'error';

// ── EventEntry: parsed NDJSON log line with ordering index ──

export interface EventEntry {
  /** Event type identifier. */
  event: EventType;

  /** ISO-8601 timestamp of the event. */
  timestamp: string;

  /** Interaction ID (groups all events for one user message). */
  interactionId: string;

  /** Round trip number within the interaction (undefined for interaction_start/end). */
  roundTrip?: number;

  /** Event-specific payload. */
  payload: Record<string, unknown>;

  /** Sequential line index within the file (0-based) for stable ordering. */
  lineIndex: number;
}

// ── InteractionSummary: lightweight data for list items ──

export interface InteractionSummary {
  /** interactionId (from LogEntry). */
  id: string;

  /** 1-based sequential number in the file. */
  index: number;

  /** User message from interaction_start payload (first 100 chars). */
  userMessage: string;

  /** ISO-8601 timestamp from interaction_start. */
  timestamp: string;

  /** Interaction status: complete, in-progress, or error. */
  status: InteractionStatus;

  /** Total duration in ms from interaction_end (null if in-progress). */
  durationMs: number | null;

  /** Number of LLM round trips. */
  roundTripCount: number;

  /** Prompt tokens from interaction_end. */
  totalPromptTokens: number;

  /** Completion tokens from interaction_end. */
  totalCompletionTokens: number;

  /** Total tokens (prompt + completion). */
  totalTokens: number;

  /** Tool names invoked (from interaction_end.toolCalls). */
  toolCalls: string[];

  /** Whether the interaction contains llm_error or tool_error events. */
  hasErrors: boolean;

  /** Total number of events in this interaction. */
  eventCount: number;
}

// ── DetailPayload: full interaction data sent on demand ──

export interface DetailPayload {
  /** The interaction summary metadata. */
  summary: InteractionSummary;

  /** All events in this interaction, ordered by lineIndex. */
  events: EventEntry[];
}

// ── FileMetadata ──

export interface FileMetadata {
  /** Full file path. */
  filePath: string;

  /** Session ID extracted from filename. */
  sessionId: string;

  /** Creation timestamp extracted from filename. */
  createdAt: string;

  /** File size in bytes. */
  fileSize: number;

  /** Detected log format. */
  logFormat: LogFormat;
}

// ── AggregateStats ──

export interface AggregateStats {
  totalInteractions: number;
  totalTokens: number;
  totalToolCalls: number;
  timeSpanMs: number; // first to last event timestamp
}

// ── ParsedFileData: initial load response ──

export interface ParsedFileData {
  metadata: FileMetadata;
  interactions: InteractionSummary[];
  aggregates: AggregateStats;
}

// ── IncrementalUpdate: live-tail push payload ──

export interface IncrementalUpdate {
  /** New or updated interaction summaries. */
  interactions: InteractionSummary[];

  /** Updated aggregate stats. */
  aggregates: AggregateStats;
}

// ── IPC Result wrapper ──

export type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };
