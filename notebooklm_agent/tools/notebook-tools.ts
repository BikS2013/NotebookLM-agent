/**
 * Notebook management tools for the NotebookLM ADK agent.
 */

import { FunctionTool, Context } from '@google/adk';
import { z } from 'zod';
import { runNlm, TIMEOUT_FAST, TIMEOUT_MEDIUM } from './nlm-runner.ts';
import { truncateList, normalizeNotebook, extractArray } from './parsers.ts';

// ---------- list_notebooks ----------

const listNotebooksSchema = z.object({});

export const listNotebooksTool = new FunctionTool({
  name: 'list_notebooks',
  description:
    'Lists all notebooks in the user\'s NotebookLM account. ' +
    'Returns an array of notebooks with id, title, source_count, and updated_at. ' +
    'Results are capped at 50 notebooks.',
  parameters: listNotebooksSchema,
  execute: async (_args: z.infer<typeof listNotebooksSchema>) => {
    const result = runNlm(['notebook', 'list', '--json'], TIMEOUT_MEDIUM);
    if (result.status !== 'success') return result;

    const rawItems = extractArray(result.data, 'notebooks', 'items', 'results');
    const normalized = rawItems.map(normalizeNotebook);
    const [items, truncated] = truncateList(normalized, 50);

    return {
      status: 'success',
      notebooks: items,
      total: rawItems.length,
      truncated,
    };
  },
});

// ---------- get_notebook ----------

const getNotebookSchema = z.object({
  notebook_id: z.string().describe('The unique identifier of the notebook to retrieve.'),
});

export const getNotebookTool = new FunctionTool({
  name: 'get_notebook',
  description:
    'Retrieves detailed information about a specific notebook by its ID. ' +
    'Also sets this notebook as the current working notebook in session state.',
  parameters: getNotebookSchema,
  execute: async (
    { notebook_id }: z.infer<typeof getNotebookSchema>,
    context?: Context,
  ) => {
    const result = runNlm(['notebook', 'get', notebook_id, '--json'], TIMEOUT_FAST);
    if (result.status !== 'success') return result;

    const notebook = normalizeNotebook(
      (result.data as Record<string, unknown>) ?? {},
    );

    context?.state?.set('current_notebook_id', notebook.id);
    context?.state?.set('current_notebook_title', notebook.title);

    return {
      status: 'success',
      notebook,
    };
  },
});

// ---------- create_notebook ----------

const createNotebookSchema = z.object({
  title: z.string().describe('The title for the new notebook.'),
});

export const createNotebookTool = new FunctionTool({
  name: 'create_notebook',
  description:
    'Creates a new empty notebook with the given title. ' +
    'Sets the newly created notebook as the current working notebook in session state.',
  parameters: createNotebookSchema,
  execute: async (
    { title }: z.infer<typeof createNotebookSchema>,
    context?: Context,
  ) => {
    const result = runNlm(['notebook', 'create', title], TIMEOUT_MEDIUM);
    if (result.status !== 'success') return result;

    // Try to extract the notebook info from the response
    if (result.data && typeof result.data === 'object') {
      const notebook = normalizeNotebook(result.data as Record<string, unknown>);
      if (notebook.id) {
        context?.state?.set('current_notebook_id', notebook.id);
        context?.state?.set('current_notebook_title', notebook.title || title);
      }
      return { status: 'success', notebook };
    }

    return {
      status: 'success',
      message: result.output ?? 'Notebook created.',
    };
  },
});

// ---------- rename_notebook ----------

const renameNotebookSchema = z.object({
  notebook_id: z.string().describe('The unique identifier of the notebook to rename.'),
  new_title: z.string().describe('The new title for the notebook.'),
});

export const renameNotebookTool = new FunctionTool({
  name: 'rename_notebook',
  description: 'Renames an existing notebook to a new title.',
  parameters: renameNotebookSchema,
  execute: async ({ notebook_id, new_title }: z.infer<typeof renameNotebookSchema>) => {
    const result = runNlm(['notebook', 'rename', notebook_id, new_title], TIMEOUT_FAST);
    if (result.status !== 'success') return result;

    return {
      status: 'success',
      message: result.output ?? `Notebook renamed to "${new_title}".`,
    };
  },
});

// ---------- delete_notebook ----------

const deleteNotebookSchema = z.object({
  notebook_id: z.string().describe('The unique identifier of the notebook to delete.'),
});

export const deleteNotebookTool = new FunctionTool({
  name: 'delete_notebook',
  description:
    'Permanently deletes a notebook and all its contents. This action cannot be undone. ' +
    'NOTE: This is a destructive operation — the agent should confirm with the user before calling this tool.',
  parameters: deleteNotebookSchema,
  execute: async ({ notebook_id }: z.infer<typeof deleteNotebookSchema>) => {
    const result = runNlm(['notebook', 'delete', notebook_id, '--confirm'], TIMEOUT_MEDIUM);
    if (result.status !== 'success') return result;

    return {
      status: 'success',
      message: result.output ?? 'Notebook deleted.',
    };
  },
});

// ---------- describe_notebook ----------

const describeNotebookSchema = z.object({
  notebook_id: z.string().describe('The unique identifier of the notebook to describe.'),
});

export const describeNotebookTool = new FunctionTool({
  name: 'describe_notebook',
  description:
    'Returns a detailed description of a notebook including its sources, metadata, and structure. ' +
    'Use this to understand what a notebook contains before querying it.',
  parameters: describeNotebookSchema,
  execute: async ({ notebook_id }: z.infer<typeof describeNotebookSchema>) => {
    const result = runNlm(['notebook', 'describe', notebook_id, '--json'], TIMEOUT_MEDIUM);
    if (result.status !== 'success') return result;

    return {
      status: 'success',
      data: result.data,
    };
  },
});
