"use strict";
const electron = require("electron");
const IPC = {
  // Renderer -> Main (invoke/handle)
  OPEN_FILE: "proxy-inspector:open-file",
  OPEN_RECENT: "proxy-inspector:open-recent",
  GET_INTERACTION_DETAIL: "proxy-inspector:get-interaction-detail",
  SEARCH: "proxy-inspector:search",
  PAUSE_WATCH: "proxy-inspector:pause-watch",
  GET_RECENT_FILES: "proxy-inspector:get-recent-files",
  // Main -> Renderer (send/on)
  FILE_DATA: "proxy-inspector:file-data",
  NEW_EVENTS: "proxy-inspector:new-events"
};
const api = {
  // ── Request/response ──
  openFile: () => electron.ipcRenderer.invoke(IPC.OPEN_FILE),
  openRecent: (filePath) => electron.ipcRenderer.invoke(IPC.OPEN_RECENT, filePath),
  getInteractionDetail: (interactionId) => electron.ipcRenderer.invoke(IPC.GET_INTERACTION_DETAIL, interactionId),
  search: (query) => electron.ipcRenderer.invoke(IPC.SEARCH, query),
  pauseWatch: (paused) => electron.ipcRenderer.invoke(IPC.PAUSE_WATCH, paused),
  getRecentFiles: () => electron.ipcRenderer.invoke(IPC.GET_RECENT_FILES),
  // ── Push events (return cleanup functions for React useEffect) ──
  onFileData: (cb) => {
    const handler = (_e, data) => cb(data);
    electron.ipcRenderer.on(IPC.FILE_DATA, handler);
    return () => electron.ipcRenderer.removeListener(IPC.FILE_DATA, handler);
  },
  onNewEvents: (cb) => {
    const handler = (_e, update) => cb(update);
    electron.ipcRenderer.on(IPC.NEW_EVENTS, handler);
    return () => electron.ipcRenderer.removeListener(IPC.NEW_EVENTS, handler);
  }
};
electron.contextBridge.exposeInMainWorld("api", api);
