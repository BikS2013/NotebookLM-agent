/**
 * Authentication tools for the NotebookLM ADK agent.
 */

import { FunctionTool } from '@google/adk';
import { z } from 'zod';
import { runNlm, TIMEOUT_FAST } from './nlm-runner.ts';

// ---------- check_auth ----------

const checkAuthSchema = z.object({});

export const checkAuthTool = new FunctionTool({
  name: 'check_auth',
  description:
    'Checks whether the user is currently authenticated with NotebookLM. ' +
    'Call this before any notebook operation if you suspect the session may have expired.',
  parameters: checkAuthSchema,
  execute: async (_args: z.infer<typeof checkAuthSchema>) => {
    const result = runNlm(['login', '--check'], TIMEOUT_FAST);

    if (result.status === 'auth_error') {
      return {
        status: 'error',
        authenticated: false,
        message: result.error ?? 'Not authenticated.',
        action: 'Run "nlm login" to authenticate.',
      };
    }

    if (result.status !== 'success') {
      return {
        status: result.status,
        authenticated: false,
        message: result.error ?? 'Authentication check failed.',
      };
    }

    return {
      status: 'success',
      authenticated: true,
      message: result.output ?? 'Authenticated.',
    };
  },
});
