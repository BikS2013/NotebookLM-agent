/**
 * Query tools for the NotebookLM ADK agent.
 */

import { FunctionTool, Context } from '@google/adk';
import { z } from 'zod';
import { runNlm, TIMEOUT_MEDIUM } from './nlm-runner.ts';

// ---------- query_notebook ----------

const queryNotebookSchema = z.object({
  notebook_id: z.string().describe('The notebook ID to query against.'),
  question: z.string().describe(
    'The question to ask the notebook. NotebookLM will answer based on the sources in the notebook.',
  ),
  conversation_id: z.string().optional().describe(
    'Optional conversation ID to continue a previous conversation thread. ' +
    'If not provided, the last conversation ID from session state will be used if available.',
  ),
});

export const queryNotebookTool = new FunctionTool({
  name: 'query_notebook',
  description:
    'Asks a question to a notebook and returns an answer grounded in its sources. ' +
    'Supports multi-turn conversations by passing a conversation_id. ' +
    'If no conversation_id is provided, the tool automatically uses the last conversation from session state.',
  parameters: queryNotebookSchema,
  execute: async (
    { notebook_id, question, conversation_id }: z.infer<typeof queryNotebookSchema>,
    context?: Context,
  ) => {
    // Resolve conversation_id: explicit param > session state > omit
    const resolvedConversationId =
      conversation_id ?? (context?.state?.get('last_conversation_id') as string | undefined);

    const args = ['notebook', 'query', notebook_id, question, '--json'];
    if (resolvedConversationId) {
      args.push('--conversation-id', resolvedConversationId);
    }

    const result = runNlm(args, TIMEOUT_MEDIUM);
    if (result.status !== 'success') return result;

    // Extract and persist conversation_id for follow-up turns
    const data = result.data as Record<string, unknown> | undefined;
    const returnedConversationId = data?.conversation_id ?? data?.conversationId;
    if (returnedConversationId) {
      context?.state?.set('last_conversation_id', String(returnedConversationId));
    }

    return {
      status: 'success',
      data: result.data,
    };
  },
});
