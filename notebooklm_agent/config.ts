/**
 * Configuration module for the NotebookLM ADK agent.
 * All environment variables are required — no fallback defaults.
 */

export interface AgentConfig {
  readonly googleGenaiApiKey: string;
  readonly nlmCliPath: string;
  readonly geminiModel: string;
  readonly nlmDownloadDir: string;
  readonly youtubeApiKey: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} environment variable is required. ` +
      `Set it in .env or export it in your shell.`
    );
  }
  return value;
}

let _config: AgentConfig | null = null;

export function getConfig(): AgentConfig {
  if (_config) return _config;

  _config = Object.freeze({
    googleGenaiApiKey: requireEnv('GOOGLE_GENAI_API_KEY'),
    nlmCliPath: requireEnv('NLM_CLI_PATH'),
    geminiModel: requireEnv('GEMINI_MODEL'),
    nlmDownloadDir: requireEnv('NLM_DOWNLOAD_DIR'),
    youtubeApiKey: requireEnv('YOUTUBE_API_KEY'),
  });

  return _config;
}

/** Reset config singleton (for testing only). */
export function resetConfig(): void {
  _config = null;
}
