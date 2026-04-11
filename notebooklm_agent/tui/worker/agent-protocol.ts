/**
 * Messages sent from the main thread to the worker thread.
 */
export type MainToWorker =
  | { type: 'init' }
  | { type: 'send'; text: string; messageId: string }
  | { type: 'cancel' };

/**
 * Messages sent from the worker thread to the main thread.
 * All objects must be serializable (no class instances, no functions).
 */
export type WorkerToMain =
  | { type: 'ready'; sessionId: string }
  | { type: 'event'; messageId: string; event: SerializedStructuredEvent }
  | { type: 'partial'; messageId: string; isPartial: boolean }
  | { type: 'done'; messageId: string }
  | { type: 'error'; messageId: string; error: string }
  | { type: 'initError'; error: string };

/**
 * Serialized form of a StructuredEvent (plain object, no class instances).
 * Maps 1:1 to the ADK EventType enum values.
 */
export interface SerializedStructuredEvent {
  eventType: 'thought' | 'content' | 'tool_call' | 'tool_result'
           | 'call_code' | 'code_result' | 'error' | 'activity'
           | 'tool_confirmation' | 'finished';
  content?: string;
  call?: { name: string; args: Record<string, unknown> };
  result?: { name: string; response: Record<string, unknown> };
  error?: string;
}
