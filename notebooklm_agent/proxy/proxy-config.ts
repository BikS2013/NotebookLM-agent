/**
 * Proxy configuration loading and validation.
 *
 * Reads proxy-specific environment variables and returns a validated
 * ProxyConfig object. This module is intentionally separate from the
 * core config.ts to avoid startup failures when proxy vars are absent.
 *
 * Documented default-value exceptions (recorded in Issues - Pending Items.md):
 * - LLM_PROXY_VERBOSE defaults to false
 * - LLM_PROXY_BUFFER_SIZE defaults to 10
 * - LLM_PROXY_MAX_FILE_SIZE defaults to 52428800 (50MB)
 */

import type { ProxyConfig } from './proxy-types.ts';

// Default values (documented exceptions to the no-fallback rule)
const DEFAULT_BUFFER_SIZE = 10;
const DEFAULT_MAX_FILE_SIZE = 52428800; // 50MB

let _config: ProxyConfig | undefined | null = null;

/**
 * Read proxy configuration from environment variables.
 *
 * Returns undefined if the proxy is disabled (LLM_PROXY_ENABLED is not
 * "true"). Throws if proxy is enabled but required variables are missing
 * or numeric values are invalid.
 */
export function getProxyConfig(): ProxyConfig | undefined {
  if (_config !== null) return _config ?? undefined;

  const enabled = process.env.LLM_PROXY_ENABLED;
  if (enabled !== 'true') {
    _config = undefined;
    return undefined;
  }

  // LLM_PROXY_LOG_DIR is required when enabled
  const logDir = process.env.LLM_PROXY_LOG_DIR;
  if (!logDir) {
    throw new Error(
      'LLM_PROXY_LOG_DIR environment variable is required when LLM_PROXY_ENABLED is set. ' +
      'Set it in .env or export it in your shell.'
    );
  }

  // LLM_PROXY_VERBOSE: optional boolean, default false
  const verbose = process.env.LLM_PROXY_VERBOSE === 'true';

  // LLM_PROXY_BUFFER_SIZE: optional positive integer, default 10
  let bufferSize = DEFAULT_BUFFER_SIZE;
  const bufferSizeRaw = process.env.LLM_PROXY_BUFFER_SIZE;
  if (bufferSizeRaw !== undefined && bufferSizeRaw !== '') {
    bufferSize = parseInt(bufferSizeRaw, 10);
    if (isNaN(bufferSize) || bufferSize <= 0) {
      throw new Error(
        `LLM_PROXY_BUFFER_SIZE must be a positive integer, got: ${bufferSizeRaw}`
      );
    }
  }

  // LLM_PROXY_MAX_FILE_SIZE: optional positive integer (bytes), default 50MB
  let maxFileSize = DEFAULT_MAX_FILE_SIZE;
  const maxFileSizeRaw = process.env.LLM_PROXY_MAX_FILE_SIZE;
  if (maxFileSizeRaw !== undefined && maxFileSizeRaw !== '') {
    maxFileSize = parseInt(maxFileSizeRaw, 10);
    if (isNaN(maxFileSize) || maxFileSize <= 0) {
      throw new Error(
        `LLM_PROXY_MAX_FILE_SIZE must be a positive integer, got: ${maxFileSizeRaw}`
      );
    }
  }

  _config = Object.freeze({
    enabled: true as const,
    logDir,
    verbose,
    bufferSize,
    maxFileSize,
  });

  return _config;
}

/** Reset cached config (for testing only). */
export function resetProxyConfig(): void {
  _config = null;
}
