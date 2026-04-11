# Investigation Report: Proxy Inspector — Electron NDJSON Log Viewer

**Date**: 2026-04-11
**Author**: Technical Investigator
**Status**: Complete

---

## 1. Problem Statement

The NotebookLM Agent proxy generates NDJSON log files capturing LLM interactions (requests, responses, tool calls, errors, token usage). These files contain dense, nested JSON that is impractical to read in a text editor. Developers need a desktop tool to visually inspect these logs: open a file, see interactions grouped and correlated, drill into payloads, and live-tail the file as the agent runs.

The tool must be a standalone Electron application living in its own directory (`proxy-inspector/`) with independent dependencies. It reads local NDJSON files and reconstructs hierarchical interaction views from the flat event stream.

---

## 2. Architecture Decisions

### 2.1 Electron Main Process — File I/O and IPC

All approaches share the same main process responsibilities:
- Show native file-open dialog (`.ndjson` filter)
- Read and parse the NDJSON file
- Watch the file for appended content
- Send parsed data to the renderer via IPC
- Manage window state (size, position persistence)
- Handle drag-and-drop file resolution
- Maintain recent files list

The main process must be CommonJS (Electron requirement). The preload script bridges IPC to the renderer using `contextBridge.exposeInMainWorld()`.

### 2.2 File Watching — Incremental Tail Reading

Three options for detecting appended content:

| Approach | Pros | Cons |
|---|---|---|
| `fs.watch` (Node built-in) | Zero dependencies, event-based, uses OS-level FSEvents on macOS | No polling overhead, but may fire duplicate events on macOS; does not report byte offsets |
| `fs.watchFile` (Node built-in) | Stat-based polling, reports file size changes | Polling-based (configurable interval), higher CPU for frequent checks |
| `chokidar` (npm) | Cross-platform, debounced, reliable | External dependency (~400KB), heavier than needed for single-file watching |

**Recommended: `fs.watch` + manual byte-offset tracking.** The pattern:
1. After initial parse, record `bytesRead = file.length`
2. On `fs.watch` change event, `fs.open` + `fs.read` from `bytesRead` to EOF
3. Split the new chunk by `\n`, parse each line as JSON
4. Update `bytesRead`
5. Debounce to 500ms to handle burst flushes (the proxy buffers and flushes every 500ms)

This avoids external dependencies and works reliably on macOS (FSEvents). The file is append-only per the proxy design, so no need to handle truncation. File rotation creates a new file; the inspector is a single-file viewer.

### 2.3 NDJSON Parsing and Grouping

The parsing logic is straightforward and framework-independent:

```
1. Read file content (or incremental chunk)
2. Split by newline
3. For each non-empty line: JSON.parse() -> LogEntry
4. Skip malformed lines with a warning (Assumption 2)
5. Group by interactionId into a Map<string, LogEntry[]>
6. Events within an interaction are contiguous (Assumption 3), so grouping is simple append
7. For each interaction group, derive:
   - status: has interaction_end? complete : in-progress; has error events? error
   - userMessage: from interaction_start payload
   - token totals: from interaction_end payload
   - duration: from interaction_end payload
   - tool calls: from interaction_end payload.toolCalls
   - round trip count: max roundTrip value or interaction_end.roundTripCount
```

This logic belongs in a pure TypeScript module (`src/shared/ndjson-parser.ts`) usable by both main and renderer processes.

---

## 3. Approach Analysis: Renderer Framework

### Approach A: React with electron-vite

**Description**: Use React 19 for the renderer, bundled with electron-vite (Vite-based build tool for Electron). Components handle the master-detail layout, virtual scrolling, collapsible JSON trees, and event timeline.

**Architecture**:
```
proxy-inspector/
  package.json
  electron.vite.config.ts
  src/
    main/
      main.ts              # Electron main process (file I/O, IPC, dialogs)
      file-watcher.ts      # fs.watch + incremental read
    preload/
      preload.ts           # contextBridge IPC bridge
    renderer/
      index.html
      App.tsx              # Root component
      components/
        InteractionList.tsx   # Left panel with virtual scroll
        EventTimeline.tsx     # Right panel event sequence
        PayloadRenderer.tsx   # Collapsible JSON/payload display
        StatusBar.tsx         # File info + aggregate stats
        SearchFilter.tsx      # Search + filter controls
      hooks/
        useFileData.ts        # IPC listener for parsed data
        useLiveTail.ts        # Auto-scroll and new-data indicator
        useFilter.ts          # Search and filter state
      lib/
        ndjson-parser.ts      # Pure parsing + grouping logic
        types.ts              # LogEntry, InteractionGroup, etc.
```

**Pros**:
- Component model well-suited for the UI complexity: collapsible sections, virtual scrolling, event timeline, filtered lists
- Consistent with the project's TUI (which uses React via Ink)
- Large ecosystem: react-window for virtual scrolling, react-json-tree for JSON display
- Hot module reload during development via electron-vite
- TypeScript-first with good IDE support
- State management for filters, selection, scroll position is natural with React hooks

**Cons**:
- Heavier dependency footprint (~15-20MB in node_modules for react + react-dom + electron-vite)
- Build step required (Vite compiles JSX/TSX)
- More files and boilerplate vs vanilla approach
- electron-vite adds configuration complexity (separate configs for main/preload/renderer)

**Dependency estimate**: electron, react, react-dom, electron-vite, @vitejs/plugin-react, react-window (virtual scroll), TypeScript

### Approach B: Vanilla HTML/CSS/JS with No Build Step

**Description**: Renderer is a single HTML file (or a few files) with inline CSS and vanilla JavaScript. Use template literals for DOM construction, manual DOM manipulation for updates. Electron loads the HTML directly.

**Architecture**:
```
proxy-inspector/
  package.json
  src/
    main/
      main.cjs              # Electron main process (CommonJS)
      file-watcher.cjs      # fs.watch + incremental read
    preload/
      preload.cjs           # contextBridge
    renderer/
      index.html            # All CSS + JS inline or in <script> tags
      app.js                # UI logic (vanilla JS)
      styles.css            # Dark theme styles
    shared/
      ndjson-parser.js      # Pure parsing logic (CommonJS for main, also loadable in renderer)
```

**Pros**:
- Zero build step: Electron loads HTML directly
- Fewer dependencies: only electron + typescript (for type checking, optional)
- Follows the existing Gitter pattern (CJS main, HTML renderer)
- Smaller, simpler project structure
- Faster cold start (no framework initialization)

**Cons**:
- Manual DOM manipulation becomes painful for the UI complexity described in the requirements: collapsible JSON trees, virtual scrolling, event timeline, filtered lists, master-detail layout with resizable divider
- No virtual scrolling library readily available (would need to implement manually or use a vanilla lib)
- No component abstraction: the 8 different payload renderers (one per event type) would be functions returning HTML strings, which is error-prone and hard to maintain
- State management (selected interaction, scroll position, filters, live-tail toggle, search) becomes ad-hoc
- No HMR during development; must reload the window on every change
- TypeScript type checking only with `tsc --noEmit`; actual runtime code is untyped JS

### Approach C: Preact with esbuild (Lightweight Middle Ground)

**Description**: Use Preact (3KB alternative to React) with esbuild for fast bundling. Gets the component model without the React weight.

**Pros**:
- Tiny runtime (3KB vs React's ~40KB)
- Same JSX component model as React
- esbuild is extremely fast (sub-second builds)
- Can use react-window via preact/compat

**Cons**:
- Less familiar than React (though API is nearly identical)
- preact/compat layer occasionally has subtle differences
- esbuild Electron configuration is less documented than electron-vite
- Still requires a build step

---

## 4. Recommendation: Approach A (React with electron-vite)

### Justification

The UI requirements are substantial enough to warrant a component framework:

1. **8 distinct payload renderers** — each event type has different display logic (FR-5.1 through FR-5.9). In React, each is a clean component. In vanilla JS, each is a function returning HTML strings with manual event binding.

2. **Virtual scrolling** (NFR-1.2) — react-window is mature and well-tested. Implementing virtual scrolling in vanilla JS for the interaction list is a significant engineering effort for marginal benefit.

3. **Collapsible sections** (FR-5.2, NFR-1.3) — llm_request payloads with system instructions, conversation history, and tool declarations need nested collapsible sections. React's state management makes this straightforward.

4. **Live-tail with auto-scroll** (FR-2.3, FR-2.4) — tracking whether the user has scrolled away, showing a "new events" badge, and auto-scrolling on new data is complex state logic that benefits from React's rendering model.

5. **Search and filter** (FR-7) — filtering the interaction list and event timeline by multiple criteria is a natural fit for React's declarative rendering.

6. **Resizable panels** (FR-8.2) — while possible in vanilla JS, it's cleaner as a React component with mouse event hooks.

7. **Consistency** — the project already uses React (via Ink for the TUI). Developers working on this codebase are expected to know React.

The weight of React + electron-vite is acceptable for a desktop developer tool. The build step is an acceptable trade-off for maintainability and development speed.

**Why not Approach C (Preact)?** The size savings (37KB) are irrelevant in an Electron app that bundles Chromium (~150MB). React has better ecosystem support and familiarity.

---

## 5. Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Electron Main Process                 │
│                                                         │
│  main.ts                                                │
│  ├── createWindow()      BrowserWindow + menu           │
│  ├── dialog.showOpenDialog()  file selection             │
│  ├── file-watcher.ts     fs.watch + byte-offset reads   │
│  ├── ndjson-parser.ts    JSON.parse per line, grouping   │
│  ├── recent-files.ts     persist last 10 opened files    │
│  └── IPC handlers:                                      │
│      ├── open-file       → parse + watch + send data    │
│      ├── file-data       ← send parsed interactions     │
│      ├── new-events      ← send incremental updates     │
│      ├── pause-watch     → stop/resume file watching    │
│      └── get-recent      ← send recent files list       │
│                                                         │
├─────────────────────────────────────────────────────────┤
│                    Preload Script                        │
│  preload.ts                                             │
│  contextBridge.exposeInMainWorld('api', {               │
│    openFile: () => ipcRenderer.invoke('open-file'),     │
│    onFileData: (cb) => ipcRenderer.on('file-data', cb), │
│    onNewEvents: (cb) => ipcRenderer.on('new-events',cb),│
│    pauseWatch: (p) => ipcRenderer.invoke('pause-watch'),│
│    getRecent: () => ipcRenderer.invoke('get-recent'),   │
│  })                                                     │
├─────────────────────────────────────────────────────────┤
│                    Renderer (React)                      │
│                                                         │
│  ┌──────────┐  ┌──────────────────────────────────────┐ │
│  │ StatusBar │  File path, session ID, aggregate stats │ │
│  ├──────────┴──┬───────────────────────────────────────┤ │
│  │ Interaction │ Event Timeline + Payload Detail       │ │
│  │ List (left) │ (right panel)                         │ │
│  │             │                                       │ │
│  │ #1 "hi"    │ interaction_start  +0ms               │ │
│  │  934ms 6K  │ llm_request        +5ms   RT1         │ │
│  │             │ llm_response       +929ms RT1         │ │
│  │ #2 "list.. │ tool_start         +930ms RT1         │ │
│  │  19.1s 21K │ tool_result        +2081ms RT1        │ │
│  │  [list_nb] │ llm_request        +2082ms RT2        │ │
│  │             │ llm_response       +19063ms RT2       │ │
│  │             │ interaction_end    +19068ms           │ │
│  │             │                                       │ │
│  │             │ ┌─ Expanded Payload ──────────┐      │ │
│  │             │ │ Model: gemini-2.5-flash      │      │ │
│  │             │ │ ▶ Contents (3 messages)      │      │ │
│  │             │ │ ▶ System Instruction         │      │ │
│  │             │ │ ▶ Tool Declarations (52)     │      │ │
│  │             │ │ [Raw JSON]                   │      │ │
│  │             │ └─────────────────────────────┘      │ │
│  └─────────────┴───────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### Data Flow

1. User opens file (dialog or drag-and-drop or recent list)
2. Main process reads file, parses all NDJSON lines, groups by interactionId
3. Main sends structured interaction data to renderer via IPC (`file-data`)
4. Main starts `fs.watch` on the file
5. On file change: main reads from last byte offset, parses new lines, sends incremental update (`new-events`)
6. Renderer merges new events into existing interaction groups, updates UI
7. If user has not scrolled up, auto-scroll to latest; otherwise show "new events" badge

### Key Technical Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Renderer framework | React 19 | UI complexity warrants components; project consistency |
| Build tool | electron-vite | Vite-native Electron support, fast HMR, good TS support |
| Virtual scrolling | react-window | Mature, small (6KB), handles 1000+ items |
| JSON rendering | Custom collapsible tree component | Avoids heavy deps; only need read-only display |
| File watching | `fs.watch` + byte-offset | Zero deps, works well on macOS, handles burst flushes |
| Main process format | CJS (`.cjs`) | Electron main process requirement |
| Type sharing | TypeScript path alias to proxy-types.ts | Zero-cost at runtime, stays in sync |
| State management | React hooks (useState/useReducer) | App state is simple enough; no Redux/Zustand needed |
| Dark theme | CSS custom properties | Single theme (dark), no runtime theme switching needed |
| Resizable panels | CSS resize or lightweight splitter | Avoid heavy layout libraries |

---

## 6. Risk Assessment

### R1: electron-vite Configuration Complexity — Medium
**Impact**: Setup of electron-vite with separate main/preload/renderer builds could hit edge cases with ESM/CJS interop.
**Mitigation**: The electron-vite project has good documentation and templates. Use their React template as the starting point. If configuration proves too complex, fall back to manual esbuild scripts (simpler but less integrated).

### R2: Large Payload Rendering Performance — Medium
**Impact**: `llm_request` payloads up to 33KB with nested arrays (52 tool declarations). Expanding all at once could cause frame drops.
**Mitigation**: Lazy rendering with collapsible sections (NFR-1.3). Only parse and render payload detail when the user clicks to expand. Use `React.memo` on list items. Virtual scrolling for the interaction list.

### R3: File Watching Reliability on macOS — Low
**Impact**: `fs.watch` may fire duplicate events or miss rapid appends.
**Mitigation**: Debounce to 500ms (matching the proxy's flush interval). Always read from byte offset to EOF regardless of event count. The worst case is a 500ms delay in showing new events, which is acceptable.

### R4: Electron Security — Low
**Impact**: Context isolation must be maintained; renderer should not have direct `fs` access.
**Mitigation**: Use preload script with `contextBridge`. `nodeIntegration: false`, `contextIsolation: true`. All file I/O stays in the main process. The renderer only receives serialized data via IPC.

### R5: Memory Usage with Large Files — Medium
**Impact**: A 100MB NDJSON file could produce thousands of interactions. Keeping all parsed data in memory (both main and renderer) could use significant RAM.
**Mitigation**: The main process parses and groups, but sends only summary data for the interaction list (not full payloads). Full payload for a specific interaction is sent on-demand when the user selects it. This keeps renderer memory bounded.

### R6: Electron Version Compatibility — Low
**Impact**: Electron releases frequently; APIs may change.
**Mitigation**: Pin to a specific Electron major version (e.g., 33.x). electron-vite tracks stable Electron versions.

---

## 7. Technical Research Guidance

Research needed: Yes

### Topic: electron-vite Project Setup with React
- **Why**: Need to validate the exact configuration for a React + TypeScript Electron app with electron-vite, including the main/preload/renderer split, IPC type safety, and build output structure.
- **Focus**: electron-vite official template for React-TS; `electron.vite.config.ts` structure; how preload scripts are bundled; how to configure TypeScript path aliases for importing `proxy-types.ts` from the parent project.
- **Depth**: standard

### Topic: fs.watch Incremental File Tailing on macOS
- **Why**: Need to confirm the exact pattern for reading appended bytes from a watched file using `fs.watch` + `fs.open` + `fs.read` with byte offsets, specifically on macOS FSEvents.
- **Focus**: `fs.watch` event types on macOS (`change` vs `rename`); reading from a byte offset with `fs.read(fd, buffer, 0, length, position)`; handling the case where a `change` event fires but no new bytes exist (false positive); debouncing strategy.
- **Depth**: standard

### Topic: react-window Integration for Master-Detail List
- **Why**: The interaction list needs virtual scrolling for files with 100+ interactions (NFR-1.2). Need to validate that react-window works well with variable-height items (interaction cards have different heights based on tool call badges).
- **Focus**: `VariableSizeList` vs `FixedSizeList`; measuring item heights; keyboard navigation (arrow keys) with react-window; scroll-to-item API for auto-scroll on live tail.
- **Depth**: standard

### Topic: Electron IPC Patterns for Streaming Data
- **Why**: The live-tail feature sends incremental updates from main to renderer. Need to validate the IPC pattern for one-way streaming (main-to-renderer push) and request-response (renderer requests full payload for selected interaction).
- **Focus**: `webContents.send()` for push events; `ipcMain.handle()` + `ipcRenderer.invoke()` for request-response; serialization overhead for large payloads (33KB JSON objects); whether `structuredClone` is used internally.
- **Depth**: standard
