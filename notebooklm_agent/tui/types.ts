/**
 * Shared types for the TUI layer.
 *
 * These are the canonical definitions consumed by both Lane B (useAgent)
 * and Lane C (display components). When useAgent.ts is implemented it
 * should re-export from here rather than redefine.
 */

/**
 * Agent execution status state machine.
 *
 * Transitions:
 *   idle -> thinking       (user sends message)
 *   thinking -> streaming  (first partial text event arrives)
 *   thinking -> tool_call  (tool call event arrives)
 *   streaming -> tool_call (tool call after partial text)
 *   tool_call -> thinking  (tool result arrives, LLM processes result)
 *   streaming -> idle      (FINISHED event)
 *   thinking -> idle       (FINISHED event, no streaming text)
 *   thinking -> error      (ERROR event)
 *   streaming -> error     (ERROR event during streaming)
 *   error -> idle          (user sends new message)
 */
export type AgentStatus = 'idle' | 'thinking' | 'streaming' | 'tool_call' | 'error';

/**
 * A chat message in the conversation history.
 */
export interface Message {
  /** Unique identifier (nanoid or timestamp-based) */
  readonly id: string;
  /** Who sent the message */
  readonly role: 'user' | 'agent' | 'system';
  /** The text content (accumulates during streaming) */
  text: string;
  /** True while the agent is still streaming this message */
  isPartial: boolean;
  /** Tool calls made during this agent response */
  toolCalls: ToolCallInfo[];
  /** Unix timestamp when the message was created */
  readonly timestamp: number;
}

/**
 * Information about a tool call in progress or completed.
 */
export interface ToolCallInfo {
  /** Tool function name (e.g., "search_youtube") */
  readonly name: string;
  /** Arguments passed to the tool */
  readonly args: Record<string, unknown>;
  /** Current execution status */
  status: 'running' | 'completed' | 'error';
}
