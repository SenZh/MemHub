import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

// 优先采用 MEMORY_HUB_HOME，平滑兼容旧 EXOBRAIN_HOME
const legacyHome = process.env.EXOBRAIN_HOME || path.join(os.homedir(), '.exobrain');
const defaultHubHome = path.join(os.homedir(), '.memory-hub');

export const MEMORY_HUB_HOME = process.env.MEMORY_HUB_HOME || (fs.existsSync(legacyHome) ? legacyHome : defaultHubHome);
export const EXOBRAIN_HOME = MEMORY_HUB_HOME; // 保持向后兼容

export const DB_PATH = path.join(MEMORY_HUB_HOME, 'memory.db');
export const VAULT_DIR = path.join(MEMORY_HUB_HOME, 'vault');
export const BACKUP_DIR = path.join(MEMORY_HUB_HOME, 'backups');

export const DEFAULT_CATEGORIES = ['learnings', 'decisions', 'solutions'];

/**
 * 动态读取用户自定义分类 (从 ~/.memory-hub/categories.json 或当前项目 .memory-hub/categories.json)
 */
export function getCategories(projectPath = process.cwd()) {
  const categories = new Set(DEFAULT_CATEGORIES);

  // 1. 全局配置
  const globalConfigPath = path.join(MEMORY_HUB_HOME, 'categories.json');
  if (fs.existsSync(globalConfigPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(globalConfigPath, 'utf8'));
      if (Array.isArray(data.categories)) {
        data.categories.forEach(c => categories.add(c));
      } else if (typeof data.categories === 'object') {
        Object.keys(data.categories).forEach(c => categories.add(c));
      }
    } catch (e) {}
  }

  // 2. 项目局部配置
  if (projectPath) {
    const projConfigPath = path.join(projectPath, '.memory-hub', 'categories.json');
    const legacyProjConfig = path.join(projectPath, '.exobrain', 'categories.json');
    const targetPath = fs.existsSync(projConfigPath) ? projConfigPath : legacyProjConfig;
    if (fs.existsSync(targetPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
        if (Array.isArray(data.categories)) {
          data.categories.forEach(c => categories.add(c));
        } else if (typeof data.categories === 'object') {
          Object.keys(data.categories).forEach(c => categories.add(c));
        }
      } catch (e) {}
    }
  }

  return Array.from(categories);
}

export const CATEGORIES = DEFAULT_CATEGORIES;

export function ensureDirectories() {
  if (!fs.existsSync(MEMORY_HUB_HOME)) {
    fs.mkdirSync(MEMORY_HUB_HOME, { recursive: true });
  }
  if (!fs.existsSync(VAULT_DIR)) {
    fs.mkdirSync(VAULT_DIR, { recursive: true });
  }
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
  for (const cat of DEFAULT_CATEGORIES) {
    const catDir = path.join(VAULT_DIR, cat);
    if (!fs.existsSync(catDir)) {
      fs.mkdirSync(catDir, { recursive: true });
    }
  }
}

