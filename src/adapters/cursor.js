import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { AgentAdapter } from './base.js';

export class CursorAdapter extends AgentAdapter {
  constructor(customBasePath = null) {
    super('cursor');
    this.baseStorageDir = customBasePath || path.join(os.homedir(), 'AppData', 'Roaming', 'Cursor', 'User', 'workspaceStorage');
  }

  isAvailable() {
    return fs.existsSync(this.baseStorageDir);
  }

  scanCandidateSessions(options = {}) {
    if (!this.isAvailable()) return [];
    // Cursor 离线发现插槽
    return [];
  }

  readSessionContext(sessionId) {
    return [];
  }

  resolveActiveSessionId(cwd) {
    if (process.env.CURSOR_VERSION || process.env.VSCODE_PID) {
      return `cursor-workspace-${path.basename(cwd)}`;
    }
    return null;
  }
}
