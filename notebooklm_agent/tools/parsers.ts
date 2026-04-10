/**
 * Parsing utilities for NLM CLI JSON output.
 * All parsers use defensive .get() style access (optional chaining).
 */

export interface NormalizedNotebook {
  id: string;
  title: string;
  source_count: number;
  updated_at?: string;
}

export interface NormalizedSource {
  id: string;
  title: string;
  type: string;
  status?: string;
}

export interface NormalizedArtifact {
  id: string;
  type: string;
  status: string;
  title?: string;
  url?: string;
}

/**
 * Truncate a list to max items, returning [items, wasTruncated].
 */
export function truncateList<T>(items: T[], maxItems: number = 50): [T[], boolean] {
  if (items.length <= maxItems) return [items, false];
  return [items.slice(0, maxItems), true];
}

/**
 * Truncate text to max characters, returning [text, wasTruncated].
 */
export function truncateText(text: string, maxChars: number = 2000): [string, boolean] {
  if (text.length <= maxChars) return [text, false];
  return [text.slice(0, maxChars) + '...', true];
}

/**
 * Normalize a raw notebook object from nlm JSON output.
 */
export function normalizeNotebook(raw: Record<string, unknown>): NormalizedNotebook {
  return {
    id: String(raw?.id ?? raw?.notebook_id ?? ''),
    title: String(raw?.title ?? ''),
    source_count: Number(raw?.source_count ?? (Array.isArray(raw?.sources) ? (raw.sources as unknown[]).length : 0)),
    updated_at: raw?.updated_at ? String(raw.updated_at) : undefined,
  };
}

/**
 * Normalize a raw source object from nlm JSON output.
 */
export function normalizeSource(raw: Record<string, unknown>): NormalizedSource {
  return {
    id: String(raw?.id ?? raw?.source_id ?? ''),
    title: String(raw?.title ?? raw?.name ?? ''),
    type: String(raw?.type ?? raw?.source_type ?? 'unknown'),
    status: raw?.status ? String(raw.status) : undefined,
  };
}

/**
 * Normalize a raw artifact object from nlm JSON output.
 */
export function normalizeArtifact(raw: Record<string, unknown>): NormalizedArtifact {
  return {
    id: String(raw?.id ?? raw?.artifact_id ?? ''),
    type: String(raw?.type ?? raw?.artifact_type ?? 'unknown'),
    status: String(raw?.status ?? 'unknown'),
    title: raw?.title ? String(raw.title) : undefined,
    url: raw?.url ? String(raw.url) : undefined,
  };
}

/**
 * Safely extract an array from nlm JSON output.
 */
export function extractArray(data: unknown, ...keys: string[]): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    for (const key of keys) {
      if (Array.isArray(obj[key])) return obj[key] as Record<string, unknown>[];
    }
  }
  return [];
}
