import { describe, it, expect } from 'vitest';
import {
  safeSerialize,
  extractToolNames,
  flattenSystemInstruction,
  serializeLlmRequest,
  serializeLlmResponse,
} from '../notebooklm_agent/proxy/proxy-serializer.ts';

// ─── safeSerialize ───────────────────────────────────────────

describe('safeSerialize', () => {
  it('serializes primitive values', () => {
    expect(safeSerialize('hello')).toBe('"hello"');
    expect(safeSerialize(42)).toBe('42');
    expect(safeSerialize(true)).toBe('true');
    expect(safeSerialize(null)).toBe('null');
  });

  it('serializes nested objects', () => {
    const obj = { a: { b: { c: 1 } } };
    expect(safeSerialize(obj)).toBe('{"a":{"b":{"c":1}}}');
  });

  it('handles circular references with [Circular] placeholder', () => {
    const obj: Record<string, unknown> = { name: 'root' };
    obj.self = obj;
    const result = safeSerialize(obj);
    expect(result).toContain('[Circular]');
    expect(result).toContain('"name":"root"');
  });

  it('handles functions with [Function] placeholder', () => {
    const obj = { fn: () => 42, name: 'test' };
    const result = safeSerialize(obj);
    expect(result).toContain('[Function]');
    expect(result).toContain('"name":"test"');
  });

  it('handles BigInt values', () => {
    const obj = { value: BigInt(9007199254740991) };
    const result = safeSerialize(obj);
    expect(result).toContain('9007199254740991');
  });

  it('truncates output exceeding maxSize', () => {
    const obj = { data: 'x'.repeat(200) };
    const result = safeSerialize(obj, 50);
    expect(result.length).toBeLessThanOrEqual(100); // 50 + truncation message
    expect(result).toContain('[truncated at 50 bytes]');
  });

  it('returns "undefined" for undefined input', () => {
    expect(safeSerialize(undefined)).toBe('undefined');
  });

  it('skips known non-serializable keys (abortSignal, httpOptions, liveConnectConfig)', () => {
    const obj = { model: 'gemini', abortSignal: {}, httpOptions: {}, liveConnectConfig: {} };
    const result = JSON.parse(safeSerialize(obj));
    expect(result).toEqual({ model: 'gemini' });
  });
});

// ─── extractToolNames ────────────────────────────────────────

describe('extractToolNames', () => {
  it('returns keys from an object', () => {
    const dict = { search_youtube: {}, get_video_info: {} };
    expect(extractToolNames(dict)).toEqual(['search_youtube', 'get_video_info']);
  });

  it('returns empty array for null', () => {
    expect(extractToolNames(null)).toEqual([]);
  });

  it('returns empty array for undefined', () => {
    expect(extractToolNames(undefined)).toEqual([]);
  });

  it('returns empty array for non-object', () => {
    expect(extractToolNames('not an object' as unknown as Record<string, unknown>)).toEqual([]);
  });
});

// ─── flattenSystemInstruction ────────────────────────────────

describe('flattenSystemInstruction', () => {
  it('returns string as-is', () => {
    expect(flattenSystemInstruction('You are a helpful agent')).toBe('You are a helpful agent');
  });

  it('handles Content object with text parts', () => {
    const content = {
      parts: [{ text: 'Hello ' }, { text: 'world' }],
    };
    expect(flattenSystemInstruction(content)).toBe('Hello world');
  });

  it('handles Part array directly', () => {
    const parts = [{ text: 'Part 1' }, { text: 'Part 2' }];
    expect(flattenSystemInstruction(parts)).toBe('Part 1Part 2');
  });

  it('returns empty string for undefined/null', () => {
    expect(flattenSystemInstruction(undefined)).toBe('');
    expect(flattenSystemInstruction(null)).toBe('');
  });

  it('returns String coercion for unknown types', () => {
    expect(flattenSystemInstruction(42)).toBe('42');
  });
});

// ─── serializeLlmRequest ─────────────────────────────────────

describe('serializeLlmRequest', () => {
  it('extracts model, contents, toolNames, and generationConfig', () => {
    const request = {
      model: 'gemini-2.0-flash',
      contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
      toolsDict: { search_youtube: {}, read_file: {} },
      config: {
        systemInstruction: 'Be helpful',
        temperature: 0.7,
      },
    };
    const result = serializeLlmRequest(request, false);
    expect(result.model).toBe('gemini-2.0-flash');
    expect(result.contentsCount).toBe(1);
    expect(result.toolNames).toEqual(['search_youtube', 'read_file']);
    expect(result.systemInstructionText).toBe('Be helpful');
    expect(result.generationConfig).toBeDefined();
    expect((result.generationConfig as Record<string, unknown>).temperature).toBe(0.7);
  });

  it('handles missing fields gracefully', () => {
    const result = serializeLlmRequest({}, false);
    expect(result.contentsCount).toBe(0);
    expect(result.toolNames).toEqual([]);
  });

  it('returns error for non-object input', () => {
    const result = serializeLlmRequest(null, false);
    expect(result.error).toBe('request is not an object');
  });

  it('includes toolDeclarations only on first round trip', () => {
    const request = {
      contents: [],
      config: { tools: [{ name: 'search' }] },
      toolsDict: {},
    };
    const first = serializeLlmRequest(request, true);
    const subsequent = serializeLlmRequest(request, false);
    expect(first.toolDeclarations).toBeDefined();
    expect(subsequent.toolDeclarations).toBeUndefined();
  });
});

// ─── serializeLlmResponse ────────────────────────────────────

describe('serializeLlmResponse', () => {
  it('extracts content, usageMetadata, finishReason, partial, turnComplete', () => {
    const response = {
      content: { parts: [{ text: 'Hello!' }] },
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 5,
        totalTokenCount: 15,
      },
      finishReason: 'STOP',
      partial: false,
      turnComplete: true,
    };
    const result = serializeLlmResponse(response);
    expect(result.content).toEqual({ parts: [{ text: 'Hello!' }] });
    expect(result.usageMetadata).toEqual({
      promptTokenCount: 10,
      candidatesTokenCount: 5,
      totalTokenCount: 15,
    });
    expect(result.finishReason).toBe('STOP');
    expect(result.partial).toBe(false);
    expect(result.turnComplete).toBe(true);
  });

  it('returns error for non-object input', () => {
    const result = serializeLlmResponse(null);
    expect(result.error).toBe('response is not an object');
  });

  it('extracts errorCode and errorMessage when present', () => {
    const response = {
      errorCode: '429',
      errorMessage: 'Rate limited',
    };
    const result = serializeLlmResponse(response);
    expect(result.errorCode).toBe('429');
    expect(result.errorMessage).toBe('Rate limited');
  });

  it('handles response with only partial fields', () => {
    const result = serializeLlmResponse({ finishReason: 'MAX_TOKENS' });
    expect(result.finishReason).toBe('MAX_TOKENS');
    expect(result.content).toBeUndefined();
    expect(result.usageMetadata).toBeUndefined();
  });
});
