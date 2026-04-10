import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock child_process before importing runNlm
vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

// Mock config to avoid requiring real env vars
vi.mock('../notebooklm_agent/config.js', () => ({
  getConfig: () => ({
    googleGenaiApiKey: 'fake-key',
    nlmCliPath: '/usr/local/bin/nlm',
    geminiModel: 'gemini-2.0-flash',
    nlmDownloadDir: '/tmp/downloads',
  }),
}));

import { execFileSync } from 'node:child_process';
import { runNlm } from '../notebooklm_agent/tools/nlm-runner.ts';

const mockExecFileSync = vi.mocked(execFileSync);

describe('runNlm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses successful JSON output correctly', () => {
    mockExecFileSync.mockReturnValue(
      JSON.stringify({ notebooks: [{ id: 'nb-1' }] }),
    );

    const result = runNlm(['notebook', 'list', '--json']);

    expect(result.status).toBe('success');
    expect(result.data).toEqual({ notebooks: [{ id: 'nb-1' }] });
    expect(mockExecFileSync).toHaveBeenCalledWith(
      '/usr/local/bin/nlm',
      ['notebook', 'list', '--json'],
      expect.objectContaining({ encoding: 'utf-8' }),
    );
  });

  it('parses successful JSON array output correctly', () => {
    mockExecFileSync.mockReturnValue(
      JSON.stringify([{ id: 'nb-1' }, { id: 'nb-2' }]),
    );

    const result = runNlm(['notebook', 'list']);

    expect(result.status).toBe('success');
    expect(result.data).toEqual([{ id: 'nb-1' }, { id: 'nb-2' }]);
  });

  it('returns text output for non-JSON stdout', () => {
    mockExecFileSync.mockReturnValue('Notebook created successfully');

    const result = runNlm(['notebook', 'create', 'Test']);

    expect(result.status).toBe('success');
    expect(result.output).toBe('Notebook created successfully');
    expect(result.data).toBeUndefined();
  });

  it('classifies nlm error JSON with auth keywords as auth_error', () => {
    mockExecFileSync.mockReturnValue(
      JSON.stringify({ status: 'error', error: 'Session expired, please login again' }),
    );

    const result = runNlm(['notebook', 'list']);

    expect(result.status).toBe('auth_error');
    expect(result.error).toContain('Session expired');
    expect(result.action).toContain('nlm login');
  });

  it('classifies auth error keywords in stderr as auth_error', () => {
    const error = new Error('Command failed') as any;
    error.stderr = 'Error: not authenticated - please login';
    error.code = 1;
    mockExecFileSync.mockImplementation(() => { throw error; });

    const result = runNlm(['notebook', 'list']);

    expect(result.status).toBe('auth_error');
    expect(result.action).toContain('nlm login');
  });

  it('classifies not found keywords as not_found', () => {
    const error = new Error('Command failed') as any;
    error.stderr = 'Error: notebook not found';
    error.code = 1;
    mockExecFileSync.mockImplementation(() => { throw error; });

    const result = runNlm(['notebook', 'get', 'bad-id']);

    expect(result.status).toBe('not_found');
  });

  it('classifies rate limit keywords as rate_limit', () => {
    const error = new Error('Command failed') as any;
    error.stderr = 'Error: 429 too many requests';
    error.code = 1;
    mockExecFileSync.mockImplementation(() => { throw error; });

    const result = runNlm(['notebook', 'list']);

    expect(result.status).toBe('rate_limit');
    expect(result.action).toContain('rate limit');
  });

  it('returns timeout status when command is killed', () => {
    const error = new Error('Command timed out') as any;
    error.killed = true;
    mockExecFileSync.mockImplementation(() => { throw error; });

    const result = runNlm(['notebook', 'list'], 30000);

    expect(result.status).toBe('timeout');
    expect(result.error).toContain('timed out');
  });

  it('returns config_error status for ENOENT', () => {
    const error = new Error('spawn ENOENT') as any;
    error.code = 'ENOENT';
    mockExecFileSync.mockImplementation(() => { throw error; });

    const result = runNlm(['notebook', 'list']);

    expect(result.status).toBe('config_error');
    expect(result.error).toContain('NLM CLI not found');
    expect(result.action).toContain('uv tool install');
  });

  it('returns generic error for unclassified stderr', () => {
    const error = new Error('Command failed') as any;
    error.stderr = 'Something unexpected happened';
    error.code = 1;
    mockExecFileSync.mockImplementation(() => { throw error; });

    const result = runNlm(['notebook', 'list']);

    expect(result.status).toBe('error');
    expect(result.error).toContain('Something unexpected happened');
  });

  it('handles non-object errors gracefully', () => {
    mockExecFileSync.mockImplementation(() => { throw 'string error'; });

    const result = runNlm(['notebook', 'list']);

    expect(result.status).toBe('error');
    expect(result.error).toBe('string error');
  });
});
