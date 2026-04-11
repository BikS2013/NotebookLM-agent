import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getProxyConfig, resetProxyConfig } from '../notebooklm_agent/proxy/proxy-config.ts';

describe('getProxyConfig', () => {
  let savedEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    savedEnv = { ...process.env };
    // Clear all proxy-related env vars
    delete process.env.LLM_PROXY_ENABLED;
    delete process.env.LLM_PROXY_LOG_DIR;
    delete process.env.LLM_PROXY_VERBOSE;
    delete process.env.LLM_PROXY_BUFFER_SIZE;
    delete process.env.LLM_PROXY_MAX_FILE_SIZE;
    resetProxyConfig();
  });

  afterEach(() => {
    process.env = savedEnv;
    resetProxyConfig();
  });

  it('returns undefined when LLM_PROXY_ENABLED is not set', () => {
    expect(getProxyConfig()).toBeUndefined();
  });

  it('returns undefined when LLM_PROXY_ENABLED is "false"', () => {
    process.env.LLM_PROXY_ENABLED = 'false';
    expect(getProxyConfig()).toBeUndefined();
  });

  it('throws when enabled but LLM_PROXY_LOG_DIR is missing', () => {
    process.env.LLM_PROXY_ENABLED = 'true';
    expect(() => getProxyConfig()).toThrow('LLM_PROXY_LOG_DIR');
  });

  it('returns valid config with all env vars set', () => {
    process.env.LLM_PROXY_ENABLED = 'true';
    process.env.LLM_PROXY_LOG_DIR = '/tmp/proxy-logs';
    process.env.LLM_PROXY_VERBOSE = 'true';
    process.env.LLM_PROXY_BUFFER_SIZE = '20';
    process.env.LLM_PROXY_MAX_FILE_SIZE = '1048576';

    const config = getProxyConfig();
    expect(config).toBeDefined();
    expect(config!.enabled).toBe(true);
    expect(config!.logDir).toBe('/tmp/proxy-logs');
    expect(config!.verbose).toBe(true);
    expect(config!.bufferSize).toBe(20);
    expect(config!.maxFileSize).toBe(1048576);
  });

  it('applies default values for optional vars', () => {
    process.env.LLM_PROXY_ENABLED = 'true';
    process.env.LLM_PROXY_LOG_DIR = '/tmp/proxy-logs';

    const config = getProxyConfig();
    expect(config).toBeDefined();
    expect(config!.verbose).toBe(false);
    expect(config!.bufferSize).toBe(10);
    expect(config!.maxFileSize).toBe(52428800);
  });

  it('throws when LLM_PROXY_BUFFER_SIZE is not a positive integer', () => {
    process.env.LLM_PROXY_ENABLED = 'true';
    process.env.LLM_PROXY_LOG_DIR = '/tmp/proxy-logs';
    process.env.LLM_PROXY_BUFFER_SIZE = 'abc';
    expect(() => getProxyConfig()).toThrow('LLM_PROXY_BUFFER_SIZE must be a positive integer');
  });

  it('throws when LLM_PROXY_BUFFER_SIZE is zero', () => {
    process.env.LLM_PROXY_ENABLED = 'true';
    process.env.LLM_PROXY_LOG_DIR = '/tmp/proxy-logs';
    process.env.LLM_PROXY_BUFFER_SIZE = '0';
    expect(() => getProxyConfig()).toThrow('LLM_PROXY_BUFFER_SIZE must be a positive integer');
  });

  it('throws when LLM_PROXY_MAX_FILE_SIZE is not a positive integer', () => {
    process.env.LLM_PROXY_ENABLED = 'true';
    process.env.LLM_PROXY_LOG_DIR = '/tmp/proxy-logs';
    process.env.LLM_PROXY_MAX_FILE_SIZE = '-5';
    expect(() => getProxyConfig()).toThrow('LLM_PROXY_MAX_FILE_SIZE must be a positive integer');
  });

  it('resetProxyConfig clears the cached singleton', () => {
    process.env.LLM_PROXY_ENABLED = 'true';
    process.env.LLM_PROXY_LOG_DIR = '/tmp/logs-1';
    const config1 = getProxyConfig();

    resetProxyConfig();
    process.env.LLM_PROXY_LOG_DIR = '/tmp/logs-2';
    const config2 = getProxyConfig();

    expect(config1!.logDir).toBe('/tmp/logs-1');
    expect(config2!.logDir).toBe('/tmp/logs-2');
  });
});
