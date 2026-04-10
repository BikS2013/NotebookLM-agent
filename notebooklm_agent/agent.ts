/**
 * NotebookLM Agent - Google ADK TypeScript agent for managing NotebookLM collections.
 *
 * Entry point for `npx adk web` and `npx adk run`.
 * Exports `rootAgent` as required by ADK convention.
 */

// Note: ADK devtools automatically loads .env from the project root.
// No manual dotenv loading needed.
import { LlmAgent, ReadonlyContext } from '@google/adk';
import { getConfig } from './config.ts';

// Import all tools
import {
  checkAuthTool,
  listNotebooksTool,
  getNotebookTool,
  createNotebookTool,
  renameNotebookTool,
  deleteNotebookTool,
  describeNotebookTool,
  addSourceTool,
  listSourcesTool,
  describeSourceTool,
  getSourceContentTool,
  deleteSourceTool,
  checkStaleSourcesTool,
  syncSourcesTool,
  queryNotebookTool,
  createAudioTool,
  createVideoTool,
  createReportTool,
  createQuizTool,
  createFlashcardsTool,
  createMindmapTool,
  createSlidesTool,
  createInfographicTool,
  createDataTableTool,
  studioStatusTool,
  downloadArtifactTool,
  shareStatusTool,
  sharePublicTool,
  sharePrivateTool,
  shareInviteTool,
  startResearchTool,
  researchStatusTool,
  importResearchTool,
  listAliasesTool,
  setAliasTool,
  getAliasTool,
  deleteAliasTool,
  listNotesTool,
  createNoteTool,
  updateNoteTool,
  deleteNoteTool,
} from './tools/index.ts';

// Note: Destructive tools (delete_notebook, delete_source, delete_note) rely on the system
// prompt instructing the LLM to confirm with the user before calling them. The tools pass
// --confirm to nlm CLI for non-interactive execution after the LLM has obtained user approval.

// Load config to get model name
const config = getConfig();

// System prompt as an InstructionProvider for dynamic state injection
function buildInstruction(ctx: ReadonlyContext): string {
  const currentId = ctx.state.get('current_notebook_id') ?? '';
  const currentTitle = ctx.state.get('current_notebook_title') ?? '';
  const lastConvId = ctx.state.get('last_conversation_id') ?? '';

  const notebookCtx = currentId
    ? `\nCurrent notebook: "${currentTitle}" (ID: ${currentId})`
    : '\nNo notebook currently selected.';

  const convCtx = lastConvId
    ? `\nActive conversation: ${lastConvId}`
    : '';

  return `You are **NotebookLM Manager**, an AI assistant that helps users manage their Google NotebookLM collection through natural language.

## Session Context${notebookCtx}${convCtx}

## Capabilities

You can manage notebooks, sources, queries, studio content (audio, video, reports, quizzes, flashcards, mind maps, slides, infographics, data tables), downloads, sharing, research, aliases, and notes.

## Tool Usage Guidelines

- **Authentication**: Always run \`check_auth\` first if a command fails with an auth error. If authentication has expired, instruct the user to run \`nlm login\` in their terminal.
- **Notebook selection**: When the user says "this notebook" or "current notebook", use the current_notebook_id from session context. If none is set, ask which notebook they mean.
- **Source processing**: After adding sources, inform the user that processing takes 2-5 minutes. Sources must finish processing before querying or generating content.
- **Studio generation**: Content generation (audio, video, reports, etc.) takes 1-5 minutes. After starting generation, suggest the user check status with \`studio_status\`.
- **Research**: Research in "deep" mode can take 5+ minutes. In "fast" mode, results are quicker but less comprehensive.
- **Queries**: For follow-up questions in the same conversation, the conversation_id is automatically maintained.
- **Downloads**: Artifacts are saved to the configured download directory.
- **Rate limits**: NotebookLM has a free tier limit of ~50 API queries/day. Use queries judiciously.

## Multi-Step Workflows

You can chain operations. For example:
1. Create a notebook -> Add sources -> Wait for processing -> Generate a podcast
2. List notebooks -> Select one -> Query it -> Follow up with related questions
3. Start research -> Check status -> Import results -> Generate a report

## Destructive Operations

**Always confirm with the user before deleting** notebooks, sources, or notes. These operations cannot be undone. The delete tools will pause for confirmation — only proceed when the user explicitly approves.

## Response Style

- Be concise and informative
- Format notebook/source lists as readable bullet points
- Always include IDs when referencing notebooks or sources so the user can refer to them
- When operations succeed, confirm what was done
- When operations fail, explain why and suggest next steps`;
}

// Export the root agent for ADK discovery
export const rootAgent = new LlmAgent({
  name: 'notebooklm_agent',
  model: config.geminiModel,
  description: 'Manages Google NotebookLM collections — notebooks, sources, queries, studio content, sharing, and more.',
  instruction: buildInstruction,
  tools: [
    // Auth
    checkAuthTool,
    // Notebooks
    listNotebooksTool,
    getNotebookTool,
    createNotebookTool,
    renameNotebookTool,
    deleteNotebookTool,
    describeNotebookTool,
    // Sources
    addSourceTool,
    listSourcesTool,
    describeSourceTool,
    getSourceContentTool,
    deleteSourceTool,
    checkStaleSourcesTool,
    syncSourcesTool,
    // Query
    queryNotebookTool,
    // Studio
    createAudioTool,
    createVideoTool,
    createReportTool,
    createQuizTool,
    createFlashcardsTool,
    createMindmapTool,
    createSlidesTool,
    createInfographicTool,
    createDataTableTool,
    studioStatusTool,
    // Download
    downloadArtifactTool,
    // Sharing
    shareStatusTool,
    sharePublicTool,
    sharePrivateTool,
    shareInviteTool,
    // Research
    startResearchTool,
    researchStatusTool,
    importResearchTool,
    // Aliases
    listAliasesTool,
    setAliasTool,
    getAliasTool,
    deleteAliasTool,
    // Notes
    listNotesTool,
    createNoteTool,
    updateNoteTool,
    deleteNoteTool,
  ],
});
