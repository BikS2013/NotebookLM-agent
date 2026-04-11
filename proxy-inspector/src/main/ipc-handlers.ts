import { ipcMain, type BrowserWindow } from 'electron';
import * as fs from 'node:fs';
import { IPC } from '@shared/ipc-channels';
import type {
  ParsedFileData,
  IncrementalUpdate,
  IpcResult,
  DetailPayload,
  InteractionSummary,
} from '@shared/types';
import { createNdjsonParser, type NdjsonParser } from './ndjson-parser';
import { createInteractionStore, type InteractionStore } from './interaction-store';
import { createFileTailer, type FileTailer } from './file-tailer';
import { createFileManager, type FileManager } from './file-manager';

// ── Module state ──

let store: InteractionStore;
let fileManager: FileManager;
let currentTailer: FileTailer | null = null;
let currentParser: NdjsonParser | null = null;
let activeWindow: BrowserWindow | null = null;
let handlersRegistered = false;

// ── Tailer + parser factory ──

function createTailerAndParser(
  filePath: string,
): { tailer: FileTailer; parser: NdjsonParser } {
  const parser = createNdjsonParser();
  const tailer = createFileTailer(filePath, {
    onNewChunk(rawChunk: string): void {
      const entries = parser.push(rawChunk);
      if (entries.length === 0) return;

      const updatedSummaries = store.addEntries(entries);
      if (updatedSummaries.length > 0 && activeWindow && !activeWindow.isDestroyed()) {
        const update: IncrementalUpdate = {
          interactions: updatedSummaries,
          aggregates: store.getAggregates(),
        };
        activeWindow.webContents.send(IPC.NEW_EVENTS, update);
      }
    },
    onError(err: Error): void {
      console.error('[file-tailer] Error:', err.message);
    },
  });
  return { tailer, parser };
}

// ── Open file helper (shared by openFile and openRecent) ──

function openAndParseFile(filePath: string): ParsedFileData {
  // Stop any existing tailer
  if (currentTailer) {
    currentTailer.stop();
    currentTailer = null;
  }
  if (currentParser) {
    currentParser.flush();
    currentParser = null;
  }

  // Reset store
  store.clear();

  // Get file info
  const fileInfo = fileManager.openFilePath(filePath);

  // Read full file content
  const content = fs.readFileSync(filePath, 'utf8');

  // Parse all lines
  const parser = createNdjsonParser();
  const entries = parser.push(content);
  entries.push(...parser.flush());
  store.addEntries(entries);

  // Start tailer from current file size
  const { tailer, parser: tailParser } = createTailerAndParser(filePath);
  currentTailer = tailer;
  currentParser = tailParser;

  tailer.start(Buffer.byteLength(content, 'utf8'));

  // Add to recent files
  fileManager.addRecentFile(filePath);

  // Build response
  return {
    metadata: {
      filePath: fileInfo.filePath,
      sessionId: fileInfo.sessionId,
      createdAt: fileInfo.createdAt,
      fileSize: fileInfo.fileSize,
    },
    interactions: store.getAllSummaries(),
    aggregates: store.getAggregates(),
  };
}

// ── Public: register all IPC handlers ──

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  // Update the module-level window reference (supports macOS window re-creation)
  activeWindow = mainWindow;
  store = createInteractionStore();
  fileManager = createFileManager(mainWindow);

  // Prevent duplicate ipcMain.handle registration
  if (handlersRegistered) return;
  handlersRegistered = true;

  // ── OPEN_FILE: Show dialog, parse, start watching ──

  ipcMain.handle(IPC.OPEN_FILE, async (): Promise<IpcResult<ParsedFileData>> => {
    try {
      const fileInfo = await fileManager.openFileDialog();
      if (!fileInfo) {
        // User cancelled — not an error, but no data
        return { ok: false, error: 'No file selected' };
      }

      const data = openAndParseFile(fileInfo.filePath);
      return { ok: true, data };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[ipc] openFile error:', msg);
      return { ok: false, error: msg };
    }
  });

  // ── OPEN_RECENT: Parse a known file path, start watching ──

  ipcMain.handle(IPC.OPEN_RECENT, async (_event, filePath: string): Promise<IpcResult<ParsedFileData>> => {
    try {
      const data = openAndParseFile(filePath);
      return { ok: true, data };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[ipc] openRecent error:', msg);
      return { ok: false, error: msg };
    }
  });

  // ── GET_INTERACTION_DETAIL: Return full events for an interaction ──

  ipcMain.handle(IPC.GET_INTERACTION_DETAIL, async (_event, interactionId: string): Promise<IpcResult<DetailPayload>> => {
    try {
      const detail = store.getDetail(interactionId);
      if (!detail) {
        return { ok: false, error: `Interaction not found: ${interactionId}` };
      }
      return { ok: true, data: detail };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: msg };
    }
  });

  // ── SEARCH: Search interactions by user message ──

  ipcMain.handle(IPC.SEARCH, async (_event, query: string): Promise<InteractionSummary[]> => {
    try {
      return store.search(query);
    } catch (err) {
      console.error('[ipc] search error:', err);
      return [];
    }
  });

  // ── PAUSE_WATCH: Toggle tailer pause/resume ──

  ipcMain.handle(IPC.PAUSE_WATCH, async (_event, paused: boolean): Promise<void> => {
    if (!currentTailer) return;

    if (paused) {
      currentTailer.pause();
    } else {
      currentTailer.resume();
    }
  });

  // ── GET_RECENT_FILES: Return recent file list ──

  ipcMain.handle(IPC.GET_RECENT_FILES, async (): Promise<string[]> => {
    try {
      return fileManager.getRecentFiles();
    } catch (err) {
      console.error('[ipc] getRecentFiles error:', err);
      return [];
    }
  });
}

// ── Cleanup: stop tailer when app quits ──

export function cleanupIpcHandlers(): void {
  if (currentTailer) {
    currentTailer.stop();
    currentTailer = null;
  }
  if (currentParser) {
    currentParser.flush();
    currentParser = null;
  }
  activeWindow = null;
}
