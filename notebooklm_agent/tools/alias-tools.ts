/**
 * Alias management tools for NotebookLM.
 * Aliases map short names to notebook UUIDs for convenience.
 */

import { FunctionTool } from '@google/adk';
import { z } from 'zod';
import { runNlm, TIMEOUT_FAST, TIMEOUT_MEDIUM } from './nlm-runner.ts';

// --- listAliasesTool ---
const listAliasesSchema = z.object({});

export const listAliasesTool = new FunctionTool({
  name: 'list_aliases',
  description: 'Lists all defined notebook aliases (short names mapped to notebook UUIDs).',
  parameters: listAliasesSchema,
  execute: async () => {
    const result = runNlm(['alias', 'list'], TIMEOUT_FAST);
    if (result.status !== 'success') return result;
    return { status: 'success', output: result.output, data: result.data };
  },
});

// --- setAliasTool ---
const setAliasSchema = z.object({
  name: z.string().describe('The alias name to create or update.'),
  notebook_id: z.string().describe('The notebook UUID to associate with this alias.'),
});

export const setAliasTool = new FunctionTool({
  name: 'set_alias',
  description: 'Creates or updates an alias that maps a short name to a notebook UUID.',
  parameters: setAliasSchema,
  execute: async ({ name, notebook_id }: z.infer<typeof setAliasSchema>) => {
    const result = runNlm(['alias', 'set', name, notebook_id], TIMEOUT_MEDIUM);
    if (result.status !== 'success') return result;
    return { status: 'success', message: `Alias "${name}" set to notebook ${notebook_id}.` };
  },
});

// --- getAliasTool ---
const getAliasSchema = z.object({
  name: z.string().describe('The alias name to look up.'),
});

export const getAliasTool = new FunctionTool({
  name: 'get_alias',
  description: 'Retrieves the notebook UUID associated with an alias.',
  parameters: getAliasSchema,
  execute: async ({ name }: z.infer<typeof getAliasSchema>) => {
    const result = runNlm(['alias', 'get', name], TIMEOUT_FAST);
    if (result.status !== 'success') return result;
    return { status: 'success', alias: name, output: result.output, data: result.data };
  },
});

// --- deleteAliasTool ---
const deleteAliasSchema = z.object({
  name: z.string().describe('The alias name to delete.'),
});

export const deleteAliasTool = new FunctionTool({
  name: 'delete_alias',
  description: 'Deletes a notebook alias.',
  parameters: deleteAliasSchema,
  execute: async ({ name }: z.infer<typeof deleteAliasSchema>) => {
    const result = runNlm(['alias', 'delete', name], TIMEOUT_MEDIUM);
    if (result.status !== 'success') return result;
    return { status: 'success', message: `Alias "${name}" deleted.` };
  },
});
