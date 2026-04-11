import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  formatInspect,
  formatInspectDisabled,
  formatInspectEmpty,
} from '../notebooklm_agent/proxy/format-inspect.ts';
import { LlmProxyPlugin } from '../notebooklm_agent/proxy/llm-proxy-plugin.ts';
import type { ProxyConfig } from '../notebooklm_agent/proxy/proxy-types.ts';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tempDir: string;

function makeConfig(): ProxyConfig {
  return {
    enabled: true,
    logDir: tempDir,
    verbose: false,
    bufferSize: 10,
    maxFileSize: 52428800,
  };
}

/** Push a complete interaction through the plugin callbacks. */
async function pushInteraction(
  plugin: LlmProxyPlugin,
  opts: {
    invocationId?: string;
    userMessage?: string;
    roundTrips?: number;
    toolCalls?: { name: string; fcId: string }[];
  } = {},
) {
  const invocationId = opts.invocationId ?? `inv-${Date.now()}`;
  const userMessage = opts.userMessage ?? 'Hello';
  const roundTripCount = opts.roundTrips ?? 1;

  await plugin.onUserMessageCallback({
    invocationContext: { invocationId },
    userMessage: { parts: [{ text: userMessage }] },
  });

  await plugin.beforeRunCallback({
    invocationContext: {
      invocationId,
      session: { id: 'session-fmt-test' },
    },
  });

  for (let i = 0; i < roundTripCount; i++) {
    await plugin.beforeModelCallback({
      callbackContext: { agentName: 'test-agent' },
      llmRequest: {
        model: 'gemini-2.0-flash',
        contents: [{ role: 'user', parts: [{ text: userMessage }] }],
        config: {},
        toolsDict: { search_youtube: {} },
      },
    });

    // Add tool calls for the first round trip if specified
    if (i === 0 && opts.toolCalls) {
      // Finalize the model response first (tools happen after model response)
      await plugin.afterModelCallback({
        callbackContext: { agentName: 'test-agent' },
        llmResponse: {
          content: { parts: [{ text: 'Let me search for that.' }] },
          usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 20, totalTokenCount: 70 },
          finishReason: 'STOP',
          partial: false,
          turnComplete: true,
        },
      });

      for (const tc of opts.toolCalls) {
        await plugin.beforeToolCallback({
          tool: { name: tc.name },
          toolArgs: { query: 'test' },
          toolContext: { functionCallId: tc.fcId },
        });
        await plugin.afterToolCallback({
          tool: { name: tc.name },
          toolArgs: { query: 'test' },
          toolContext: { functionCallId: tc.fcId },
          result: { items: [] },
        });
      }
    } else {
      await plugin.afterModelCallback({
        callbackContext: { agentName: 'test-agent' },
        llmResponse: {
          content: { parts: [{ text: 'Hello back!' }] },
          usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 20, totalTokenCount: 70 },
          finishReason: 'STOP',
          partial: false,
          turnComplete: true,
        },
      });
    }
  }

  await plugin.afterRunCallback({
    invocationContext: { invocationId },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('format-inspect', () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'format-inspect-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('formatInspectDisabled returns instructions text', () => {
    const output = formatInspectDisabled();
    expect(output).toContain('LLM Proxy is not active');
    expect(output).toContain('LLM_PROXY_ENABLED');
    expect(output).toContain('LLM_PROXY_LOG_DIR');
  });

  it('formatInspectEmpty returns "no interactions" text', () => {
    const output = formatInspectEmpty();
    expect(output).toContain('No interactions captured yet');
  });

  it('formatInspect with a populated plugin shows interaction details', async () => {
    const plugin = new LlmProxyPlugin(makeConfig());
    await pushInteraction(plugin, {
      invocationId: 'inv-abcd1234-test',
      userMessage: 'Tell me about AI',
      roundTrips: 1,
    });

    const output = formatInspect(plugin);
    // Should contain interaction ID (first 8 chars)
    expect(output).toContain('inv-abcd');
    // Should contain round trip info
    expect(output).toContain('Round Trip 1');
    // Should contain model name
    expect(output).toContain('gemini-2.0-flash');

    await plugin.close();
  });

  it('output contains tool call info when tools were invoked', async () => {
    const plugin = new LlmProxyPlugin(makeConfig());
    await pushInteraction(plugin, {
      invocationId: 'inv-tools-test1',
      toolCalls: [
        { name: 'search_youtube', fcId: 'fc-001' },
      ],
    });

    const output = formatInspect(plugin);
    expect(output).toContain('search_youtube');
    expect(output).toContain('Tool Calls');

    await plugin.close();
  });

  it('output contains ANSI color codes', async () => {
    const plugin = new LlmProxyPlugin(makeConfig());
    await pushInteraction(plugin, { invocationId: 'inv-ansi-test1' });

    const output = formatInspect(plugin);
    // Check for ANSI escape sequences
    expect(output).toMatch(/\x1b\[\d+m/);

    await plugin.close();
  });

  it('handles interaction with zero round trips gracefully', async () => {
    const plugin = new LlmProxyPlugin(makeConfig());

    // Create an interaction with no model calls -- just beforeRun + afterRun
    await plugin.beforeRunCallback({
      invocationContext: {
        invocationId: 'inv-zero-rt',
        session: { id: 'session-zero' },
      },
    });
    await plugin.afterRunCallback({
      invocationContext: { invocationId: 'inv-zero-rt' },
    });

    const output = formatInspect(plugin);
    expect(output).toContain('inv-zero');
    expect(output).toContain('Round Trips');
    // Should not crash
    expect(typeof output).toBe('string');

    await plugin.close();
  });
});
