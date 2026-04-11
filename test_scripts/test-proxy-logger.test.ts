import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ProxyLogger } from '../notebooklm_agent/proxy/proxy-logger.ts';
import type { LogEntry } from '../notebooklm_agent/proxy/proxy-types.ts';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tempDir: string;

function makeLogger(overrides?: Partial<{ logDir: string; sessionId: string; maxFileSize: number }>) {
  return new ProxyLogger({
    logDir: tempDir,
    sessionId: 'test-session',
    maxFileSize: 52428800,
    ...overrides,
  });
}

function makeEntry(overrides?: Partial<LogEntry>): LogEntry {
  return {
    event: 'interaction_start',
    timestamp: new Date().toISOString(),
    interactionId: 'inv-test-001',
    payload: { test: true },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProxyLogger', () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'proxy-logger-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('constructor creates logger without opening files', () => {
    const logger = makeLogger();
    expect(logger).toBeDefined();
    // File path is set but no file should exist yet
    expect(logger.getFilePath()).toContain('proxy-');
    expect(logger.getFilePath()).toContain('.ndjson');
  });

  it('write buffers entries without immediately writing to disk', async () => {
    const logger = makeLogger();
    logger.write(makeEntry());

    // Check that no files have been created yet (lazy init)
    const files = await readdir(tempDir);
    expect(files).toHaveLength(0);

    await logger.close();
  });

  it('flush writes buffered entries to NDJSON file', async () => {
    const logger = makeLogger();
    logger.write(makeEntry({ interactionId: 'inv-flush-test' }));
    await logger.flush();

    const filePath = logger.getFilePath();
    const content = await readFile(filePath, 'utf8');
    expect(content.length).toBeGreaterThan(0);
    expect(content).toContain('inv-flush-test');

    await logger.close();
  });

  it('file is created lazily on first flush', async () => {
    const logger = makeLogger();

    // No files before first flush
    let files = await readdir(tempDir);
    expect(files).toHaveLength(0);

    // After write + flush, file is created
    logger.write(makeEntry());
    await logger.flush();

    files = await readdir(tempDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/\.ndjson$/);

    await logger.close();
  });

  it('each line in the file is valid JSON (NDJSON format)', async () => {
    const logger = makeLogger();
    logger.write(makeEntry({ interactionId: 'line-1' }));
    logger.write(makeEntry({ interactionId: 'line-2' }));
    logger.write(makeEntry({ interactionId: 'line-3' }));
    await logger.flush();

    const content = await readFile(logger.getFilePath(), 'utf8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(3);

    for (const line of lines) {
      const parsed = JSON.parse(line);
      expect(parsed).toHaveProperty('event');
      expect(parsed).toHaveProperty('timestamp');
      expect(parsed).toHaveProperty('interactionId');
    }

    await logger.close();
  });

  it('close flushes remaining data and closes handle', async () => {
    const logger = makeLogger();
    logger.write(makeEntry({ interactionId: 'close-test' }));
    // Don't manually flush -- close should flush
    await logger.close();

    const content = await readFile(logger.getFilePath(), 'utf8');
    expect(content).toContain('close-test');
  });

  it('logger never throws even with invalid paths', async () => {
    // Create logger with a path that will cause trouble (nested in non-existent deep path with
    // special chars -- mkdir recursive should still work, but even if it fails, no throw)
    const badLogger = new ProxyLogger({
      logDir: join(tempDir, 'sub', 'deep'),
      sessionId: 'bad',
      maxFileSize: 100,
    });

    // write should not throw
    badLogger.write(makeEntry());
    // flush should not throw (it will create directories recursively)
    await expect(badLogger.flush()).resolves.toBeUndefined();
    await expect(badLogger.close()).resolves.toBeUndefined();
  });

  it('file rotation when size limit exceeded', async () => {
    // Use a very small max file size to trigger rotation
    const logger = makeLogger({ maxFileSize: 100 });

    // Write enough data to exceed the limit
    for (let i = 0; i < 5; i++) {
      logger.write(makeEntry({ interactionId: `rotation-${i}`, payload: { data: 'x'.repeat(50) } }));
    }
    await logger.flush();

    // Should have created multiple files due to rotation
    const files = await readdir(tempDir);
    expect(files.length).toBeGreaterThanOrEqual(2);

    // All files should be NDJSON
    for (const file of files) {
      expect(file).toMatch(/\.ndjson$/);
    }

    await logger.close();
  });
});
