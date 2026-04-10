/**
 * Download tools for NotebookLM studio artifacts.
 */

import { FunctionTool } from '@google/adk';
import { z } from 'zod';
import { runNlm, TIMEOUT_LONG } from './nlm-runner.ts';
import { getConfig } from '../config.ts';

const downloadArtifactSchema = z.object({
  notebook_id: z.string().describe('The notebook UUID that owns the artifact.'),
  artifact_type: z.enum([
    'audio', 'video', 'report', 'mind-map', 'slide-deck',
    'infographic', 'data-table', 'quiz', 'flashcards',
  ]).describe('Type of artifact to download.'),
  artifact_id: z.string().describe('The ID of the specific artifact to download.'),
  output_path: z.string().optional().describe('Optional output file path. Defaults to NLM_DOWNLOAD_DIR.'),
});

export const downloadArtifactTool = new FunctionTool({
  name: 'download_artifact',
  description: 'Downloads a studio artifact (audio, video, report, etc.) to a local file.',
  parameters: downloadArtifactSchema,
  execute: async ({ notebook_id, artifact_type, artifact_id, output_path }: z.infer<typeof downloadArtifactSchema>) => {
    const outputDir = output_path ?? getConfig().nlmDownloadDir;
    const result = runNlm(
      ['download', artifact_type, notebook_id, '--id', artifact_id, '--output', outputDir],
      TIMEOUT_LONG,
    );
    if (result.status !== 'success') return result;
    return {
      status: 'success',
      message: `Artifact ${artifact_id} (${artifact_type}) downloaded to ${outputDir}.`,
      output_path: outputDir,
    };
  },
});
