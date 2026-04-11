import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createFileTailer } from '../proxy-inspector/src/main/file-tailer.js';

// ── Helpers ──

const tmpDir = path.join(os.tmpdir(), 'file-tailer-tests');
let tempFiles: string[] = [];
let tailers: ReturnType<typeof createFileTailer>[] = [];

function createTempFile(name: string, content = ''): string {
  fs.mkdirSync(tmpDir, { recursive: true });
  const filePath = path.join(tmpDir, name);
  fs.writeFileSync(filePath, content, 'utf8');
  tempFiles.push(filePath);
  return filePath;
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

afterEach(() => {
  // Stop all tailers
  for (const t of tailers) {
    try { t.stop(); } catch { /* ignore */ }
  }
  tailers = [];

  // Clean up temp files
  for (const f of tempFiles) {
    try { fs.unlinkSync(f); } catch { /* ignore */ }
  }
  tempFiles = [];
  try { fs.rmdirSync(tmpDir); } catch { /* ignore */ }
});

// NOTE: fs.watch tests can be flaky in CI environments.
// These tests use real temp files and rely on fs.watch + debounce (500ms).
// If flaky in your CI, consider marking with .skip or adjusting timeouts.

describe('FileTailer - basic lifecycle', () => {
  it('creates a tailer with initial bytesRead = 0', () => {
    const filePath = createTempFile('basic.txt', 'initial content');
    const tailer = createFileTailer(filePath, {
      onNewChunk: () => {},
      onError: () => {},
    });
    tailers.push(tailer);

    expect(tailer.bytesRead).toBe(0);
    expect(tailer.isPaused).toBe(false);
  });

  it('starts watching from given byte offset', () => {
    const filePath = createTempFile('offset.txt', 'hello world');
    const tailer = createFileTailer(filePath, {
      onNewChunk: () => {},
      onError: () => {},
    });
    tailers.push(tailer);

    tailer.start(5);
    expect(tailer.bytesRead).toBe(5);
  });

  it('stop cleans up watcher', () => {
    const filePath = createTempFile('stop.txt', 'data');
    const tailer = createFileTailer(filePath, {
      onNewChunk: () => {},
      onError: () => {},
    });
    tailers.push(tailer);

    tailer.start(0);
    tailer.stop();
    // Should not throw when stopped again
    tailer.stop();
  });

  it('pause and resume change isPaused state', () => {
    const filePath = createTempFile('pause.txt', 'data');
    const tailer = createFileTailer(filePath, {
      onNewChunk: () => {},
      onError: () => {},
    });
    tailers.push(tailer);

    tailer.start(0);
    expect(tailer.isPaused).toBe(false);

    tailer.pause();
    expect(tailer.isPaused).toBe(true);

    tailer.resume();
    expect(tailer.isPaused).toBe(false);
  });
});

describe('FileTailer - content detection', () => {
  // NOTE: This test relies on fs.watch which can be flaky on macOS (especially in /tmp).
  // If it fails in CI, consider marking with .skip.
  it('detects new content appended to file', async () => {
    const filePath = createTempFile('append.txt', 'line1\n');
    const chunks: string[] = [];

    const tailer = createFileTailer(filePath, {
      onNewChunk: (chunk) => chunks.push(chunk),
      onError: () => { /* swallow -- fs.watch may fire errors on macOS */ },
    });
    tailers.push(tailer);

    // Start from the end of initial content
    const initialSize = fs.statSync(filePath).size;
    tailer.start(initialSize);

    // Small delay to let watcher register before writing
    await wait(200);

    // Append new content
    fs.appendFileSync(filePath, 'line2\n');

    // Poll for result with retries (debounce is 500ms, total budget 4s)
    for (let i = 0; i < 8; i++) {
      await wait(500);
      if (chunks.length > 0) break;
    }

    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks.join('')).toContain('line2');
  }, 10000);

  it('handles resume by reading bytes that arrived while paused', () => {
    const filePath = createTempFile('resume-read.txt', 'initial');
    const chunks: string[] = [];

    const tailer = createFileTailer(filePath, {
      onNewChunk: (chunk) => chunks.push(chunk),
      onError: () => {},
    });
    tailers.push(tailer);

    // Start from offset 0 -- but we haven't triggered any watch event yet
    tailer.start(0);
    tailer.pause();

    // Append while paused
    fs.appendFileSync(filePath, '-appended');

    // Resume triggers an immediate read
    tailer.resume();

    // The resume calls readNewBytes synchronously
    expect(chunks.join('')).toContain('initial');
    expect(chunks.join('')).toContain('-appended');
  });
});

describe('FileTailer - rotation detection', () => {
  it('resets bytesRead when file shrinks (rotation)', () => {
    const filePath = createTempFile('rotate.txt', 'long content here');
    const chunks: string[] = [];

    const tailer = createFileTailer(filePath, {
      onNewChunk: (chunk) => chunks.push(chunk),
      onError: () => {},
    });
    tailers.push(tailer);

    // Start reading all initial content
    tailer.start(0);
    tailer.resume(); // triggers synchronous read of existing content

    const bytesAfterRead = tailer.bytesRead;
    expect(bytesAfterRead).toBeGreaterThan(0);

    // Simulate rotation: truncate and write shorter content
    fs.writeFileSync(filePath, 'new\n');

    // Resume to trigger another read -- file is now smaller
    tailer.pause();
    tailer.resume();

    // After rotation detection, bytesRead should be reset and new content read
    expect(chunks.join('')).toContain('new');
  });
});

describe('FileTailer - error handling', () => {
  it('calls onError when watching a non-existent file', () => {
    const errors: Error[] = [];
    const tailer = createFileTailer('/tmp/nonexistent-tailer-test-file.txt', {
      onNewChunk: () => {},
      onError: (err) => errors.push(err),
    });
    tailers.push(tailer);

    // start should call onError since the file does not exist for fs.watch
    tailer.start(0);

    // fs.watch on non-existent file throws -- should be caught
    expect(errors.length).toBeGreaterThanOrEqual(1);
  });
});
