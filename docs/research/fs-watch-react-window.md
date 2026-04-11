# fs.watch Incremental File Tailing & react-window for Proxy Inspector

**Date**: 2026-04-11
**Project**: proxy-inspector — Electron NDJSON Log Viewer
**Depth**: Standard

---

## Overview

This document covers two technical topics required for the proxy-inspector Electron app:

1. **fs.watch Incremental File Tailing on macOS** — how to detect appended content in an NDJSON log file using `fs.watch` (or a better alternative), read only the new bytes using byte offsets, handle false positives, debounce burst writes, detect file rotation, and split buffered bytes into complete NDJSON lines.

2. **react-window for Variable-Height Master-Detail Lists** — how to use react-window v2's `List` component (replacing the v1 `VariableSizeList`) for interaction cards of varying heights, measure item heights dynamically, implement keyboard navigation with arrow keys, use the scroll-to-item API for live-tail auto-scroll, and integrate with a detail panel.

---

## Topic 1: fs.watch Incremental File Tailing on macOS

### The Core Problem with fs.watch on macOS

`fs.watch` on macOS uses a hybrid backend:
- **kqueue** for individual file descriptors
- **FSEvents** for directory trees

The critical limitation: on macOS, `fs.watch` on a **file** uses kqueue, which triggers `NOTE_EXTEND` and `NOTE_WRITE` events. Node.js maps both of these to the `'rename'` event type — **not** `'change'`. This is a long-standing known issue (Node.js GitHub issue #7420) officially marked as "wontfix."

**Practical consequence**: you cannot reliably filter by event type (`'change'` vs `'rename'`) on macOS. All events from a watched file arrive with `eventType === 'rename'` regardless of what actually happened (content append, rename, deletion). Your watcher handler must be event-type agnostic.

Additional reliability issues:
- A single file write can produce **two** kqueue events (`NOTE_EXTEND` + `NOTE_WRITE`), causing the callback to fire twice.
- Async writes can produce far more events than actual write operations.
- A `change` event (on other platforms) can fire when a file is merely read (observed in some Node.js versions on Windows).

### The Recommended Pattern: fs.watch + Byte Offset Reads

Despite its quirks, `fs.watch` is the right tool for the proxy-inspector's use case because:
- The file is append-only (no truncation to handle in the normal path)
- The proxy flushes every 500ms, so events are relatively infrequent
- No extra dependencies are needed in the Electron main process

The pattern:

```typescript
// src/main/file-watcher.ts (CommonJS / .cjs)

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface WatcherCallbacks {
  onNewChunk: (rawChunk: string) => void;
  onRotation: (newPath: string) => void;
  onError: (err: Error) => void;
}

export function createFileWatcher(filePath: string, callbacks: WatcherCallbacks) {
  let bytesRead = 0;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let watcher: fs.FSWatcher | null = null;

  // ── 1. Read initial file size so we know where "live" starts ──────────
  function initBytesRead(): void {
    try {
      const stat = fs.statSync(filePath);
      bytesRead = stat.size;
    } catch {
      bytesRead = 0;
    }
  }

  // ── 2. Read new bytes from bytesRead to EOF ────────────────────────────
  function readNewBytes(): void {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch (err) {
      // File may have been removed (rotation). Handle below.
      callbacks.onError(err as Error);
      return;
    }

    // Guard: false positive — no new bytes
    if (stat.size <= bytesRead) {
      return;
    }

    // Guard: file truncated / rotated (size is smaller than our offset)
    if (stat.size < bytesRead) {
      bytesRead = 0; // Reset to start of new file
    }

    const chunkSize = stat.size - bytesRead;
    const buffer = Buffer.allocUnsafe(chunkSize);

    const fd = fs.openSync(filePath, 'r');
    try {
      const bytesActuallyRead = fs.readSync(fd, buffer, 0, chunkSize, bytesRead);
      bytesRead += bytesActuallyRead;
      if (bytesActuallyRead > 0) {
        callbacks.onNewChunk(buffer.slice(0, bytesActuallyRead).toString('utf8'));
      }
    } finally {
      fs.closeSync(fd);
    }
  }

  // ── 3. Debounced event handler ─────────────────────────────────────────
  // macOS fires multiple events per write. Debounce at 500ms to match
  // the proxy's flush interval and collapse burst events into one read.
  function onWatchEvent(_eventType: string, _filename: string | null): void {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      readNewBytes();
    }, 500);
  }

  // ── 4. Start watching ──────────────────────────────────────────────────
  function start(): void {
    initBytesRead();
    watcher = fs.watch(filePath, { persistent: false }, onWatchEvent);
    watcher.on('error', (err) => callbacks.onError(err));
  }

  // ── 5. Stop watching ───────────────────────────────────────────────────
  function stop(): void {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (watcher !== null) {
      watcher.close();
      watcher = null;
    }
  }

  return { start, stop };
}
```

**Key design decisions in the above**:
- `bytesRead` is initialized to the file's current size, so the watcher only delivers content that is appended after the watcher starts. Initial content is handled by the first full read in `main.ts`.
- `statSync` is called on every debounced event — this is the false-positive guard. If `stat.size <= bytesRead`, we return immediately without opening the file.
- `fs.readSync` is used with an explicit `position` parameter (`bytesRead`), which maps to the POSIX `pread(2)` call and reads from an arbitrary offset without changing the file descriptor's internal position.
- The file descriptor is opened, read, and closed in a single synchronous unit. This avoids keeping an open fd that could cause issues if the file is renamed or replaced.
- `persistent: false` on `fs.watch` ensures the watcher does not prevent the Node.js process from exiting.

### Splitting Buffered Bytes Into Complete NDJSON Lines

The chunk delivered by `readNewBytes` may not end on a newline boundary. A partial line at the end must be held in a buffer and prepended to the next chunk.

```typescript
// src/main/ndjson-tail-parser.ts

export interface NdjsonTailParser {
  push(rawChunk: string): string[];  // returns complete JSON strings
  flush(): string[];                 // returns any remaining partial line
}

export function createNdjsonTailParser(): NdjsonTailParser {
  let remainder = '';

  function push(rawChunk: string): string[] {
    const combined = remainder + rawChunk;
    const lines = combined.split('\n');

    // The last element is either empty (chunk ended with \n) or a partial line.
    // In either case, save it as the new remainder.
    remainder = lines.pop() ?? '';

    // Filter out empty lines (e.g., from trailing newlines) before returning.
    return lines.filter((line) => line.trim().length > 0);
  }

  function flush(): string[] {
    const result = remainder.trim().length > 0 ? [remainder.trim()] : [];
    remainder = '';
    return result;
  }

  return { push, flush };
}
```

Usage in the watcher callback:

```typescript
const parser = createNdjsonTailParser();

const watcher = createFileWatcher(filePath, {
  onNewChunk(rawChunk) {
    const lines = parser.push(rawChunk);
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        // dispatch entry to IPC / grouping logic
      } catch {
        console.warn('[file-watcher] Malformed NDJSON line, skipping:', line.slice(0, 80));
      }
    }
  },
  onError(err) {
    console.error('[file-watcher] Error:', err);
  },
  onRotation(_newPath) {
    parser.flush(); // discard incomplete partial line from old file
  },
});
```

### Handling File Rotation

The proxy-inspector is a single-file viewer; the investigation document states "file rotation creates a new file; the inspector is a single-file viewer." However, the watcher should still handle the case where the watched file is replaced (rotated externally).

Detection strategy using `fs.watch`:

When a file is renamed/deleted and recreated at the same path, `fs.watch` on the original file path may:
- Continue firing on the old inode (macOS kqueue behavior) — events stop after the file is deleted
- Fire a `rename` event and then go silent

A robust approach polls for file existence on `rename` events and restarts the watcher:

```typescript
function onWatchEvent(eventType: string, _filename: string | null): void {
  // On macOS, eventType is always 'rename' regardless of what happened.
  // Check if the file still exists to detect deletion/rotation.
  if (!fs.existsSync(filePath)) {
    // File was deleted or renamed — rotation detected
    stop();
    // Poll until the file reappears (new rotation target)
    waitForFileReappearance(filePath, () => {
      bytesRead = 0; // reset offset for new file
      parser.flush();
      start();
      callbacks.onRotation(filePath);
    });
    return;
  }

  if (debounceTimer !== null) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    readNewBytes();
  }, 500);
}

function waitForFileReappearance(filePath: string, callback: () => void): void {
  const interval = setInterval(() => {
    if (fs.existsSync(filePath)) {
      clearInterval(interval);
      callback();
    }
  }, 200);
}
```

Note: for the proxy-inspector's stated use case (append-only, single-session file), rotation handling is a defensive measure. The investigation document confirms the proxy does not rotate files during a session.

### Alternative: fs.createReadStream with start Option

A cleaner async alternative that avoids manual fd management uses `fs.createReadStream` with a `start` byte offset:

```typescript
async function readNewBytesStream(filePath: string, fromByte: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const stream = fs.createReadStream(filePath, { start: fromByte, encoding: 'utf8' });
    stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    stream.on('error', reject);
  });
}
```

The `start` option maps to `pread(2)` internally. Both approaches (readSync with position, createReadStream with start) are correct; the synchronous approach has slightly less overhead for small chunks.

### Should You Use chokidar Instead?

The investigation document explicitly chose `fs.watch` over chokidar to avoid external dependencies. However, for context:

**chokidar** (v4, released Sep 2024) is the industry standard for reliable file watching. It wraps `fsevents` on macOS (which uses FSEvents rather than kqueue, giving directory-level efficiency), normalizes events, deduplicates, and provides clean `add`/`change`/`unlink` semantics. If cross-platform support or edge-case reliability becomes a concern, chokidar is the migration path.

For the proxy-inspector (macOS-focused developer tool, single file, append-only), `fs.watch` with the debounce + stat guard pattern is sufficient.

### Summary: fs.watch Pattern for Proxy Inspector

| Concern | Solution |
|---|---|
| macOS emits 'rename' not 'change' | Ignore event type; always call `statSync` to check actual size |
| Duplicate events per write | Debounce at 500ms (matches proxy flush interval) |
| False positives (no new bytes) | Guard: `if (stat.size <= bytesRead) return` |
| File truncation / rotation | Guard: `if (stat.size < bytesRead) bytesRead = 0` |
| Partial lines at chunk boundary | `NdjsonTailParser` with remainder buffer |
| Malformed JSON lines | `try/catch` around `JSON.parse`, log warning and skip |
| Memory management | Close fd immediately after read; open/close per event |

---

## Topic 2: react-window for Variable-Height Master-Detail Lists

### react-window Version Situation

react-window 2.0 (latest: **2.2.7** as of early 2026) is a **major API rewrite** compared to the widely-documented v1.8.x. The v2 API is what you will get from `npm install react-window` today.

**Key API changes in v2**:
- `FixedSizeList` and `VariableSizeList` are **replaced** by a single `List` component
- `FixedSizeGrid` and `VariableSizeGrid` are **replaced** by a single `Grid` component
- The children render prop pattern is replaced by `rowComponent` / `cellComponent` props
- `itemData` is replaced by `rowProps` / `cellProps` (automatically memoized)
- `AutoSizer` from `react-virtualized-auto-sizer` is no longer needed (sizing is built-in)
- New hooks: `useListRef`, `useDynamicRowHeight`
- Native TypeScript support (no `@types/react-window` needed)

The v1.8.x `VariableSizeList` API (`scrollToItem`, `resetAfterIndex`) documented in most tutorials and Stack Overflow answers is **no longer the current API**.

### FixedSizeList vs VariableSizeList (v2 Equivalents)

In v2 terminology:

| v1 Concept | v2 Equivalent | When to Use |
|---|---|---|
| `FixedSizeList` | `List` with `rowHeight={number}` | All cards have the same height |
| `VariableSizeList` | `List` with `rowHeight={(index, props) => number}` | Cards have different heights |
| `VariableSizeList` + dynamic measurement | `List` with `rowHeight={useDynamicRowHeight(...)}` | Heights determined at render time |

For the proxy-inspector interaction list, cards will have different heights because:
- Cards with tool call badges are taller than plain text response cards
- Cards that show additional metadata (token counts, duration) vary by content
- Potentially expandable cards

**Recommendation**: Use `List` with a static `rowHeight` function first. If cards have a small number of well-defined height variants (e.g., "simple card" = 72px, "card with tools" = 96px, "card with multiple tools" = 120px), the static function is simpler and more performant. Use `useDynamicRowHeight` only if heights genuinely cannot be calculated from data.

### Basic List Setup (v2 API)

```tsx
// src/renderer/components/InteractionList.tsx

import { List, useListRef, type RowComponentProps } from 'react-window';
import type { InteractionGroup } from '../../shared/types';

// Height function: called at render time with index + rowProps
function rowHeight(index: number, { interactions }: RowProps): number {
  const interaction = interactions[index];
  const toolCallCount = interaction.toolCalls?.length ?? 0;
  if (toolCallCount === 0) return 72;       // Simple card: title + metadata
  if (toolCallCount <= 2) return 96;        // 1-2 tool badges
  return 120;                               // 3+ tool badges
}

type RowProps = {
  interactions: InteractionGroup[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

function InteractionRow({
  index,
  interactions,
  selectedId,
  onSelect,
  style,
}: RowComponentProps<RowProps>) {
  const interaction = interactions[index];
  const isSelected = interaction.id === selectedId;

  return (
    <div
      style={style}
      className={`interaction-card ${isSelected ? 'selected' : ''}`}
      onClick={() => onSelect(interaction.id)}
      role="option"
      aria-selected={isSelected}
    >
      <div className="card-header">
        <span className="card-index">#{index + 1}</span>
        <span className="card-message">{interaction.userMessage}</span>
        <span className={`card-status status-${interaction.status}`}>
          {interaction.status}
        </span>
      </div>
      <div className="card-meta">
        <span>{formatDuration(interaction.durationMs)}</span>
        <span>{formatTokens(interaction.totalTokens)}</span>
      </div>
      {interaction.toolCalls && interaction.toolCalls.length > 0 && (
        <div className="card-tools">
          {interaction.toolCalls.map((tool) => (
            <span key={tool.name} className="tool-badge">{tool.name}</span>
          ))}
        </div>
      )}
    </div>
  );
}

interface InteractionListProps {
  interactions: InteractionGroup[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  listRef: ReturnType<typeof useListRef<null>>;
}

export function InteractionList({
  interactions,
  selectedId,
  onSelect,
  listRef,
}: InteractionListProps) {
  return (
    <List
      listRef={listRef}
      rowComponent={InteractionRow}
      rowCount={interactions.length}
      rowHeight={rowHeight}
      rowProps={{ interactions, selectedId, onSelect }}
      role="listbox"
      aria-label="Interactions"
      className="interaction-list"
    />
  );
}
```

### Dynamic Row Height Measurement (useDynamicRowHeight)

When card heights truly depend on rendered content (e.g., a user message that wraps to multiple lines), use `useDynamicRowHeight`:

```tsx
import {
  List,
  useListRef,
  useDynamicRowHeight,
  type RowComponentProps,
} from 'react-window';

type RowProps = {
  interactions: InteractionGroup[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

function InteractionRow({
  index,
  ariaAttributes,
  interactions,
  selectedId,
  onSelect,
  style,
}: RowComponentProps<RowProps>) {
  const interaction = interactions[index];

  return (
    // The outer div must use the provided `style` for positioning.
    // Do NOT add padding/margin to this div — it affects height measurement.
    // Use an inner wrapper for padding instead.
    <div style={style} {...ariaAttributes}>
      <div className="interaction-card-inner">
        {/* card content here */}
        <span>{interaction.userMessage}</span>
      </div>
    </div>
  );
}

function InteractionListDynamic({ interactions }: { interactions: InteractionGroup[] }) {
  const listRef = useListRef(null);

  // useDynamicRowHeight uses ResizeObserver to measure rendered rows.
  // defaultRowHeight is the initial estimate before measurement.
  const rowHeight = useDynamicRowHeight({ defaultRowHeight: 80 });

  return (
    <List
      listRef={listRef}
      rowComponent={InteractionRow}
      rowCount={interactions.length}
      rowHeight={rowHeight}
      rowProps={{ interactions, selectedId: null, onSelect: () => {} }}
    />
  );
}
```

**Important constraints with useDynamicRowHeight**:
- Uses `ResizeObserver` internally — rows must be in the DOM for measurement
- Does not call ResizeObserver during server rendering (safe for SSR if needed)
- Initial render uses `defaultRowHeight`; rows adjust on first paint
- This can cause a visible height "pop" on first render for variable content

### Keyboard Navigation with Arrow Keys

react-window (v2) does not implement keyboard navigation natively. You must handle `ArrowUp`/`ArrowDown` at the container level and call `listRef.current.scrollToRow()` to keep the selected item visible.

```tsx
// src/renderer/hooks/useListKeyboardNav.ts

import { useCallback } from 'react';
import { useListRef } from 'react-window';

interface UseListKeyboardNavOptions {
  itemCount: number;
  selectedIndex: number | null;
  onSelectIndex: (index: number) => void;
  listRef: ReturnType<typeof useListRef<null>>;
}

export function useListKeyboardNav({
  itemCount,
  selectedIndex,
  onSelectIndex,
  listRef,
}: UseListKeyboardNavOptions) {
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (itemCount === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault(); // Prevent browser scroll
        const next = selectedIndex === null ? 0 : Math.min(selectedIndex + 1, itemCount - 1);
        onSelectIndex(next);
        listRef.current?.scrollToRow({
          index: next,
          align: 'auto',    // Only scrolls if item is not already visible
          behavior: 'smooth',
        });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = selectedIndex === null ? 0 : Math.max(selectedIndex - 1, 0);
        onSelectIndex(prev);
        listRef.current?.scrollToRow({
          index: prev,
          align: 'auto',
          behavior: 'smooth',
        });
      } else if (e.key === 'Home') {
        e.preventDefault();
        onSelectIndex(0);
        listRef.current?.scrollToRow({ index: 0, align: 'start' });
      } else if (e.key === 'End') {
        e.preventDefault();
        const last = itemCount - 1;
        onSelectIndex(last);
        listRef.current?.scrollToRow({ index: last, align: 'end' });
      }
    },
    [itemCount, selectedIndex, onSelectIndex, listRef],
  );

  return { handleKeyDown };
}
```

Wiring the keyboard handler to the container:

```tsx
// The list container div must be focusable (tabIndex={0}) to receive key events.
// Without this, keyboard events will not reach the handler.

function InteractionPanel({ interactions }: { interactions: InteractionGroup[] }) {
  const listRef = useListRef(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const { handleKeyDown } = useListKeyboardNav({
    itemCount: interactions.length,
    selectedIndex,
    onSelectIndex: setSelectedIndex,
    listRef,
  });

  return (
    <div
      className="interaction-panel"
      tabIndex={0}           // Required: makes div keyboard-focusable
      onKeyDown={handleKeyDown}
      role="listbox"
      aria-label="Interactions"
    >
      <InteractionList
        interactions={interactions}
        selectedId={selectedIndex !== null ? interactions[selectedIndex]?.id : null}
        onSelect={(id) => {
          const idx = interactions.findIndex((i) => i.id === id);
          if (idx !== -1) setSelectedIndex(idx);
        }}
        listRef={listRef}
      />
    </div>
  );
}
```

**Note on browser scroll conflict**: When the list container div has `tabIndex={0}` and is focused, the browser's native scroll behavior for `ArrowUp`/`ArrowDown` will conflict with the list's own scroll. The `e.preventDefault()` calls in the handler suppress the native scroll, allowing the list to manage its own scrolling via `scrollToRow`.

### Scroll-to-Item API for Live Tail Auto-Scroll

The live-tail feature requires auto-scrolling to the latest item when new events arrive — but only if the user has not manually scrolled away from the bottom.

```tsx
// src/renderer/hooks/useLiveTail.ts

import { useEffect, useRef, useCallback } from 'react';
import { useListRef } from 'react-window';

interface UseLiveTailOptions {
  itemCount: number;
  listRef: ReturnType<typeof useListRef<null>>;
}

export function useLiveTail({ itemCount, listRef }: UseLiveTailOptions) {
  // Track whether the user is at the bottom of the list
  const isAtBottomRef = useRef(true);

  const handleScroll = useCallback(
    ({
      scrollOffset,
      scrollUpdateWasRequested,
    }: {
      scrollOffset: number;
      scrollUpdateWasRequested: boolean;
    }) => {
      // scrollUpdateWasRequested is true when scroll was triggered programmatically
      // (e.g. from scrollToRow). Only update isAtBottom for user-initiated scrolls.
      if (!scrollUpdateWasRequested) {
        // We don't have direct access to scrollHeight from the List's onScroll
        // callback. Use a heuristic: if the user scrolls up at all, they are
        // no longer at the bottom. Reset when they scroll to the last item.
        // A more precise approach tracks scrollHeight via a ResizeObserver on
        // the outer list container element.
        isAtBottomRef.current = false;
      }
    },
    [],
  );

  // When new items arrive, scroll to the last one if we were at the bottom
  useEffect(() => {
    if (itemCount === 0) return;
    if (isAtBottomRef.current) {
      listRef.current?.scrollToRow({
        index: itemCount - 1,
        align: 'end',
        behavior: 'smooth',
      });
    }
  }, [itemCount, listRef]);

  // Allow the user to manually jump to the tail and re-enable auto-scroll
  const scrollToTail = useCallback(() => {
    if (itemCount === 0) return;
    isAtBottomRef.current = true;
    listRef.current?.scrollToRow({
      index: itemCount - 1,
      align: 'end',
      behavior: 'smooth',
    });
  }, [itemCount, listRef]);

  return { handleScroll, scrollToTail, isAtBottom: isAtBottomRef };
}
```

Integrating `onScroll` with the List:

```tsx
// In react-window v2, pass onScroll via the List's props.
// Note: verify exact prop name in v2 docs; it may be onRowsRendered
// with visible row tracking as the alternative approach.

<List
  listRef={listRef}
  rowComponent={InteractionRow}
  rowCount={interactions.length}
  rowHeight={rowHeight}
  rowProps={{ interactions, selectedId, onSelect }}
  onScroll={handleScroll}
/>
```

**More precise bottom-detection** using the `onRowsRendered` callback:

```tsx
// onRowsRendered (v2 API) receives visible and all-rows info.
// If the last visible item is the last item, the user is at the bottom.

function onRowsRendered(
  visibleRows: { startIndex: number; stopIndex: number },
  _allRows: { startIndex: number; stopIndex: number }
) {
  isAtBottomRef.current = visibleRows.stopIndex >= interactions.length - 1;
}

<List
  listRef={listRef}
  rowComponent={InteractionRow}
  rowCount={interactions.length}
  rowHeight={rowHeight}
  rowProps={{ interactions, selectedId, onSelect }}
  onRowsRendered={onRowsRendered}
/>
```

### Master-Detail Integration Pattern

The master-detail layout connects the interaction list (left panel) to the event timeline and payload detail (right panel). The selected interaction ID is the shared state.

```tsx
// src/renderer/App.tsx

import { useState, useCallback } from 'react';
import { useListRef } from 'react-window';
import { InteractionList } from './components/InteractionList';
import { DetailPanel } from './components/DetailPanel';
import { useLiveTail } from './hooks/useLiveTail';
import { useListKeyboardNav } from './hooks/useListKeyboardNav';
import type { InteractionGroup } from '../shared/types';

export function App() {
  const [interactions, setInteractions] = useState<InteractionGroup[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const listRef = useListRef(null);

  const selectedInteraction = selectedIndex !== null
    ? interactions[selectedIndex]
    : null;

  const handleSelect = useCallback((id: string) => {
    const idx = interactions.findIndex((i) => i.id === id);
    if (idx !== -1) setSelectedIndex(idx);
  }, [interactions]);

  const { handleScroll, scrollToTail, isAtBottom } = useLiveTail({
    itemCount: interactions.length,
    listRef,
  });

  const { handleKeyDown } = useListKeyboardNav({
    itemCount: interactions.length,
    selectedIndex,
    onSelectIndex: setSelectedIndex,
    listRef,
  });

  return (
    <div className="app-layout">
      <div
        className="left-panel"
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        <InteractionList
          interactions={interactions}
          selectedId={selectedInteraction?.id ?? null}
          onSelect={handleSelect}
          listRef={listRef}
        />
        {!isAtBottom.current && (
          <button className="scroll-to-tail-btn" onClick={scrollToTail}>
            New events ↓
          </button>
        )}
      </div>
      <div className="right-panel">
        {selectedInteraction ? (
          <DetailPanel interaction={selectedInteraction} />
        ) : (
          <div className="no-selection">Select an interaction to view details</div>
        )}
      </div>
    </div>
  );
}
```

### Handling New Items from Live Tail

When new interaction groups arrive via IPC from the main process, they must be appended to the existing list. If the interaction already exists (partial update for an in-progress interaction), it must be merged rather than appended:

```typescript
// src/renderer/hooks/useFileData.ts

import { useState, useEffect } from 'react';
import type { InteractionGroup } from '../../shared/types';

export function useFileData() {
  const [interactions, setInteractions] = useState<InteractionGroup[]>([]);

  useEffect(() => {
    // Initial full load
    window.api.onFileData((_event: unknown, data: InteractionGroup[]) => {
      setInteractions(data);
    });

    // Incremental updates from live tail
    window.api.onNewEvents((_event: unknown, newGroups: InteractionGroup[]) => {
      setInteractions((prev) => {
        const map = new Map(prev.map((i) => [i.id, i]));
        for (const group of newGroups) {
          map.set(group.id, group); // Overwrite if exists (in-progress update), append if new
        }
        return Array.from(map.values());
      });
    });
  }, []);

  return { interactions };
}
```

### Performance Considerations

**Do not put heavy computation in the rowHeight function.** It is called during every render and scroll event for all visible + overscan items. Derive heights from simple data properties (e.g., `toolCalls.length`), not from DOM measurement.

**Use `React.memo` equivalents for row components.** In react-window v2, `rowProps` is automatically memoized by the `List` component, so pure row components will not re-render unless `rowProps` changes. Keep `rowProps` stable and avoid creating new object references on every parent render.

**Set `overscanCount` appropriately.** The default is 1 (one extra row above and below the visible area). For the proxy-inspector, where cards may have complex content, consider `overscanCount={3}` to reduce flash of empty space during fast keyboard navigation. Higher values increase DOM node count.

**Avoid `resetAfterIndex` when possible in v2.** In v1 `VariableSizeList`, calling `resetAfterIndex(0)` was required whenever heights changed. In v2, when `rowHeight` is a function, the framework re-evaluates it on every render. This is handled correctly without manual cache invalidation in most cases. With `useDynamicRowHeight`, invalidation is handled internally by `ResizeObserver`.

### Summary: react-window v2 for Proxy Inspector

| Need | Solution |
|---|---|
| Variable card heights (few discrete sizes) | `List` with static `rowHeight` function |
| Heights determined at render time | `List` with `useDynamicRowHeight({ defaultRowHeight })` |
| Programmatic scroll to selected item | `useListRef` + `listRef.current.scrollToRow({ index, align: 'auto' })` |
| Auto-scroll on new events | `useEffect` on `itemCount` + `listRef.current.scrollToRow({ index: last, align: 'end' })` |
| Keyboard navigation (arrow keys) | `tabIndex={0}` container + `onKeyDown` + `scrollToRow` with `align: 'auto'` |
| Bottom-detection for live tail | `onRowsRendered` callback: check `visibleRows.stopIndex >= itemCount - 1` |
| Detail panel selection | Lift `selectedIndex` state to parent; pass `selectedId` as `rowProps` |
| Panel resize (Electron window resize) | `List` auto-sizes in v2 (no AutoSizer needed); use CSS `height: 100%` on container |

---

## Assumptions & Scope

| Assumption | Confidence | Impact if Wrong |
|---|---|---|
| The file is append-only during a session (no truncation) | HIGH | Would need to handle `stat.size < bytesRead` as common case; reset offset to 0 |
| The proxy flushes every 500ms as documented in the investigation | HIGH | If flush interval changes, debounce duration should match it |
| react-window v2.2.7 is the version that will be installed | HIGH | v1.8.x has a completely different API; the `VariableSizeList`/`scrollToItem`/`resetAfterIndex` API documented in most tutorials does not apply |
| macOS is the primary deployment target | HIGH | On Linux/Windows, `fs.watch` event types behave differently (may get 'change' events) |
| Interaction cards have a small number of discrete height variants | MEDIUM | If heights are fully dynamic (e.g., wrapping user messages), `useDynamicRowHeight` is needed |
| The `onScroll` prop on react-window v2 `List` exists with the described signature | MEDIUM | The v2 API is relatively new; exact prop name should be verified against the official v2 docs |

### Uncertainties & Gaps

- **react-window v2 `onScroll` prop signature**: The exact callback signature for scroll events in v2 was not confirmed from official docs in this research session. The v1 signature was `({ scrollDirection, scrollOffset, scrollUpdateWasRequested })`. Verify in the v2 documentation at https://react-window.vercel.app/ before implementing.

- **`useDynamicRowHeight` ResizeObserver timing**: There is a known edge case in v2.2.1 where a "scroll-jump scenario" with `useDynamicRowHeight` was fixed. The exact conditions that trigger this are not documented. Monitor for visual glitches when first rendering a long list with dynamic heights.

- **fs.watch on Electron**: `fs.watch` behavior inside an Electron main process is expected to be identical to Node.js standalone, as Electron uses the same libuv event loop. This was not explicitly confirmed from Electron-specific documentation.

- **react-window v2 `onRowsRendered` callback behavior**: The v2 changelog (2.1.0) changed this callback to pass two params (visible rows and all rows including overscan). Ensure the handler signature matches the v2 signature exactly.

### Clarifying Questions for Follow-up

1. Should interaction cards ever be expandable in-place (showing a mini event timeline) within the master list? If yes, `useDynamicRowHeight` becomes necessary as heights will change on toggle.
2. Is there a minimum card height requirement for touch/accessibility? A 72px minimum is assumed; this affects the static `rowHeight` function values.
3. Should the proxy-inspector handle multiple simultaneously open files in tabs? If yes, the watcher architecture needs to be adapted for multiple watcher instances.
4. What is the maximum expected number of interactions in a single session file? The investigation mentions "thousands of interactions" at 100MB — if 10,000+ is realistic, overscan settings and scroll performance should be stress-tested.

---

## References

| # | Source | URL | Information Gathered |
|---|--------|-----|---------------------|
| 1 | Node.js fs.watch GitHub Issue #7420 | https://github.com/nodejs/node/issues/7420 | Confirmed that `fs.watch` on macOS always emits 'rename', not 'change'; marked wontfix |
| 2 | Node.js fs.watch duplicate events issue #3042 | https://github.com/nodejs/node/issues/3042 | Documents that a single file write triggers two kqueue events, causing duplicate callbacks |
| 3 | react-window CHANGELOG (official) | https://raw.githubusercontent.com/bvaughn/react-window/master/CHANGELOG.md | Confirmed v2 API: `List` replaces `FixedSizeList`/`VariableSizeList`; `useListRef`; `useDynamicRowHeight`; `rowComponent` pattern; migration guide |
| 4 | react-window npm page | https://www.npmjs.com/package/react-window | Confirmed latest version is 2.2.7 |
| 5 | react-window Context7 docs | https://context7.com/bvaughn/react-window/llms.txt | API examples for `useListRef`, `useDynamicRowHeight`, `scrollToRow`, `onRowsRendered` |
| 6 | Node.js File System docs | https://nodejs.org/api/fs.html | `fs.read` with position parameter; `fs.createReadStream` with start/end; `fs.watch` event semantics |
| 7 | thisDaveJ: Watch for File Changes in Node.js | https://thisdavej.com/how-to-watch-for-file-changes-in-node-js/ | Debounce pattern; mtime-based false-positive guard |
| 8 | web.dev: Virtualize large lists with react-window | https://web.dev/virtualize-long-lists-react-window/ | VariableSizeList (v1) patterns; overscanCount guidance |
| 9 | react-window GitHub Issue #490 | https://github.com/bvaughn/react-window/issues/490 | Confirmed react-window does not natively handle arrow-key item selection |
| 10 | react-window GitHub Issue #202 | https://github.com/bvaughn/react-window/issues/202 | VariableSizeList cache invalidation requirements (v1) |
| 11 | oneuptime.com: Node.js watch file changes | https://oneuptime.com/blog/post/2026-01-22-nodejs-watch-file-changes/view | Summary of fs.watch platform behavior and chokidar alternative |
| 12 | chokidar GitHub | https://github.com/paulmillr/chokidar | FSEvents-based alternative; v4 released Sep 2024 with reduced dependencies |
| 13 | tailing-stream npm | https://www.npmjs.com/package/tailing-stream | Reference implementation of fs.watch + tailing pattern |
| 14 | LogRocket: react-window virtualization | https://blog.logrocket.com/how-to-virtualize-large-lists-using-react-window/ | VariableSizeList dynamic height patterns; resetAfterIndex usage (v1 reference) |

### Recommended for Deep Reading

- **react-window v2 official docs** (https://react-window.vercel.app/): The single authoritative source for the v2 API. Most tutorials online document v1.8.x, which has a different API.
- **Node.js fs.watch GitHub Issue #7420** (https://github.com/nodejs/node/issues/7420): Essential reading for understanding why event type filtering is unreliable on macOS and the official position on fixing it.
- **react-window CHANGELOG** (https://github.com/bvaughn/react-window/blob/main/CHANGELOG.md): Covers the complete v1→v2 migration guide with before/after examples for all component types.
