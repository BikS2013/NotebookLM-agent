/**
 * Note management tools for NotebookLM.
 * Notes are user-created text entries within a notebook.
 */

import { FunctionTool } from '@google/adk';
import { z } from 'zod';
import { runNlm, TIMEOUT_MEDIUM } from './nlm-runner.ts';

// --- listNotesTool ---
const listNotesSchema = z.object({
  notebook_id: z.string().describe('The notebook UUID to list notes for.'),
});

export const listNotesTool = new FunctionTool({
  name: 'list_notes',
  description: 'Lists all notes in a notebook.',
  parameters: listNotesSchema,
  execute: async ({ notebook_id }: z.infer<typeof listNotesSchema>) => {
    const result = runNlm(['note', 'list', notebook_id], TIMEOUT_MEDIUM);
    if (result.status !== 'success') return result;
    return { status: 'success', notebook_id, output: result.output, data: result.data };
  },
});

// --- createNoteTool ---
const createNoteSchema = z.object({
  notebook_id: z.string().describe('The notebook UUID to create a note in.'),
  content: z.string().describe('The text content of the note.'),
});

export const createNoteTool = new FunctionTool({
  name: 'create_note',
  description: 'Creates a new text note in a notebook.',
  parameters: createNoteSchema,
  execute: async ({ notebook_id, content }: z.infer<typeof createNoteSchema>) => {
    const result = runNlm(['note', 'create', notebook_id, '--content', content], TIMEOUT_MEDIUM);
    if (result.status !== 'success') return result;
    return { status: 'success', message: `Note created in notebook ${notebook_id}.`, output: result.output, data: result.data };
  },
});

// --- updateNoteTool ---
const updateNoteSchema = z.object({
  notebook_id: z.string().describe('The notebook UUID containing the note.'),
  note_id: z.string().describe('The ID of the note to update.'),
  content: z.string().describe('The new text content for the note.'),
});

export const updateNoteTool = new FunctionTool({
  name: 'update_note',
  description: 'Updates the content of an existing note in a notebook.',
  parameters: updateNoteSchema,
  execute: async ({ notebook_id, note_id, content }: z.infer<typeof updateNoteSchema>) => {
    const result = runNlm(['note', 'update', notebook_id, note_id, '--content', content], TIMEOUT_MEDIUM);
    if (result.status !== 'success') return result;
    return { status: 'success', message: `Note ${note_id} updated in notebook ${notebook_id}.`, output: result.output, data: result.data };
  },
});

// --- deleteNoteTool ---
const deleteNoteSchema = z.object({
  notebook_id: z.string().describe('The notebook UUID containing the note.'),
  note_id: z.string().describe('The ID of the note to delete.'),
});

export const deleteNoteTool = new FunctionTool({
  name: 'delete_note',
  description: 'Deletes a note from a notebook. This action cannot be undone.',
  parameters: deleteNoteSchema,
  execute: async ({ notebook_id, note_id }: z.infer<typeof deleteNoteSchema>) => {
    const result = runNlm(['note', 'delete', notebook_id, note_id, '--confirm'], TIMEOUT_MEDIUM);
    if (result.status !== 'success') return result;
    return { status: 'success', message: `Note ${note_id} deleted from notebook ${notebook_id}.` };
  },
});
