import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LlmProxyPlugin } from '../notebooklm_agent/proxy/llm-proxy-plugin.ts';
import type { ProxyConfig } from '../notebooklm_agent/proxy/proxy-types.ts';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tempDir: string;

function makeConfig(overrides?: Partial<ProxyConfig>): ProxyConfig {
  return {
    enabled: true,
    logDir: tempDir,
    verbose: false,
    bufferSize: 10,
    maxFileSize: 52428800,
    ...overrides,
  };
}

function makeInvocationContext(overrides?: Record<string, unknown>) {
  return {
    invocationId: 'inv-test-001',
    session: { id: 'session-test-001' },
    ...overrides,
  };
}

function makeLlmRequest(overrides?: Record<string, unknown>) {
  return {
    model: 'gemini-2.0-flash',
    contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
    config: {
      systemInstruction: { parts: [{ text: 'You are helpful' }] },
      tools: [{ name: 'search_youtube' }],
    },
    toolsDict: { search_youtube: {} },
    ...overrides,
  };
}

function makeCallbackContext(overrides?: Record<string, unknown>) {
  return {
    agentName: 'test-agent',
    ...overrides,
  };
}

function makeLlmResponse(overrides?: Record<string, unknown>) {
  return {
    content: { parts: [{ text: 'Hello back' }] },
    usageMetadata: {
      promptTokenCount: 10,
      candidatesTokenCount: 5,
      totalTokenCount: 15,
    },
    finishReason: 'STOP',
    partial: false,
    turnComplete: true,
    ...overrides,
  };
}

function makePartialResponse(text: string) {
  return {
    content: { parts: [{ text }] },
    partial: true,
    turnComplete: false,
  };
}

function makeUserMessage(text: string) {
  return {
    parts: [{ text }],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LlmProxyPlugin', () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'proxy-plugin-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // -- Constructor & initial state --

  describe('constructor and initial state', () => {
    it('creates plugin with config, buffer, and logger', () => {
      const plugin = new LlmProxyPlugin(makeConfig());
      expect(plugin).toBeDefined();
      expect(plugin.buffer).toBeDefined();
      expect(plugin.logger).toBeDefined();
    });

    it('getAllInteractions returns empty array initially', () => {
      const plugin = new LlmProxyPlugin(makeConfig());
      expect(plugin.getAllInteractions()).toEqual([]);
    });

    it('getLastInteraction returns undefined initially', () => {
      const plugin = new LlmProxyPlugin(makeConfig());
      expect(plugin.getLastInteraction()).toBeUndefined();
    });

    it('isActive returns false initially', () => {
      const plugin = new LlmProxyPlugin(makeConfig());
      expect(plugin.isActive()).toBe(false);
    });
  });

  // -- Callback flow: single round trip --

  describe('single round trip flow', () => {
    it('beforeRunCallback starts an interaction', async () => {
      const plugin = new LlmProxyPlugin(makeConfig());
      await plugin.beforeRunCallback({
        invocationContext: makeInvocationContext(),
      });
      expect(plugin.isActive()).toBe(true);
    });

    it('full callback sequence produces one interaction with one round trip', async () => {
      const plugin = new LlmProxyPlugin(makeConfig());

      // 1. User message
      await plugin.onUserMessageCallback({
        invocationContext: makeInvocationContext(),
        userMessage: makeUserMessage('What is AI?'),
      });

      // 2. Before run
      await plugin.beforeRunCallback({
        invocationContext: makeInvocationContext(),
      });

      // 3. Before model
      await plugin.beforeModelCallback({
        callbackContext: makeCallbackContext(),
        llmRequest: makeLlmRequest(),
      });

      // 4. After model (final)
      await plugin.afterModelCallback({
        callbackContext: makeCallbackContext(),
        llmResponse: makeLlmResponse(),
      });

      // 5. After run
      await plugin.afterRunCallback({
        invocationContext: makeInvocationContext(),
      });

      const interactions = plugin.getAllInteractions();
      expect(interactions).toHaveLength(1);
      expect(interactions[0].interactionId).toBe('inv-test-001');
      expect(interactions[0].sessionId).toBe('session-test-001');
      expect(interactions[0].roundTrips).toHaveLength(1);
      expect(interactions[0].roundTrips[0].roundTripNumber).toBe(1);
      expect(interactions[0].completedAt).toBeDefined();
      expect(interactions[0].durationMs).toBeDefined();
    });

    it('captures user message text', async () => {
      const plugin = new LlmProxyPlugin(makeConfig());
      await plugin.onUserMessageCallback({
        invocationContext: makeInvocationContext(),
        userMessage: makeUserMessage('Tell me about cats'),
      });
      await plugin.beforeRunCallback({
        invocationContext: makeInvocationContext(),
      });
      await plugin.beforeModelCallback({
        callbackContext: makeCallbackContext(),
        llmRequest: makeLlmRequest(),
      });
      await plugin.afterModelCallback({
        callbackContext: makeCallbackContext(),
        llmResponse: makeLlmResponse(),
      });
      await plugin.afterRunCallback({
        invocationContext: makeInvocationContext(),
      });

      const interaction = plugin.getLastInteraction();
      expect(interaction?.userMessage).toBe('Tell me about cats');
    });

    it('records usage metadata and sums tokens', async () => {
      const plugin = new LlmProxyPlugin(makeConfig());
      await plugin.beforeRunCallback({ invocationContext: makeInvocationContext() });
      await plugin.beforeModelCallback({
        callbackContext: makeCallbackContext(),
        llmRequest: makeLlmRequest(),
      });
      await plugin.afterModelCallback({
        callbackContext: makeCallbackContext(),
        llmResponse: makeLlmResponse({
          usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50, totalTokenCount: 150 },
        }),
      });
      await plugin.afterRunCallback({ invocationContext: makeInvocationContext() });

      const interaction = plugin.getLastInteraction()!;
      expect(interaction.totalPromptTokens).toBe(100);
      expect(interaction.totalCompletionTokens).toBe(50);
    });
  });

  // -- Streaming (partial responses) --

  describe('streaming / partial responses', () => {
    it('accumulates partial chunks and finalizes on non-partial', async () => {
      const plugin = new LlmProxyPlugin(makeConfig());
      await plugin.beforeRunCallback({ invocationContext: makeInvocationContext() });
      await plugin.beforeModelCallback({
        callbackContext: makeCallbackContext(),
        llmRequest: makeLlmRequest(),
      });

      // Partial chunks
      await plugin.afterModelCallback({
        callbackContext: makeCallbackContext(),
        llmResponse: makePartialResponse('Hello '),
      });
      await plugin.afterModelCallback({
        callbackContext: makeCallbackContext(),
        llmResponse: makePartialResponse('world'),
      });

      // Final chunk
      await plugin.afterModelCallback({
        callbackContext: makeCallbackContext(),
        llmResponse: makeLlmResponse({ partial: false, turnComplete: true }),
      });

      await plugin.afterRunCallback({ invocationContext: makeInvocationContext() });

      const rt = plugin.getLastInteraction()!.roundTrips[0];
      expect(rt.streamed).toBe(true);
      expect(rt.chunkCount).toBe(3); // 2 partial + 1 final
    });
  });

  // -- Tool calls --

  describe('tool call tracking', () => {
    it('beforeToolCallback and afterToolCallback create and complete tool call record', async () => {
      const plugin = new LlmProxyPlugin(makeConfig());
      await plugin.beforeRunCallback({ invocationContext: makeInvocationContext() });
      await plugin.beforeModelCallback({
        callbackContext: makeCallbackContext(),
        llmRequest: makeLlmRequest(),
      });
      await plugin.afterModelCallback({
        callbackContext: makeCallbackContext(),
        llmResponse: makeLlmResponse(),
      });

      // Tool call
      await plugin.beforeToolCallback({
        tool: { name: 'search_youtube' },
        toolArgs: { query: 'cats' },
        toolContext: { functionCallId: 'fc-001' },
      });
      await plugin.afterToolCallback({
        tool: { name: 'search_youtube' },
        toolArgs: { query: 'cats' },
        toolContext: { functionCallId: 'fc-001' },
        result: { items: [] },
      });

      await plugin.afterRunCallback({ invocationContext: makeInvocationContext() });

      const rt = plugin.getLastInteraction()!.roundTrips[0];
      expect(rt.toolCalls).toHaveLength(1);
      expect(rt.toolCalls[0].toolName).toBe('search_youtube');
      expect(rt.toolCalls[0].args).toEqual({ query: 'cats' });
      expect(rt.toolCalls[0].result).toEqual({ items: [] });
      expect(rt.toolCalls[0].durationMs).toBeDefined();
      expect(rt.toolCalls[0].completedAt).toBeDefined();
    });

    it('onToolErrorCallback records error on tool call', async () => {
      const plugin = new LlmProxyPlugin(makeConfig());
      await plugin.beforeRunCallback({ invocationContext: makeInvocationContext() });
      await plugin.beforeModelCallback({
        callbackContext: makeCallbackContext(),
        llmRequest: makeLlmRequest(),
      });
      await plugin.afterModelCallback({
        callbackContext: makeCallbackContext(),
        llmResponse: makeLlmResponse(),
      });

      await plugin.beforeToolCallback({
        tool: { name: 'search_youtube' },
        toolArgs: { query: 'cats' },
        toolContext: { functionCallId: 'fc-002' },
      });
      await plugin.onToolErrorCallback({
        tool: { name: 'search_youtube' },
        toolArgs: { query: 'cats' },
        toolContext: { functionCallId: 'fc-002' },
        error: new Error('API quota exceeded'),
      });

      await plugin.afterRunCallback({ invocationContext: makeInvocationContext() });

      const rt = plugin.getLastInteraction()!.roundTrips[0];
      expect(rt.toolCalls).toHaveLength(1);
      expect(rt.toolCalls[0].error).toBe('API quota exceeded');
    });
  });

  // -- Model error --

  describe('model error', () => {
    it('onModelErrorCallback records error on current round trip', async () => {
      const plugin = new LlmProxyPlugin(makeConfig());
      await plugin.beforeRunCallback({ invocationContext: makeInvocationContext() });
      await plugin.beforeModelCallback({
        callbackContext: makeCallbackContext(),
        llmRequest: makeLlmRequest(),
      });

      await plugin.onModelErrorCallback({
        callbackContext: makeCallbackContext(),
        llmRequest: makeLlmRequest(),
        error: new Error('Rate limited'),
      });

      await plugin.afterRunCallback({ invocationContext: makeInvocationContext() });

      const rt = plugin.getLastInteraction()!.roundTrips[0];
      expect(rt.errorCode).toBe('MODEL_ERROR');
      expect(rt.errorMessage).toBe('Rate limited');
    });
  });

  // -- Multiple round trips --

  describe('multiple round trips', () => {
    it('round trips are numbered sequentially (1-based)', async () => {
      const plugin = new LlmProxyPlugin(makeConfig());
      await plugin.beforeRunCallback({ invocationContext: makeInvocationContext() });

      // Round trip 1
      await plugin.beforeModelCallback({
        callbackContext: makeCallbackContext(),
        llmRequest: makeLlmRequest(),
      });
      await plugin.afterModelCallback({
        callbackContext: makeCallbackContext(),
        llmResponse: makeLlmResponse(),
      });

      // Round trip 2
      await plugin.beforeModelCallback({
        callbackContext: makeCallbackContext(),
        llmRequest: makeLlmRequest(),
      });
      await plugin.afterModelCallback({
        callbackContext: makeCallbackContext(),
        llmResponse: makeLlmResponse(),
      });

      // Round trip 3
      await plugin.beforeModelCallback({
        callbackContext: makeCallbackContext(),
        llmRequest: makeLlmRequest(),
      });
      await plugin.afterModelCallback({
        callbackContext: makeCallbackContext(),
        llmResponse: makeLlmResponse(),
      });

      await plugin.afterRunCallback({ invocationContext: makeInvocationContext() });

      const interaction = plugin.getLastInteraction()!;
      expect(interaction.roundTrips).toHaveLength(3);
      expect(interaction.roundTrips[0].roundTripNumber).toBe(1);
      expect(interaction.roundTrips[1].roundTripNumber).toBe(2);
      expect(interaction.roundTrips[2].roundTripNumber).toBe(3);
    });

    it('tokens are summed across all round trips', async () => {
      const plugin = new LlmProxyPlugin(makeConfig());
      await plugin.beforeRunCallback({ invocationContext: makeInvocationContext() });

      await plugin.beforeModelCallback({
        callbackContext: makeCallbackContext(),
        llmRequest: makeLlmRequest(),
      });
      await plugin.afterModelCallback({
        callbackContext: makeCallbackContext(),
        llmResponse: makeLlmResponse({
          usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 20, totalTokenCount: 70 },
        }),
      });

      await plugin.beforeModelCallback({
        callbackContext: makeCallbackContext(),
        llmRequest: makeLlmRequest(),
      });
      await plugin.afterModelCallback({
        callbackContext: makeCallbackContext(),
        llmResponse: makeLlmResponse({
          usageMetadata: { promptTokenCount: 80, candidatesTokenCount: 30, totalTokenCount: 110 },
        }),
      });

      await plugin.afterRunCallback({ invocationContext: makeInvocationContext() });

      const interaction = plugin.getLastInteraction()!;
      expect(interaction.totalPromptTokens).toBe(130);
      expect(interaction.totalCompletionTokens).toBe(50);
    });
  });

  // -- Safety nets --

  describe('safety nets', () => {
    it('afterRunCallback finalizes unclosed round trip', async () => {
      const plugin = new LlmProxyPlugin(makeConfig());
      await plugin.beforeRunCallback({ invocationContext: makeInvocationContext() });
      await plugin.beforeModelCallback({
        callbackContext: makeCallbackContext(),
        llmRequest: makeLlmRequest(),
      });
      // Note: no afterModelCallback -- round trip is unclosed

      await plugin.afterRunCallback({ invocationContext: makeInvocationContext() });

      const interaction = plugin.getLastInteraction()!;
      expect(interaction.roundTrips).toHaveLength(1);
      expect(interaction.completedAt).toBeDefined();
    });

    it('beforeRunCallback finalizes previous unclosed interaction', async () => {
      const plugin = new LlmProxyPlugin(makeConfig());

      // Start first interaction but don't close it
      await plugin.beforeRunCallback({
        invocationContext: makeInvocationContext({ invocationId: 'inv-first' }),
      });

      // Start second interaction -- should finalize the first
      await plugin.beforeRunCallback({
        invocationContext: makeInvocationContext({ invocationId: 'inv-second' }),
      });
      await plugin.afterRunCallback({ invocationContext: makeInvocationContext() });

      const all = plugin.getAllInteractions();
      expect(all).toHaveLength(2);
      expect(all[0].interactionId).toBe('inv-first');
      expect(all[1].interactionId).toBe('inv-second');
    });
  });

  // -- Callbacks never throw --

  describe('error resilience', () => {
    it('callbacks never throw with malformed input', async () => {
      const plugin = new LlmProxyPlugin(makeConfig());

      // All callbacks should return undefined and not throw
      const r1 = await plugin.onUserMessageCallback({
        invocationContext: undefined as unknown,
        userMessage: 42 as unknown,
      });
      expect(r1).toBeUndefined();

      const r2 = await plugin.beforeRunCallback({
        invocationContext: null as unknown,
      });
      expect(r2).toBeUndefined();

      const r3 = await plugin.beforeModelCallback({
        callbackContext: 'not-an-object' as unknown,
        llmRequest: null as unknown,
      });
      expect(r3).toBeUndefined();

      const r4 = await plugin.afterModelCallback({
        callbackContext: {} as unknown,
        llmResponse: undefined as unknown,
      });
      expect(r4).toBeUndefined();

      const r5 = await plugin.beforeToolCallback({
        tool: null as unknown,
        toolArgs: {} as Record<string, unknown>,
        toolContext: undefined as unknown,
      });
      expect(r5).toBeUndefined();
    });

    it('all callbacks return undefined', async () => {
      const plugin = new LlmProxyPlugin(makeConfig());
      await plugin.beforeRunCallback({ invocationContext: makeInvocationContext() });

      const results = await Promise.all([
        plugin.onUserMessageCallback({ invocationContext: makeInvocationContext(), userMessage: makeUserMessage('hi') }),
        plugin.beforeModelCallback({ callbackContext: makeCallbackContext(), llmRequest: makeLlmRequest() }),
      ]);

      for (const r of results) {
        expect(r).toBeUndefined();
      }
    });
  });

  // -- Buffer interaction --

  describe('buffer integration', () => {
    it('afterRunCallback pushes interaction to buffer', async () => {
      const plugin = new LlmProxyPlugin(makeConfig());
      await plugin.beforeRunCallback({ invocationContext: makeInvocationContext() });
      await plugin.beforeModelCallback({
        callbackContext: makeCallbackContext(),
        llmRequest: makeLlmRequest(),
      });
      await plugin.afterModelCallback({
        callbackContext: makeCallbackContext(),
        llmResponse: makeLlmResponse(),
      });
      await plugin.afterRunCallback({ invocationContext: makeInvocationContext() });

      expect(plugin.buffer.size).toBe(1);
      expect(plugin.buffer.getLast()?.interactionId).toBe('inv-test-001');
    });

    it('isActive returns false after afterRunCallback', async () => {
      const plugin = new LlmProxyPlugin(makeConfig());
      await plugin.beforeRunCallback({ invocationContext: makeInvocationContext() });
      expect(plugin.isActive()).toBe(true);
      await plugin.afterRunCallback({ invocationContext: makeInvocationContext() });
      expect(plugin.isActive()).toBe(false);
    });
  });

  // -- User message truncation --

  describe('user message truncation', () => {
    it('truncates user message to 500 characters', async () => {
      const plugin = new LlmProxyPlugin(makeConfig());
      const longMessage = 'A'.repeat(600);
      await plugin.onUserMessageCallback({
        invocationContext: makeInvocationContext(),
        userMessage: makeUserMessage(longMessage),
      });
      await plugin.beforeRunCallback({ invocationContext: makeInvocationContext() });
      await plugin.afterRunCallback({ invocationContext: makeInvocationContext() });

      const interaction = plugin.getLastInteraction()!;
      expect(interaction.userMessage).toHaveLength(500);
    });
  });

  // -- Close --

  describe('close', () => {
    it('close does not throw', async () => {
      const plugin = new LlmProxyPlugin(makeConfig());
      await expect(plugin.close()).resolves.toBeUndefined();
    });
  });
});
