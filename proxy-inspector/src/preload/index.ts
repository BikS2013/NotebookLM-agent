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
