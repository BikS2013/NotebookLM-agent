/**
 * Safe JSON serialization and LLM request/response extractors for the proxy.
 *
 * Design:
 * - All exported functions accept `unknown` typed parameters to avoid coupling
 *   to ADK internal types.
 * - No function in this module ever throws. Every function wraps its body in
 *   try/catch and returns a safe fallback on failure.
 * - Handles ADK hazards: non-serializable BaseTool instances in toolsDict,
 *   abortSignal, httpOptions, liveConnectConfig fields, circular references,
 *   functions, BigInt values.
 */

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────

const DEFAULT_MAX_SIZE = 50 * 1024; // 50KB

/** Keys known to hold non-serializable objects in ADK request/config. */
const SKIP_KEYS = new Set(['abortSignal', 'httpOptions', 'liveConnectConfig']);

// ──────────────────────────────────────────────
// safeSerialize
// ──────────────────────────────────────────────

/**
 * Safely serialize any value to a JSON string.
 *
 * Handles:
 * - Circular references -> "[Circular]"
 * - Functions -> "[Function]"
 * - BigInt -> string representation
 * - Skips known non-serializable keys: abortSignal, httpOptions, liveConnectConfig
 * - Truncates output exceeding maxSize
 *
 * Never throws. Returns an error marker string on failure.
 *
 * @param obj - The value to serialize
 * @param maxSize - Maximum output size in bytes (default: 51200 = 50KB)
 * @returns JSON string or error marker
 */
export function safeSerialize(obj: unknown, maxSize: number = DEFAULT_MAX_SIZE): string {
  try {
    const seen = new WeakSet<object>();

    const json = JSON.stringify(obj, (key: string, value: unknown): unknown => {
      // Skip known non-serializable fields
      if (SKIP_KEYS.has(key)) return undefined;

      // Handle functions
      if (typeof value === 'function') return '[Function]';

      // Handle BigInt
      if (typeof value === 'bigint') return value.toString();

      // Handle circular references
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) return '[Circular]';
        seen.add(value);
      }

      return value;
    });

    // Truncation check
    if (json !== undefined && json.length > maxSize) {
      return json.slice(0, maxSize) + `\n[truncated at ${maxSize} bytes]`;
    }

    return json ?? 'undefined';
  } catch (err) {
    return `[serialization failed: ${err instanceof Error ? err.message : String(err)}]`;
  }
}

// ──────────────────────────────────────────────
// extractToolNames
// ──────────────────────────────────────────────

/**
 * Extract tool names from LlmRequest.toolsDict.
 * Returns Object.keys(toolsDict) or empty array if input is falsy.
 */
export function extractToolNames(
  toolsDict: Record<string, unknown> | undefined | null,
): string[] {
  try {
    if (!toolsDict || typeof toolsDict !== 'object') return [];
    return Object.keys(toolsDict);
  } catch {
    return [];
  }
}

// ──────────────────────────────────────────────
// flattenSystemInstruction
// ──────────────────────────────────────────────

/**
 * Flatten a ContentUnion (string | Content | Part[]) to a plain text string.
 * Returns "" for undefined/null.
 *
 * Handles:
 * - string -> returned as-is
 * - Content object (has `parts` array) -> concatenates text from all parts
 * - Part[] (array of objects with `text`) -> concatenates text from all text-typed parts
 * - unknown -> String(instruction) as fallback
 */
export function flattenSystemInstruction(instruction: unknown): string {
  try {
    if (instruction === undefined || instruction === null) return '';

    // string -> return as-is
    if (typeof instruction === 'string') return instruction;

    // Content object: has a `parts` array
    if (
      typeof instruction === 'object' &&
      'parts' in instruction &&
      Array.isArray((instruction as Record<string, unknown>).parts)
    ) {
      const parts = (instruction as Record<string, unknown>).parts as unknown[];
      return extractTextFromParts(parts);
    }

    // Part[] (direct array of parts)
    if (Array.isArray(instruction)) {
      return extractTextFromParts(instruction);
    }

    // Fallback: coerce to string
    return String(instruction);
  } catch {
    return '';
  }
}

/**
 * Extract and concatenate text from an array of Part-like objects.
 * Each part is expected to optionally have a `text` string field.
 */
function extractTextFromParts(parts: unknown[]): string {
  const texts: string[] = [];
  for (const part of parts) {
    if (typeof part === 'object' && part !== null && 'text' in part) {
      const text = (part as Record<string, unknown>).text;
      if (typeof text === 'string') {
        texts.push(text);
      }
    }
  }
  return texts.join('');
}

// ──────────────────────────────────────────────
// serializeLlmRequest
// ──────────────────────────────────────────────

/**
 * Extract and serialize relevant fields from an LlmRequest object.
 *
 * @param request - The raw LlmRequest from beforeModelCallback
 * @param isFirstRoundTrip - If true, include full tool declarations; else names only
 * @returns A plain object safe for JSON.stringify / LogEntry payload
 */
export function serializeLlmRequest(
  request: unknown,
  isFirstRoundTrip: boolean,
): Record<string, unknown> {
  try {
    if (!request || typeof request !== 'object') {
      return { error: 'request is not an object' };
    }

    const req = request as Record<string, unknown>;
    const result: Record<string, unknown> = {};

    // model
    if (typeof req.model === 'string') {
      result.model = req.model;
    }

    // contents
    const contents = req.contents;
    if (Array.isArray(contents)) {
      result.contentsCount = contents.length;
      result.contents = safeParse(safeSerialize(contents));
    } else {
      result.contentsCount = 0;
    }

    // config (systemInstruction, tools, generationConfig)
    const config = req.config;
    if (config && typeof config === 'object') {
      const cfg = config as Record<string, unknown>;

      // systemInstruction
      if (cfg.systemInstruction !== undefined) {
        result.systemInstruction = safeParse(safeSerialize(cfg.systemInstruction));
        result.systemInstructionText = flattenSystemInstruction(cfg.systemInstruction);
      }

      // toolDeclarations (full schemas only on first round trip)
      if (isFirstRoundTrip && cfg.tools !== undefined) {
        result.toolDeclarations = safeParse(safeSerialize(cfg.tools));
      }

      // generationConfig: remaining config fields minus tools, systemInstruction, and skip keys
      const generationConfig: Record<string, unknown> = {};
      const excludeKeys = new Set([
        'tools',
        'systemInstruction',
        'abortSignal',
        'httpOptions',
        'liveConnectConfig',
      ]);
      for (const [key, value] of Object.entries(cfg)) {
        if (!excludeKeys.has(key)) {
          generationConfig[key] = safeParse(safeSerialize(value));
        }
      }
      if (Object.keys(generationConfig).length > 0) {
        result.generationConfig = generationConfig;
      }
    }

    // toolNames (always extracted from toolsDict)
    result.toolNames = extractToolNames(
      req.toolsDict as Record<string, unknown> | undefined | null,
    );

    return result;
  } catch (err) {
    return {
      error: `serializeLlmRequest failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ──────────────────────────────────────────────
// serializeLlmResponse
// ──────────────────────────────────────────────

/**
 * Extract and serialize relevant fields from an LlmResponse object.
 *
 * Extracts: content, usageMetadata, finishReason, errorCode, errorMessage,
 *           partial, turnComplete.
 *
 * @param response - The raw LlmResponse from afterModelCallback
 * @returns A plain object safe for JSON.stringify / LogEntry payload
 */
export function serializeLlmResponse(
  response: unknown,
): Record<string, unknown> {
  try {
    if (!response || typeof response !== 'object') {
      return { error: 'response is not an object' };
    }

    const resp = response as Record<string, unknown>;
    const result: Record<string, unknown> = {};

    // content
    if (resp.content !== undefined) {
      result.content = safeParse(safeSerialize(resp.content));
    }

    // usageMetadata
    if (resp.usageMetadata !== undefined && typeof resp.usageMetadata === 'object') {
      const usage = resp.usageMetadata as Record<string, unknown>;
      result.usageMetadata = {
        promptTokenCount: typeof usage.promptTokenCount === 'number' ? usage.promptTokenCount : undefined,
        candidatesTokenCount: typeof usage.candidatesTokenCount === 'number' ? usage.candidatesTokenCount : undefined,
        totalTokenCount: typeof usage.totalTokenCount === 'number' ? usage.totalTokenCount : undefined,
      };
    }

    // finishReason
    if (resp.finishReason !== undefined) {
      result.finishReason = String(resp.finishReason);
    }

    // errorCode
    if (resp.errorCode !== undefined) {
      result.errorCode = String(resp.errorCode);
    }

    // errorMessage
    if (resp.errorMessage !== undefined) {
      result.errorMessage = String(resp.errorMessage);
    }

    // partial (streaming flag)
    if (resp.partial !== undefined) {
      result.partial = Boolean(resp.partial);
    }

    // turnComplete (streaming flag)
    if (resp.turnComplete !== undefined) {
      result.turnComplete = Boolean(resp.turnComplete);
    }

    return result;
  } catch (err) {
    return {
      error: `serializeLlmResponse failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ──────────────────────────────────────────────
// Internal helpers
// ──────────────────────────────────────────────

/**
 * Parse a JSON string back to a value, returning the original string
 * as a fallback if parsing fails. Used to convert safeSerialize output
 * back to a plain object for embedding in LogEntry payloads.
 */
function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return json;
  }
}
