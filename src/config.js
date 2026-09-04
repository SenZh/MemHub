import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

export const EXOBRAIN_HOME = process.env.EXOBRAIN_HOME || path.join(os.homedir(), '.exobrain');
export const VAULT_DIR = path.join(EXOBRAIN_HOME, 'vault');
export const DB_PATH = path.join(EXOBRAIN_HOME, 'index.db');

export const CATEGORIES = ['learnings', 'decisions', 'solutions'];

export function ensureDirectories() {
  if (!fs.existsSync(EXOBRAIN_HOME)) {
    fs.mkdirSync(EXOBRAIN_HOME, { recursive: true });
  }
  if (!fs.existsSync(VAULT_DIR)) {
    fs.mkdirSync(VAULT_DIR, { recursive: true });
  }
  for (const cat of CATEGORIES) {
    const catDir = path.join(VAULT_DIR, cat);
    if (!fs.existsSync(catDir)) {
      fs.mkdirSync(catDir, { recursive: true });
    }
  }
}
