import { dialog, type BrowserWindow } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ── Public types ──

export interface FileInfo {
  filePath: string;
  sessionId: string;
  createdAt: string;
  fileSize: number;
}

export interface FileManager {
  openFileDialog: () => Promise<FileInfo | undefined>;
  openFilePath: (filePath: string) => FileInfo;
  getRecentFiles: () => string[];
  addRecentFile: (filePath: string) => void;
  parseFilename: (filePath: string) => { sessionId: string; createdAt: string };
}

// ── Constants ──

const CONFIG_DIR = path.join(os.homedir(), '.proxy-inspector');
const RECENT_FILE = path.join(CONFIG_DIR, 'recent.json');
const MAX_RECENT = 10;

// Matches: proxy-<uuid>-<ISO-timestamp>.ndjson
// Example: proxy-36d86b1d-cb79-4609-b8e5-1a777a25db08-2026-04-11T06-58-50.ndjson
const FILENAME_RE = /proxy-([a-f0-9-]{36})-(\d{4}-\d{2}-\d{2}T[\d-]+)\.ndjson$/;

// ── Factory ──

export function createFileManager(mainWindow: BrowserWindow): FileManager {

  function parseFilename(filePath: string): { sessionId: string; createdAt: string } {
    const basename = path.basename(filePath);
    const match = basename.match(FILENAME_RE);

    if (match) {
      const sessionId = match[1];
      // Convert timestamp from filename format (dashes) to ISO-8601 (colons)
      // e.g., 2026-04-11T06-58-50 -> 2026-04-11T06:58:50
      const rawTimestamp = match[2];
      const createdAt = rawTimestamp.replace(
        /T(\d{2})-(\d{2})-(\d{2})/,
        'T$1:$2:$3'
      );
      return { sessionId, createdAt };
    }

    // Fallback: use filename as session ID, file mtime as createdAt
    return {
      sessionId: path.basename(filePath, path.extname(filePath)),
      createdAt: new Date().toISOString(),
    };
  }

  async function openFileDialog(): Promise<FileInfo | undefined> {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Open NDJSON Log File',
      filters: [
        { name: 'NDJSON Logs', extensions: ['ndjson', 'jsonl'] },
        { name: 'All Files', extensions: ['*'] },
      ],
      properties: ['openFile'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return undefined;
    }

    const filePath = result.filePaths[0];
    return openFilePath(filePath);
  }

  function openFilePath(filePath: string): FileInfo {
    const stat = fs.statSync(filePath);
    const { sessionId, createdAt } = parseFilename(filePath);

    return {
      filePath,
      sessionId,
      createdAt,
      fileSize: stat.size,
    };
  }

  function getRecentFiles(): string[] {
    try {
      const data = fs.readFileSync(RECENT_FILE, 'utf8');
      const paths = JSON.parse(data) as string[];
      if (!Array.isArray(paths)) return [];

      // Filter out files that no longer exist
      return paths.filter(p => {
        try {
          fs.accessSync(p, fs.constants.R_OK);
          return true;
        } catch {
          return false;
        }
      });
    } catch {
      return [];
    }
  }

  function addRecentFile(filePath: string): void {
    try {
      const recent = getRecentFiles();

      // Remove the path if it already exists (to move it to the front)
      const filtered = recent.filter(p => p !== filePath);
      filtered.unshift(filePath);

      // Keep only the last MAX_RECENT
      const trimmed = filtered.slice(0, MAX_RECENT);

      // Ensure config directory exists
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
      fs.writeFileSync(RECENT_FILE, JSON.stringify(trimmed, null, 2), 'utf8');
    } catch (err) {
      console.error('[file-manager] Failed to persist recent files:', err);
    }
  }

  return {
    openFileDialog,
    openFilePath,
    getRecentFiles,
    addRecentFile,
    parseFilename,
  };
}
