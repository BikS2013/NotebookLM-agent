/**
 * Barrel export for the LLM Proxy Plugin subsystem.
 *
 * External consumers should import from this module only.
 */

// Factory -- the primary entry point for TUI and CLI
export { createProxyPlugin } from './proxy-factory.ts';

// Plugin class -- needed for type annotations and /inspect access
export { LlmProxyPlugin } from './llm-proxy-plugin.ts';

// Types -- needed by consumers that inspect InteractionRecord, etc.
export type {
  ProxyConfig,
  ProxyEventType,
  InteractionRecord,
  RoundTripRecord,
  ToolCallRecord,
  LogEntry,
} from './proxy-types.ts';

// Formatters -- used by /inspect command in TUI and CLI
export {
  formatInspect,
  formatInspectDisabled,
  formatInspectEmpty,
} from './format-inspect.ts';

// Buffer -- exposed for direct /inspect access if needed
export { ProxyBuffer } from './proxy-buffer.ts';
