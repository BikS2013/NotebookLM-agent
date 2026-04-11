# electron-vite Project Setup and Electron IPC Patterns

**Research Date**: 2026-04-11
**Project Context**: proxy-inspector — Electron NDJSON Log Viewer
**Depth**: Standard (implementation-ready reference)

---

## Overview

This document covers two topics required to build the proxy-inspector Electron application:

1. **electron-vite with React + TypeScript** — project scaffolding, the `electron.vite.config.ts`
   structure, preload bundling with context isolation, TypeScript path aliases, and build output.

2. **Electron IPC Patterns for Streaming Data** — `webContents.send()` for main-to-renderer
   push events, `ipcMain.handle()` + `ipcRenderer.invoke()` for request-response, serialization
   overhead, and type-safe IPC with TypeScript.

---

## Topic 1: electron-vite Project Setup with React + TypeScript

### 1.1 Prerequisites

- Node.js 20.19+ or 22.12+
- Vite 5.0+
- Electron (pinned to a specific major, e.g., 33.x)

### 1.2 Scaffolding the Project

The official scaffolding command for a React + TypeScript template:

```bash
npm create @quick-start/electron@latest proxy-inspector -- --template react-ts
cd proxy-inspector
npm install
npm run dev
```

Alternatively, use `degit` for the boilerplate directly:

```bash
npx degit alex8088/electron-vite-boilerplate proxy-inspector
cd proxy-inspector
npm install
npm run dev
```

The `--template react-ts` flag selects the TypeScript + React preset. Available presets: `vanilla`,
`vanilla-ts`, `vue`, `vue-ts`, `react`, `react-ts`, `svelte`, `svelte-ts`, `solid`, `solid-ts`.

### 1.3 Canonical Project Structure

electron-vite works with minimal configuration when this directory convention is followed:

```
proxy-inspector/
├── electron.vite.config.ts
├── package.json                  # "main": "./out/main/index.js"
├── tsconfig.json                 # references tsconfig.node.json + tsconfig.web.json
├── tsconfig.node.json            # for main + preload (Node targets)
├── tsconfig.web.json             # for renderer (browser targets)
├── src/
│   ├── main/
│   │   └── index.ts              # Electron main process
│   ├── preload/
│   │   └── index.ts              # contextBridge IPC bridge
│   └── renderer/
│       ├── index.html            # Vite entry point
│       └── src/
│           ├── main.tsx          # React root
│           ├── App.tsx
│           └── ...
└── out/                          # Build output (default)
    ├── main/
    │   └── index.js              # Bundled main process (CJS)
    ├── preload/
    │   └── index.js              # Bundled preload (CJS)
    └── renderer/
        ├── index.html
        └── assets/
```

Default auto-detected entry points (no config needed when following the convention):

| Process | Entry point |
|---|---|
| Main | `src/main/{index\|main}.{js,ts,mjs,cjs}` |
| Preload | `src/preload/{index\|preload}.{js,ts,mjs,cjs}` |
| Renderer | `src/renderer/index.html` |

### 1.4 `electron.vite.config.ts` Structure

#### Minimal configuration (using convention-based defaults)

```typescript
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    plugins: [react()]
  }
})
```

#### Full configuration with explicit inputs and custom output dirs

```typescript
import { defineConfig } from 'electron-vite'
import { resolve } from 'path'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    build: {
      outDir: 'out/main',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts')
        }
      }
    }
  },
  preload: {
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts')
        }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    build: {
      outDir: 'out/renderer',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html')
        }
      }
    },
    plugins: [react()]
  }
})
```

#### Built-in defaults (no need to specify these explicitly)

| Config key | Main | Preload | Renderer |
|---|---|---|---|
| `build.outDir` | `out/main` | `out/preload` | `out/renderer` |
| `build.lib.formats` | `cjs` (or `es` on Electron 28+) | `cjs` | n/a |
| `build.target` | `node*` (matched to Electron version) | `node*` | `chrome*` (matched to Electron version) |
| `build.rollupOptions.external` | `electron` + all Node builtins | `electron` + all Node builtins | n/a |
| `envPrefix` | `MAIN_VITE_`, `VITE_` | `PRELOAD_VITE_`, `VITE_` | `RENDERER_VITE_`, `VITE_` |

The `build.lib.formats: 'cjs'` default means main and preload are emitted as CommonJS by default,
which is what Electron requires. No manual CJS configuration is needed.

### 1.5 `package.json` entry point

The Electron `main` field must point to the build output, not the source:

```json
{
  "name": "proxy-inspector",
  "version": "1.0.0",
  "main": "./out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "preview": "electron-vite preview"
  }
}
```

### 1.6 Preload Scripts and Context Isolation

Preload scripts run in a privileged context (limited Node.js access) and bridge the main process
to the renderer via `contextBridge.exposeInMainWorld()`.

**Key constraint since Electron 20**: Preload scripts are **sandboxed by default**. They can only
import from: `electron` renderer modules, `events`, `timers`, `url`, and polyfilled globals
(`Buffer`, `process`, `clearImmediate`, `setImmediate`).

To use other Node.js modules in a preload, electron-vite must fully bundle them. This is done
by setting `externalizeDeps: false` in the preload config:

```typescript
// electron.vite.config.ts
preload: {
  build: {
    // Bundle all dependencies into the preload output instead of leaving
    // them as external requires (which would fail in sandbox mode)
    rollupOptions: {
      external: [] // override: bundle everything
    }
  }
}
```

Or use the `isolatedEntries` option for multiple preload entry points:

```typescript
preload: {
  build: {
    isolatedEntries: true,  // each entry is bundled independently
    // externalizeDeps: false  // uncomment to fully bundle deps
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'src/preload/index.ts')
      }
    }
  }
}
```

**Standard preload pattern** (`src/preload/index.ts`):

```typescript
import { contextBridge, ipcRenderer } from 'electron'

// Type-safe, named wrappers only. Never expose ipcRenderer directly.
contextBridge.exposeInMainWorld('api', {
  // Renderer -> Main (request/response)
  openFile: (): Promise<string | undefined> =>
    ipcRenderer.invoke('open-file'),

  getPayload: (interactionId: string): Promise<InteractionPayload> =>
    ipcRenderer.invoke('get-payload', interactionId),

  // Main -> Renderer (push events) — returns cleanup function
  onFileData: (cb: (data: ParsedFileData) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: ParsedFileData) => cb(data)
    ipcRenderer.on('file-data', handler)
    return () => ipcRenderer.removeListener('file-data', handler)
  },

  onNewEvents: (cb: (events: IncrementalUpdate) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, events: IncrementalUpdate) => cb(events)
    ipcRenderer.on('new-events', handler)
    return () => ipcRenderer.removeListener('new-events', handler)
  }
})
```

Security note: wrapping each `ipcRenderer` call in a named helper (rather than exposing the
`ipcRenderer` object) is a hard requirement. Exposing `ipcRenderer.send` directly allows the
renderer to send arbitrary messages to the main process, which is a security vulnerability.

### 1.7 TypeScript Configuration

electron-vite generates a split TypeScript config: one for Node processes (main + preload) and
one for browser/renderer.

**`tsconfig.json`** (project root, references both):
```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.node.json" },
    { "path": "./tsconfig.web.json" }
  ]
}
```

**`tsconfig.node.json`** (main + preload):
```json
{
  "extends": "@electron-toolkit/tsconfig/tsconfig.node.json",
  "include": ["electron.vite.config.*", "src/main/**/*", "src/preload/**/*"],
  "compilerOptions": {
    "composite": true,
    "types": ["electron-vite/node"],
    "paths": {
      "@shared/*": ["./src/shared/*"],
      "@proxy-types": ["../path/to/proxy-types.ts"]
    }
  }
}
```

**`tsconfig.web.json`** (renderer):
```json
{
  "extends": "@electron-toolkit/tsconfig/tsconfig.web.json",
  "include": ["src/renderer/src/**/*"],
  "compilerOptions": {
    "composite": true,
    "paths": {
      "@renderer/*": ["./src/renderer/src/*"],
      "@shared/*": ["./src/shared/*"],
      "@proxy-types": ["../path/to/proxy-types.ts"]
    }
  }
}
```

The `"types": ["electron-vite/node"]` entry enables electron-vite's special import suffixes
(`?modulePath`, `?nodeWorker`) in TypeScript.

### 1.8 TypeScript Path Aliases for Importing from a Parent Project

To import types from `../proxy-types.ts` (a file in the parent project), configure both the
TypeScript compiler and the Vite resolver:

**In `electron.vite.config.ts`**:
```typescript
import { defineConfig } from 'electron-vite'
import { resolve } from 'path'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    resolve: {
      alias: {
        '@proxy-types': resolve(__dirname, '../proxy-types.ts'),
        '@shared': resolve(__dirname, 'src/shared')
      }
    }
  },
  preload: {
    resolve: {
      alias: {
        '@proxy-types': resolve(__dirname, '../proxy-types.ts'),
        '@shared': resolve(__dirname, 'src/shared')
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@proxy-types': resolve(__dirname, '../proxy-types.ts'),
        '@shared': resolve(__dirname, 'src/shared'),
        '@renderer': resolve(__dirname, 'src/renderer/src')
      }
    },
    plugins: [react()]
  }
})
```

**Usage** in any process:
```typescript
import type { LogEntry, InteractionGroup } from '@proxy-types'
```

Note: The `@proxy-types` alias points to a `.ts` file (not a `.d.ts`). At runtime, the file is
included in the bundle and all type imports are erased. There is no runtime cost.

### 1.9 Build Output Structure

Default output after `electron-vite build`:

```
out/
├── main/
│   └── index.js          # CJS bundle of src/main/**
├── preload/
│   └── index.js          # CJS bundle of src/preload/**
└── renderer/
    ├── index.html
    └── assets/
        ├── index-[hash].js   # React renderer bundle
        └── index-[hash].css
```

The preload script path is referenced in the main process using `__dirname`:

```typescript
// src/main/index.ts
import { BrowserWindow } from 'electron'
import { join } from 'path'

const win = new BrowserWindow({
  webPreferences: {
    preload: join(__dirname, '../preload/index.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true   // default since Electron 20
  }
})
```

The relative path `../preload/index.js` works because both `out/main/` and `out/preload/` are
siblings. This path is stable regardless of where the user installs the app.

### 1.10 Development Workflow

```bash
# Start dev server (main + preload hot-reload, renderer HMR)
npm run dev

# Type-check without building
npx tsc --noEmit -p tsconfig.node.json
npx tsc --noEmit -p tsconfig.web.json

# Production build
npm run build

# Preview production build
npm run preview
```

HMR behavior:
- **Renderer**: Vite HMR — component-level hot replacement, no window reload.
- **Main process**: Hot reloading — Electron restarts the main process on changes (window reloads).
- **Preload**: Hot reloading — similar to main process restart.

---

## Topic 2: Electron IPC Patterns for Streaming Data

### 2.1 IPC Architecture Overview

Electron uses two inter-process communication modules:

- `ipcMain` — runs in the main process (Node.js). Listens for messages, handles requests.
- `ipcRenderer` — runs in the preload/renderer. Sends messages, invokes handlers.

Communication is always channel-based (named strings). Channels are bidirectional by name but
each call direction uses distinct APIs.

All IPC arguments are serialized using the **HTML Structured Clone Algorithm** — the same
algorithm used by `postMessage` and `Web Workers`. This is internally equivalent to
`structuredClone()`.

### 2.2 Pattern 1: Main-to-Renderer Push (Live Tail Updates)

Use `webContents.send(channel, ...args)` to push data from the main process to the renderer.
The renderer registers a listener via `ipcRenderer.on()` exposed through the preload bridge.

**Main process** (`src/main/index.ts`):

```typescript
import { BrowserWindow, ipcMain } from 'electron'

let mainWindow: BrowserWindow | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
}

// Push incremental NDJSON events to renderer (called from file watcher)
function pushNewEvents(events: LogEntry[]): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('new-events', events)
  }
}

// Push initial full file parse result
function pushFileData(data: ParsedFileData): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('file-data', data)
  }
}
```

**Preload** (`src/preload/index.ts`):

```typescript
import { contextBridge, ipcRenderer } from 'electron'
import type { LogEntry, ParsedFileData } from '@proxy-types'

contextBridge.exposeInMainWorld('api', {
  onFileData: (cb: (data: ParsedFileData) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, data: ParsedFileData) => cb(data)
    ipcRenderer.on('file-data', handler)
    return () => ipcRenderer.removeListener('file-data', handler)  // returns cleanup
  },

  onNewEvents: (cb: (events: LogEntry[]) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, events: LogEntry[]) => cb(events)
    ipcRenderer.on('new-events', handler)
    return () => ipcRenderer.removeListener('new-events', handler)
  }
})
```

**React hook** (`src/renderer/src/hooks/useFileData.ts`):

```typescript
import { useEffect, useState } from 'react'
import type { ParsedFileData, LogEntry } from '@proxy-types'

export function useFileData() {
  const [fileData, setFileData] = useState<ParsedFileData | null>(null)

  useEffect(() => {
    const cleanupFileData = window.api.onFileData((data) => {
      setFileData(data)
    })
    const cleanupNewEvents = window.api.onNewEvents((events) => {
      setFileData(prev => prev
        ? { ...prev, events: [...prev.events, ...events] }
        : null
      )
    })
    // Clean up listeners on unmount to prevent memory leaks
    return () => {
      cleanupFileData()
      cleanupNewEvents()
    }
  }, [])

  return fileData
}
```

**Important**: Always return a cleanup function from the preload `on*` helpers and call it in the
React `useEffect` cleanup. Failing to remove `ipcRenderer.on` listeners causes memory leaks because
Electron holds a reference to the callback.

### 2.3 Pattern 2: Renderer-to-Main Request/Response (Fetching Payloads)

Use `ipcRenderer.invoke(channel, ...args)` paired with `ipcMain.handle(channel, listener)` for
request-response. This returns a `Promise` and is the correct pattern for on-demand data fetching.

**Main process**:

```typescript
import { ipcMain, dialog } from 'electron'
import type { InteractionPayload } from '@proxy-types'

// Handle file open dialog
ipcMain.handle('open-file', async (): Promise<string | undefined> => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Open NDJSON Log',
    filters: [{ name: 'NDJSON Logs', extensions: ['ndjson', 'jsonl'] }],
    properties: ['openFile']
  })
  if (canceled) return undefined
  return filePaths[0]
})

// Handle on-demand payload fetch (lazy loading for selected interaction)
ipcMain.handle('get-payload', async (_event, interactionId: string): Promise<InteractionPayload> => {
  const payload = interactionStore.get(interactionId)
  if (!payload) throw new Error(`Interaction ${interactionId} not found`)
  return payload
})

// Pause/resume file watcher
ipcMain.handle('pause-watch', async (_event, paused: boolean): Promise<void> => {
  paused ? fileWatcher.pause() : fileWatcher.resume()
})
```

**Preload**:

```typescript
contextBridge.exposeInMainWorld('api', {
  openFile: (): Promise<string | undefined> =>
    ipcRenderer.invoke('open-file'),

  getPayload: (interactionId: string): Promise<InteractionPayload> =>
    ipcRenderer.invoke('get-payload', interactionId),

  pauseWatch: (paused: boolean): Promise<void> =>
    ipcRenderer.invoke('pause-watch', paused)
})
```

**React component** (on-demand payload loading):

```typescript
async function loadPayload(interactionId: string) {
  try {
    const payload = await window.api.getPayload(interactionId)
    setSelectedPayload(payload)
  } catch (err) {
    console.error('Failed to load payload:', err)
    // Note: errors from ipcMain.handle are serialized — only `.message` is preserved
  }
}
```

**Note on error handling**: Errors thrown inside an `ipcMain.handle` callback are serialized
before being sent to the renderer. Only the `message` property of the `Error` is preserved.
The stack trace and custom error properties are lost. To work around this, encode error
information in a structured return value:

```typescript
// Preferred pattern for richer error info
ipcMain.handle('get-payload', async (_event, id: string) => {
  try {
    const payload = interactionStore.get(id)
    if (!payload) return { ok: false, error: `Not found: ${id}` }
    return { ok: true, data: payload }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
})
```

### 2.4 Serialization: Structured Clone Algorithm

**How it works**: All IPC arguments (both directions) are serialized using the
[Structured Clone Algorithm](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm).
This is the same algorithm used by `structuredClone()`, `postMessage`, and Web Workers.

**What can be serialized** (safe to send over IPC):
- Primitive types: `string`, `number`, `boolean`, `null`, `undefined`
- Plain objects and arrays
- `Date`, `RegExp`, `ArrayBuffer`, `TypedArray`, `Map`, `Set`, `Error`
- Nested structures of the above

**What cannot be serialized** (will throw):
- Functions
- `Promise`
- `Symbol`
- `WeakMap`, `WeakSet`
- DOM objects (`Element`, `DOMMatrix`, etc.)
- Node.js C++ backed objects (`process.env` members, `Stream`)
- Electron objects (`WebContents`, `BrowserWindow`, `WebFrame`)

For the proxy-inspector, all data being sent is plain JSON (`LogEntry` objects, strings, arrays).
This is fully compatible with Structured Clone. No special handling is needed.

**Performance considerations for large payloads (30-100KB)**:

The Structured Clone Algorithm performs a full deep copy of the data. For a 33KB `llm_request`
payload (JSON object with nested arrays of tool declarations), the IPC overhead involves:

1. **Serialization in main process**: The object is cloned into a binary representation. For a
   33KB JSON-equivalent object this is roughly equivalent to `JSON.stringify()` in cost, but
   Structured Clone is generally faster because it handles circular references and typed arrays
   natively.

2. **IPC message passing**: The binary data is sent over a pipe between processes. This is
   fast for objects up to a few MB.

3. **Deserialization in renderer**: The binary representation is cloned back into a JavaScript
   object.

**Practical guidance**:
- Sending 30-100KB objects (a single interaction payload) is fast: typically <5ms total round-trip
  for `invoke`/`handle`.
- Do **not** send the full file parse result (potentially thousands of interactions) in one IPC
  call. Instead:
  - Send summary data (list of interaction headers) as the initial `file-data` message.
  - Use `get-payload` (on-demand `invoke`) to fetch full payloads only when the user selects
    an interaction.
- For `new-events` push updates, send only the new `LogEntry[]` array (typically 1-5 events per
  debounce tick), not the entire file state.

There is **no zero-copy path** through standard IPC for plain objects. If sub-millisecond transfer
of large binary data is needed, `SharedArrayBuffer` or `MessagePort` can be used, but this is
not warranted for the proxy-inspector use case.

### 2.5 Type-Safe IPC with TypeScript

The key challenge is that `window.api` is injected by the preload at runtime. TypeScript does not
know its shape unless you declare it. The standard pattern is to augment the global `Window` interface.

**Step 1**: Define the API contract as an interface in a shared types file:

```typescript
// src/shared/ipc-types.ts
import type { LogEntry, ParsedFileData, InteractionPayload } from '@proxy-types'

/** The API shape exposed by the preload script via contextBridge */
export interface ProxyInspectorAPI {
  // Request/response
  openFile: () => Promise<string | undefined>
  getPayload: (interactionId: string) => Promise<InteractionPayload>
  pauseWatch: (paused: boolean) => Promise<void>
  getRecentFiles: () => Promise<string[]>

  // Main-to-renderer push (return value is the cleanup/unsubscribe function)
  onFileData: (cb: (data: ParsedFileData) => void) => () => void
  onNewEvents: (cb: (events: LogEntry[]) => void) => () => void
}
```

**Step 2**: Declare the type on the global `Window` interface. Place this in a `.d.ts` file
that is included by the renderer's `tsconfig.web.json`:

```typescript
// src/renderer/src/env.d.ts
import type { ProxyInspectorAPI } from '@shared/ipc-types'

declare global {
  interface Window {
    api: ProxyInspectorAPI
  }
}
```

**Step 3**: Implement in preload, making sure the implementation matches the interface:

```typescript
// src/preload/index.ts
import { contextBridge, ipcRenderer } from 'electron'
import type { ProxyInspectorAPI } from '@shared/ipc-types'
import type { LogEntry, ParsedFileData, InteractionPayload } from '@proxy-types'

// TypeScript will error here if the implementation doesn't match the interface
const api: ProxyInspectorAPI = {
  openFile: () => ipcRenderer.invoke('open-file'),
  getPayload: (id) => ipcRenderer.invoke('get-payload', id),
  pauseWatch: (paused) => ipcRenderer.invoke('pause-watch', paused),
  getRecentFiles: () => ipcRenderer.invoke('get-recent'),

  onFileData: (cb) => {
    const h = (_e: Electron.IpcRendererEvent, d: ParsedFileData) => cb(d)
    ipcRenderer.on('file-data', h)
    return () => ipcRenderer.removeListener('file-data', h)
  },
  onNewEvents: (cb) => {
    const h = (_e: Electron.IpcRendererEvent, events: LogEntry[]) => cb(events)
    ipcRenderer.on('new-events', h)
    return () => ipcRenderer.removeListener('new-events', h)
  }
}

contextBridge.exposeInMainWorld('api', api)
```

**Step 4**: Define IPC channel names as constants to avoid string typos:

```typescript
// src/shared/ipc-channels.ts
export const IPC = {
  // Renderer -> Main (invoke/handle)
  OPEN_FILE: 'open-file',
  GET_PAYLOAD: 'get-payload',
  PAUSE_WATCH: 'pause-watch',
  GET_RECENT: 'get-recent',

  // Main -> Renderer (send/on)
  FILE_DATA: 'file-data',
  NEW_EVENTS: 'new-events'
} as const
```

**Usage in main**:
```typescript
import { IPC } from '@shared/ipc-channels'

ipcMain.handle(IPC.OPEN_FILE, handleFileOpen)
ipcMain.handle(IPC.GET_PAYLOAD, handleGetPayload)
mainWindow.webContents.send(IPC.FILE_DATA, parsedData)
mainWindow.webContents.send(IPC.NEW_EVENTS, newEntries)
```

### 2.6 Listener Cleanup and Memory Safety

The `ipcRenderer.on()` listener accumulates unless explicitly removed. Common mistake: registering
a listener inside a React component without cleanup.

**Correct pattern** — React `useEffect` with cleanup:

```typescript
useEffect(() => {
  const cleanup = window.api.onNewEvents((events) => {
    dispatch({ type: 'NEW_EVENTS', payload: events })
  })
  return cleanup  // called on component unmount
}, [])            // empty deps = register once
```

**Anti-pattern** — listener leaks on remount:

```typescript
// DO NOT DO THIS — adds a new listener on every render
window.api.onNewEvents((events) => {
  setData(events)
})
```

For channels that should have exactly one active listener, the preload can use
`ipcRenderer.removeAllListeners(channel)` before registering, but this is fragile in
multi-component apps. The per-listener cleanup pattern above is preferred.

### 2.7 Complete IPC Flow for proxy-inspector

```
User opens file
    └─> Renderer calls window.api.openFile()
            └─> ipcRenderer.invoke('open-file')
                    └─> ipcMain.handle('open-file')
                            └─> dialog.showOpenDialog()
                            └─> returns filePath
                    └─> main reads + parses NDJSON
                    └─> starts fs.watch
                    └─> mainWindow.webContents.send('file-data', summaryData)
                            └─> ipcRenderer.on('file-data', handler)
                                    └─> window.api.onFileData callback
                                            └─> React setState → UI renders

File changes (fs.watch fires)
    └─> Main reads incremental bytes
    └─> Parses new LogEntry[]
    └─> mainWindow.webContents.send('new-events', newEntries)
            └─> React setState → UI appends new entries

User clicks interaction to expand
    └─> Renderer calls window.api.getPayload(interactionId)
            └─> ipcRenderer.invoke('get-payload', interactionId)
                    └─> ipcMain.handle('get-payload')
                            └─> returns full payload from interactionStore
                    └─> React setState with payload → PayloadRenderer renders
```

---

## Assumptions & Scope

| Assumption | Confidence | Impact if Wrong |
|---|---|---|
| electron-vite version is 3.x or 4.x (Vite 5 compatible) | HIGH | Earlier versions had different config schema; scaffolding command would produce different output |
| Electron 28+ for ESM support in main/preload | MEDIUM | If targeting Electron 27 or earlier, format must be `cjs` (which is the default anyway) |
| Sandbox mode enabled (Electron 20+ default) | HIGH | If `sandbox: false`, preload has full Node.js access and bundling concerns are different |
| Proxy types file is pure TypeScript (no runtime side effects) | HIGH | If it has side effects, importing via path alias in preload may run unwanted code |
| Single BrowserWindow (one renderer target) | HIGH | Multi-window apps need to track which `WebContents` to send to; `BrowserWindow.getFocusedWindow()` or explicit references are needed |
| IPC payload sizes stay in the 30-100KB range per investigation | HIGH | Multi-MB payloads would require a different strategy (e.g., sending a file path and having renderer read it) |

## Uncertainties & Gaps

- **structuredClone internal implementation in Electron**: Confirmed that Electron uses the
  Structured Clone Algorithm (same as `structuredClone()`), but the exact native implementation
  (whether it reuses V8's `ValueSerializer` or a custom path) is not documented publicly. The
  observable behavior is equivalent to `structuredClone()`. Confidence: HIGH for behavior, LOW
  for implementation internals.

- **Serialization benchmark numbers**: The "<5ms" figure for 30-100KB IPC round-trip is a
  reasonable estimate based on Structured Clone being faster than JSON for complex objects,
  but no authoritative benchmark was found in official docs. This should be validated with
  a micro-benchmark in the actual app if performance is critical.

- **`@electron-toolkit/tsconfig` availability**: The `extends` path used in the tsconfig examples
  assumes `@electron-toolkit/tsconfig` is installed. The scaffolded react-ts template installs
  it by default, but a custom setup would need `npm install -D @electron-toolkit/tsconfig`.

## Clarifying Questions for Follow-up

1. **Electron version target**: Which Electron major version (e.g., 28, 30, 33)? This determines
   whether ESM is available for main/preload or if CJS-only is enforced.

2. **Proxy types file location**: Is `proxy-types.ts` at a fixed relative path from
   `proxy-inspector/`, or is it inside a shared package? The path alias approach works for both,
   but a workspace package (`npm workspaces`) is cleaner if the types are also used by the agent.

3. **Sandbox policy**: Should the preload run with `sandbox: true` (default, more secure) or
   `sandbox: false`? If the preload needs to import Node.js modules beyond the limited set, the
   approach differs.

4. **Error reporting fidelity**: Is it acceptable that `ipcMain.handle` errors lose their stack
   trace in the renderer? If not, the structured result-object pattern (`{ ok, data, error }`)
   should be standardized across all handlers.

---

## References

| # | Source | URL | Information Gathered |
|---|--------|-----|---------------------|
| 1 | electron-vite Official Docs | https://electron-vite.org/guide/ | Scaffolding, CLI, config overview, project structure conventions |
| 2 | electron-vite Config Reference | https://electron-vite.org/config/ | Built-in defaults table for main/preload/renderer, env prefixes |
| 3 | electron-vite Dev Guide | https://electron-vite.org/guide/dev | Project structure conventions, preload sandboxing, multiple windows, multi-threading |
| 4 | electron-vite TypeScript Guide | https://electron-vite.org/guide/typescript | Type definitions, `electron-vite/node` reference, decorator support |
| 5 | electron-vite Build Guide (Context7) | https://github.com/alex8088/electron-vite-docs | `outDir` config, isolated build, rollupOptions.input |
| 6 | electron-vite Preload IPC Example (Context7) | https://context7.com/alex8088/electron-vite-docs | contextBridge pattern, `@electron-toolkit/preload` usage |
| 7 | Electron IPC Tutorial | https://www.electronjs.org/docs/latest/tutorial/ipc | All 4 IPC patterns, webContents.send, ipcMain.handle, serialization section |
| 8 | Electron ipcRenderer API | https://www.electronjs.org/docs/latest/api/ipc-renderer | invoke, send, on method signatures, Structured Clone note |
| 9 | Electron ipcMain API | https://www.electronjs.org/docs/latest/api/ipc-main | handle method signature, error serialization note |
| 10 | Electron Context Isolation Tutorial | https://www.electronjs.org/docs/latest/tutorial/context-isolation | Security considerations, TypeScript Window interface augmentation pattern |

### Recommended for Deep Reading

- **Electron IPC Tutorial** (source 7): The official tutorial covers all four IPC patterns with
  complete working code. Essential reading before implementing the preload bridge.

- **electron-vite Dev Guide** (source 3): Covers sandboxing limitations in Electron 20+,
  the `@electron-toolkit/preload` helper, and multiple-window config — all directly relevant
  to the proxy-inspector architecture.

- **Electron Context Isolation Tutorial** (source 10): Explains the security model, the
  TypeScript `Window` augmentation pattern, and why directly exposing `ipcRenderer` is unsafe.
