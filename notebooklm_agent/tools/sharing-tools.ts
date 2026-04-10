/**
 * Sharing tools for NotebookLM notebooks.
 */

import { FunctionTool } from '@google/adk';
import { z } from 'zod';
import { runNlm, TIMEOUT_MEDIUM } from './nlm-runner.ts';

// --- shareStatusTool ---
const shareStatusSchema = z.object({
  notebook_id: z.string().describe('The notebook UUID to check sharing status for.'),
});

export const shareStatusTool = new FunctionTool({
  name: 'share_status',
  description: 'Returns the current sharing status of a notebook (public, private, invited users).',
  parameters: shareStatusSchema,
  execute: async ({ notebook_id }: z.infer<typeof shareStatusSchema>) => {
    const result = runNlm(['share', 'status', notebook_id], TIMEOUT_MEDIUM);
    if (result.status !== 'success') return result;
    return { status: 'success', notebook_id, output: result.output, data: result.data };
  },
});

// --- sharePublicTool ---
const sharePublicSchema = z.object({
  notebook_id: z.string().describe('The notebook UUID to make public.'),
});

export const sharePublicTool = new FunctionTool({
  name: 'share_public',
  description: 'Makes a notebook publicly accessible via a shared link.',
  parameters: sharePublicSchema,
  execute: async ({ notebook_id }: z.infer<typeof sharePublicSchema>) => {
    const result = runNlm(['share', 'public', notebook_id], TIMEOUT_MEDIUM);
    if (result.status !== 'success') return result;
    return { status: 'success', message: `Notebook ${notebook_id} is now public.`, output: result.output, data: result.data };
  },
});

// --- sharePrivateTool ---
const sharePrivateSchema = z.object({
  notebook_id: z.string().describe('The notebook UUID to make private.'),
});

export const sharePrivateTool = new FunctionTool({
  name: 'share_private',
  description: 'Makes a notebook private, removing public access.',
  parameters: sharePrivateSchema,
  execute: async ({ notebook_id }: z.infer<typeof sharePrivateSchema>) => {
    const result = runNlm(['share', 'private', notebook_id], TIMEOUT_MEDIUM);
    if (result.status !== 'success') return result;
    return { status: 'success', message: `Notebook ${notebook_id} is now private.`, output: result.output, data: result.data };
  },
});

// --- shareInviteTool ---
const shareInviteSchema = z.object({
  notebook_id: z.string().describe('The notebook UUID to share.'),
  email: z.string().describe('Email address of the person to invite.'),
  role: z.enum(['viewer', 'editor']).optional().default('viewer')
    .describe('Role for the invited user: viewer or editor.'),
});

export const shareInviteTool = new FunctionTool({
  name: 'share_invite',
  description: 'Invites a user to a notebook by email with a specified role.',
  parameters: shareInviteSchema,
  execute: async ({ notebook_id, email, role }: z.infer<typeof shareInviteSchema>) => {
    const result = runNlm(['share', 'invite', notebook_id, email, '--role', role!], TIMEOUT_MEDIUM);
    if (result.status !== 'success') return result;
    return { status: 'success', message: `Invited ${email} as ${role} to notebook ${notebook_id}.` };
  },
});
