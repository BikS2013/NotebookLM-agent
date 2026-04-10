/**
 * Research tools for NotebookLM.
 * No --json on any research command — parse text output.
 */

import { FunctionTool } from '@google/adk';
import { z } from 'zod';
import { runNlm, TIMEOUT_LONG, TIMEOUT_EXTRA_LONG } from './nlm-runner.ts';

// --- startResearchTool ---
const startResearchSchema = z.object({
  notebook_id: z.string().describe('The notebook UUID to associate research with.'),
  query: z.string().describe('The research query or topic to investigate.'),
  mode: z.enum(['fast', 'thorough']).optional().default('fast')
    .describe('Research mode: fast for quick results, thorough for deeper investigation.'),
  source: z.enum(['web', 'scholar', 'news']).optional().default('web')
    .describe('Research source: web, scholar, or news.'),
});

export const startResearchTool = new FunctionTool({
  name: 'start_research',
  description: 'Starts a research task that searches external sources and adds findings to a notebook.',
  parameters: startResearchSchema,
  execute: async ({ notebook_id, query, mode, source }: z.infer<typeof startResearchSchema>) => {
    const result = runNlm(
      ['research', 'start', query, '--notebook-id', notebook_id, '--mode', mode!, '--source', source!],
      TIMEOUT_LONG,
    );
    if (result.status !== 'success') return result;
    return {
      status: 'success',
      message: `Research started for "${query}" (mode: ${mode}, source: ${source}) in notebook ${notebook_id}.`,
      output: result.output,
    };
  },
});

// --- researchStatusTool ---
const researchStatusSchema = z.object({
  notebook_id: z.string().describe('The notebook UUID to check research status for.'),
});

export const researchStatusTool = new FunctionTool({
  name: 'research_status',
  description: 'Returns the current status of research tasks for a notebook.',
  parameters: researchStatusSchema,
  execute: async ({ notebook_id }: z.infer<typeof researchStatusSchema>) => {
    const result = runNlm(['research', 'status', notebook_id], TIMEOUT_EXTRA_LONG);
    if (result.status !== 'success') return result;
    return {
      status: 'success',
      notebook_id,
      output: result.output,
    };
  },
});

// --- importResearchTool ---
const importResearchSchema = z.object({
  notebook_id: z.string().describe('The notebook UUID to import research findings into.'),
});

export const importResearchTool = new FunctionTool({
  name: 'import_research',
  description: 'Imports completed research findings as sources into a notebook.',
  parameters: importResearchSchema,
  execute: async ({ notebook_id }: z.infer<typeof importResearchSchema>) => {
    const result = runNlm(['research', 'import', notebook_id], TIMEOUT_LONG);
    if (result.status !== 'success') return result;
    return {
      status: 'success',
      message: `Research findings imported into notebook ${notebook_id}.`,
      output: result.output,
    };
  },
});
