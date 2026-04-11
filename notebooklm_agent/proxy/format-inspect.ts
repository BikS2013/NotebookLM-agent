/**
 * /inspect output formatter for the LLM Proxy Plugin.
 *
 * Pure functions that format InteractionRecord data for human-readable display.
 * No side effects, no React dependency — suitable for both TUI and CLI.
 */

import type { LlmProxyPlugin } from './llm-proxy-plugin.ts';
import type { InteractionRecord, RoundTripRecord, ToolCallRecord } from './proxy-types.ts';

// ---------------------------------------------------------------------------
// ANSI helpers (matching cli.ts conventions — raw escape codes, no chalk)
// ---------------------------------------------------------------------------

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';

// ---------------------------------------------------------------------------
// Duration formatting
// ---------------------------------------------------------------------------

function formatDuration(ms: number | undefined): string {
  if (ms === undefined || ms === null) return '?';
  if (ms < 1) return '<1ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 10000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 1000)}s`;
}

// ---------------------------------------------------------------------------
// Text truncation
// ---------------------------------------------------------------------------

function truncate(text: string | undefined, maxLen: number): string {
  if (!text) return '';
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '...';
}

// ---------------------------------------------------------------------------
// Tool call formatting
// ---------------------------------------------------------------------------

function formatToolCall(tc: ToolCallRecord): string {
  const duration = formatDuration(tc.durationMs);
  const status = tc.error
    ? `${RED}✗ ${tc.error}${RESET}`
    : `${GREEN}✓${RESET}`;
  const argKeys = Object.keys(tc.args);
  const argsSummary = argKeys.length > 0
    ? `(${argKeys.join(', ')})`
    : '()';
  return `      ${DIM}→${RESET} ${tc.toolName}${DIM}${argsSummary}${RESET} ${DIM}(${duration})${RESET} ${status}`;
}

// ---------------------------------------------------------------------------
// Round trip formatting
// ---------------------------------------------------------------------------

function formatRoundTrip(rt: RoundTripRecord): string {
  const lines: string[] = [];

  const model = rt.model ?? 'unknown';
  const duration = formatDuration(rt.durationMs);
  const streamed = rt.streamed ? ` ${DIM}streamed:${rt.chunkCount} chunks${RESET}` : '';

  lines.push(`  ${BOLD}Round Trip ${rt.roundTripNumber}${RESET} ${DIM}[${model}]${RESET} ${DIM}(${duration})${RESET}${streamed}`);

  // Token usage
  const prompt = rt.usageMetadata?.promptTokenCount;
  const completion = rt.usageMetadata?.candidatesTokenCount;
  if (prompt !== undefined || completion !== undefined) {
    const p = prompt ?? 0;
    const c = completion ?? 0;
    lines.push(`    ${DIM}Tokens: ${p} prompt + ${c} completion${RESET}`);
  }

  // System instruction (first round trip only, truncated)
  if (rt.systemInstructionText) {
    const preview = truncate(rt.systemInstructionText, 120);
    lines.push(`    ${DIM}System: "${preview}"${RESET}`);
  }

  // Contents count and tool names
  if (rt.contentsCount > 0) {
    lines.push(`    ${DIM}Contents: ${rt.contentsCount} message(s)${RESET}`);
  }
  if (rt.toolNames.length > 0) {
    lines.push(`    ${DIM}Tools available: ${rt.toolNames.join(', ')}${RESET}`);
  }

  // Tool calls
  if (rt.toolCalls.length > 0) {
    lines.push(`    Tool Calls:`);
    for (const tc of rt.toolCalls) {
      lines.push(formatToolCall(tc));
    }
  } else {
    lines.push(`    ${DIM}No tool calls${RESET}`);
  }

  // Error
  if (rt.errorCode || rt.errorMessage) {
    lines.push(`    ${RED}Error: ${rt.errorCode ?? ''} ${rt.errorMessage ?? ''}${RESET}`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Interaction formatting
// ---------------------------------------------------------------------------

function formatInteraction(interaction: InteractionRecord): string {
  const lines: string[] = [];

  const idShort = interaction.interactionId.slice(0, 8);
  const duration = formatDuration(interaction.durationMs);
  const timestamp = new Date(interaction.startedAt).toISOString();

  lines.push(`${BOLD}${CYAN}=== LLM Proxy: Interaction ===${RESET}`);
  lines.push(`${DIM}ID:${RESET} ${idShort}  ${DIM}Time:${RESET} ${timestamp}  ${DIM}Duration:${RESET} ${duration}`);
  lines.push(`${DIM}Round Trips:${RESET} ${interaction.roundTrips.length}`);

  // Total tokens
  const totalPrompt = interaction.totalPromptTokens;
  const totalCompletion = interaction.totalCompletionTokens;
  if (totalPrompt > 0 || totalCompletion > 0) {
    const total = totalPrompt + totalCompletion;
    lines.push(`${DIM}Total Tokens:${RESET} ${totalPrompt} prompt + ${totalCompletion} completion = ${total}`);
  }

  // User message preview
  if (interaction.userMessage) {
    const preview = truncate(interaction.userMessage, 200);
    lines.push(`${DIM}User Message:${RESET} "${preview}"`);
  }

  lines.push('');

  // Round trips
  for (const rt of interaction.roundTrips) {
    lines.push(formatRoundTrip(rt));
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Format the last N interactions from the proxy buffer as a readable summary.
 *
 * @param plugin - The LlmProxyPlugin instance
 * @param n - Number of recent interactions to show (default: 1)
 * @returns Formatted string ready for display
 */
export function formatInspect(plugin: LlmProxyPlugin, n?: number): string {
  const count = n ?? 1;
  const all = plugin.getAllInteractions();

  if (all.length === 0) {
    return formatInspectEmpty();
  }

  // Get last N interactions
  const interactions = all.slice(-count);

  if (interactions.length === 1) {
    return formatInteraction(interactions[0]);
  }

  // Multiple interactions
  const sections: string[] = [];
  sections.push(`${BOLD}${CYAN}=== LLM Proxy: Last ${interactions.length} Interactions ===${RESET}\n`);

  for (let i = 0; i < interactions.length; i++) {
    sections.push(formatInteraction(interactions[i]));
    if (i < interactions.length - 1) {
      sections.push(`${DIM}${'─'.repeat(60)}${RESET}\n`);
    }
  }

  return sections.join('\n');
}

/**
 * Returns a message indicating the proxy is disabled and how to enable it.
 */
export function formatInspectDisabled(): string {
  return [
    `${YELLOW}LLM Proxy is not active.${RESET}`,
    '',
    `To enable, set these environment variables:`,
    `  ${BOLD}LLM_PROXY_ENABLED${RESET}=true`,
    `  ${BOLD}LLM_PROXY_LOG_DIR${RESET}=<path>  ${DIM}(e.g., ./logs/proxy)${RESET}`,
    '',
    `Optional:`,
    `  ${DIM}LLM_PROXY_VERBOSE=true${RESET}       ${DIM}Print summaries to stderr${RESET}`,
    `  ${DIM}LLM_PROXY_BUFFER_SIZE=10${RESET}        ${DIM}In-memory buffer capacity${RESET}`,
    `  ${DIM}LLM_PROXY_MAX_FILE_SIZE=52428800${RESET}  ${DIM}Log file rotation size (50MB)${RESET}`,
  ].join('\n');
}

/**
 * Returns a message indicating no interactions have been captured yet.
 */
export function formatInspectEmpty(): string {
  return `${DIM}No interactions captured yet. Send a message to the agent first.${RESET}`;
}
