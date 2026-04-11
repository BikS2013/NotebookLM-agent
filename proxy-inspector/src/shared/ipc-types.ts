import type {
  ParsedFileData,
  DetailPayload,
  IncrementalUpdate,
  InteractionSummary,
  IpcResult,
} from './types';

/**
 * The API shape exposed by the preload script via contextBridge.
 * This is the single source of truth for the renderer's `window.api`.
 *
 * All IPC payloads use Structured Clone serialization.
 * No functions, Promises, Symbols, WeakMaps, or DOM objects in payloads.
 */
export interface ProxyInspectorAPI {
  // ── Renderer -> Main (request/response via invoke/handle) ──

  /** Open native file dialog, parse file, start watcher. */
  openFile: () => Promise<IpcResult<ParsedFileData>>;

  /** Open a specific file by path (from recent files or drag-drop). */
  openRecent: (filePath: string) => Promise<IpcResult<ParsedFileData>>;

  /** Fetch full event list for a selected interaction (lazy loading). */
  getInteractionDetail: (interactionId: string) => Promise<IpcResult<DetailPayload>>;

  /** Search interactions by user message substring. */
  search: (query: string) => Promise<InteractionSummary[]>;

  /** Pause or resume the file watcher. */
  pauseWatch: (paused: boolean) => Promise<void>;

  /** Get the list of recently opened file paths. */
  getRecentFiles: () => Promise<string[]>;

  // ── Main -> Renderer (push events via send/on) ──
  // Return value is the cleanup/unsubscribe function.

  /** Subscribe to initial file data after opening. */
  onFileData: (cb: (data: ParsedFileData) => void) => () => void;

  /** Subscribe to incremental updates from live-tail. */
  onNewEvents: (cb: (update: IncrementalUpdate) => void) => () => void;
}
