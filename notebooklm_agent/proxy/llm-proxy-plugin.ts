/**
 * LLM Proxy Plugin -- ADK BasePlugin subclass that observes all LLM
 * interactions without modifying agent behavior.
 *
 * Every callback returns `undefined` (observe-only, never short-circuit).
 * Every callback body is wrapped in try/catch -- the plugin NEVER throws.
 * Errors are written to stderr with a `[llm-proxy]` prefix.
 */
import { BasePlugin } from '@google/adk';
import type {
  ProxyConfig,
  InteractionRecord,
  RoundTripRecord,
  ToolCallRecord,
  LogEntry,
  ProxyEventType,
} from './proxy-types.ts';
import { ProxyBuffer } from './proxy-buffer.ts';
import { ProxyLogger } from './proxy-logger.ts';
import {
  serializeLlmRequest,
  serializeLlmResponse,
  safeSerialize,
} from './proxy-serializer.ts';

export class LlmProxyPlugin extends BasePlugin {
  // --- Dependencies ---
  private readonly _buffer: ProxyBuffer;
  private readonly _logger: ProxyLogger;
  private readonly verbose: boolean;

  // --- Active state tracking ---
  private currentInteraction: InteractionRecord | null = null;
  private currentRoundTrip: RoundTripRecord | null = null;
  private activeToolCalls: Map<string, ToolCallRecord> = new Map();
  private partialTexts: string[] = [];
  private chunkCount: number = 0;
  private roundTripCounter: number = 0;
  private sessionIdKnown: boolean = false;
  private pendingUserMessage: string | undefined = undefined;

  constructor(config: ProxyConfig) {
    super('llm-proxy');
    this._buffer = new ProxyBuffer(config.bufferSize);
    this._logger = new ProxyLogger({
      logDir: config.logDir,
      sessionId: 'pending',
      maxFileSize: config.maxFileSize,
    });
    this.verbose = config.verbose;
  }

  // --- Public API for /inspect ---

  get buffer(): ProxyBuffer {
    return this._buffer;
  }

  get logger(): ProxyLogger {
    return this._logger;
  }

  getLastInteraction(): InteractionRecord | undefined {
    return this._buffer.getLast();
  }

  getAllInteractions(): InteractionRecord[] {
    return this._buffer.getAll();
  }

  isActive(): boolean {
    return this.currentInteraction !== null;
  }

  // --- Cleanup ---

  async close(): Promise<void> {
    try {
      await this._logger.close();
    } catch (err) {
      this.logError('close', err);
    }
  }

  // ===================================================================
  // Plugin Callbacks
  // ===================================================================

  override async onUserMessageCallback(params: {
    invocationContext: unknown;
    userMessage: unknown;
  }): Promise<undefined> {
    try {
      // Extract user message text
      const msg = params.userMessage as Record<string, unknown> | undefined;
      let text = '';
      if (msg && Array.isArray(msg.parts)) {
        for (const part of msg.parts) {
          if (typeof part === 'object' && part !== null && 'text' in part) {
            const t = (part as Record<string, unknown>).text;
            if (typeof t === 'string') {
              text += t;
            }
          }
        }
      }
      if (!text && msg) {
        text = safeSerialize(msg, 600);
      }
      // Truncate to 500 chars
      this.pendingUserMessage = text.length > 500 ? text.slice(0, 500) : text;
    } catch (err) {
      this.logError('onUserMessageCallback', err);
    }
    return undefined;
  }

  override async beforeRunCallback(params: {
    invocationContext: unknown;
  }): Promise<undefined> {
    try {
      // Safety net: finalize any unclosed interaction
      if (this.currentInteraction !== null) {
        this.finalizeInteraction();
      }

      const ctx = params.invocationContext as Record<string, unknown>;

      // Extract invocationId
      const invocationId =
        typeof ctx.invocationId === 'string'
          ? ctx.invocationId
          : `inv-${Date.now()}`;

      // Extract sessionId
      let sessionId = 'unknown';
      const session = ctx.session as Record<string, unknown> | undefined;
      if (session && typeof session.id === 'string') {
        sessionId = session.id;
      }

      // Update logger sessionId if not yet known
      if (!this.sessionIdKnown) {
        this._logger.setSessionId(sessionId);
        this.sessionIdKnown = true;
      }

      // Create new InteractionRecord
      this.currentInteraction = {
        interactionId: invocationId,
        sessionId,
        startedAt: Date.now(),
        userMessage: this.pendingUserMessage,
        roundTrips: [],
        totalPromptTokens: 0,
        totalCompletionTokens: 0,
      };

      // Reset state
      this.roundTripCounter = 0;
      this.currentRoundTrip = null;
      this.activeToolCalls.clear();
      this.partialTexts = [];
      this.chunkCount = 0;

      // Log interaction_start
      this.log('interaction_start', undefined, {
        sessionId,
        userMessage: this.pendingUserMessage ?? '',
      });

      this.pendingUserMessage = undefined;
    } catch (err) {
      this.logError('beforeRunCallback', err);
    }
    return undefined;
  }

  override async beforeModelCallback(params: {
    callbackContext: unknown;
    llmRequest: unknown;
  }): Promise<undefined> {
    try {
      // Safety net: finalize any unclosed round trip
      if (this.currentRoundTrip !== null) {
        this.finalizeRoundTrip();
      }

      this.roundTripCounter++;
      const isFirstRoundTrip = this.roundTripCounter === 1;

      // Extract agentName from callbackContext
      const ctx = params.callbackContext as Record<string, unknown>;
      const agentName =
        typeof ctx.agentName === 'string' ? ctx.agentName : 'unknown';

      // Serialize the LLM request
      const serialized = serializeLlmRequest(
        params.llmRequest,
        isFirstRoundTrip,
      );

      // Create new RoundTripRecord
      this.currentRoundTrip = {
        roundTripNumber: this.roundTripCounter,
        agentName,
        requestTimestamp: Date.now(),
        contentsCount:
          typeof serialized.contentsCount === 'number'
            ? serialized.contentsCount
            : 0,
        contents: serialized.contents as unknown[] | undefined,
        model:
          typeof serialized.model === 'string' ? serialized.model : undefined,
        systemInstruction: serialized.systemInstruction,
        systemInstructionText:
          typeof serialized.systemInstructionText === 'string'
            ? serialized.systemInstructionText
            : undefined,
        toolNames: Array.isArray(serialized.toolNames)
          ? (serialized.toolNames as string[])
          : [],
        toolDeclarations: isFirstRoundTrip
          ? (serialized.toolDeclarations as unknown[] | undefined)
          : undefined,
        generationConfig: serialized.generationConfig as
          | Record<string, unknown>
          | undefined,
        streamed: false,
        chunkCount: 0,
        toolCalls: [],
      };

      // Reset streaming accumulators
      this.partialTexts = [];
      this.chunkCount = 0;

      // Log llm_request
      this.log('llm_request', this.roundTripCounter, serialized);
    } catch (err) {
      this.logError('beforeModelCallback', err);
    }
    return undefined;
  }

  override async afterModelCallback(params: {
    callbackContext: unknown;
    llmResponse: unknown;
  }): Promise<undefined> {
    try {
      if (this.currentRoundTrip === null) return undefined;

      this.chunkCount++;
      const serialized = serializeLlmResponse(params.llmResponse);
      const resp = params.llmResponse as Record<string, unknown> | undefined;

      const partial = resp?.partial;
      const turnComplete = resp?.turnComplete;

      // Check if this is a partial (non-final) chunk
      if (partial === true && turnComplete !== true) {
        // Accumulate text from partial chunk
        this.accumulatePartialText(resp);
        this.currentRoundTrip.streamed = true;
        return undefined;
      }

      // FINAL CHUNK: finalize the round trip
      if (this.partialTexts.length > 0) {
        this.currentRoundTrip.streamed = true;
      }

      // Set response fields from the final serialized response
      this.currentRoundTrip.responseContent = serialized.content;

      if (
        serialized.usageMetadata &&
        typeof serialized.usageMetadata === 'object'
      ) {
        this.currentRoundTrip.usageMetadata = serialized.usageMetadata as {
          promptTokenCount?: number;
          candidatesTokenCount?: number;
          totalTokenCount?: number;
        };
      }

      if (typeof serialized.finishReason === 'string') {
        this.currentRoundTrip.finishReason = serialized.finishReason;
      }

      if (typeof serialized.errorCode === 'string') {
        this.currentRoundTrip.errorCode = serialized.errorCode;
      }

      if (typeof serialized.errorMessage === 'string') {
        this.currentRoundTrip.errorMessage = serialized.errorMessage;
      }

      this.currentRoundTrip.chunkCount = this.chunkCount;
      this.currentRoundTrip.responseTimestamp = Date.now();
      this.currentRoundTrip.durationMs =
        this.currentRoundTrip.responseTimestamp -
        this.currentRoundTrip.requestTimestamp;

      // Log llm_response
      this.log('llm_response', this.roundTripCounter, {
        ...serialized,
        streamed: this.currentRoundTrip.streamed,
        chunkCount: this.currentRoundTrip.chunkCount,
        durationMs: this.currentRoundTrip.durationMs,
      });

      // Push to interaction and reset
      if (this.currentInteraction) {
        this.currentInteraction.roundTrips.push(this.currentRoundTrip);
      }
      this.currentRoundTrip = null;
      this.partialTexts = [];
      this.chunkCount = 0;
    } catch (err) {
      this.logError('afterModelCallback', err);
    }
    return undefined;
  }

  override async beforeToolCallback(params: {
    tool: unknown;
    toolArgs: Record<string, unknown>;
    toolContext: unknown;
  }): Promise<undefined> {
    try {
      const tool = params.tool as Record<string, unknown>;
      const toolName =
        typeof tool?.name === 'string' ? tool.name : 'unknown_tool';

      const ctx = params.toolContext as Record<string, unknown>;
      const functionCallId =
        typeof ctx?.functionCallId === 'string'
          ? ctx.functionCallId
          : `fcid-${Date.now()}`;

      const record: ToolCallRecord = {
        toolName,
        functionCallId,
        args: params.toolArgs,
        startedAt: Date.now(),
      };

      this.activeToolCalls.set(functionCallId, record);

      this.log('tool_start', this.roundTripCounter, {
        toolName,
        functionCallId,
        args: params.toolArgs,
      });
    } catch (err) {
      this.logError('beforeToolCallback', err);
    }
    return undefined;
  }

  override async afterToolCallback(params: {
    tool: unknown;
    toolArgs: Record<string, unknown>;
    toolContext: unknown;
    result: Record<string, unknown>;
  }): Promise<undefined> {
    try {
      const ctx = params.toolContext as Record<string, unknown>;
      const functionCallId =
        typeof ctx?.functionCallId === 'string'
          ? ctx.functionCallId
          : undefined;

      const record = functionCallId
        ? this.activeToolCalls.get(functionCallId)
        : undefined;

      if (record) {
        record.result = params.result;
        record.completedAt = Date.now();
        record.durationMs = record.completedAt - record.startedAt;

        // Attach to appropriate round trip
        this.attachToolCall(record);

        if (functionCallId) {
          this.activeToolCalls.delete(functionCallId);
        }

        this.log('tool_result', this.roundTripCounter, {
          toolName: record.toolName,
          functionCallId: record.functionCallId,
          durationMs: record.durationMs,
          resultKeys: params.result ? Object.keys(params.result) : [],
        });
      }
    } catch (err) {
      this.logError('afterToolCallback', err);
    }
    return undefined;
  }

  override async onModelErrorCallback(params: {
    callbackContext: unknown;
    llmRequest: unknown;
    error: Error;
  }): Promise<undefined> {
    try {
      if (this.currentRoundTrip) {
        this.currentRoundTrip.errorCode = 'MODEL_ERROR';
        this.currentRoundTrip.errorMessage = params.error.message;
        this.currentRoundTrip.responseTimestamp = Date.now();
        this.currentRoundTrip.durationMs =
          this.currentRoundTrip.responseTimestamp -
          this.currentRoundTrip.requestTimestamp;
        this.currentRoundTrip.chunkCount = this.chunkCount;

        if (this.currentInteraction) {
          this.currentInteraction.roundTrips.push(this.currentRoundTrip);
        }
        this.currentRoundTrip = null;
        this.partialTexts = [];
        this.chunkCount = 0;
      }

      this.log('llm_error', this.roundTripCounter, {
        error: params.error.message,
      });
    } catch (err) {
      this.logError('onModelErrorCallback', err);
    }
    return undefined;
  }

  override async onToolErrorCallback(params: {
    tool: unknown;
    toolArgs: Record<string, unknown>;
    toolContext: unknown;
    error: Error;
  }): Promise<undefined> {
    try {
      const ctx = params.toolContext as Record<string, unknown>;
      const functionCallId =
        typeof ctx?.functionCallId === 'string'
          ? ctx.functionCallId
          : undefined;

      const tool = params.tool as Record<string, unknown>;
      const toolName =
        typeof tool?.name === 'string' ? tool.name : 'unknown_tool';

      const record = functionCallId
        ? this.activeToolCalls.get(functionCallId)
        : undefined;

      if (record) {
        record.error = params.error.message;
        record.completedAt = Date.now();
        record.durationMs = record.completedAt - record.startedAt;

        // Attach to appropriate round trip
        this.attachToolCall(record);

        if (functionCallId) {
          this.activeToolCalls.delete(functionCallId);
        }
      }

      this.log('tool_error', this.roundTripCounter, {
        toolName,
        functionCallId: functionCallId ?? '',
        error: params.error.message,
      });
    } catch (err) {
      this.logError('onToolErrorCallback', err);
    }
    return undefined;
  }

  override async afterRunCallback(_params: {
    invocationContext: unknown;
  }): Promise<void> {
    try {
      // Safety net: finalize any unclosed round trip
      if (this.currentRoundTrip !== null) {
        this.finalizeRoundTrip();
      }

      // Safety net: drain remaining active tool calls
      for (const [, record] of this.activeToolCalls) {
        record.error = 'interaction ended before tool completed';
        record.completedAt = Date.now();
        record.durationMs = record.completedAt - record.startedAt;
        this.attachToolCall(record);
      }
      this.activeToolCalls.clear();

      // Finalize interaction
      if (this.currentInteraction) {
        this.finalizeInteraction();
      }
    } catch (err) {
      this.logError('afterRunCallback', err);
    }
  }

  // ===================================================================
  // Private Helpers
  // ===================================================================

  /** Finalize the current round trip and push to interaction. */
  private finalizeRoundTrip(): void {
    if (!this.currentRoundTrip) return;

    if (!this.currentRoundTrip.responseTimestamp) {
      this.currentRoundTrip.responseTimestamp = Date.now();
      this.currentRoundTrip.durationMs =
        this.currentRoundTrip.responseTimestamp -
        this.currentRoundTrip.requestTimestamp;
    }
    this.currentRoundTrip.chunkCount = this.chunkCount;

    if (this.currentInteraction) {
      this.currentInteraction.roundTrips.push(this.currentRoundTrip);
    }
    this.currentRoundTrip = null;
    this.partialTexts = [];
    this.chunkCount = 0;
  }

  /** Finalize the current interaction, push to buffer, flush logger. */
  private finalizeInteraction(): void {
    if (!this.currentInteraction) return;

    this.currentInteraction.completedAt = Date.now();
    this.currentInteraction.durationMs =
      this.currentInteraction.completedAt - this.currentInteraction.startedAt;

    // Sum tokens across round trips
    let totalPrompt = 0;
    let totalCompletion = 0;
    const allToolNames: string[] = [];

    for (const rt of this.currentInteraction.roundTrips) {
      if (rt.usageMetadata) {
        totalPrompt += rt.usageMetadata.promptTokenCount ?? 0;
        totalCompletion += rt.usageMetadata.candidatesTokenCount ?? 0;
      }
      for (const tc of rt.toolCalls) {
        allToolNames.push(tc.toolName);
      }
    }
    this.currentInteraction.totalPromptTokens = totalPrompt;
    this.currentInteraction.totalCompletionTokens = totalCompletion;

    // Log interaction_end
    this.log('interaction_end', undefined, {
      roundTripCount: this.currentInteraction.roundTrips.length,
      totalPromptTokens: totalPrompt,
      totalCompletionTokens: totalCompletion,
      totalTokens: totalPrompt + totalCompletion,
      durationMs: this.currentInteraction.durationMs,
      toolCalls: allToolNames,
    });

    // Push to buffer
    this._buffer.push(this.currentInteraction);

    // Flush logger (fire-and-forget)
    void this._logger.flush();

    // Print verbose summary to stderr
    if (this.verbose) {
      const id = this.currentInteraction.interactionId.slice(0, 8);
      const rtCount = this.currentInteraction.roundTrips.length;
      const total = totalPrompt + totalCompletion;
      const dur = (this.currentInteraction.durationMs / 1000).toFixed(1);
      const tools =
        allToolNames.length > 0 ? allToolNames.join(', ') : 'none';
      process.stderr.write(
        `[llm-proxy] Interaction ${id} completed: ${rtCount} round trips, ` +
          `tokens: ${totalPrompt} prompt + ${totalCompletion} completion = ${total} total, ` +
          `tools: ${tools}, ` +
          `duration: ${dur}s\n`,
      );
    }

    this.currentInteraction = null;
  }

  /** Accumulate text from a partial streaming chunk. */
  private accumulatePartialText(
    resp: Record<string, unknown> | undefined,
  ): void {
    if (!resp) return;
    try {
      const content = resp.content as Record<string, unknown> | undefined;
      if (!content) return;
      const parts = content.parts as unknown[] | undefined;
      if (!Array.isArray(parts)) return;
      for (const part of parts) {
        if (typeof part === 'object' && part !== null && 'text' in part) {
          const text = (part as Record<string, unknown>).text;
          if (typeof text === 'string') {
            this.partialTexts.push(text);
          }
        }
      }
    } catch {
      // Ignore accumulation errors
    }
  }

  /** Attach a tool call record to the current or last round trip. */
  private attachToolCall(record: ToolCallRecord): void {
    if (this.currentRoundTrip) {
      this.currentRoundTrip.toolCalls.push(record);
    } else if (this.currentInteraction) {
      // Attach to the last round trip in the interaction
      const rts = this.currentInteraction.roundTrips;
      if (rts.length > 0) {
        rts[rts.length - 1].toolCalls.push(record);
      }
    }
  }

  /** Write a LogEntry to the logger. */
  private log(
    event: ProxyEventType,
    roundTrip: number | undefined,
    payload: Record<string, unknown>,
  ): void {
    try {
      const entry: LogEntry = {
        event,
        timestamp: new Date().toISOString(),
        interactionId:
          this.currentInteraction?.interactionId ?? 'unknown',
        roundTrip,
        payload,
      };
      this._logger.write(entry);
    } catch (err) {
      this.logError('log', err);
    }
  }

  /** Write an error to stderr. Never throws. */
  private logError(method: string, err: unknown): void {
    try {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `[llm-proxy] Error in ${method}: ${message}\n`,
      );
    } catch {
      // Nothing we can do
    }
  }
}
