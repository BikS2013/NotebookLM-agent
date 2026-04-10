/**
 * Filesystem management tools for the NotebookLM ADK agent.
 * Enables creating, reading, editing, and deleting files and folders.
 * Uses Node.js built-in fs and path modules — no external dependencies.
 */

import { FunctionTool } from '@google/adk';
import { z } from 'zod';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { truncateText, truncateList } from './parsers.ts';

// ──────────────────────────────────────────────
// Tool 1: create_file
// ──────────────────────────────────────────────

const createFileSchema = z.object({
  file_path: z.string().describe(
    'Absolute or relative path for the new file.',
  ),
  content: z.string().describe(
    'Text content to write to the file.',
  ),
  overwrite: z.boolean().optional().describe(
    'If true, overwrite an existing file. If false or omitted, fail if the file already exists.',
  ),
});

export const createFileTool = new FunctionTool({
  name: 'create_file',
  description:
    'Create a new file with the given content at the specified path. ' +
    'Parent directories are created automatically if they do not exist. ' +
    'Set overwrite to true to replace an existing file.',
  parameters: createFileSchema,
  execute: async ({ file_path, content, overwrite }: z.infer<typeof createFileSchema>) => {
    try {
      const resolved = path.resolve(file_path);
      const existed = fs.existsSync(resolved);

      if (!overwrite && existed) {
        return { status: 'error', error: `File already exists: ${resolved}. Set overwrite=true to replace it.` };
      }

      // Create parent directories if needed
      const dir = path.dirname(resolved);
      fs.mkdirSync(dir, { recursive: true });

      fs.writeFileSync(resolved, content, 'utf-8');
      const stats = fs.statSync(resolved);

      return {
        status: 'success',
        file_path: resolved,
        size_bytes: stats.size,
        message: overwrite && existed ? 'File overwritten.' : 'File created.',
      };
    } catch (err: unknown) {
      return { status: 'error', error: `Failed to create file: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
});

// ──────────────────────────────────────────────
// Tool 2: read_file
// ──────────────────────────────────────────────

const readFileSchema = z.object({
  file_path: z.string().describe(
    'Path to the file to read.',
  ),
  max_chars: z.number().optional().describe(
    'Maximum characters to return. Content is truncated if exceeded. Default: 10000.',
  ),
});

export const readFileTool = new FunctionTool({
  name: 'read_file',
  description:
    'Read the text content of a file. Returns the content with optional truncation. ' +
    'Use this to inspect file contents before editing or to review saved documents.',
  parameters: readFileSchema,
  execute: async ({ file_path, max_chars }: z.infer<typeof readFileSchema>) => {
    try {
      const resolved = path.resolve(file_path);

      if (!fs.existsSync(resolved)) {
        return { status: 'not_found', error: `File not found: ${resolved}` };
      }

      const stats = fs.statSync(resolved);
      if (!stats.isFile()) {
        return { status: 'error', error: `Path is not a file: ${resolved}` };
      }

      const raw = fs.readFileSync(resolved, 'utf-8');

      // Check for binary content (null bytes)
      if (raw.includes('\0')) {
        return { status: 'error', error: `File appears to be binary and cannot be read as text: ${resolved}` };
      }

      const limit = max_chars ?? 10_000;
      const [content, truncated] = truncateText(raw, limit);

      return {
        status: 'success',
        content,
        size_bytes: stats.size,
        truncated,
        original_length: raw.length,
      };
    } catch (err: unknown) {
      return { status: 'error', error: `Failed to read file: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
});

// ──────────────────────────────────────────────
// Tool 3: edit_file
// ──────────────────────────────────────────────

const editFileSchema = z.object({
  file_path: z.string().describe(
    'Path to the file to edit.',
  ),
  old_text: z.string().optional().describe(
    'Text to find and replace. If omitted, new_text is appended to the end of the file.',
  ),
  new_text: z.string().describe(
    'Replacement text (when old_text is provided), or text to append (when old_text is omitted).',
  ),
});

export const editFileTool = new FunctionTool({
  name: 'edit_file',
  description:
    'Edit a file by replacing a specific text string with new content, or append content to the end. ' +
    'When old_text is provided, the first occurrence is replaced with new_text. ' +
    'When old_text is omitted, new_text is appended to the end of the file.',
  parameters: editFileSchema,
  execute: async ({ file_path, old_text, new_text }: z.infer<typeof editFileSchema>) => {
    try {
      const resolved = path.resolve(file_path);

      if (!fs.existsSync(resolved)) {
        return { status: 'not_found', error: `File not found: ${resolved}` };
      }

      const stats = fs.statSync(resolved);
      if (!stats.isFile()) {
        return { status: 'error', error: `Path is not a file: ${resolved}` };
      }

      const content = fs.readFileSync(resolved, 'utf-8');

      if (old_text === undefined || old_text === null) {
        // Append mode
        fs.writeFileSync(resolved, content + new_text, 'utf-8');
        return {
          status: 'success',
          file_path: resolved,
          message: 'Content appended to file.',
        };
      }

      // Replace mode
      if (!content.includes(old_text)) {
        return { status: 'error', error: 'Text to replace was not found in the file.' };
      }

      const updated = content.replace(old_text, new_text);
      fs.writeFileSync(resolved, updated, 'utf-8');

      return {
        status: 'success',
        file_path: resolved,
        message: 'Text replaced successfully.',
      };
    } catch (err: unknown) {
      return { status: 'error', error: `Failed to edit file: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
});

// ──────────────────────────────────────────────
// Tool 4: delete_file
// ──────────────────────────────────────────────

const deleteFileSchema = z.object({
  file_path: z.string().describe(
    'Path to the file to delete.',
  ),
});

export const deleteFileTool = new FunctionTool({
  name: 'delete_file',
  description:
    'Permanently delete a file. This action cannot be undone. ' +
    'The agent should confirm with the user before calling this tool.',
  parameters: deleteFileSchema,
  execute: async ({ file_path }: z.infer<typeof deleteFileSchema>) => {
    try {
      const resolved = path.resolve(file_path);

      if (!fs.existsSync(resolved)) {
        return { status: 'not_found', error: `File not found: ${resolved}` };
      }

      const stats = fs.statSync(resolved);
      if (!stats.isFile()) {
        return { status: 'error', error: `Path is not a file: ${resolved}. Use delete_folder for directories.` };
      }

      fs.unlinkSync(resolved);

      return {
        status: 'success',
        message: `File deleted: ${resolved}`,
      };
    } catch (err: unknown) {
      return { status: 'error', error: `Failed to delete file: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
});

// ──────────────────────────────────────────────
// Tool 5: create_folder
// ──────────────────────────────────────────────

const createFolderSchema = z.object({
  folder_path: z.string().describe(
    'Path for the new folder. Parent directories are created if needed.',
  ),
});

export const createFolderTool = new FunctionTool({
  name: 'create_folder',
  description:
    'Create a new folder at the specified path. Parent directories are created automatically. ' +
    'If the folder already exists, succeeds silently (idempotent).',
  parameters: createFolderSchema,
  execute: async ({ folder_path }: z.infer<typeof createFolderSchema>) => {
    try {
      const resolved = path.resolve(folder_path);
      const existed = fs.existsSync(resolved);

      fs.mkdirSync(resolved, { recursive: true });

      return {
        status: 'success',
        folder_path: resolved,
        message: existed ? 'Folder already exists.' : 'Folder created.',
      };
    } catch (err: unknown) {
      return { status: 'error', error: `Failed to create folder: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
});

// ──────────────────────────────────────────────
// Tool 6: delete_folder
// ──────────────────────────────────────────────

const deleteFolderSchema = z.object({
  folder_path: z.string().describe(
    'Path to the folder to delete.',
  ),
  recursive: z.boolean().optional().describe(
    'Must be true to delete non-empty folders. Safety guard to prevent accidental data loss.',
  ),
});

export const deleteFolderTool = new FunctionTool({
  name: 'delete_folder',
  description:
    'Permanently delete a folder. Set recursive=true to delete non-empty folders and all contents. ' +
    'This action cannot be undone. The agent should confirm with the user before calling this tool.',
  parameters: deleteFolderSchema,
  execute: async ({ folder_path, recursive }: z.infer<typeof deleteFolderSchema>) => {
    try {
      const resolved = path.resolve(folder_path);

      if (!fs.existsSync(resolved)) {
        return { status: 'not_found', error: `Folder not found: ${resolved}` };
      }

      const stats = fs.statSync(resolved);
      if (!stats.isDirectory()) {
        return { status: 'error', error: `Path is not a folder: ${resolved}. Use delete_file for files.` };
      }

      // Check if folder is non-empty
      const entries = fs.readdirSync(resolved);
      if (entries.length > 0 && !recursive) {
        return {
          status: 'error',
          error: `Folder is not empty (${entries.length} items). Set recursive=true to delete the folder and all its contents.`,
        };
      }

      fs.rmSync(resolved, { recursive: true, force: true });

      return {
        status: 'success',
        message: `Folder deleted: ${resolved}`,
      };
    } catch (err: unknown) {
      return { status: 'error', error: `Failed to delete folder: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
});

// ──────────────────────────────────────────────
// Tool 7: list_folder
// ──────────────────────────────────────────────

interface FolderEntry {
  name: string;
  type: 'file' | 'directory';
  size_bytes: number;
}

const listFolderSchema = z.object({
  folder_path: z.string().describe(
    'Path to the folder to list.',
  ),
  recursive: z.boolean().optional().describe(
    'If true, list contents recursively including subfolders.',
  ),
});

function listDir(dirPath: string, recursive: boolean, basePath: string): FolderEntry[] {
  const entries: FolderEntry[] = [];

  for (const dirent of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, dirent.name);
    const relativeName = path.relative(basePath, fullPath);

    if (dirent.isFile()) {
      const stats = fs.statSync(fullPath);
      entries.push({ name: relativeName, type: 'file', size_bytes: stats.size });
    } else if (dirent.isDirectory()) {
      entries.push({ name: relativeName, type: 'directory', size_bytes: 0 });
      if (recursive) {
        entries.push(...listDir(fullPath, true, basePath));
      }
    }
  }

  return entries;
}

export const listFolderTool = new FunctionTool({
  name: 'list_folder',
  description:
    'List the contents of a folder. Returns file and folder names with types and sizes. ' +
    'Set recursive=true to include subdirectory contents. Results are capped at 200 entries.',
  parameters: listFolderSchema,
  execute: async ({ folder_path, recursive }: z.infer<typeof listFolderSchema>) => {
    try {
      const resolved = path.resolve(folder_path);

      if (!fs.existsSync(resolved)) {
        return { status: 'not_found', error: `Folder not found: ${resolved}` };
      }

      const stats = fs.statSync(resolved);
      if (!stats.isDirectory()) {
        return { status: 'error', error: `Path is not a folder: ${resolved}` };
      }

      const allEntries = listDir(resolved, !!recursive, resolved);
      const [entries, truncated] = truncateList(allEntries, 200);

      return {
        status: 'success',
        folder_path: resolved,
        entries,
        total_count: allEntries.length,
        truncated,
      };
    } catch (err: unknown) {
      return { status: 'error', error: `Failed to list folder: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
});
