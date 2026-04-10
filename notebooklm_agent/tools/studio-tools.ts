/**
 * Studio content creation and status tools for NotebookLM.
 * Creation commands have NO --json support — check exit code only.
 * studioStatusTool is the exception: it supports --json --full.
 */

import { FunctionTool } from '@google/adk';
import { z } from 'zod';
import { runNlm, TIMEOUT_MEDIUM } from './nlm-runner.ts';
import { extractArray, normalizeArtifact } from './parsers.ts';

// --- createAudioTool ---
const createAudioSchema = z.object({
  notebook_id: z.string().describe('The notebook UUID to create audio for.'),
  format: z.enum(['deep_dive', 'brief', 'critique', 'debate']).optional().default('deep_dive')
    .describe('Audio format style.'),
  length: z.enum(['short', 'default', 'long']).optional().default('default')
    .describe('Audio length.'),
});

export const createAudioTool = new FunctionTool({
  name: 'create_audio',
  description: 'Creates an audio overview (podcast-style) from a notebook. Formats: deep_dive, brief, critique, debate.',
  parameters: createAudioSchema,
  execute: async ({ notebook_id, format, length }: z.infer<typeof createAudioSchema>) => {
    const result = runNlm(
      ['audio', 'create', notebook_id, '--format', format!, '--length', length!, '--confirm'],
      TIMEOUT_MEDIUM,
    );
    if (result.status !== 'success') return result;
    return { status: 'success', message: `Audio creation started for notebook ${notebook_id} (format: ${format}, length: ${length}).` };
  },
});

// --- createVideoTool ---
const createVideoSchema = z.object({
  notebook_id: z.string().describe('The notebook UUID to create video for.'),
  format: z.enum(['explainer', 'tutorial', 'summary']).optional().default('explainer')
    .describe('Video format style.'),
  style: z.string().optional().describe('Optional video style modifier.'),
});

export const createVideoTool = new FunctionTool({
  name: 'create_video',
  description: 'Creates a video from a notebook. Formats: explainer, tutorial, summary.',
  parameters: createVideoSchema,
  execute: async ({ notebook_id, format, style }: z.infer<typeof createVideoSchema>) => {
    const args = ['video', 'create', notebook_id, '--format', format!, '--confirm'];
    if (style) args.splice(5, 0, '--style', style);
    const result = runNlm(args, TIMEOUT_MEDIUM);
    if (result.status !== 'success') return result;
    return { status: 'success', message: `Video creation started for notebook ${notebook_id} (format: ${format}${style ? `, style: ${style}` : ''}).` };
  },
});

// --- createReportTool ---
const createReportSchema = z.object({
  notebook_id: z.string().describe('The notebook UUID to create a report for.'),
  format: z.string().optional().default('Briefing Doc')
    .describe('Report format, e.g. "Briefing Doc", "FAQ", "Study Guide", "Timeline".'),
});

export const createReportTool = new FunctionTool({
  name: 'create_report',
  description: 'Creates a written report from a notebook. Common formats: Briefing Doc, FAQ, Study Guide, Timeline.',
  parameters: createReportSchema,
  execute: async ({ notebook_id, format }: z.infer<typeof createReportSchema>) => {
    const result = runNlm(
      ['report', 'create', notebook_id, '--format', format!, '--confirm'],
      TIMEOUT_MEDIUM,
    );
    if (result.status !== 'success') return result;
    return { status: 'success', message: `Report creation started for notebook ${notebook_id} (format: ${format}).` };
  },
});

// --- createQuizTool ---
const createQuizSchema = z.object({
  notebook_id: z.string().describe('The notebook UUID to create a quiz for.'),
  count: z.number().optional().default(5).describe('Number of quiz questions (default 5).'),
  difficulty: z.number().optional().default(3).describe('Difficulty level 1-5 (default 3).'),
});

export const createQuizTool = new FunctionTool({
  name: 'create_quiz',
  description: 'Creates a quiz from notebook content. Specify question count and difficulty.',
  parameters: createQuizSchema,
  execute: async ({ notebook_id, count, difficulty }: z.infer<typeof createQuizSchema>) => {
    const result = runNlm(
      ['quiz', 'create', notebook_id, '--count', String(count!), '--difficulty', String(difficulty!), '--confirm'],
      TIMEOUT_MEDIUM,
    );
    if (result.status !== 'success') return result;
    return { status: 'success', message: `Quiz creation started for notebook ${notebook_id} (${count} questions, difficulty ${difficulty}).` };
  },
});

// --- createFlashcardsTool ---
const createFlashcardsSchema = z.object({
  notebook_id: z.string().describe('The notebook UUID to create flashcards for.'),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional().default('medium')
    .describe('Flashcard difficulty level.'),
});

export const createFlashcardsTool = new FunctionTool({
  name: 'create_flashcards',
  description: 'Creates flashcards from notebook content for study purposes.',
  parameters: createFlashcardsSchema,
  execute: async ({ notebook_id, difficulty }: z.infer<typeof createFlashcardsSchema>) => {
    const result = runNlm(
      ['flashcards', 'create', notebook_id, '--difficulty', difficulty!, '--confirm'],
      TIMEOUT_MEDIUM,
    );
    if (result.status !== 'success') return result;
    return { status: 'success', message: `Flashcard creation started for notebook ${notebook_id} (difficulty: ${difficulty}).` };
  },
});

// --- createMindmapTool ---
const createMindmapSchema = z.object({
  notebook_id: z.string().describe('The notebook UUID to create a mind map for.'),
  title: z.string().optional().describe('Optional title for the mind map.'),
});

export const createMindmapTool = new FunctionTool({
  name: 'create_mindmap',
  description: 'Creates a mind map visualization from notebook content.',
  parameters: createMindmapSchema,
  execute: async ({ notebook_id, title }: z.infer<typeof createMindmapSchema>) => {
    const args = ['mindmap', 'create', notebook_id, '--confirm'];
    if (title) args.splice(3, 0, '--title', title);
    const result = runNlm(args, TIMEOUT_MEDIUM);
    if (result.status !== 'success') return result;
    return { status: 'success', message: `Mind map creation started for notebook ${notebook_id}${title ? ` (title: ${title})` : ''}.` };
  },
});

// --- createSlidesTool ---
const createSlidesSchema = z.object({
  notebook_id: z.string().describe('The notebook UUID to create slides for.'),
  format: z.enum(['detailed_deck', 'summary_deck', 'pitch_deck']).optional().default('detailed_deck')
    .describe('Slide deck format.'),
});

export const createSlidesTool = new FunctionTool({
  name: 'create_slides',
  description: 'Creates a slide deck from notebook content. Formats: detailed_deck, summary_deck, pitch_deck.',
  parameters: createSlidesSchema,
  execute: async ({ notebook_id, format }: z.infer<typeof createSlidesSchema>) => {
    const result = runNlm(
      ['slides', 'create', notebook_id, '--format', format!, '--confirm'],
      TIMEOUT_MEDIUM,
    );
    if (result.status !== 'success') return result;
    return { status: 'success', message: `Slide deck creation started for notebook ${notebook_id} (format: ${format}).` };
  },
});

// --- createInfographicTool ---
const createInfographicSchema = z.object({
  notebook_id: z.string().describe('The notebook UUID to create an infographic for.'),
  orientation: z.enum(['landscape', 'portrait']).optional().default('landscape')
    .describe('Infographic orientation.'),
  detail: z.enum(['minimal', 'standard', 'detailed']).optional().default('standard')
    .describe('Level of detail in the infographic.'),
});

export const createInfographicTool = new FunctionTool({
  name: 'create_infographic',
  description: 'Creates an infographic from notebook content.',
  parameters: createInfographicSchema,
  execute: async ({ notebook_id, orientation, detail }: z.infer<typeof createInfographicSchema>) => {
    const result = runNlm(
      ['infographic', 'create', notebook_id, '--orientation', orientation!, '--detail', detail!, '--confirm'],
      TIMEOUT_MEDIUM,
    );
    if (result.status !== 'success') return result;
    return { status: 'success', message: `Infographic creation started for notebook ${notebook_id} (orientation: ${orientation}, detail: ${detail}).` };
  },
});

// --- createDataTableTool ---
const createDataTableSchema = z.object({
  notebook_id: z.string().describe('The notebook UUID to create a data table for.'),
  description: z.string().describe('Description of the data table to generate.'),
});

export const createDataTableTool = new FunctionTool({
  name: 'create_data_table',
  description: 'Creates a structured data table from notebook content based on a description.',
  parameters: createDataTableSchema,
  execute: async ({ notebook_id, description }: z.infer<typeof createDataTableSchema>) => {
    const result = runNlm(
      ['data-table', 'create', notebook_id, description, '--confirm'],
      TIMEOUT_MEDIUM,
    );
    if (result.status !== 'success') return result;
    return { status: 'success', message: `Data table creation started for notebook ${notebook_id}.` };
  },
});

// --- studioStatusTool ---
const studioStatusSchema = z.object({
  notebook_id: z.string().describe('The notebook UUID to check studio status for.'),
});

export const studioStatusTool = new FunctionTool({
  name: 'studio_status',
  description: 'Returns the status of all studio artifacts (audio, video, reports, etc.) for a notebook.',
  parameters: studioStatusSchema,
  execute: async ({ notebook_id }: z.infer<typeof studioStatusSchema>) => {
    const result = runNlm(['studio', 'status', notebook_id, '--json', '--full'], TIMEOUT_MEDIUM);
    if (result.status !== 'success') return result;

    const raw = extractArray(result.data, 'artifacts', 'items', 'content');
    const artifacts = raw.map(normalizeArtifact);
    return {
      status: 'success',
      notebook_id,
      artifact_count: artifacts.length,
      artifacts,
    };
  },
});
