import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import {
  createFileTool,
  readFileTool,
  editFileTool,
  deleteFileTool,
  createFolderTool,
  deleteFolderTool,
  listFolderTool,
} from '../notebooklm_agent/tools/filesystem-tools.ts';

// Helper to call the execute method (same pattern as other test files)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callTool(tool: any, args: any): Promise<any> {
  return tool.execute(args);
}

// Root temp directory for all tests
const ROOT_TMP = path.join(os.tmpdir(), 'nlm-agent-fs-tests-' + Date.now());

// Per-test temp directory
let tmpDir: string;
let testCounter = 0;

beforeEach(() => {
  testCounter++;
  tmpDir = path.join(ROOT_TMP, `test-${testCounter}`);
  fs.mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  // Clean up individual test directory
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

afterAll(() => {
  // Clean up root temp directory
  if (fs.existsSync(ROOT_TMP)) {
    fs.rmSync(ROOT_TMP, { recursive: true, force: true });
  }
});

// ──────────────────────────────────────────────
// Tool 1: create_file
// ──────────────────────────────────────────────

describe('createFileTool', () => {
  it('creates a new file successfully', async () => {
    const filePath = path.join(tmpDir, 'hello.txt');

    const result = await callTool(createFileTool, {
      file_path: filePath,
      content: 'Hello, world!',
    });

    expect(result.status).toBe('success');
    expect(result.file_path).toBe(filePath);
    expect(result.size_bytes).toBe(13);
    expect(result.message).toBe('File created.');
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('Hello, world!');
  });

  it('refuses to overwrite without overwrite flag', async () => {
    const filePath = path.join(tmpDir, 'existing.txt');
    fs.writeFileSync(filePath, 'original');

    const result = await callTool(createFileTool, {
      file_path: filePath,
      content: 'new content',
    });

    expect(result.status).toBe('error');
    expect(result.error).toContain('already exists');
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('original');
  });

  it('overwrites when overwrite=true', async () => {
    const filePath = path.join(tmpDir, 'existing.txt');
    fs.writeFileSync(filePath, 'original');

    const result = await callTool(createFileTool, {
      file_path: filePath,
      content: 'replaced',
      overwrite: true,
    });

    expect(result.status).toBe('success');
    expect(result.message).toBe('File overwritten.');
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('replaced');
  });

  it('creates parent directories automatically', async () => {
    const filePath = path.join(tmpDir, 'deep', 'nested', 'dir', 'file.txt');

    const result = await callTool(createFileTool, {
      file_path: filePath,
      content: 'deep content',
    });

    expect(result.status).toBe('success');
    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('deep content');
  });
});

// ──────────────────────────────────────────────
// Tool 2: read_file
// ──────────────────────────────────────────────

describe('readFileTool', () => {
  it('reads a file successfully', async () => {
    const filePath = path.join(tmpDir, 'readme.txt');
    fs.writeFileSync(filePath, 'Some content here.');

    const result = await callTool(readFileTool, { file_path: filePath });

    expect(result.status).toBe('success');
    expect(result.content).toBe('Some content here.');
    expect(result.size_bytes).toBe(18);
    expect(result.truncated).toBe(false);
    expect(result.original_length).toBe(18);
  });

  it('returns not_found for missing file', async () => {
    const filePath = path.join(tmpDir, 'nonexistent.txt');

    const result = await callTool(readFileTool, { file_path: filePath });

    expect(result.status).toBe('not_found');
    expect(result.error).toContain('not found');
  });

  it('detects binary content (null bytes)', async () => {
    const filePath = path.join(tmpDir, 'binary.bin');
    fs.writeFileSync(filePath, Buffer.from([0x48, 0x65, 0x00, 0x6c, 0x6f]));

    const result = await callTool(readFileTool, { file_path: filePath });

    expect(result.status).toBe('error');
    expect(result.error).toContain('binary');
  });

  it('truncates content when exceeding max_chars', async () => {
    const filePath = path.join(tmpDir, 'long.txt');
    const longContent = 'A'.repeat(500);
    fs.writeFileSync(filePath, longContent);

    const result = await callTool(readFileTool, {
      file_path: filePath,
      max_chars: 100,
    });

    expect(result.status).toBe('success');
    expect(result.truncated).toBe(true);
    expect(result.content.length).toBeLessThanOrEqual(103); // 100 + '...'
    expect(result.original_length).toBe(500);
  });
});

// ──────────────────────────────────────────────
// Tool 3: edit_file
// ──────────────────────────────────────────────

describe('editFileTool', () => {
  it('replaces text successfully', async () => {
    const filePath = path.join(tmpDir, 'edit-me.txt');
    fs.writeFileSync(filePath, 'Hello, world!');

    const result = await callTool(editFileTool, {
      file_path: filePath,
      old_text: 'world',
      new_text: 'universe',
    });

    expect(result.status).toBe('success');
    expect(result.message).toBe('Text replaced successfully.');
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('Hello, universe!');
  });

  it('appends text when old_text is omitted', async () => {
    const filePath = path.join(tmpDir, 'append-me.txt');
    fs.writeFileSync(filePath, 'Line 1');

    const result = await callTool(editFileTool, {
      file_path: filePath,
      new_text: '\nLine 2',
    });

    expect(result.status).toBe('success');
    expect(result.message).toBe('Content appended to file.');
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('Line 1\nLine 2');
  });

  it('returns error when old_text is not found', async () => {
    const filePath = path.join(tmpDir, 'no-match.txt');
    fs.writeFileSync(filePath, 'Hello, world!');

    const result = await callTool(editFileTool, {
      file_path: filePath,
      old_text: 'nonexistent',
      new_text: 'replacement',
    });

    expect(result.status).toBe('error');
    expect(result.error).toContain('not found');
  });

  it('returns not_found for missing file', async () => {
    const result = await callTool(editFileTool, {
      file_path: path.join(tmpDir, 'missing.txt'),
      old_text: 'x',
      new_text: 'y',
    });

    expect(result.status).toBe('not_found');
  });
});

// ──────────────────────────────────────────────
// Tool 4: delete_file
// ──────────────────────────────────────────────

describe('deleteFileTool', () => {
  it('deletes a file successfully', async () => {
    const filePath = path.join(tmpDir, 'to-delete.txt');
    fs.writeFileSync(filePath, 'bye');

    const result = await callTool(deleteFileTool, { file_path: filePath });

    expect(result.status).toBe('success');
    expect(result.message).toContain('deleted');
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it('returns not_found for missing file', async () => {
    const result = await callTool(deleteFileTool, {
      file_path: path.join(tmpDir, 'ghost.txt'),
    });

    expect(result.status).toBe('not_found');
  });

  it('returns error when path is a directory', async () => {
    const dirPath = path.join(tmpDir, 'a-folder');
    fs.mkdirSync(dirPath);

    const result = await callTool(deleteFileTool, { file_path: dirPath });

    expect(result.status).toBe('error');
    expect(result.error).toContain('not a file');
  });
});

// ──────────────────────────────────────────────
// Tool 5: create_folder
// ──────────────────────────────────────────────

describe('createFolderTool', () => {
  it('creates a new folder', async () => {
    const folderPath = path.join(tmpDir, 'new-folder');

    const result = await callTool(createFolderTool, { folder_path: folderPath });

    expect(result.status).toBe('success');
    expect(result.message).toBe('Folder created.');
    expect(fs.existsSync(folderPath)).toBe(true);
    expect(fs.statSync(folderPath).isDirectory()).toBe(true);
  });

  it('succeeds silently if folder already exists (idempotent)', async () => {
    const folderPath = path.join(tmpDir, 'existing-folder');
    fs.mkdirSync(folderPath);

    const result = await callTool(createFolderTool, { folder_path: folderPath });

    expect(result.status).toBe('success');
    expect(result.message).toBe('Folder already exists.');
  });
});

// ──────────────────────────────────────────────
// Tool 6: delete_folder
// ──────────────────────────────────────────────

describe('deleteFolderTool', () => {
  it('deletes an empty folder', async () => {
    const folderPath = path.join(tmpDir, 'empty-dir');
    fs.mkdirSync(folderPath);

    const result = await callTool(deleteFolderTool, { folder_path: folderPath });

    expect(result.status).toBe('success');
    expect(fs.existsSync(folderPath)).toBe(false);
  });

  it('refuses to delete non-empty folder without recursive', async () => {
    const folderPath = path.join(tmpDir, 'non-empty');
    fs.mkdirSync(folderPath);
    fs.writeFileSync(path.join(folderPath, 'file.txt'), 'data');

    const result = await callTool(deleteFolderTool, { folder_path: folderPath });

    expect(result.status).toBe('error');
    expect(result.error).toContain('not empty');
    expect(fs.existsSync(folderPath)).toBe(true);
  });

  it('deletes non-empty folder with recursive=true', async () => {
    const folderPath = path.join(tmpDir, 'non-empty-r');
    fs.mkdirSync(folderPath);
    fs.writeFileSync(path.join(folderPath, 'file.txt'), 'data');
    fs.mkdirSync(path.join(folderPath, 'sub'));
    fs.writeFileSync(path.join(folderPath, 'sub', 'nested.txt'), 'nested');

    const result = await callTool(deleteFolderTool, {
      folder_path: folderPath,
      recursive: true,
    });

    expect(result.status).toBe('success');
    expect(fs.existsSync(folderPath)).toBe(false);
  });

  it('returns not_found for missing folder', async () => {
    const result = await callTool(deleteFolderTool, {
      folder_path: path.join(tmpDir, 'no-such-dir'),
    });

    expect(result.status).toBe('not_found');
  });
});

// ──────────────────────────────────────────────
// Tool 7: list_folder
// ──────────────────────────────────────────────

describe('listFolderTool', () => {
  it('lists folder contents', async () => {
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'aaa');
    fs.writeFileSync(path.join(tmpDir, 'b.txt'), 'bb');
    fs.mkdirSync(path.join(tmpDir, 'subdir'));

    const result = await callTool(listFolderTool, { folder_path: tmpDir });

    expect(result.status).toBe('success');
    expect(result.total_count).toBe(3);
    expect(result.truncated).toBe(false);

    const names = result.entries.map((e: any) => e.name).sort();
    expect(names).toEqual(['a.txt', 'b.txt', 'subdir']);

    const fileEntry = result.entries.find((e: any) => e.name === 'a.txt');
    expect(fileEntry.type).toBe('file');
    expect(fileEntry.size_bytes).toBe(3);

    const dirEntry = result.entries.find((e: any) => e.name === 'subdir');
    expect(dirEntry.type).toBe('directory');
  });

  it('lists recursively', async () => {
    fs.writeFileSync(path.join(tmpDir, 'root.txt'), 'r');
    fs.mkdirSync(path.join(tmpDir, 'child'));
    fs.writeFileSync(path.join(tmpDir, 'child', 'deep.txt'), 'd');

    const result = await callTool(listFolderTool, {
      folder_path: tmpDir,
      recursive: true,
    });

    expect(result.status).toBe('success');
    // root.txt, child/, child/deep.txt
    expect(result.total_count).toBe(3);

    const names = result.entries.map((e: any) => e.name).sort();
    expect(names).toContain('root.txt');
    expect(names).toContain('child');
    expect(names).toContain(path.join('child', 'deep.txt'));
  });

  it('returns empty entries for empty folder', async () => {
    const emptyDir = path.join(tmpDir, 'empty');
    fs.mkdirSync(emptyDir);

    const result = await callTool(listFolderTool, { folder_path: emptyDir });

    expect(result.status).toBe('success');
    expect(result.entries).toEqual([]);
    expect(result.total_count).toBe(0);
  });

  it('returns not_found for missing folder', async () => {
    const result = await callTool(listFolderTool, {
      folder_path: path.join(tmpDir, 'nope'),
    });

    expect(result.status).toBe('not_found');
  });
});
