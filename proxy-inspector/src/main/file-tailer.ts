import * as fs from 'node:fs';

// ── Public API ──

export interface FileTailerCallbacks {
  onNewChunk: (rawChunk: string) => void;
  onError: (err: Error) => void;
}

export interface FileTailer {
  /** Start watching the file from the given byte offset. */
  start(fromByte: number): void;

  /** Stop watching and clean up all timers and the fs.watch handle. */
  stop(): void;

  /** Pause: stop reacting to events but keep the watcher alive. */
  pause(): void;

  /** Resume: start reacting to events again. */
  resume(): void;

  /** Current byte offset (number of bytes already read). */
  readonly bytesRead: number;

  /** Whether currently paused. */
  readonly isPaused: boolean;
}

export function createFileTailer(
  filePath: string,
  callbacks: FileTailerCallbacks
): FileTailer {
  let bytesRead = 0;
  let paused = false;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let watcher: fs.FSWatcher | null = null;

  // ── Read new bytes from bytesRead to EOF ──

  function readNewBytes(): void {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch (err) {
      callbacks.onError(err as Error);
      return;
    }

    // Rotation detection: file shrank (was replaced by a smaller one)
    if (stat.size < bytesRead) {
      bytesRead = 0;
    }

    // False positive guard: no new bytes
    if (stat.size <= bytesRead) {
      return;
    }

    const chunkSize = stat.size - bytesRead;
    const buffer = Buffer.allocUnsafe(chunkSize);

    let fd: number;
    try {
      fd = fs.openSync(filePath, 'r');
    } catch (err) {
      callbacks.onError(err as Error);
      return;
    }

    try {
      const actual = fs.readSync(fd, buffer, 0, chunkSize, bytesRead);
      bytesRead += actual;
      if (actual > 0) {
        callbacks.onNewChunk(buffer.subarray(0, actual).toString('utf8'));
      }
    } catch (err) {
      callbacks.onError(err as Error);
    } finally {
      try {
        fs.closeSync(fd);
      } catch {
        // Ignore close errors
      }
    }
  }

  // ── Event-type agnostic handler (macOS fires 'rename' not 'change') ──

  function onWatchEvent(_eventType: string, _filename: string | null): void {
    if (paused) return;
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(readNewBytes, 500);
  }

  // ── Public methods ──

  function start(fromByte: number): void {
    // Clean up any previous watcher
    stop();

    bytesRead = fromByte;
    paused = false;

    try {
      // persistent: false ensures the watcher does not prevent Electron from exiting
      watcher = fs.watch(filePath, { persistent: false }, onWatchEvent);

      watcher.on('error', (err: Error) => {
        callbacks.onError(err);
      });
    } catch (err) {
      callbacks.onError(err as Error);
    }
  }

  function stop(): void {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }

    if (watcher !== null) {
      try {
        watcher.close();
      } catch {
        // Ignore close errors
      }
      watcher = null;
    }
  }

  function pauseTailer(): void {
    paused = true;
    // Cancel any pending debounce
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  }

  function resumeTailer(): void {
    paused = false;
    // Immediately check for new bytes that arrived while paused
    readNewBytes();
  }

  return {
    start,
    stop,
    pause: pauseTailer,
    resume: resumeTailer,
    get bytesRead() { return bytesRead; },
    get isPaused() { return paused; },
  };
}
