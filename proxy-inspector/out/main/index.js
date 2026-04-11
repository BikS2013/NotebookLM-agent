"use strict";
const electron = require("electron");
const path$1 = require("path");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
function _interopNamespaceDefault(e) {
  const n = Object.create(null, { [Symbol.toStringTag]: { value: "Module" } });
  if (e) {
    for (const k in e) {
      if (k !== "default") {
        const d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: () => e[k]
        });
      }
    }
  }
  n.default = e;
  return Object.freeze(n);
}
const fs__namespace = /* @__PURE__ */ _interopNamespaceDefault(fs);
const os__namespace = /* @__PURE__ */ _interopNamespaceDefault(os);
const path__namespace = /* @__PURE__ */ _interopNamespaceDefault(path);
const IPC = {
  // Renderer -> Main (invoke/handle)
  OPEN_FILE: "proxy-inspector:open-file",
  OPEN_RECENT: "proxy-inspector:open-recent",
  GET_INTERACTION_DETAIL: "proxy-inspector:get-interaction-detail",
  SEARCH: "proxy-inspector:search",
  PAUSE_WATCH: "proxy-inspector:pause-watch",
  GET_RECENT_FILES: "proxy-inspector:get-recent-files",
  NEW_EVENTS: "proxy-inspector:new-events"
};
const ADK_EVENTS = /* @__PURE__ */ new Set([
  "interaction_start",
  "llm_request",
  "llm_response",
  "tool_start",
  "tool_result",
  "tool_error",
  "llm_error",
  "interaction_end"
]);
const LANGGRAPH_EVENTS = /* @__PURE__ */ new Set([
  "llm_call_start",
  "llm_call_end",
  "tool_call_start",
  "tool_call_end",
  "turn_summary"
]);
function detectFormat(obj) {
  if (typeof obj.event === "string" && ADK_EVENTS.has(obj.event)) {
    return "adk-proxy";
  }
  if (typeof obj.type === "string" && LANGGRAPH_EVENTS.has(obj.type)) {
    return "langgraph";
  }
  return null;
}
function validateAdkEntry(record, lineIndex) {
  if (typeof record.interactionId !== "string" || record.interactionId.length === 0) {
    console.warn("[ndjson-parser] Missing or empty interactionId");
    return null;
  }
  if (typeof record.timestamp !== "string") {
    console.warn("[ndjson-parser] Missing timestamp");
    return null;
  }
  return {
    event: record.event,
    timestamp: record.timestamp,
    interactionId: record.interactionId,
    roundTrip: typeof record.roundTrip === "number" ? record.roundTrip : void 0,
    payload: typeof record.payload === "object" && record.payload !== null ? record.payload : {},
    lineIndex
  };
}
function normalizeLangGraphEntry(record, lineIndex) {
  const eventType = record.type;
  const data = record.data;
  if (!data || typeof data !== "object") return null;
  const interactionId = `lg-temp-${lineIndex}`;
  const timestamp = data.timestamp ?? data.startTime ?? (/* @__PURE__ */ new Date()).toISOString();
  const payload = { ...data };
  return {
    event: eventType,
    timestamp,
    interactionId,
    roundTrip: void 0,
    payload,
    lineIndex
  };
}
function groupByTurns(entries) {
  if (entries.length === 0) return entries;
  const turnSummaryIndices = [];
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].event === "turn_summary") {
      turnSummaryIndices.push(i);
    }
  }
  if (turnSummaryIndices.length === 0) {
    const id = "lg-turn-pending";
    return entries.map((e) => ({ ...e, interactionId: id }));
  }
  const result = [];
  let prevBoundary = 0;
  for (const tsIdx of turnSummaryIndices) {
    const ts = entries[tsIdx];
    const data = ts.payload;
    const threadId = data.threadId ?? "unknown";
    const turnNumber = data.turnNumber ?? 0;
    const turnId = `lg-${threadId}-turn-${turnNumber}`;
    for (let i = prevBoundary; i <= tsIdx; i++) {
      result.push({ ...entries[i], interactionId: turnId });
    }
    prevBoundary = tsIdx + 1;
  }
  if (prevBoundary < entries.length) {
    const lastTurn = entries[turnSummaryIndices[turnSummaryIndices.length - 1]];
    const threadId = lastTurn.payload.threadId ?? "unknown";
    const lastTurnNum = lastTurn.payload.turnNumber ?? 0;
    const pendingId = `lg-${threadId}-turn-${lastTurnNum + 1}`;
    for (let i = prevBoundary; i < entries.length; i++) {
      result.push({ ...entries[i], interactionId: pendingId });
    }
  }
  return result;
}
function createNdjsonParser() {
  let remainder = "";
  let lineCount = 0;
  let detectedFormat = null;
  function parseOne(obj, lineIndex) {
    const format = detectFormat(obj);
    if (format === null) {
      console.warn(`[ndjson-parser] Unrecognized format at line ~${lineIndex}`);
      return null;
    }
    if (detectedFormat === null) {
      detectedFormat = format;
      console.log(`[ndjson-parser] Detected log format: ${format}`);
    }
    if (format === "adk-proxy") {
      return validateAdkEntry(obj, lineIndex);
    } else {
      return normalizeLangGraphEntry(obj, lineIndex);
    }
  }
  function push(rawChunk) {
    const combined = remainder + rawChunk;
    const segments = combined.split("\n");
    remainder = segments.pop();
    const results = [];
    for (const segment of segments) {
      const trimmed = segment.trim();
      if (trimmed.length === 0) continue;
      try {
        const parsed = JSON.parse(trimmed);
        const entry = parseOne(parsed, lineCount);
        if (entry !== null) {
          results.push(entry);
          lineCount++;
        }
      } catch {
        console.warn(`[ndjson-parser] Malformed JSON at line ~${lineCount}: ${trimmed.slice(0, 80)}...`);
      }
    }
    return results;
  }
  function flush() {
    if (remainder.trim().length === 0) {
      remainder = "";
      return [];
    }
    const trimmed = remainder.trim();
    remainder = "";
    try {
      const parsed = JSON.parse(trimmed);
      const entry = parseOne(parsed, lineCount);
      if (entry !== null) {
        lineCount++;
        return [entry];
      }
    } catch {
      console.warn(`[ndjson-parser] Malformed JSON in flush: ${trimmed.slice(0, 80)}...`);
    }
    return [];
  }
  function reset() {
    remainder = "";
    lineCount = 0;
    detectedFormat = null;
  }
  return {
    push,
    flush,
    reset,
    get lineCount() {
      return lineCount;
    },
    get detectedFormat() {
      return detectedFormat;
    }
  };
}
function deriveSummary(id, index, events) {
  const isLangGraph = events.some(
    (e) => e.event === "turn_summary" || e.event === "llm_call_start" || e.event === "llm_call_end"
  );
  if (isLangGraph) {
    return deriveLangGraphSummary(id, index, events);
  }
  return deriveAdkSummary(id, index, events);
}
function deriveAdkSummary(id, index, events) {
  const startEvent = events.find((e) => e.event === "interaction_start");
  const endEvent = events.find((e) => e.event === "interaction_end");
  const hasErrors = events.some(
    (e) => e.event === "llm_error" || e.event === "tool_error"
  );
  const userMessage = startEvent?.payload?.userMessage ?? "";
  const status = hasErrors ? "error" : endEvent ? "complete" : "in-progress";
  const endRoundTripCount = endEvent?.payload?.roundTripCount;
  const maxRoundTrip = events.filter((e) => e.roundTrip != null).map((e) => e.roundTrip);
  const roundTripCount = endRoundTripCount ?? (maxRoundTrip.length > 0 ? Math.max(...maxRoundTrip) : 0);
  const endToolCalls = endEvent?.payload?.toolCalls;
  const toolCalls = endToolCalls ?? events.filter((e) => e.event === "tool_start").map((e) => e.payload?.toolName ?? "unknown");
  return {
    id,
    index,
    userMessage: userMessage.slice(0, 100),
    timestamp: startEvent?.timestamp ?? events[0].timestamp,
    status,
    durationMs: endEvent?.payload?.durationMs ?? null,
    roundTripCount,
    totalPromptTokens: endEvent?.payload?.totalPromptTokens ?? 0,
    totalCompletionTokens: endEvent?.payload?.totalCompletionTokens ?? 0,
    totalTokens: endEvent?.payload?.totalTokens ?? 0,
    toolCalls,
    hasErrors,
    eventCount: events.length
  };
}
function deriveLangGraphSummary(id, index, events) {
  const turnSummary = events.find((e) => e.event === "turn_summary");
  const llmEnds = events.filter((e) => e.event === "llm_call_end");
  const toolStarts = events.filter((e) => e.event === "tool_call_start");
  const hasErrors = false;
  const userMessage = turnSummary?.payload?.userInput ?? "";
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  if (turnSummary?.payload?.totalTokenUsage) {
    const usage = turnSummary.payload.totalTokenUsage;
    totalPromptTokens = usage.input_tokens ?? 0;
    totalCompletionTokens = usage.output_tokens ?? 0;
  } else {
    for (const llmEnd of llmEnds) {
      const usage = llmEnd.payload?.tokenUsage;
      if (usage) {
        totalPromptTokens += usage.input_tokens ?? 0;
        totalCompletionTokens += usage.output_tokens ?? 0;
      }
    }
  }
  const toolCalls = toolStarts.map((e) => e.payload?.toolName ?? "unknown");
  const durationMs = turnSummary?.payload?.turnDurationMs ?? null;
  const status = turnSummary ? "complete" : "in-progress";
  return {
    id,
    index,
    userMessage: userMessage.slice(0, 100),
    timestamp: turnSummary?.timestamp ?? events[0].timestamp,
    status,
    durationMs,
    roundTripCount: turnSummary?.payload?.llmCallCount ?? llmEnds.length,
    totalPromptTokens,
    totalCompletionTokens,
    totalTokens: totalPromptTokens + totalCompletionTokens,
    toolCalls,
    hasErrors,
    eventCount: events.length
  };
}
function createInteractionStore() {
  const interactions = /* @__PURE__ */ new Map();
  const summaryCache = /* @__PURE__ */ new Map();
  const insertionOrder = [];
  let nextIndex = 1;
  function addEntries(entries) {
    const affectedIds = /* @__PURE__ */ new Set();
    for (const entry of entries) {
      const id = entry.interactionId;
      let eventList = interactions.get(id);
      if (!eventList) {
        eventList = [];
        interactions.set(id, eventList);
        insertionOrder.push(id);
      }
      eventList.push(entry);
      affectedIds.add(id);
    }
    const updatedSummaries = [];
    for (const id of affectedIds) {
      const events = interactions.get(id);
      let existingSummary = summaryCache.get(id);
      const index = existingSummary?.index ?? nextIndex++;
      const summary = deriveSummary(id, index, events);
      summaryCache.set(id, summary);
      updatedSummaries.push(summary);
    }
    return updatedSummaries;
  }
  function getAllSummaries() {
    return insertionOrder.map((id) => summaryCache.get(id)).filter(Boolean);
  }
  function getDetail(interactionId) {
    const events = interactions.get(interactionId);
    if (!events) return void 0;
    const summary = summaryCache.get(interactionId);
    if (!summary) return void 0;
    const sortedEvents = [...events].sort((a, b) => a.lineIndex - b.lineIndex);
    return {
      summary,
      events: sortedEvents
    };
  }
  function getAggregates() {
    let totalTokens = 0;
    let totalToolCalls = 0;
    let firstTimestamp = null;
    let lastTimestamp = null;
    for (const summary of summaryCache.values()) {
      totalTokens += summary.totalTokens;
      totalToolCalls += summary.toolCalls.length;
      const ts = new Date(summary.timestamp).getTime();
      if (!isNaN(ts)) {
        if (firstTimestamp === null || ts < firstTimestamp) firstTimestamp = ts;
        if (lastTimestamp === null || ts > lastTimestamp) lastTimestamp = ts;
      }
    }
    for (const events of interactions.values()) {
      for (const event of events) {
        const ts = new Date(event.timestamp).getTime();
        if (!isNaN(ts)) {
          if (lastTimestamp === null || ts > lastTimestamp) lastTimestamp = ts;
        }
      }
    }
    return {
      totalInteractions: summaryCache.size,
      totalTokens,
      totalToolCalls,
      timeSpanMs: firstTimestamp !== null && lastTimestamp !== null ? lastTimestamp - firstTimestamp : 0
    };
  }
  function search(query) {
    if (query.trim().length === 0) return getAllSummaries();
    const lowerQuery = query.toLowerCase();
    return getAllSummaries().filter(
      (summary) => summary.userMessage.toLowerCase().includes(lowerQuery)
    );
  }
  function clear() {
    interactions.clear();
    summaryCache.clear();
    insertionOrder.length = 0;
    nextIndex = 1;
  }
  return {
    addEntries,
    getAllSummaries,
    getDetail,
    getAggregates,
    search,
    clear,
    get size() {
      return interactions.size;
    }
  };
}
function createFileTailer(filePath, callbacks) {
  let bytesRead = 0;
  let paused = false;
  let debounceTimer = null;
  let watcher = null;
  function readNewBytes() {
    let stat;
    try {
      stat = fs__namespace.statSync(filePath);
    } catch (err) {
      callbacks.onError(err);
      return;
    }
    if (stat.size < bytesRead) {
      bytesRead = 0;
    }
    if (stat.size <= bytesRead) {
      return;
    }
    const chunkSize = stat.size - bytesRead;
    const buffer = Buffer.allocUnsafe(chunkSize);
    let fd;
    try {
      fd = fs__namespace.openSync(filePath, "r");
    } catch (err) {
      callbacks.onError(err);
      return;
    }
    try {
      const actual = fs__namespace.readSync(fd, buffer, 0, chunkSize, bytesRead);
      bytesRead += actual;
      if (actual > 0) {
        callbacks.onNewChunk(buffer.subarray(0, actual).toString("utf8"));
      }
    } catch (err) {
      callbacks.onError(err);
    } finally {
      try {
        fs__namespace.closeSync(fd);
      } catch {
      }
    }
  }
  function onWatchEvent(_eventType, _filename) {
    if (paused) return;
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(readNewBytes, 500);
  }
  function start(fromByte) {
    stop();
    bytesRead = fromByte;
    paused = false;
    try {
      watcher = fs__namespace.watch(filePath, { persistent: false }, onWatchEvent);
      watcher.on("error", (err) => {
        callbacks.onError(err);
      });
    } catch (err) {
      callbacks.onError(err);
    }
  }
  function stop() {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (watcher !== null) {
      try {
        watcher.close();
      } catch {
      }
      watcher = null;
    }
  }
  function pauseTailer() {
    paused = true;
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  }
  function resumeTailer() {
    paused = false;
    readNewBytes();
  }
  return {
    start,
    stop,
    pause: pauseTailer,
    resume: resumeTailer,
    get bytesRead() {
      return bytesRead;
    },
    get isPaused() {
      return paused;
    }
  };
}
const CONFIG_DIR$1 = path__namespace.join(os__namespace.homedir(), ".proxy-inspector");
const RECENT_FILE = path__namespace.join(CONFIG_DIR$1, "recent.json");
const MAX_RECENT = 10;
const ADK_FILENAME_RE = /proxy-([a-f0-9-]{36})-(\d{4}-\d{2}-\d{2}T[\d-]+)\.ndjson$/;
const LG_FILENAME_RE = /monitoring-([a-z0-9]+)-(\d{4}-\d{2}-\d{2}T[\d-]+Z?)\.jsonl$/;
function createFileManager(mainWindow) {
  function parseFilename(filePath) {
    const basename = path__namespace.basename(filePath);
    const adkMatch = basename.match(ADK_FILENAME_RE);
    if (adkMatch) {
      const sessionId = adkMatch[1];
      const rawTimestamp = adkMatch[2];
      const createdAt = rawTimestamp.replace(
        /T(\d{2})-(\d{2})-(\d{2})/,
        "T$1:$2:$3"
      );
      return { sessionId, createdAt };
    }
    const lgMatch = basename.match(LG_FILENAME_RE);
    if (lgMatch) {
      const sessionId = lgMatch[1];
      const rawTimestamp = lgMatch[2];
      const createdAt = rawTimestamp.replace(
        /T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z?/,
        "T$1:$2:$3.$4Z"
      );
      return { sessionId, createdAt };
    }
    return {
      sessionId: path__namespace.basename(filePath, path__namespace.extname(filePath)),
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
  async function openFileDialog() {
    const result = await electron.dialog.showOpenDialog(mainWindow, {
      title: "Open NDJSON Log File",
      filters: [
        { name: "NDJSON Logs", extensions: ["ndjson", "jsonl"] },
        { name: "All Files", extensions: ["*"] }
      ],
      properties: ["openFile"]
    });
    if (result.canceled || result.filePaths.length === 0) {
      return void 0;
    }
    const filePath = result.filePaths[0];
    return openFilePath(filePath);
  }
  function openFilePath(filePath) {
    const stat = fs__namespace.statSync(filePath);
    const { sessionId, createdAt } = parseFilename(filePath);
    return {
      filePath,
      sessionId,
      createdAt,
      fileSize: stat.size
    };
  }
  function getRecentFiles() {
    try {
      const data = fs__namespace.readFileSync(RECENT_FILE, "utf8");
      const paths = JSON.parse(data);
      if (!Array.isArray(paths)) return [];
      return paths.filter((p) => {
        try {
          fs__namespace.accessSync(p, fs__namespace.constants.R_OK);
          return true;
        } catch {
          return false;
        }
      });
    } catch {
      return [];
    }
  }
  function addRecentFile(filePath) {
    try {
      const recent = getRecentFiles();
      const filtered = recent.filter((p) => p !== filePath);
      filtered.unshift(filePath);
      const trimmed = filtered.slice(0, MAX_RECENT);
      fs__namespace.mkdirSync(CONFIG_DIR$1, { recursive: true });
      fs__namespace.writeFileSync(RECENT_FILE, JSON.stringify(trimmed, null, 2), "utf8");
    } catch (err) {
      console.error("[file-manager] Failed to persist recent files:", err);
    }
  }
  return {
    openFileDialog,
    openFilePath,
    getRecentFiles,
    addRecentFile,
    parseFilename
  };
}
let store;
let fileManager;
let currentTailer = null;
let currentParser = null;
let activeWindow = null;
let handlersRegistered = false;
function createTailerAndParser(filePath) {
  const parser = createNdjsonParser();
  const tailer = createFileTailer(filePath, {
    onNewChunk(rawChunk) {
      const entries = parser.push(rawChunk);
      if (entries.length === 0) return;
      const updatedSummaries = store.addEntries(entries);
      if (updatedSummaries.length > 0 && activeWindow && !activeWindow.isDestroyed()) {
        const update = {
          interactions: updatedSummaries,
          aggregates: store.getAggregates()
        };
        activeWindow.webContents.send(IPC.NEW_EVENTS, update);
      }
    },
    onError(err) {
      console.error("[file-tailer] Error:", err.message);
    }
  });
  return { tailer, parser };
}
function openAndParseFile(filePath) {
  if (currentTailer) {
    currentTailer.stop();
    currentTailer = null;
  }
  if (currentParser) {
    currentParser.flush();
    currentParser = null;
  }
  store.clear();
  const fileInfo = fileManager.openFilePath(filePath);
  const content = fs__namespace.readFileSync(filePath, "utf8");
  const parser = createNdjsonParser();
  let entries = parser.push(content);
  entries.push(...parser.flush());
  if (parser.detectedFormat === "langgraph") {
    entries = groupByTurns(entries);
  }
  store.addEntries(entries);
  const { tailer, parser: tailParser } = createTailerAndParser(filePath);
  currentTailer = tailer;
  currentParser = tailParser;
  tailer.start(Buffer.byteLength(content, "utf8"));
  fileManager.addRecentFile(filePath);
  return {
    metadata: {
      filePath: fileInfo.filePath,
      sessionId: fileInfo.sessionId,
      createdAt: fileInfo.createdAt,
      fileSize: fileInfo.fileSize,
      logFormat: parser.detectedFormat ?? "adk-proxy"
    },
    interactions: store.getAllSummaries(),
    aggregates: store.getAggregates()
  };
}
function registerIpcHandlers(mainWindow) {
  activeWindow = mainWindow;
  store = createInteractionStore();
  fileManager = createFileManager(mainWindow);
  if (handlersRegistered) return;
  handlersRegistered = true;
  electron.ipcMain.handle(IPC.OPEN_FILE, async () => {
    try {
      const fileInfo = await fileManager.openFileDialog();
      if (!fileInfo) {
        return { ok: false, error: "No file selected" };
      }
      const data = openAndParseFile(fileInfo.filePath);
      return { ok: true, data };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[ipc] openFile error:", msg);
      return { ok: false, error: msg };
    }
  });
  electron.ipcMain.handle(IPC.OPEN_RECENT, async (_event, filePath) => {
    try {
      const data = openAndParseFile(filePath);
      return { ok: true, data };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[ipc] openRecent error:", msg);
      return { ok: false, error: msg };
    }
  });
  electron.ipcMain.handle(IPC.GET_INTERACTION_DETAIL, async (_event, interactionId) => {
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
  electron.ipcMain.handle(IPC.SEARCH, async (_event, query) => {
    try {
      return store.search(query);
    } catch (err) {
      console.error("[ipc] search error:", err);
      return [];
    }
  });
  electron.ipcMain.handle(IPC.PAUSE_WATCH, async (_event, paused) => {
    if (!currentTailer) return;
    if (paused) {
      currentTailer.pause();
    } else {
      currentTailer.resume();
    }
  });
  electron.ipcMain.handle(IPC.GET_RECENT_FILES, async () => {
    try {
      return fileManager.getRecentFiles();
    } catch (err) {
      console.error("[ipc] getRecentFiles error:", err);
      return [];
    }
  });
}
function cleanupIpcHandlers() {
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
const CONFIG_DIR = path__namespace.join(os__namespace.homedir(), ".proxy-inspector");
const WINDOW_STATE_FILE = path__namespace.join(CONFIG_DIR, "window-state.json");
function loadWindowState() {
  try {
    const data = fs__namespace.readFileSync(WINDOW_STATE_FILE, "utf8");
    const state = JSON.parse(data);
    const displays = electron.screen.getAllDisplays();
    const displayMatch = displays.some((d) => {
      const { x, y, width, height } = d.bounds;
      return state.x >= x && state.x < x + width && state.y >= y && state.y < y + height;
    });
    return displayMatch ? state : null;
  } catch {
    return null;
  }
}
function saveWindowState(win) {
  try {
    const bounds = win.getBounds();
    const state = {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height
    };
    fs__namespace.mkdirSync(CONFIG_DIR, { recursive: true });
    fs__namespace.writeFileSync(WINDOW_STATE_FILE, JSON.stringify(state, null, 2), "utf8");
  } catch (err) {
    console.error("[main] Failed to save window state:", err);
  }
}
function buildAppMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    // App menu (macOS only)
    ...isMac ? [
      {
        label: electron.app.name,
        submenu: [
          { role: "about" },
          { type: "separator" },
          { role: "quit" }
        ]
      }
    ] : [],
    // File menu
    {
      label: "File",
      submenu: [
        isMac ? { role: "close" } : { role: "quit" }
      ]
    },
    // Edit menu
    {
      label: "Edit",
      submenu: [
        { role: "copy" },
        { role: "selectAll" }
      ]
    },
    // View menu
    {
      label: "View",
      submenu: [
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "reload" }
      ]
    },
    // Window menu
    ...isMac ? [
      {
        label: "Window",
        submenu: [
          { role: "minimize" },
          { role: "zoom" }
        ]
      }
    ] : []
  ];
  return electron.Menu.buildFromTemplate(template);
}
function createWindow() {
  const savedState = loadWindowState();
  const win = new electron.BrowserWindow({
    width: savedState?.width ?? 1200,
    height: savedState?.height ?? 800,
    x: savedState?.x,
    y: savedState?.y,
    minWidth: 800,
    minHeight: 500,
    webPreferences: {
      preload: path$1.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    },
    titleBarStyle: "hiddenInset",
    backgroundColor: "#1e1e2e"
  });
  win.on("close", () => {
    saveWindowState(win);
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith("file://")) {
      event.preventDefault();
      const filePath = decodeURIComponent(new URL(url).pathname);
      if (filePath.endsWith(".ndjson") || filePath.endsWith(".jsonl")) {
        win.webContents.send("proxy-inspector:drag-drop", filePath);
      }
    }
  });
  registerIpcHandlers(win);
  if (process.env["ELECTRON_RENDERER_URL"]) {
    win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    win.loadFile(path$1.join(__dirname, "../renderer/index.html"));
  }
  return win;
}
electron.app.whenReady().then(() => {
  electron.Menu.setApplicationMenu(buildAppMenu());
  createWindow();
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});
electron.app.on("open-file", (event, filePath) => {
  event.preventDefault();
  if (!filePath.endsWith(".ndjson") && !filePath.endsWith(".jsonl")) {
    return;
  }
  const windows = electron.BrowserWindow.getAllWindows();
  if (windows.length > 0) {
    windows[0].webContents.send("proxy-inspector:drag-drop", filePath);
  }
});
electron.app.on("window-all-closed", () => {
  cleanupIpcHandlers();
  if (process.platform !== "darwin") {
    electron.app.quit();
  }
});
electron.app.on("before-quit", () => {
  cleanupIpcHandlers();
});
