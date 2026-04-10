/**
 * Source management tools for the NotebookLM ADK agent.
 */

import { FunctionTool } from '@google/adk';
import { z } from 'zod';
import { runNlm, TIMEOUT_FAST, TIMEOUT_MEDIUM, TIMEOUT_LONG } from './nlm-runner.ts';
import { truncateList, truncateText, extractArray, normalizeSource } from './parsers.ts';

// ---------- add_source ----------

const SOURCE_TYPES = ['url', 'text', 'file', 'drive'] as const;

const SOURCE_TYPE_FLAGS: Record<typeof SOURCE_TYPES[number], string> = {
  url: '--url',
  text: '--text',
  file: '--file',
  drive: '--drive',
};

const addSourceSchema = z.object({
  notebook_id: z.string().describe('The notebook ID to add the source to.'),
  source_type: z.enum(SOURCE_TYPES).describe(
    'The type of source to add: "url" for a web URL, "text" for inline text, ' +
    '"file" for a local file path, "drive" for a Google Drive link.',
  ),
  source_value: z.string().describe(
    'The source content or reference: a URL, inline text, local file path, or Google Drive link — depending on source_type.',
  ),
});

export const addSourceTool = new FunctionTool({
  name: 'add_source',
  description:
    'Adds a new source to a notebook. Supported source types: url, text, file, drive. ' +
    'Adding a source may take a moment as NotebookLM processes and indexes the content.',
  parameters: addSourceSchema,
  execute: async ({ notebook_id, source_type, source_value }: z.infer<typeof addSourceSchema>) => {
    const flag = SOURCE_TYPE_FLAGS[source_type];
    const result = runNlm(
      ['source', 'add', notebook_id, flag, source_value],
      TIMEOUT_LONG,
    );
    if (result.status !== 'success') return result;

    return {
      status: 'success',
      message: result.output ?? 'Source added.',
      data: result.data,
    };
  },
});

// ---------- list_sources ----------

const listSourcesSchema = z.object({
  notebook_id: z.string().describe('The notebook ID whose sources to list.'),
});

export const listSourcesTool = new FunctionTool({
  name: 'list_sources',
  description:
    'Lists all sources in a notebook. Returns an array of sources with id, title, type, and status. ' +
    'Results are capped at 30 sources.',
  parameters: listSourcesSchema,
  execute: async ({ notebook_id }: z.infer<typeof listSourcesSchema>) => {
    const result = runNlm(['source', 'list', notebook_id, '--json'], TIMEOUT_MEDIUM);
    if (result.status !== 'success') return result;

    const rawItems = extractArray(result.data, 'sources', 'items', 'results');
    const normalized = rawItems.map(normalizeSource);
    const [items, truncated] = truncateList(normalized, 30);

    return {
      status: 'success',
      sources: items,
      total: rawItems.length,
      truncated,
    };
  },
});

// ---------- describe_source ----------

const describeSourceSchema = z.object({
  source_id: z.string().describe('The unique identifier of the source to describe.'),
});

export const describeSourceTool = new FunctionTool({
  name: 'describe_source',
  description:
    'Returns detailed metadata about a specific source, including its type, status, and indexing information.',
  parameters: describeSourceSchema,
  execute: async ({ source_id }: z.infer<typeof describeSourceSchema>) => {
    const result = runNlm(['source', 'describe', source_id, '--json'], TIMEOUT_FAST);
    if (result.status !== 'success') return result;

    return {
      status: 'success',
      data: result.data,
    };
  },
});

// ---------- get_source_content ----------

const getSourceContentSchema = z.object({
  source_id: z.string().describe('The unique identifier of the source whose content to retrieve.'),
});

export const getSourceContentTool = new FunctionTool({
  name: 'get_source_content',
  description:
    'Retrieves the text content of a source. The content is truncated to 2000 characters to stay within context limits. ' +
    'Use this to inspect what a source contains.',
  parameters: getSourceContentSchema,
  execute: async ({ source_id }: z.infer<typeof getSourceContentSchema>) => {
    const result = runNlm(['source', 'content', source_id, '--json'], TIMEOUT_MEDIUM);
    if (result.status !== 'success') return result;

    // Extract text content from the result
    const rawContent = (result.data as Record<string, unknown>)?.content
      ?? (result.data as Record<string, unknown>)?.text
      ?? result.output
      ?? '';
    const contentStr = String(rawContent);
    const [content, truncated] = truncateText(contentStr, 2000);

    return {
      status: 'success',
      content,
      truncated,
      original_length: contentStr.length,
    };
  },
});

// ---------- delete_source ----------

const deleteSourceSchema = z.object({
  notebook_id: z.string().describe('The notebook ID that contains the source.'),
  source_id: z.string().describe('The unique identifier of the source to delete.'),
});

export const deleteSourceTool = new FunctionTool({
  name: 'delete_source',
  description:
    'Permanently deletes a source from a notebook. This action cannot be undone. ' +
    'The agent should confirm with the user before calling this tool.',
  parameters: deleteSourceSchema,
  execute: async ({ notebook_id, source_id }: z.infer<typeof deleteSourceSchema>) => {
    const result = runNlm(
      ['source', 'delete', notebook_id, source_id, '--confirm'],
      TIMEOUT_MEDIUM,
    );
    if (result.status !== 'success') return result;

    return {
      status: 'success',
      message: result.output ?? 'Source deleted.',
    };
  },
});

// ---------- check_stale_sources ----------

const checkStaleSourcesSchema = z.object({
  notebook_id: z.string().describe('The notebook ID to check for stale sources.'),
});

export const checkStaleSourcesTool = new FunctionTool({
  name: 'check_stale_sources',
  description:
    'Checks whether any sources in a notebook are stale (i.e., the original content has changed since it was added). ' +
    'Use this to determine if sources need to be re-synced.',
  parameters: checkStaleSourcesSchema,
  execute: async ({ notebook_id }: z.infer<typeof checkStaleSourcesSchema>) => {
    const result = runNlm(['source', 'stale', notebook_id], TIMEOUT_MEDIUM);
    if (result.status !== 'success') return result;

    return {
      status: 'success',
      data: result.data,
      message: result.output,
    };
  },
});

// ---------- sync_sources ----------

const syncSourcesSchema = z.object({
  notebook_id: z.string().describe('The notebook ID whose sources to synchronize.'),
});

export const syncSourcesTool = new FunctionTool({
  name: 'sync_sources',
  description:
    'Synchronizes all sources in a notebook, re-fetching and re-indexing any that have changed. ' +
    'This may take a while depending on the number and size of sources.',
  parameters: syncSourcesSchema,
  execute: async ({ notebook_id }: z.infer<typeof syncSourcesSchema>) => {
    const result = runNlm(['source', 'sync', notebook_id], TIMEOUT_LONG);
    if (result.status !== 'success') return result;

    return {
      status: 'success',
      data: result.data,
      message: result.output ?? 'Sources synchronized.',
    };
  },
});
