/**
 * Async NDJSON file writer with buffering and size-based rotation.
 *
 * MUST NEVER throw -- all errors are logged to stderr and swallowed.
 * Uses only Node.js built-in modules: node:fs/promises, node:path.
 */
import { open, mkdir } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import type { LogEntry } from './proxy-types.ts';

/** 64KB buffer flush threshold. */
const BUFFER_FLUSH_THRESHOLD = 65536;

/** 500ms periodic flush interval. */
const FLUSH_INTERVAL_MS = 500;

export class ProxyLogger {
  private readonly logDir: string;
  private sessionId: string;
  private readonly maxFileSize: number;

  private currentFilePath: string;
  private fileHandle: FileHandle | null = null;
  private writeBuffer: string[] = [];
  private bufferByteSize: number = 0;
  private currentFileSize: number = 0;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private fileIndex: number = 0;
  private initialized: boolean = false;
  private closed: boolean = false;

  /**
   * @param opts.logDir - Directory for log files (created on first write if missing)
   * @param opts.sessionId - ADK session ID for file naming
   * @param opts.maxFileSize - Max file size in bytes before rotation
   */
  constructor(opts: {
    logDir: string;
    sessionId: string;
    maxFileSize: number;
  }) {
    this.logDir = opts.logDir;
    this.sessionId = opts.sessionId;
    this.maxFileSize = opts.maxFileSize;
    this.currentFilePath = this.buildFilePath();
  }

  /**
   * Queue a log entry for writing. Non-blocking.
   * The entry is serialized immediately and added to the write buffer.
   * Actual disk write happens on flush (timer or threshold).
   *
   * Never throws.
   */
  write(entry: LogEntry): void {
    try {
      if (this.closed) return;

      const line = JSON.stringify(entry) + '\n';
      this.writeBuffer.push(line);
      this.bufferByteSize += Buffer.byteLength(line, 'utf8');

      // Start the periodic flush timer on first write
      if (this.flushTimer === null && !this.closed) {
        this.flushTimer = setInterval(() => {
          void this.flush();
        }, FLUSH_INTERVAL_MS);
        // Unref so the timer does not keep the process alive
        if (this.flushTimer && typeof this.flushTimer === 'object' && 'unref' in this.flushTimer) {
          (this.flushTimer as NodeJS.Timeout).unref();
        }
      }

      // Flush immediately if buffer exceeds threshold
      if (this.bufferByteSize > BUFFER_FLUSH_THRESHOLD) {
        void this.flush();
      }
    } catch (err) {
      this.logError('write', err);
    }
  }

  /**
   * Force flush the write buffer to disk.
   * Called explicitly by the plugin at interaction end.
   * Never throws.
   */
  async flush(): Promise<void> {
    try {
      if (this.writeBuffer.length === 0) return;

      // Grab the current buffer contents and reset
      const data = this.writeBuffer.join('');
      const dataByteSize = Buffer.byteLength(data, 'utf8');
      this.writeBuffer = [];
      this.bufferByteSize = 0;

      // Lazy initialization: ensure directory and file handle
      if (!this.initialized) {
        await this.initialize();
      }

      // Check rotation before writing
      if (this.currentFileSize + dataByteSize > this.maxFileSize) {
        await this.rotate();
      }

      // Write data
      if (this.fileHandle) {
        await this.fileHandle.appendFile(data, 'utf8');
        this.currentFileSize += dataByteSize;
      }
    } catch (err) {
      this.logError('flush', err);
    }
  }

  /**
   * Flush remaining buffer and close the file handle.
   * Stops the periodic flush timer.
   * Never throws.
   */
  async close(): Promise<void> {
    try {
      this.closed = true;

      // Stop the periodic flush timer
      if (this.flushTimer !== null) {
        clearInterval(this.flushTimer);
        this.flushTimer = null;
      }

      // Flush remaining data
      await this.flush();

      // Close the file handle
      if (this.fileHandle) {
        await this.fileHandle.close();
        this.fileHandle = null;
      }
    } catch (err) {
      this.logError('close', err);
    }
  }

  /**
   * Update the session ID (called when the actual session is created).
   * Only effective before the first write (before file is opened).
   */
  setSessionId(sessionId: string): void {
    if (!this.initialized) {
      this.sessionId = sessionId;
      this.currentFilePath = this.buildFilePath();
    }
  }

  /**
   * Returns the path to the current log file.
   */
  getFilePath(): string {
    return this.currentFilePath;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Build the file path for the current log file. */
  private buildFilePath(): string {
    const timestamp = new Date()
      .toISOString()
      .replace(/:/g, '-')
      .replace(/\.\d{3}Z$/, '');
    const suffix = this.fileIndex > 0 ? `.${this.fileIndex}` : '';
    return join(this.logDir, `proxy-${this.sessionId}-${timestamp}${suffix}.ndjson`);
  }

  /** Lazy initialization: create directory and open file handle. */
  private async initialize(): Promise<void> {
    try {
      await mkdir(this.logDir, { recursive: true });
      this.fileHandle = await open(this.currentFilePath, 'a');
      this.currentFileSize = 0;
      this.initialized = true;
    } catch (err) {
      this.logError('initialize', err);
    }
  }

  /** Rotate to a new log file when current exceeds maxFileSize. */
  private async rotate(): Promise<void> {
    try {
      // Close current file handle
      if (this.fileHandle) {
        await this.fileHandle.close();
        this.fileHandle = null;
      }

      // Increment file index and build new path
      this.fileIndex++;
      this.currentFilePath = this.buildFilePath();

      // Open new file
      this.fileHandle = await open(this.currentFilePath, 'a');
      this.currentFileSize = 0;
    } catch (err) {
      this.logError('rotate', err);
    }
  }

  /** Write an error to stderr. Never throws. */
  private logError(method: string, err: unknown): void {
    try {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[llm-proxy] Error in ProxyLogger.${method}: ${message}\n`);
    } catch {
      // Absolutely nothing we can do here
    }
  }
}
