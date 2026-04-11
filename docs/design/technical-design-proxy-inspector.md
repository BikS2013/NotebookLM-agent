# Technical Design: Proxy Inspector (Electron NDJSON Log Viewer)

**Date**: 2026-04-11
**Status**: Ready for implementation
**Dependencies**: plan-007-proxy-inspector.md, investigation-proxy-inspector.md, electron-vite-ipc.md, fs-watch-react-window.md

---

## Table of Contents

1. [Directory Structure](#1-directory-structure)
2. [Main Process Modules](#2-main-process-modules)
3. [Shared Types](#3-shared-types)
4. [Preload Bridge](#4-preload-bridge)
5. [Renderer Components](#5-renderer-components)
6. [Data Flow](#6-data-flow)
7. [Implementation Units](#7-implementation-units)

---

## 1. Directory Structure

```
proxy-inspector/
├── package.json                            # Independent deps: electron, react, react-window, electron-vite
├── electron.vite.config.ts                 # Three-section Vite config with path aliases
├── tsconfig.json                           # References tsconfig.node.json + tsconfig.web.json
├── tsconfig.node.json                      # Node targets (main + preload), path aliases
├── tsconfig.web.json                       # Browser targets (renderer), path aliases
├── .gitignore                              # out/, node_modules/, dist/
│
├── src/
│   ├── main/                               # ── Electron Main Process ──
│   │   ├── index.ts                        # BrowserWindow setup, menu, window state, drag-drop
│   │   ├── file-manager.ts                 # Open dialog, recent files, drag-drop resolution
│   │   ├── ndjson-parser.ts                # Line parser with remainder buffer, JSON.parse per line
│   │   ├── file-tailer.ts                  # fs.watch + byte-offset incremental read, 500ms debounce
│   │   ├── interaction-store.ts            # In-memory Map<interactionId, EventEntry[]>, summary derivation
│   │   └── ipc-handlers.ts                 # Registers all ipcMain.handle handlers, push via webContents.send
│   │
│   ├── preload/                            # ── Preload Bridge ──
│   │   └── index.ts                        # contextBridge.exposeInMainWorld('api', { ... })
│   │
│   ├── shared/                             # ── Types Shared Across All Processes ──
│   │   ├── types.ts                        # InteractionSummary, EventEntry, DetailPayload, FileMetadata, etc.
│   │   ├── ipc-types.ts                    # ProxyInspectorAPI interface (preload contract)
│   │   └── ipc-channels.ts                 # IPC channel name constants (as const object)
│   │
│   └── renderer/                           # ── React Renderer ──
│       ├── index.html                      # Vite entry HTML
│       └── src/
│           ├── main.tsx                    # React root: createRoot + render <App />
│           ├── App.tsx                     # Root component: layout, IPC subscriptions, selection state
│           ├── App.css                     # Global dark theme, CSS custom properties, grid layout
│           ├── env.d.ts                    # Window.api type declaration (augments global Window)
│           │
│           ├── components/
│           │   ├── StatusBar.tsx           # File path, session ID, creation date, aggregate stats
│           │   ├── Toolbar.tsx             # File open button, recent files, watch indicator, pause/resume
│           │   ├── SplitPane.tsx           # Resizable two-panel layout with draggable divider
│           │   ├── SearchFilter.tsx        # Text search input + filter checkboxes
│           │   │
│           │   ├── InteractionList.tsx     # react-window v2 List, keyboard nav container
│           │   ├── InteractionCard.tsx     # Single list item: index, message, time, badges, status
│           │   │
│           │   ├── DetailPanel.tsx         # Container: event timeline + expanded payload + Raw JSON toggle
│           │   ├── EventTimeline.tsx       # Vertical timeline of events within an interaction
│           │   ├── EventCard.tsx           # Single event: type badge, relative timestamp, RT number, duration
│           │   │
│           │   ├── payloads/
│           │   │   ├── InteractionStartView.tsx    # Chat-bubble user message, session ID
│           │   │   ├── LlmRequestView.tsx          # Model, contents, system instruction, tool declarations
│           │   │   ├── LlmResponseView.tsx         # Response text, function calls, token usage, streaming info
│           │   │   ├── ToolCallView.tsx             # Tool name, function call ID, args JSON (tool_start)
│           │   │   ├── ToolResultView.tsx           # Tool name, duration, result keys (tool_result)
│           │   │   ├── ToolErrorView.tsx            # Tool name, error message (tool_error)
│           │   │   ├── LlmErrorView.tsx             # Error code, error message (llm_error)
│           │   │   ├── InteractionEndView.tsx       # Summary: RT count, token totals, duration, tool calls
│           │   │   └── TokenSummary.tsx             # Prompt/completion/total token badge
│           │   │
│           │   ├── JsonViewer.tsx          # Collapsible JSON tree with syntax highlighting
│           │   └── CollapsibleSection.tsx  # Reusable accordion: chevron toggle, title, children
│           │
│           ├── hooks/
│           │   ├── useFileData.ts          # IPC listener: ParsedFileData state, merges incremental updates
│           │   ├── useLiveTail.ts          # Auto-scroll logic, bottom detection, "new events" badge
│           │   ├── useListKeyboardNav.ts   # Arrow key/Home/End navigation with scrollToRow
│           │   ├── usePayload.ts           # On-demand payload fetch via api.getInteractionDetail(id)
│           │   └── useFilter.ts            # Search text, hasToolCalls, hasErrors, minTokens state
│           │
│           └── styles/
│               └── theme.css              # CSS custom properties for dark theme colors, fonts, spacing
│
└── out/                                    # ── Build Output (electron-vite default) ──
    ├── main/index.js                       # Bundled main process (CJS)
    ├── preload/index.js                    # Bundled preload (CJS)
    └── renderer/
        ├── index.html
        └── assets/
```

### Path Alias Configuration

In `electron.vite.config.ts`:

```typescript
import { defineConfig } from 'electron-vite'
import { resolve } from 'path'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    resolve: {
      alias: {
        '@proxy-types': resolve(__dirname, '../notebooklm_agent/proxy/proxy-types.ts'),
        '@shared': resolve(__dirname, 'src/shared')
      }
    }
  },
  preload: {
    resolve: {
      alias: {
        '@proxy-types': resolve(__dirname, '../notebooklm_agent/proxy/proxy-types.ts'),
        '@shared': resolve(__dirname, 'src/shared')
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@proxy-types': resolve(__dirname, '../notebooklm_agent/proxy/proxy-types.ts'),
        '@shared': resolve(__dirname, 'src/shared'),
        '@renderer': resolve(__dirname, 'src/renderer/src')
      }
    },
    plugins: [react()]
  }
})
```

Both `tsconfig.node.json` and `tsconfig.web.json` mirror these aliases in their `compilerOptions.paths`.

---

## 2. Main Process Modules

### 2.1 `file-manager.ts` — File Selection and Recent Files

**Responsibility**: Native file-open dialog, recent files persistence, drag-drop path resolution, filename parsing.

```typescript
// ── Public API ──

export interface FileManagerOptions {
  mainWindow: BrowserWindow;
}

export interface FileInfo {
  filePath: string;
  sessionId: string;       // extracted from filename: proxy-<sessionId>-<timestamp>.ndjson
  createdAt: string;       // ISO-8601 extracted from filename
  fileSize: number;        // bytes from fs.statSync
}

export function createFileManager(opts: FileManagerOptions): {
  openFileDialog: () => Promise<FileInfo | undefined>;
  openFilePath: (filePath: string) => Promise<FileInfo>;
  getRecentFiles: () => string[];
  addRecentFile: (filePath: string) => void;
  parseFilename: (filePath: string) => { sessionId: string; createdAt: string };
};
```

**Implementation details**:

- **Open dialog**: Calls `dialog.showOpenDialog()` with filter `[{ name: 'NDJSON Logs', extensions: ['ndjson', 'jsonl'] }]` and `properties: ['openFile']`.
- **Filename parsing**: Regex `proxy-([a-f0-9-]+)-(\d{4}-\d{2}-\d{2}T[\d-]+)\.ndjson` extracts `sessionId` and `createdAt` from the filename convention `proxy-<uuid>-<ISO-timestamp>.ndjson`.
- **Recent files**: Persisted to `~/.proxy-inspector/recent.json` as a JSON array of strings (last 10 paths). Uses `fs.mkdirSync(dir, { recursive: true })` on first write. On read, filters out paths that no longer exist on disk.
- **Drag-drop**: The main process registers a `will-navigate` handler that intercepts file drops. On macOS Electron, dropped files arrive as `file://` URLs via the `will-navigate` event. The handler converts the URL to a path, validates the `.ndjson` extension, and calls `openFilePath`.

**Error handling**: If the file does not exist or stat fails, throws an Error with the path. The IPC handler catches and returns a structured error result `{ ok: false, error: string }`.

### 2.2 `ndjson-parser.ts` — Line Parser with Remainder Buffer

**Responsibility**: Splits raw text chunks into complete NDJSON lines, holds partial lines in a remainder buffer, validates each line as JSON conforming to the LogEntry shape.

```typescript
import type { LogEntry, ProxyEventType } from '@proxy-types';

// ── Public API ──

export interface NdjsonParser {
  /** Push a raw text chunk. Returns an array of successfully parsed LogEntry objects. */
  push(rawChunk: string): LogEntry[];

  /** Flush any remaining partial line. Returns 0 or 1 LogEntry. */
  flush(): LogEntry[];

  /** Reset internal state (remainder buffer). */
  reset(): void;
}

export function createNdjsonParser(): NdjsonParser;
```

**Implementation details**:

- **Line splitting**: `combined = remainder + rawChunk`, split by `'\n'`. Last element saved as new remainder. Empty lines (after trim) are skipped.
- **JSON parsing**: Each non-empty line is wrapped in `try/catch` around `JSON.parse()`. Malformed lines are logged to `console.warn` and skipped.
- **Shape validation**: After parsing, the function checks that `entry.event` is one of the 8 valid `ProxyEventType` values and that `entry.interactionId` is a non-empty string. Entries failing validation are skipped with a warning.

**Valid event types** (from `proxy-types.ts`):
```typescript
const VALID_EVENTS: Set<string> = new Set([
  'interaction_start', 'llm_request', 'llm_response',
  'tool_start', 'tool_result', 'tool_error',
  'llm_error', 'interaction_end'
]);
```

- **Remainder buffer**: Critical for incremental tailing. When `fs.read` delivers a chunk that ends mid-line, the incomplete final segment is held until the next chunk arrives.
- **`flush()`**: Called when the watcher stops or the file is closed. If the remainder is non-empty, attempts to parse it as a final entry.
- **`reset()`**: Clears the remainder. Called when opening a new file.

### 2.3 `file-tailer.ts` — fs.watch with Byte-Offset Incremental Read

**Responsibility**: Watches a file for appended content using `fs.watch`, reads only new bytes from the last known offset, and delivers raw text chunks to a callback.

```typescript
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
): FileTailer;
```

**Implementation details**:

#### Event-type agnostic handler (macOS constraint)

On macOS, `fs.watch` always fires with `eventType === 'rename'` regardless of whether the file was appended to, renamed, or deleted (Node.js issue #7420). The handler ignores `eventType` entirely:

```typescript
function onWatchEvent(_eventType: string, _filename: string | null): void {
  if (paused) return;
  if (debounceTimer !== null) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(readNewBytes, 500);
}
```

#### 500ms debounce

The proxy flushes its buffer every 500ms. macOS kqueue can fire multiple events per write (`NOTE_EXTEND` + `NOTE_WRITE`). The 500ms debounce collapses burst events into a single read operation.

#### False positive guard

```typescript
function readNewBytes(): void {
  const stat = fs.statSync(filePath);
  if (stat.size <= bytesRead) return;  // No new bytes; false positive
  // ...
}
```

#### Byte-offset read using `fs.readSync` with position

```typescript
const chunkSize = stat.size - bytesRead;
const buffer = Buffer.allocUnsafe(chunkSize);
const fd = fs.openSync(filePath, 'r');
try {
  const actual = fs.readSync(fd, buffer, 0, chunkSize, bytesRead);
  bytesRead += actual;
  if (actual > 0) {
    callbacks.onNewChunk(buffer.subarray(0, actual).toString('utf8'));
  }
} finally {
  fs.closeSync(fd);
}
```

The file descriptor is opened, read, and closed in a single synchronous unit. No persistent fd is held open.

#### Rotation detection

If `stat.size < bytesRead` (file shrank), the byte offset is reset to 0. This handles the edge case where the file is replaced by a smaller one. For the proxy-inspector's stated use case (append-only files), this is purely defensive.

#### Watcher options

```typescript
watcher = fs.watch(filePath, { persistent: false }, onWatchEvent);
```

`persistent: false` ensures the watcher does not prevent the Electron process from exiting.

### 2.4 `interaction-store.ts` — In-Memory Event Store and Summary Derivation

**Responsibility**: Groups `LogEntry` objects by `interactionId`, derives `InteractionSummary` from the group, serves full event lists on demand.

```typescript
import type { LogEntry } from '@proxy-types';
import type { InteractionSummary, EventEntry, DetailPayload, AggregateStats } from '@shared/types';

// ── Public API ──

export interface InteractionStore {
  /** Add one or more parsed LogEntry objects. Returns updated/new InteractionSummary[]. */
  addEntries(entries: LogEntry[]): InteractionSummary[];

  /** Get all interaction summaries sorted by first event timestamp. */
  getAllSummaries(): InteractionSummary[];

  /** Get full detail for a specific interaction. */
  getDetail(interactionId: string): DetailPayload | undefined;

  /** Get aggregate statistics across all interactions. */
  getAggregates(): AggregateStats;

  /** Search interactions by user message substring. */
  search(query: string): InteractionSummary[];

  /** Reset the store (for opening a new file). */
  clear(): void;

  /** Total number of interactions. */
  readonly size: number;
}

export function createInteractionStore(): InteractionStore;
```

**Internal data structures**:

```typescript
// Internal storage
const interactions = new Map<string, EventEntry[]>();    // interactionId -> events
const summaryCache = new Map<string, InteractionSummary>(); // interactionId -> summary
const insertionOrder: string[] = [];                      // ordered list of interactionIds
let nextIndex = 1;                                        // 1-based sequential numbering
```

**Summary derivation** (`deriveSummary`):

For a given `EventEntry[]` group, the summary is derived as follows:

```typescript
function deriveSummary(id: string, index: number, events: EventEntry[]): InteractionSummary {
  const startEvent = events.find(e => e.event === 'interaction_start');
  const endEvent = events.find(e => e.event === 'interaction_end');
  const hasErrors = events.some(e =>
    e.event === 'llm_error' || e.event === 'tool_error'
  );

  const userMessage = startEvent?.payload?.userMessage as string ?? '';
  const status: InteractionStatus =
    hasErrors ? 'error' :
    endEvent ? 'complete' : 'in-progress';

  return {
    id,
    index,
    userMessage: userMessage.slice(0, 100),
    timestamp: startEvent?.timestamp ?? events[0].timestamp,
    status,
    durationMs: (endEvent?.payload?.durationMs as number) ?? null,
    roundTripCount: (endEvent?.payload?.roundTripCount as number) ??
      Math.max(...events.filter(e => e.roundTrip != null).map(e => e.roundTrip!), 0),
    totalPromptTokens: (endEvent?.payload?.totalPromptTokens as number) ?? 0,
    totalCompletionTokens: (endEvent?.payload?.totalCompletionTokens as number) ?? 0,
    totalTokens: (endEvent?.payload?.totalTokens as number) ?? 0,
    toolCalls: (endEvent?.payload?.toolCalls as string[]) ?? [],
    hasErrors,
    eventCount: events.length,
  };
}
```

**`addEntries` behavior**:

1. For each `LogEntry`, wrap it as an `EventEntry` (adds a sequential `lineIndex` for ordering).
2. Append to the `Map` entry for the `interactionId`. If this is a new interaction, add to `insertionOrder` and assign the next index.
3. Re-derive the `InteractionSummary` for each affected interaction.
4. Return only the summaries that were created or updated (for incremental IPC push).

**`getDetail` behavior**:

Returns a `DetailPayload` object containing the full `EventEntry[]` array plus the `InteractionSummary` metadata. Events are returned in order of their `lineIndex` (insertion order).

**`search` behavior**:

Case-insensitive substring match on `InteractionSummary.userMessage`. Returns matching summaries in insertion order.

### 2.5 `ipc-handlers.ts` — IPC Handler Registration

**Responsibility**: Registers all `ipcMain.handle` handlers and provides helper functions for push events. Single point of IPC wiring.

```typescript
import type { BrowserWindow } from 'electron';
import type { InteractionStore } from './interaction-store';
import type { FileManager } from './file-manager';
import type { FileTailer } from './file-tailer';
import type { NdjsonParser } from './ndjson-parser';
import { IPC } from '@shared/ipc-channels';

export function registerIpcHandlers(deps: {
  mainWindow: BrowserWindow;
  store: InteractionStore;
  fileManager: FileManager;
  createTailerAndParser: (filePath: string) => { tailer: FileTailer; parser: NdjsonParser };
}): void;
```

**IPC Channel Map**:

| Channel | Direction | Pattern | Handler Logic |
|---------|-----------|---------|---------------|
| `IPC.OPEN_FILE` | Renderer -> Main | invoke/handle | Call `fileManager.openFileDialog()`. If file selected: reset store, read full file, parse all lines via `ndjsonParser.push()`, add to store, start tailer, return `ParsedFileData`. |
| `IPC.OPEN_RECENT` | Renderer -> Main | invoke/handle | Call `fileManager.openFilePath(path)`. Same as OPEN_FILE but skips dialog. |
| `IPC.GET_INTERACTION_DETAIL` | Renderer -> Main | invoke/handle | Call `store.getDetail(interactionId)`. Return `DetailPayload` or `{ ok: false, error }`. |
| `IPC.SEARCH` | Renderer -> Main | invoke/handle | Call `store.search(query)`. Return `InteractionSummary[]`. |
| `IPC.PAUSE_WATCH` | Renderer -> Main | invoke/handle | Call `tailer.pause()` or `tailer.resume()`. |
| `IPC.GET_RECENT_FILES` | Renderer -> Main | invoke/handle | Call `fileManager.getRecentFiles()`. Return `string[]`. |
| `IPC.FILE_DATA` | Main -> Renderer | webContents.send | Pushed after initial file parse. Contains full `ParsedFileData`. |
| `IPC.NEW_EVENTS` | Main -> Renderer | webContents.send | Pushed on each debounced tailer tick. Contains `IncrementalUpdate`. |

**Full file parse flow** (inside OPEN_FILE handler):

```typescript
async function handleOpenFile(): Promise<ParsedFileData | undefined> {
  const fileInfo = await fileManager.openFileDialog();
  if (!fileInfo) return undefined;

  // Stop any existing tailer
  currentTailer?.stop();
  store.clear();
  parser.reset();

  // Read full file content
  const content = fs.readFileSync(fileInfo.filePath, 'utf8');
  const entries = parser.push(content);
  entries.push(...parser.flush());
  const updatedSummaries = store.addEntries(entries);

  // Start tailer from current file size
  const { tailer, parser: tailParser } = createTailerAndParser(fileInfo.filePath);
  currentTailer = tailer;
  currentParser = tailParser;

  tailer.start(Buffer.byteLength(content, 'utf8'));

  // Build response
  const result: ParsedFileData = {
    metadata: {
      filePath: fileInfo.filePath,
      sessionId: fileInfo.sessionId,
      createdAt: fileInfo.createdAt,
      fileSize: fileInfo.fileSize,
    },
    interactions: store.getAllSummaries(),
    aggregates: store.getAggregates(),
  };

  fileManager.addRecentFile(fileInfo.filePath);
  return result;
}
```

**Incremental tail flow** (wired in `createTailerAndParser`):

```typescript
function createTailerAndParser(filePath: string) {
  const parser = createNdjsonParser();
  const tailer = createFileTailer(filePath, {
    onNewChunk(rawChunk: string) {
      const entries = parser.push(rawChunk);
      if (entries.length === 0) return;

      const updatedSummaries = store.addEntries(entries);
      if (updatedSummaries.length > 0 && mainWindow && !mainWindow.isDestroyed()) {
        const update: IncrementalUpdate = {
          interactions: updatedSummaries,
          aggregates: store.getAggregates(),
        };
        mainWindow.webContents.send(IPC.NEW_EVENTS, update);
      }
    },
    onError(err: Error) {
      console.error('[file-tailer] Error:', err.message);
    },
  });
  return { tailer, parser };
}
```

**Structured error pattern**: All invoke handlers use the `{ ok: true, data } | { ok: false, error }` pattern to preserve error context across IPC (since `ipcMain.handle` error serialization loses stack traces):

```typescript
ipcMain.handle(IPC.GET_INTERACTION_DETAIL, async (_event, interactionId: string) => {
  const detail = store.getDetail(interactionId);
  if (!detail) return { ok: false, error: `Interaction not found: ${interactionId}` };
  return { ok: true, data: detail };
});
```

### 2.6 `index.ts` — Main Process Entry Point

**Responsibility**: Creates the BrowserWindow, wires all modules together, sets up the application menu, handles window state persistence, registers drag-drop handlers.

**BrowserWindow configuration**:

```typescript
const win = new BrowserWindow({
  width: 1200,
  height: 800,
  minWidth: 800,
  minHeight: 500,
  webPreferences: {
    preload: join(__dirname, '../preload/index.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  },
  titleBarStyle: 'hiddenInset',        // macOS: integrated title bar
  backgroundColor: '#1e1e2e',           // Dark theme background (prevents flash)
});
```

**Window state persistence**: Position and size saved to `~/.proxy-inspector/window-state.json` on `close` event. Restored on next launch. Uses `screen.getDisplayMatching()` to validate the saved position is still on a connected display.

**Application menu** (macOS):

```
App: About, Separator, Quit (Cmd+Q)
File: Open File (Cmd+O), Open Recent (submenu), Separator, Close Window (Cmd+W)
Edit: Copy (Cmd+C), Select All (Cmd+A)
View: Toggle DevTools (Opt+Cmd+I), Separator, Reload (Cmd+R)
Window: Minimize (Cmd+M), Zoom
```

**Drag-and-drop**: Registers `webContents.on('will-navigate', handler)` to intercept file:// navigations from drag-drop. Validates `.ndjson` extension before processing.

---

## 3. Shared Types

All types live in `src/shared/` and are importable from all three processes via the `@shared` path alias.

### 3.1 `types.ts` — Domain Types

```typescript
import type { LogEntry, ProxyEventType } from '@proxy-types';

// ── Interaction status ──

export type InteractionStatus = 'complete' | 'in-progress' | 'error';

// ── EventEntry: parsed LogEntry with ordering index ──

export interface EventEntry extends LogEntry {
  /** Sequential line index within the file (0-based) for stable ordering. */
  lineIndex: number;
}

// ── InteractionSummary: lightweight data for list items ──

export interface InteractionSummary {
  /** interactionId (from LogEntry). */
  id: string;

  /** 1-based sequential number in the file. */
  index: number;

  /** User message from interaction_start payload (first 100 chars). */
  userMessage: string;

  /** ISO-8601 timestamp from interaction_start. */
  timestamp: string;

  /** Interaction status: complete, in-progress, or error. */
  status: InteractionStatus;

  /** Total duration in ms from interaction_end (null if in-progress). */
  durationMs: number | null;

  /** Number of LLM round trips. */
  roundTripCount: number;

  /** Prompt tokens from interaction_end. */
  totalPromptTokens: number;

  /** Completion tokens from interaction_end. */
  totalCompletionTokens: number;

  /** Total tokens (prompt + completion). */
  totalTokens: number;

  /** Tool names invoked (from interaction_end.toolCalls). */
  toolCalls: string[];

  /** Whether the interaction contains llm_error or tool_error events. */
  hasErrors: boolean;

  /** Total number of events in this interaction. */
  eventCount: number;
}

// ── DetailPayload: full interaction data sent on demand ──

export interface DetailPayload {
  /** The interaction summary metadata. */
  summary: InteractionSummary;

  /** All events in this interaction, ordered by lineIndex. */
  events: EventEntry[];
}

// ── FileMetadata ──

export interface FileMetadata {
  /** Full file path. */
  filePath: string;

  /** Session ID extracted from filename. */
  sessionId: string;

  /** Creation timestamp extracted from filename. */
  createdAt: string;

  /** File size in bytes. */
  fileSize: number;
}

// ── AggregateStats ──

export interface AggregateStats {
  totalInteractions: number;
  totalTokens: number;
  totalToolCalls: number;
  timeSpanMs: number;  // first to last event timestamp
}

// ── ParsedFileData: initial load response ──

export interface ParsedFileData {
  metadata: FileMetadata;
  interactions: InteractionSummary[];
  aggregates: AggregateStats;
}

// ── IncrementalUpdate: live-tail push payload ──

export interface IncrementalUpdate {
  /** New or updated interaction summaries. */
  interactions: InteractionSummary[];

  /** Updated aggregate stats. */
  aggregates: AggregateStats;
}

// ── IPC Result wrapper ──

export type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };
```

### 3.2 `ipc-types.ts` — ProxyInspectorAPI Interface

```typescript
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
```

### 3.3 `ipc-channels.ts` — Channel Name Constants

```typescript
/**
 * IPC channel name constants. Used in both main and preload to avoid string typos.
 * Each channel is a unique string literal.
 */
export const IPC = {
  // Renderer -> Main (invoke/handle)
  OPEN_FILE:              'proxy-inspector:open-file',
  OPEN_RECENT:            'proxy-inspector:open-recent',
  GET_INTERACTION_DETAIL: 'proxy-inspector:get-interaction-detail',
  SEARCH:                 'proxy-inspector:search',
  PAUSE_WATCH:            'proxy-inspector:pause-watch',
  GET_RECENT_FILES:       'proxy-inspector:get-recent-files',

  // Main -> Renderer (send/on)
  FILE_DATA:              'proxy-inspector:file-data',
  NEW_EVENTS:             'proxy-inspector:new-events',
} as const;
```

Channel names are prefixed with `proxy-inspector:` to avoid collision with any other IPC channels if the Electron app ever grows.

---

## 4. Preload Bridge

### 4.1 `src/preload/index.ts`

```typescript
import { contextBridge, ipcRenderer } from 'electron';
import type { ProxyInspectorAPI } from '@shared/ipc-types';
import { IPC } from '@shared/ipc-channels';

const api: ProxyInspectorAPI = {
  // ── Request/response ──
  openFile: () =>
    ipcRenderer.invoke(IPC.OPEN_FILE),

  openRecent: (filePath: string) =>
    ipcRenderer.invoke(IPC.OPEN_RECENT, filePath),

  getInteractionDetail: (interactionId: string) =>
    ipcRenderer.invoke(IPC.GET_INTERACTION_DETAIL, interactionId),

  search: (query: string) =>
    ipcRenderer.invoke(IPC.SEARCH, query),

  pauseWatch: (paused: boolean) =>
    ipcRenderer.invoke(IPC.PAUSE_WATCH, paused),

  getRecentFiles: () =>
    ipcRenderer.invoke(IPC.GET_RECENT_FILES),

  // ── Push events (return cleanup functions for React useEffect) ──
  onFileData: (cb) => {
    const handler = (_e: Electron.IpcRendererEvent, data: any) => cb(data);
    ipcRenderer.on(IPC.FILE_DATA, handler);
    return () => ipcRenderer.removeListener(IPC.FILE_DATA, handler);
  },

  onNewEvents: (cb) => {
    const handler = (_e: Electron.IpcRendererEvent, update: any) => cb(update);
    ipcRenderer.on(IPC.NEW_EVENTS, handler);
    return () => ipcRenderer.removeListener(IPC.NEW_EVENTS, handler);
  },
};

contextBridge.exposeInMainWorld('api', api);
```

**Security constraints**:

- `ipcRenderer` is never exposed directly.
- Each method is a named wrapper with typed parameters.
- `contextIsolation: true` and `sandbox: true` are enforced in BrowserWindow config.
- The `api` object is type-checked against `ProxyInspectorAPI` at compile time.

### 4.2 `src/renderer/src/env.d.ts` — Window Type Augmentation

```typescript
import type { ProxyInspectorAPI } from '@shared/ipc-types';

declare global {
  interface Window {
    api: ProxyInspectorAPI;
  }
}
```

This makes `window.api.openFile()`, `window.api.onNewEvents()`, etc. fully typed in the renderer.

---

## 5. Renderer Components

### 5.1 Component Tree

```
App
├── StatusBar             (file info + aggregate stats bar at top)
├── Toolbar               (open button, recent files, watch indicator, search/filter)
└── SplitPane             (resizable two-panel layout)
    ├── InteractionList   (left panel, ~300px default)
    │   └── InteractionCard * N  (one per interaction, virtualized)
    └── DetailPanel       (right panel)
        ├── EventTimeline (vertical event sequence)
        │   └── EventCard * N  (one per event)
        └── PayloadView   (expanded payload for selected event)
            ├── InteractionStartView
            ├── LlmRequestView
            ├── LlmResponseView
            ├── ToolCallView
            ├── ToolResultView
            ├── ToolErrorView
            ├── LlmErrorView
            ├── InteractionEndView
            └── JsonViewer (Raw JSON toggle)
```

### 5.2 `App.tsx` — Root Component

**State managed**:
- `fileData: ParsedFileData | null` — from `useFileData` hook
- `selectedInteractionId: string | null` — currently selected interaction
- `searchQuery: string` — text filter
- `filters: { hasToolCalls: boolean, hasErrors: boolean, minTokens: number | null }` — from `useFilter` hook
- `watchPaused: boolean` — watcher pause state

**IPC subscriptions**: Registered in `useEffect(() => { ... return cleanup }, [])` using `window.api.onFileData` and `window.api.onNewEvents`. Both return cleanup functions called on unmount.

**Layout** (CSS Grid):
```css
.app-layout {
  display: grid;
  grid-template-rows: auto auto 1fr;  /* status-bar, toolbar, content */
  grid-template-columns: 1fr;
  height: 100vh;
  background: var(--bg-primary);
  color: var(--text-primary);
}
```

### 5.3 `InteractionList.tsx` — Virtualized List (Left Panel)

**Uses react-window v2.2.7 API**:

```tsx
import { List, useListRef, type RowComponentProps } from 'react-window';

type RowProps = {
  interactions: InteractionSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

function rowHeight(index: number, { interactions }: RowProps): number {
  const toolCount = interactions[index].toolCalls.length;
  if (toolCount === 0) return 72;
  if (toolCount <= 2) return 96;
  return 120;
}

function InteractionRow({
  index, style, interactions, selectedId, onSelect
}: RowComponentProps<RowProps>) {
  return (
    <div style={style}>
      <InteractionCard
        summary={interactions[index]}
        isSelected={interactions[index].id === selectedId}
        onSelect={onSelect}
      />
    </div>
  );
}

export function InteractionList({ interactions, selectedId, onSelect, listRef }: Props) {
  return (
    <List
      listRef={listRef}
      rowComponent={InteractionRow}
      rowCount={interactions.length}
      rowHeight={rowHeight}
      rowProps={{ interactions, selectedId, onSelect }}
      overscanCount={3}
      role="listbox"
      aria-label="Interactions"
    />
  );
}
```

**Key points**:
- `rowComponent` prop (NOT children render prop) -- v2 API.
- `rowProps` is automatically memoized by `List`.
- `useListRef` for programmatic scroll control.
- `overscanCount={3}` to reduce flash during fast keyboard navigation.
- `scrollToRow({ index, align: 'auto', behavior: 'smooth' })` for keyboard nav and live tail.

### 5.4 `InteractionCard.tsx` — List Item

Renders a single interaction summary as a compact card:

```
+----------------------------------------------+
| #2  "list my notebooks"                 [✓]  |  <- index, message (100 chars), status icon
| 07:00:02  19.1s  20.8K tokens                |  <- local time, duration, tokens
| [list_notebooks]                              |  <- tool badges (only if toolCalls.length > 0)
+----------------------------------------------+
```

**Status icons**:
- `complete`: green checkmark
- `in-progress`: yellow animated spinner (CSS animation)
- `error`: red X

**Error styling**: Interactions with `hasErrors === true` get a `border-left: 3px solid var(--error)` accent.

**Selection**: `aria-selected` attribute and a highlight background color.

### 5.5 `DetailPanel.tsx` — Right Panel Container

**Behavior**:
1. When an interaction is selected, calls `window.api.getInteractionDetail(id)` via the `usePayload` hook.
2. Caches the result in component state (keyed by interactionId) to avoid re-fetching on re-selection.
3. Renders `EventTimeline` with the full event list.
4. Tracks which event is expanded (one at a time, or multiple via accordion).

**Empty state**: When no interaction is selected, displays a centered placeholder: "Select an interaction to view details".

### 5.6 `EventTimeline.tsx` — Vertical Event Sequence

Renders events as a vertical timeline with connecting lines. Each event shows:

```
●──[LLM REQ]  +5ms   RT1
│
●──[LLM RES]  +929ms RT1  929ms
│
●──[TOOL]     +930ms RT1  list_notebooks
│
●──[RESULT]   +2081ms RT1  list_notebooks  1150ms
│
●──[LLM REQ]  +2082ms RT2
│
●──[LLM RES]  +19063ms RT2  16981ms
│
●──[END]      +19068ms  2 RTs  20773 tokens  19.1s
```

**Relative timestamps**: Calculated as `event.timestamp - firstEvent.timestamp` in milliseconds.

**Event type color scheme**:

| Event | CSS Variable | Color | Badge Text |
|-------|-------------|-------|------------|
| `interaction_start` | `--event-start` | `#6c7086` (gray) | START |
| `llm_request` | `--event-llm-req` | `#89b4fa` (blue) | LLM REQ |
| `llm_response` | `--event-llm-res` | `#a6e3a1` (green) | LLM RES |
| `tool_start` | `--event-tool` | `#fab387` (orange) | TOOL |
| `tool_result` | `--event-result` | `#94e2d5` (teal) | RESULT |
| `tool_error` | `--event-error` | `#f38ba8` (red) | TOOL ERR |
| `llm_error` | `--event-error` | `#f38ba8` (red) | LLM ERR |
| `interaction_end` | `--event-end` | `#6c7086` (gray) | END |

**Clicking an event**: Expands the payload detail below the event card (inline accordion). Shows the appropriate payload renderer based on `event.event` type.

**Event type filter**: Optional checkboxes to show/hide specific event types (FR-7.3). Controlled by `DetailPanel`.

### 5.7 Payload Renderers

Each payload renderer is a dedicated component that knows how to display one event type's payload. All share a common pattern:

```tsx
interface PayloadViewProps {
  event: EventEntry;
  showRawJson: boolean;
}
```

When `showRawJson` is true, the component renders a `JsonViewer` with the full `event.payload` object. Otherwise, it renders the structured view.

#### `LlmRequestView.tsx` (FR-5.2)

The most complex renderer. Displays:

- **Model name** (prominent, non-collapsible): `event.payload.model`
- **Contents count**: `event.payload.contentsCount` with a CollapsibleSection containing the conversation history. Each content item renders as a mini chat bubble showing `role` and `text`/`functionCall`/`functionResponse`.
- **System instruction** (CollapsibleSection, monospaced, default collapsed): `event.payload.systemInstructionText` (can be very long -- 3000+ chars observed in sample data).
- **Tool names** (non-collapsible chip/tag list): `event.payload.toolNames` as small badges.
- **Tool declarations** (CollapsibleSection, default collapsed, only on first RT): `event.payload.toolDeclarations` rendered via `JsonViewer`.
- **Generation config** (CollapsibleSection, if present): `event.payload.generationConfig` via `JsonViewer`.

#### `LlmResponseView.tsx` (FR-5.3)

Displays:

- **Response text**: Extracted from `event.payload.content`. Handles two formats:
  - Structured: `{ role: "model", parts: [{ text: "..." }] }` -- extracts and renders text.
  - Structured with function call: `{ role: "model", parts: [{ functionCall: { name, args } }] }` -- renders tool name prominently + args as JSON.
- **Token usage** (`TokenSummary` component): `event.payload.usageMetadata` -- prompt / completion / total as three badges.
- **Duration**: `event.payload.durationMs` formatted.
- **Streaming info**: `streamed: true/false`, `chunkCount`, `finishReason`.

#### `ToolCallView.tsx` (FR-5.4 -- tool_start)

- Tool name (prominent, colored badge).
- Function call ID (monospaced, smaller text).
- Args as formatted JSON via `JsonViewer`.

#### `ToolResultView.tsx` (FR-5.5)

- Tool name, duration formatted.
- Result keys as a bullet list (full result is not logged, only `resultKeys`).

#### `ToolErrorView.tsx` / `LlmErrorView.tsx` (FR-5.6, FR-5.7)

- Red error styling (`background: var(--error-bg)`).
- Error message or `errorCode` + `errorMessage`.

#### `InteractionEndView.tsx` (FR-5.8)

- Summary: round trip count, token totals (prompt/completion/total), total duration, tool calls as badges.

### 5.8 `JsonViewer.tsx` — Collapsible JSON Tree

A custom component (not an external library) that renders a JSON object as a collapsible tree with syntax highlighting.

**Features**:
- Top-level keys are collapsible nodes.
- Primitive values (string, number, boolean, null) are leaf nodes with type-based coloring.
- Arrays show `[N items]` when collapsed; expand to show indexed children.
- Objects show `{N keys}` when collapsed.
- String values longer than 200 chars are truncated with a "show more" toggle.
- Monospaced font (`var(--font-mono)`).
- Copy-to-clipboard button on the root node.

**Why custom**: External JSON viewer libraries (react-json-tree, react-json-view) add 15-50KB of dependencies and are styled for light themes. A custom component of ~150 lines provides exactly the needed functionality with the dark theme.

### 5.9 `CollapsibleSection.tsx` — Reusable Accordion

```tsx
interface CollapsibleSectionProps {
  title: string;
  defaultOpen?: boolean;
  badge?: string;         // optional count badge (e.g., "52 tools")
  children: React.ReactNode;
}
```

Renders a header with a chevron toggle (right-pointing when collapsed, down-pointing when expanded) and conditionally renders children. CSS transition on `max-height` for smooth expand/collapse animation.

### 5.10 Hooks

#### `useFileData.ts`

```typescript
export function useFileData(): {
  fileData: ParsedFileData | null;
  interactions: InteractionSummary[];  // filtered + sorted
  aggregates: AggregateStats | null;
  isLoading: boolean;
} {
  // Subscribes to onFileData and onNewEvents
  // Merges incremental updates into state
  // Returns all data needed by App
}
```

**Merge logic**: When `onNewEvents` fires with an `IncrementalUpdate`, the hook merges updated summaries by `id` (Map-based overwrite for existing, append for new). This handles both new interactions and updates to in-progress interactions.

#### `useLiveTail.ts`

```typescript
export function useLiveTail(opts: {
  itemCount: number;
  listRef: ReturnType<typeof useListRef<null>>;
}): {
  isAtBottom: boolean;
  hasNewEvents: boolean;    // true when new events arrived while scrolled away
  scrollToTail: () => void;
}
```

**Bottom detection**: Uses `onRowsRendered` callback from react-window v2. If `visibleRows.stopIndex >= itemCount - 1`, the user is at the bottom. When new events arrive and `isAtBottom` is true, auto-scrolls via `listRef.current?.scrollToRow({ index: itemCount - 1, align: 'end', behavior: 'smooth' })`.

**"New events" badge**: When `isAtBottom` is false and new events arrive, sets `hasNewEvents = true`. Cleared when the user scrolls to bottom or clicks the badge.

#### `useListKeyboardNav.ts`

Handles `ArrowDown`, `ArrowUp`, `Home`, `End`, `Enter`, `Escape` on a `tabIndex={0}` container div. Calls `scrollToRow({ index, align: 'auto', behavior: 'smooth' })` after each navigation.

#### `usePayload.ts`

```typescript
export function usePayload(): {
  loadPayload: (interactionId: string) => Promise<void>;
  payload: DetailPayload | null;
  isLoading: boolean;
  error: string | null;
}
```

Caches fetched payloads in a `Map<string, DetailPayload>`. On subsequent requests for the same interaction, returns from cache. Calls `window.api.getInteractionDetail(id)`.

#### `useFilter.ts`

```typescript
export function useFilter(interactions: InteractionSummary[]): {
  filtered: InteractionSummary[];
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  filters: FilterState;
  setFilters: (f: Partial<FilterState>) => void;
}

interface FilterState {
  hasToolCalls: boolean;
  hasErrors: boolean;
  minTokens: number | null;
}
```

Applies filters in order: text search (case-insensitive substring on `userMessage`), then boolean/numeric filters. Returns the filtered list. Filtering is done in the renderer from the summaries already in memory.

### 5.11 CSS Theme (`theme.css`)

```css
:root {
  /* ── Background ── */
  --bg-primary: #1e1e2e;
  --bg-secondary: #313244;
  --bg-surface: #45475a;
  --bg-hover: #585b70;

  /* ── Text ── */
  --text-primary: #cdd6f4;
  --text-secondary: #a6adc8;
  --text-dim: #6c7086;

  /* ── Accent ── */
  --accent-blue: #89b4fa;
  --accent-green: #a6e3a1;
  --accent-orange: #fab387;
  --accent-teal: #94e2d5;
  --accent-mauve: #cba6f7;

  /* ── Status ── */
  --success: #a6e3a1;
  --warning: #f9e2af;
  --error: #f38ba8;
  --error-bg: rgba(243, 139, 168, 0.1);

  /* ── Event type colors ── */
  --event-start: #6c7086;
  --event-llm-req: #89b4fa;
  --event-llm-res: #a6e3a1;
  --event-tool: #fab387;
  --event-result: #94e2d5;
  --event-error: #f38ba8;
  --event-end: #6c7086;

  /* ── Fonts ── */
  --font-mono: 'SF Mono', 'Menlo', 'Monaco', 'Courier New', monospace;
  --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;

  /* ── Spacing ── */
  --spacing-xs: 4px;
  --spacing-sm: 8px;
  --spacing-md: 12px;
  --spacing-lg: 16px;
  --spacing-xl: 24px;

  /* ── Border ── */
  --border-color: #45475a;
  --border-radius: 6px;
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: var(--font-sans);
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 13px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  user-select: none;
  overflow: hidden;
}

/* JSON/code content is selectable */
pre, code, .selectable {
  user-select: text;
}

/* Scrollbar styling */
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
::-webkit-scrollbar-track {
  background: var(--bg-primary);
}
::-webkit-scrollbar-thumb {
  background: var(--bg-surface);
  border-radius: 4px;
}
::-webkit-scrollbar-thumb:hover {
  background: var(--bg-hover);
}
```

The theme is based on Catppuccin Mocha colors -- a widely used dark theme palette that provides excellent contrast ratios (WCAG AA compliant).

---

## 6. Data Flow

### 6.1 File Open Flow

```
User clicks "Open File" in Toolbar
  |
  v
Renderer: window.api.openFile()
  |
  v  (ipcRenderer.invoke)
Main: ipcMain.handle(IPC.OPEN_FILE)
  |
  ├── dialog.showOpenDialog({ filters: [.ndjson] })
  │     User selects file → filePath
  |
  ├── fileManager.parseFilename(filePath) → sessionId, createdAt
  ├── fs.readFileSync(filePath, 'utf8') → rawContent
  ├── ndjsonParser.push(rawContent) → LogEntry[]
  ├── ndjsonParser.flush() → remaining LogEntry[]
  ├── store.clear()
  ├── store.addEntries(allEntries) → InteractionSummary[]
  |
  ├── fileTailer.start(Buffer.byteLength(rawContent))
  │     (starts fs.watch from end of current content)
  |
  ├── fileManager.addRecentFile(filePath)
  |
  └── return ParsedFileData {
        metadata: { filePath, sessionId, createdAt, fileSize },
        interactions: InteractionSummary[],
        aggregates: { totalInteractions, totalTokens, totalToolCalls, timeSpanMs }
      }
  |
  v  (IPC response via invoke/handle)
Renderer: receives ParsedFileData
  |
  ├── setFileData(result.data)
  ├── InteractionList renders with summaries
  └── StatusBar renders with metadata + aggregates
```

### 6.2 Live Tail Flow

```
Proxy appends NDJSON lines to log file
  |
  v
macOS kqueue fires NOTE_EXTEND + NOTE_WRITE
  |
  v
fs.watch callback(_eventType, _filename)      ← eventType ignored (macOS: always 'rename')
  |
  v
Debounce timer reset to 500ms
  |
  v  (after 500ms)
fileTailer.readNewBytes()
  |
  ├── fs.statSync(filePath) → stat
  ├── Guard: stat.size <= bytesRead → return (false positive)
  |
  ├── fs.openSync + fs.readSync(fd, buffer, 0, chunkSize, bytesRead) → rawChunk
  ├── bytesRead += actualBytesRead
  ├── fs.closeSync(fd)
  |
  └── callbacks.onNewChunk(rawChunk)
        |
        v
      ndjsonParser.push(rawChunk) → LogEntry[]
        |
        v
      store.addEntries(entries) → updatedSummaries
        |
        v
      mainWindow.webContents.send(IPC.NEW_EVENTS, {
        interactions: updatedSummaries,
        aggregates: store.getAggregates()
      })
        |
        v  (IPC push)
      Renderer: onNewEvents callback
        |
        ├── Merge updated summaries into state (Map-based overwrite)
        ├── Update aggregates
        ├── If isAtBottom → auto-scroll to last item
        └── If NOT isAtBottom → show "New events" badge
```

### 6.3 Detail Selection Flow

```
User clicks InteractionCard in list
  |
  v
Renderer: setSelectedInteractionId(id)
  |
  v
DetailPanel: usePayload hook checks cache
  |
  ├── Cache hit → render from cache
  |
  └── Cache miss:
        window.api.getInteractionDetail(id)
          |
          v  (ipcRenderer.invoke)
        Main: ipcMain.handle(IPC.GET_INTERACTION_DETAIL)
          |
          ├── store.getDetail(interactionId) → DetailPayload
          └── return { ok: true, data: DetailPayload }
          |
          v  (IPC response)
        Renderer: cache payload, render EventTimeline
          |
          └── User clicks event → expand payload inline
                |
                └── Render appropriate PayloadView component based on event.event
```

### 6.4 Search Flow

```
User types in search field
  |
  v
Renderer: useFilter hook applies filters client-side
  |
  ├── Filter interactions by searchQuery (case-insensitive substring on userMessage)
  ├── Filter by hasToolCalls checkbox
  ├── Filter by hasErrors checkbox
  ├── Filter by minTokens threshold
  |
  └── Return filtered InteractionSummary[]
        |
        v
      InteractionList re-renders with filtered list
```

Search is performed entirely in the renderer from the summaries already in state. No IPC round-trip is needed because summaries contain the `userMessage` field used for search. The `api.search` IPC channel exists as a fallback for more complex server-side queries in the future but is not used for the initial implementation.

---

## 7. Implementation Units

The design supports parallel coding by three developers (or three sequential implementation passes). Dependencies between units are minimized through the shared types contract in `src/shared/`.

### Unit A: Main Process

**Files**: `src/main/file-manager.ts`, `src/main/ndjson-parser.ts`, `src/main/file-tailer.ts`, `src/main/interaction-store.ts`, `src/main/ipc-handlers.ts`, `src/main/index.ts`

**Dependencies**: `src/shared/*` (Unit B must define the interfaces first, but stubs suffice)

**Deliverables**:
1. File manager with open dialog, recent files, filename parsing
2. NDJSON parser with remainder buffer and validation
3. File tailer with fs.watch, 500ms debounce, byte-offset reads
4. Interaction store with grouping, summary derivation, search
5. IPC handlers wired to all of the above
6. BrowserWindow setup with menu, window state persistence, drag-drop

**Test files** (in `test_scripts/`):
- `test-ndjson-parser.test.ts` — partial lines, empty lines, malformed JSON, valid entries, flush behavior
- `test-interaction-store.test.ts` — grouping, summary derivation, incremental updates, search, aggregates

**Can start when**: Shared types (Unit B) interfaces are defined (even as stubs).

### Unit B: Shared Types + Preload

**Files**: `src/shared/types.ts`, `src/shared/ipc-types.ts`, `src/shared/ipc-channels.ts`, `src/preload/index.ts`, `src/renderer/src/env.d.ts`

**Dependencies**: None (this is the foundation).

**Deliverables**:
1. All shared type definitions (InteractionSummary, EventEntry, DetailPayload, etc.)
2. ProxyInspectorAPI interface
3. IPC channel constants
4. Preload script implementing ProxyInspectorAPI
5. Window.api type declaration for renderer

**Can start when**: Immediately (no dependencies).

### Unit C: Renderer Components + Hooks + Styles

**Files**: Everything under `src/renderer/src/`

**Dependencies**: `src/shared/*` (Unit B), `src/main/ipc-handlers.ts` (Unit A) must be functional for end-to-end testing

**Deliverables**:
1. App shell with CSS grid layout and dark theme
2. StatusBar, Toolbar, SplitPane components
3. InteractionList with react-window v2, InteractionCard
4. DetailPanel, EventTimeline, EventCard
5. All 8 payload renderers + JsonViewer + CollapsibleSection
6. All 5 hooks (useFileData, useLiveTail, useListKeyboardNav, usePayload, useFilter)

**Can develop against mocks**: The renderer can be developed with mock data before the main process is complete. Create a `src/renderer/src/__mocks__/api.ts` that returns hardcoded `ParsedFileData` and `DetailPayload` objects derived from the sample log file.

**Can start when**: Shared types (Unit B) are defined.

### Dependency Graph

```
Unit B (Shared Types + Preload)   ← Start immediately
  |
  +───> Unit A (Main Process)     ← Start after B defines interfaces
  |
  +───> Unit C (Renderer)         ← Start after B defines interfaces
              |                       (can use mocks for main process)
              v
         Integration              ← When A + C are both complete
```

---

## Appendix A: Sample Data Reference

The sample log file at `logs/proxy-36d86b1d-cb79-4609-b8e5-1a777a25db08-2026-04-11T06-58-50.ndjson` contains 12 lines, 2 interactions:

**Interaction #1** (interactionId: `e-81280261-9171-46ea-988e-a36e343b4240`):
- User message: "hi"
- 4 events: interaction_start, llm_request (RT1), llm_response (RT1), interaction_end
- 1 round trip, 0 tool calls
- Tokens: 6099 prompt, 41 completion, 6140 total
- Duration: 934ms

**Interaction #2** (interactionId: `e-5a54eb01-4f09-45db-bf68-e1101ba376fd`):
- User message: "list my notebooks"
- 8 events: interaction_start, llm_request (RT1), llm_response (RT1, functionCall), tool_start (list_notebooks), tool_result (list_notebooks), llm_request (RT2), llm_response (RT2, streamed, 88 chunks), interaction_end
- 2 round trips, 1 tool call: list_notebooks
- Tokens: 16711 prompt, 4062 completion, 20773 total
- Duration: 19068ms

**Aggregate stats**:
- Total interactions: 2
- Total tokens: 26913
- Total tool calls: 1
- Time span: ~91 seconds (06:58:50 to 07:00:21)

**Observed payload characteristics**:
- `llm_request` payloads are 19-35 KB (contain full conversation history + 52 tool declarations)
- `llm_response` RT1 for interaction #2 contains `functionCall` (not text) -- `{ parts: [{ functionCall: { name: "list_notebooks", args: {} } }], role: "model" }`
- `llm_response` RT2 for interaction #2 was streamed with 88 chunks and 16787ms duration
- `tool_result` contains only `resultKeys` (array of key names), not the full result data
- System instruction text is ~3000 characters (repeated in every llm_request)
- Tool declarations array contains 52 tools (one `functionDeclarations` wrapper with all tools inside)

## Appendix B: Technology Stack

| Component | Choice | Version |
|-----------|--------|---------|
| Desktop shell | Electron | Latest stable (33.x+) |
| Build tool | electron-vite | 3.x+ |
| Renderer framework | React | 19.x |
| Virtual scrolling | react-window | 2.2.7 |
| Language | TypeScript | 5.x |
| File watching | Node.js `fs.watch` | Built-in |
| State management | React hooks (useState/useReducer) | Built-in |
| Styling | CSS custom properties | N/A |
| Package manager | npm | 10.x+ |
