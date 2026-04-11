/**
 * Conditional proxy plugin creation.
 *
 * This is the single entry point for both TUI and CLI to optionally
 * create the LLM proxy plugin based on environment configuration.
 */
import { getProxyConfig } from './proxy-config.ts';
import { LlmProxyPlugin } from './llm-proxy-plugin.ts';

/**
 * Create an LlmProxyPlugin if the proxy is enabled via environment variables.
 *
 * Returns undefined if LLM_PROXY_ENABLED is not 'true'.
 * Throws if proxy is enabled but configuration is invalid (startup error).
 *
 * This is the ONLY function that TUI and CLI need to import for proxy setup.
 */
export function createProxyPlugin(): LlmProxyPlugin | undefined {
  try {
    const config = getProxyConfig();
    if (config === undefined) return undefined;
    return new LlmProxyPlugin(config);
  } catch (err) {
    // Re-throw config errors -- these are startup errors, not runtime errors.
    // The caller (TUI/CLI) should handle them like any other config failure.
    throw err;
  }
}
