/**
 * Type definitions for the LLM Proxy Plugin subsystem.
 *
 * This module has zero runtime dependencies. It defines all shared types
 * and interfaces used across the proxy modules.
 */

// ---------------------------------------------------------------------------
// Event types for NDJSON log entries
// ---------------------------------------------------------------------------

export type ProxyEventType =
  | 'interaction_start'
  | 'llm_request'
  | 'llm_response'
  | 'tool_start'
  | 'tool_result'
  | 'tool_error'
  | 'llm_error'
  | 'interaction_end';

// ---------------------------------------------------------------------------
// Tool call record -- one tool invocation within a round trip
// ---------------------------------------------------------------------------

export interface ToolCallRecord {
  /** Name of the tool invoked (e.g., "search_youtube"). */
  toolName: string;

  /** Function call ID from the LLM response, used to correlate before/after. */
  functionCallId: string;

  /** Tool arguments (JSON-serializable). */
  args: Record<string, unknown>;

  /** Tool result (JSON-serializable). Populated by afterToolCallback. */
  result?: Record<string, unknown>;

  /** Error message if the tool failed. Populated by onToolErrorCallback. */
  error?: string;

  /** Timestamp (ms since epoch) when beforeToolCallback fired. */
  startedAt: number;

  /** Timestamp (ms since epoch) when afterToolCallback fired. */
  completedAt?: number;

  /** Computed: completedAt - startedAt. */
  durationMs?: number;
}

// ---------------------------------------------------------------------------
// Round trip record -- one LLM request/response cycle
// ---------------------------------------------------------------------------

export interface RoundTripRecord {
  /** Sequential number within the interaction (1-based). */
  roundTripNumber: number;

  /** Name of the agent that made the LLM call. */
  agentName: string;

  /** Timestamp (ms) when beforeModelCallback fired. */
  requestTimestamp: number;

  /** Timestamp (ms) when the final afterModelCallback fired. */
  responseTimestamp?: number;

  /** Computed: responseTimestamp - requestTimestamp. */
  durationMs?: number;

  // --- Request fields (serialized from LlmRequest) ---

  /** Model name (e.g., "gemini-2.0-flash"). */
  model?: string;

  /** Raw systemInstruction (Content object as-is). */
  systemInstruction?: unknown;

  /** Flattened text of systemInstruction for quick reading. */
  systemInstructionText?: string;

  /** Number of Content objects in the request's contents array. */
  contentsCount: number;

  /** Serialized conversation history (Content[] array). */
  contents?: unknown[];

  /** Tool names available for this round trip. */
  toolNames: string[];

  /**
   * Full tool declarations (schemas). Only populated on the first round trip
   * of each interaction; subsequent round trips contain only toolNames.
   */
  toolDeclarations?: unknown[];

  /** Generation config (temperature, topP, maxOutputTokens, etc.). */
  generationConfig?: Record<string, unknown>;

  // --- Response fields (accumulated from streaming chunks) ---

  /** Final accumulated response content. */
  responseContent?: unknown;

  /** Token usage from the final response chunk. */
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };

  /** LLM finish reason (e.g., "STOP", "MAX_TOKENS"). */
  finishReason?: string;

  /** Whether this round trip was streamed (SSE). */
  streamed: boolean;

  /** Number of streaming chunks received (1 for non-streaming). */
  chunkCount: number;

  /** Error code from the LLM (if error response). */
  errorCode?: string;

  /** Error message from the LLM (if error response). */
  errorMessage?: string;

  /** Tool calls triggered by the LLM's response in this round trip. */
  toolCalls: ToolCallRecord[];
}

// ---------------------------------------------------------------------------
// Interaction record -- a complete user message -> agent response cycle
// ---------------------------------------------------------------------------

export interface InteractionRecord {
  /** Unique ID for this interaction (from InvocationContext.invocationId). */
  interactionId: string;

  /** ADK session ID. */
  sessionId: string;

  /** Timestamp (ms) when the interaction started. */
  startedAt: number;

  /** Timestamp (ms) when the interaction completed. */
  completedAt?: number;

  /** Computed: completedAt - startedAt. */
  durationMs?: number;

  /** First 500 chars of the user's message text. */
  userMessage?: string;

  /** All LLM round trips within this interaction. */
  roundTrips: RoundTripRecord[];

  /** Sum of promptTokenCount across all round trips. */
  totalPromptTokens: number;

  /** Sum of candidatesTokenCount across all round trips. */
  totalCompletionTokens: number;
}

// ---------------------------------------------------------------------------
// NDJSON log entry -- envelope written to the log file
// ---------------------------------------------------------------------------

export interface LogEntry {
  /** Event type identifier. */
  event: ProxyEventType;

  /** ISO-8601 timestamp of the event. */
  timestamp: string;

  /** Interaction ID (groups all events for one user message). */
  interactionId: string;

  /** Round trip number within the interaction (undefined for interaction_start/end). */
  roundTrip?: number;

  /** Event-specific payload. */
  payload: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Proxy configuration
// ---------------------------------------------------------------------------

export interface ProxyConfig {
  /** Always true when a ProxyConfig exists (proxy is enabled). */
  enabled: true;

  /** Directory for NDJSON log files (required, no fallback). */
  logDir: string;

  /** Whether to print per-interaction summaries to stderr. */
  verbose: boolean;

  /** Number of interactions to retain in the in-memory buffer. */
  bufferSize: number;

  /** Maximum log file size in bytes before rotation. */
  maxFileSize: number;
}
