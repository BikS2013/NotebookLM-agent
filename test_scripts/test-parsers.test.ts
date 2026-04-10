import { describe, it, expect } from 'vitest';
import {
  truncateList,
  truncateText,
  normalizeNotebook,
  normalizeSource,
  normalizeArtifact,
  extractArray,
} from '../notebooklm_agent/tools/parsers.ts';

describe('truncateList', () => {
  it('returns the full list when under max', () => {
    const items = [1, 2, 3];
    const [result, truncated] = truncateList(items, 5);
    expect(result).toEqual([1, 2, 3]);
    expect(truncated).toBe(false);
  });

  it('returns the full list when exactly at max', () => {
    const items = [1, 2, 3];
    const [result, truncated] = truncateList(items, 3);
    expect(result).toEqual([1, 2, 3]);
    expect(truncated).toBe(false);
  });

  it('truncates when over max', () => {
    const items = [1, 2, 3, 4, 5];
    const [result, truncated] = truncateList(items, 3);
    expect(result).toEqual([1, 2, 3]);
    expect(truncated).toBe(true);
  });
});

describe('truncateText', () => {
  it('returns the full text when under max', () => {
    const [result, truncated] = truncateText('hello', 10);
    expect(result).toBe('hello');
    expect(truncated).toBe(false);
  });

  it('returns the full text when exactly at max', () => {
    const [result, truncated] = truncateText('hello', 5);
    expect(result).toBe('hello');
    expect(truncated).toBe(false);
  });

  it('truncates with ellipsis when over max', () => {
    const [result, truncated] = truncateText('hello world', 5);
    expect(result).toBe('hello...');
    expect(truncated).toBe(true);
  });
});

describe('normalizeNotebook', () => {
  it('extracts fields from a standard notebook object', () => {
    const raw = {
      id: 'nb-123',
      title: 'My Notebook',
      source_count: 5,
      updated_at: '2025-01-01T00:00:00Z',
    };
    const result = normalizeNotebook(raw);
    expect(result).toEqual({
      id: 'nb-123',
      title: 'My Notebook',
      source_count: 5,
      updated_at: '2025-01-01T00:00:00Z',
    });
  });

  it('falls back to notebook_id when id is missing', () => {
    const raw = { notebook_id: 'nb-456', title: 'Test' };
    const result = normalizeNotebook(raw);
    expect(result.id).toBe('nb-456');
  });

  it('counts sources array when source_count is missing', () => {
    const raw = { id: 'nb-789', title: 'Test', sources: ['a', 'b', 'c'] };
    const result = normalizeNotebook(raw);
    expect(result.source_count).toBe(3);
  });

  it('handles missing fields gracefully', () => {
    const result = normalizeNotebook({});
    expect(result.id).toBe('');
    expect(result.title).toBe('');
    expect(result.source_count).toBe(0);
    expect(result.updated_at).toBeUndefined();
  });
});

describe('normalizeSource', () => {
  it('extracts fields from a standard source object', () => {
    const raw = {
      id: 'src-123',
      title: 'My Source',
      type: 'pdf',
      status: 'ready',
    };
    const result = normalizeSource(raw);
    expect(result).toEqual({
      id: 'src-123',
      title: 'My Source',
      type: 'pdf',
      status: 'ready',
    });
  });

  it('falls back to source_id and name and source_type', () => {
    const raw = { source_id: 'src-456', name: 'Alt Name', source_type: 'url' };
    const result = normalizeSource(raw);
    expect(result.id).toBe('src-456');
    expect(result.title).toBe('Alt Name');
    expect(result.type).toBe('url');
  });

  it('handles missing fields gracefully', () => {
    const result = normalizeSource({});
    expect(result.id).toBe('');
    expect(result.title).toBe('');
    expect(result.type).toBe('unknown');
    expect(result.status).toBeUndefined();
  });
});

describe('normalizeArtifact', () => {
  it('extracts fields from a standard artifact object', () => {
    const raw = {
      id: 'art-123',
      type: 'podcast',
      status: 'generated',
      title: 'My Podcast',
      url: 'https://example.com/podcast',
    };
    const result = normalizeArtifact(raw);
    expect(result).toEqual({
      id: 'art-123',
      type: 'podcast',
      status: 'generated',
      title: 'My Podcast',
      url: 'https://example.com/podcast',
    });
  });

  it('falls back to artifact_id and artifact_type', () => {
    const raw = { artifact_id: 'art-456', artifact_type: 'summary', status: 'pending' };
    const result = normalizeArtifact(raw);
    expect(result.id).toBe('art-456');
    expect(result.type).toBe('summary');
  });

  it('handles missing fields gracefully', () => {
    const result = normalizeArtifact({});
    expect(result.id).toBe('');
    expect(result.type).toBe('unknown');
    expect(result.status).toBe('unknown');
    expect(result.title).toBeUndefined();
    expect(result.url).toBeUndefined();
  });
});

describe('extractArray', () => {
  it('returns data directly when it is an array', () => {
    const data = [{ id: 1 }, { id: 2 }];
    const result = extractArray(data, 'items');
    expect(result).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('extracts array from object using matching key', () => {
    const data = { notebooks: [{ id: 'nb-1' }], total: 1 };
    const result = extractArray(data, 'notebooks', 'items');
    expect(result).toEqual([{ id: 'nb-1' }]);
  });

  it('tries keys in order and returns first matching array', () => {
    const data = { items: [{ id: 'a' }], results: [{ id: 'b' }] };
    const result = extractArray(data, 'items', 'results');
    expect(result).toEqual([{ id: 'a' }]);
  });

  it('returns empty array when no keys match', () => {
    const data = { count: 5 };
    const result = extractArray(data, 'notebooks', 'items');
    expect(result).toEqual([]);
  });

  it('returns empty array for null/undefined input', () => {
    expect(extractArray(null, 'items')).toEqual([]);
    expect(extractArray(undefined, 'items')).toEqual([]);
  });
});
