import { app, BrowserWindow, Menu, screen } from 'electron';
import { join } from 'path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { registerIpcHandlers, cleanupIpcHandlers } from './ipc-handlers';

// ── Window state persistence ──

const CONFIG_DIR = path.join(os.homedir(), '.proxy-inspector');
const WINDOW_STATE_FILE = path.join(CONFIG_DIR, 'window-state.json');

interface WindowState {
  x: number;
  y: number;
  width: number;
  height: number;
}

function loadWindowState(): WindowState | null {
  try {
    const data = fs.readFileSync(WINDOW_STATE_FILE, 'utf8');
    const state = JSON.parse(data) as WindowState;

    // Validate the saved position is still on a connected display
    const displays = screen.getAllDisplays();
    const displayMatch = displays.some(d => {
      const { x, y, width, height } = d.bounds;
      return (
        state.x >= x &&
        state.x < x + width &&
        state.y >= y &&
        state.y < y + height
      );
    });

    return displayMatch ? state : null;
  } catch {
    return null;
  }
}

function saveWindowState(win: BrowserWindow): void {
  try {
    const bounds = win.getBounds();
    const state: WindowState = {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    };
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(WINDOW_STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.error('[main] Failed to save window state:', err);
  }
}

// ── Application menu (macOS) ──

function buildAppMenu(): Electron.Menu {
  const isMac = process.platform === 'darwin';

  const template: Electron.MenuItemConstructorOptions[] = [
    // App menu (macOS only)
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          },
        ]
      : []),
    // File menu
    {
      label: 'File',
      submenu: [
        isMac
          ? { role: 'close' as const }
          : { role: 'quit' as const },
      ],
    },
    // Edit menu
    {
      label: 'Edit',
      submenu: [
        { role: 'copy' as const },
        { role: 'selectAll' as const },
      ],
    },
    // View menu
    {
      label: 'View',
      submenu: [
        { role: 'toggleDevTools' as const },
        { type: 'separator' as const },
        { role: 'reload' as const },
      ],
    },
    // Window menu
    ...(isMac
      ? [
          {
            label: 'Window',
            submenu: [
              { role: 'minimize' as const },
              { role: 'zoom' as const },
            ],
          },
        ]
      : []),
  ];

  return Menu.buildFromTemplate(template);
}

// ── Create window ──

function createWindow(): BrowserWindow {
  const savedState = loadWindowState();

  const win = new BrowserWindow({
    width: savedState?.width ?? 1200,
    height: savedState?.height ?? 800,
    x: savedState?.x,
    y: savedState?.y,
    minWidth: 800,
    minHeight: 500,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#1e1e2e',
  });

  // Save window state on close
  win.on('close', () => {
    saveWindowState(win);
  });

  // Drag-and-drop: intercept file:// navigations
  win.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('file://')) {
      event.preventDefault();
      const filePath = decodeURIComponent(new URL(url).pathname);
      if (filePath.endsWith('.ndjson') || filePath.endsWith('.jsonl')) {
        // The file will be opened via the IPC open-recent handler
        // We emit a custom message to the renderer
        win.webContents.send('proxy-inspector:drag-drop', filePath);
      }
    }
  });

  // Register IPC handlers
  registerIpcHandlers(win);

  // Load renderer
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return win;
}

// ── App lifecycle ──

app.whenReady().then(() => {
  // Set application menu
  Menu.setApplicationMenu(buildAppMenu());

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// macOS: handle open-file events (drag to dock icon, Finder associations)
app.on('open-file', (event, filePath) => {
  event.preventDefault();

  if (!filePath.endsWith('.ndjson') && !filePath.endsWith('.jsonl')) {
    return;
  }

  // If the app is ready, send to the existing window
  const windows = BrowserWindow.getAllWindows();
  if (windows.length > 0) {
    windows[0].webContents.send('proxy-inspector:drag-drop', filePath);
  }
  // Otherwise, the file will be available when the window is created
});

app.on('window-all-closed', () => {
  cleanupIpcHandlers();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  cleanupIpcHandlers();
});
