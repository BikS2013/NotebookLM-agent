/**
 * Core NLM CLI runner. Executes nlm commands via child_process and
 * classifies results into structured response objects.
 */

import { execFileSync } from 'node:child_process';
import { getConfig } from '../config.ts';

// Timeout constants (milliseconds)
export const TIMEOUT_FAST = 30_000;
export const TIMEOUT_MEDIUM = 60_000;
export const TIMEOUT_LONG = 120_000;
export const TIMEOUT_EXTRA_LONG = 360_000;

export type NlmStatus =
  | 'success'
  | 'auth_error'
  | 'not_found'
  | 'rate_limit'
  | 'timeout'
  | 'config_error'
  | 'error';

export interface NlmResult {
  status: NlmStatus;
  data?: Record<string, unknown>;
  output?: string;
  error?: string;
  error_type?: string;
  action?: string;
  hint?: string;
}

const AUTH_KEYWORDS = ['expired', 'authentication', 'login', 'unauthorized', 'not authenticated', 'session'];
const NOT_FOUND_KEYWORDS = ['not found', 'no notebook', 'no source', 'does not exist', 'invalid id'];
const RATE_LIMIT_KEYWORDS = ['429', 'rate limit', 'quota', 'too many requests'];

function classifyError(text: string): NlmStatus {
  const lower = text.toLowerCase();
  if (AUTH_KEYWORDS.some(kw => lower.includes(kw))) return 'auth_error';
  if (NOT_FOUND_KEYWORDS.some(kw => lower.includes(kw))) return 'not_found';
  if (RATE_LIMIT_KEYWORDS.some(kw => lower.includes(kw))) return 'rate_limit';
  return 'error';
}

/**
 * Execute an nlm CLI command and return a classified result.
 */
export function runNlm(args: string[], timeout: number = TIMEOUT_MEDIUM): NlmResult {
  const config = getConfig();
  const nlmPath = config.nlmCliPath;

  try {
    const stdout = execFileSync(nlmPath, args, {
      timeout,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024, // 10MB
      env: { ...process.env },
    });

    // Try to parse as JSON
    const trimmed = stdout.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);

        // Check for nlm's own error format
        if (parsed && typeof parsed === 'object' && parsed.status === 'error') {
          const errorStatus = classifyError(parsed.error || '');
          return {
            status: errorStatus,
            error: parsed.error,
            error_type: errorStatus,
            hint: parsed.hint,
            action: errorStatus === 'auth_error'
              ? 'Run "nlm login" to re-authenticate.'
              : undefined,
          };
        }

        return { status: 'success', data: parsed };
      } catch {
        // JSON parse failed, treat as text
      }
    }

    return { status: 'success', output: trimmed };

  } catch (err: unknown) {
    if (err && typeof err === 'object') {
      const e = err as { code?: string; killed?: boolean; stderr?: string; stdout?: string; message?: string };

      // Timeout
      if (e.killed || (e.code === 'ETIMEDOUT')) {
        return {
          status: 'timeout',
          error: `Command timed out after ${timeout / 1000}s`,
          error_type: 'timeout',
          action: 'The operation is taking longer than expected. Try again or check nlm status.',
        };
      }

      // File not found (nlm not installed)
      if (e.code === 'ENOENT') {
        return {
          status: 'config_error',
          error: `NLM CLI not found at: ${nlmPath}`,
          error_type: 'config_error',
          action: 'Install nlm with: uv tool install notebooklm-mcp-cli',
        };
      }

      // Non-zero exit code
      const stderr = (e.stderr || e.stdout || e.message || '').toString();
      const errorStatus = classifyError(stderr);
      return {
        status: errorStatus,
        error: stderr.trim() || 'Command failed with non-zero exit code',
        error_type: errorStatus,
        action: errorStatus === 'auth_error'
          ? 'Run "nlm login" to re-authenticate.'
          : errorStatus === 'rate_limit'
            ? 'You have hit the rate limit (~50 queries/day). Wait and try again later.'
            : undefined,
      };
    }

    return {
      status: 'error',
      error: String(err),
      error_type: 'error',
    };
  }
}

/**
 * Check the installed nlm version.
 */
export function checkNlmVersion(): string {
  const result = runNlm(['--version'], TIMEOUT_FAST);
  if (result.status === 'success') {
    return result.output || result.data?.toString() || 'unknown';
  }
  return `nlm version check failed: ${result.error}`;
}
