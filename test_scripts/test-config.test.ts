import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getConfig, resetConfig } from '../notebooklm_agent/config.ts';

describe('config', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    resetConfig();
    // Clear all relevant env vars
    delete process.env.GOOGLE_GENAI_API_KEY;
    delete process.env.NLM_CLI_PATH;
    delete process.env.GEMINI_MODEL;
    delete process.env.NLM_DOWNLOAD_DIR;
    delete process.env.YOUTUBE_API_KEY;
  });

  afterEach(() => {
    resetConfig();
    // Restore original environment
    process.env = { ...ORIGINAL_ENV };
  });

  function setAllEnvVars() {
    process.env.GOOGLE_GENAI_API_KEY = 'test-api-key';
    process.env.NLM_CLI_PATH = '/usr/local/bin/nlm';
    process.env.GEMINI_MODEL = 'gemini-2.0-flash';
    process.env.NLM_DOWNLOAD_DIR = '/tmp/downloads';
    process.env.YOUTUBE_API_KEY = 'test-youtube-key';
  }

  it('throws Error when GOOGLE_GENAI_API_KEY is missing', () => {
    process.env.NLM_CLI_PATH = '/usr/local/bin/nlm';
    process.env.GEMINI_MODEL = 'gemini-2.0-flash';
    process.env.NLM_DOWNLOAD_DIR = '/tmp/downloads';

    expect(() => getConfig()).toThrow('GOOGLE_GENAI_API_KEY');
  });

  it('throws Error when NLM_CLI_PATH is missing', () => {
    process.env.GOOGLE_GENAI_API_KEY = 'test-api-key';
    process.env.GEMINI_MODEL = 'gemini-2.0-flash';
    process.env.NLM_DOWNLOAD_DIR = '/tmp/downloads';

    expect(() => getConfig()).toThrow('NLM_CLI_PATH');
  });

  it('throws Error when GEMINI_MODEL is missing', () => {
    process.env.GOOGLE_GENAI_API_KEY = 'test-api-key';
    process.env.NLM_CLI_PATH = '/usr/local/bin/nlm';
    process.env.NLM_DOWNLOAD_DIR = '/tmp/downloads';

    expect(() => getConfig()).toThrow('GEMINI_MODEL');
  });

  it('throws Error when NLM_DOWNLOAD_DIR is missing', () => {
    process.env.GOOGLE_GENAI_API_KEY = 'test-api-key';
    process.env.NLM_CLI_PATH = '/usr/local/bin/nlm';
    process.env.GEMINI_MODEL = 'gemini-2.0-flash';

    expect(() => getConfig()).toThrow('NLM_DOWNLOAD_DIR');
  });

  it('returns valid config when all vars are set', () => {
    setAllEnvVars();

    const config = getConfig();

    expect(config.googleGenaiApiKey).toBe('test-api-key');
    expect(config.nlmCliPath).toBe('/usr/local/bin/nlm');
    expect(config.geminiModel).toBe('gemini-2.0-flash');
    expect(config.nlmDownloadDir).toBe('/tmp/downloads');
    expect(config.youtubeApiKey).toBe('test-youtube-key');
  });

  it('returns a frozen (immutable) config object', () => {
    setAllEnvVars();

    const config = getConfig();

    expect(Object.isFrozen(config)).toBe(true);
    expect(() => {
      (config as any).googleGenaiApiKey = 'changed';
    }).toThrow();
  });

  it('returns the same singleton on subsequent calls', () => {
    setAllEnvVars();

    const config1 = getConfig();
    const config2 = getConfig();

    expect(config1).toBe(config2);
  });
});
