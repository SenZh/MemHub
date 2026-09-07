import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

// 优先采用环境变量声明，具有最高优先级
const legacyExoHome = process.env.EXOBRAIN_HOME;
const legacyMemoryHubHome = process.env.MEMORY_HUB_HOME;
const memHubEnvHome = process.env.MEMHUB_HOME;

function resolveHome() {
  // 环境变量绝对优先
  if (memHubEnvHome) return memHubEnvHome;
  if (legacyMemoryHubHome) return legacyMemoryHubHome;
  if (legacyExoHome) return legacyExoHome;

  // 物理目录优先级：~/.memhub -> ~/.memory-hub -> ~/.exobrain
  const defaultMemHubHome = path.join(os.homedir(), '.memhub');
  const diskLegacyMemoryHub = path.join(os.homedir(), '.memory-hub');
  const diskLegacyExo = path.join(os.homedir(), '.exobrain');

  if (fs.existsSync(defaultMemHubHome)) return defaultMemHubHome;
  if (fs.existsSync(diskLegacyMemoryHub)) return diskLegacyMemoryHub;
  if (fs.existsSync(diskLegacyExo)) return diskLegacyExo;
  return defaultMemHubHome;
}

export const MEMHUB_HOME = resolveHome();
export const MEMORY_HUB_HOME = MEMHUB_HOME; // 保持向后兼容
export const EXOBRAIN_HOME = MEMHUB_HOME;     // 保持向后兼容

export const DB_PATH = path.join(MEMHUB_HOME, 'memory.db');
export const VAULT_DIR = path.join(MEMHUB_HOME, 'vault');
export const BACKUP_DIR = path.join(MEMHUB_HOME, 'backups');

export const DEFAULT_CATEGORIES = ['learnings', 'decisions', 'patterns'];

/**
 * 分类别名归一化映射
 * 保证历史别名与近义词（如 solutions -> patterns, pitfall -> learnings）平滑归一
 * 非法分类统一收敛为默认顶级分类 'learnings'
 */
export function normalizeCategory(rawCategory) {
  if (!rawCategory || typeof rawCategory !== 'string') return 'learnings';
  const lower = rawCategory.trim().toLowerCase();
  
  if (lower === 'solutions' || lower === 'solution' || lower === 'patterns' || lower === 'pattern' || lower === 'guide') {
    return 'patterns';
  }
  if (lower === 'gotchas' || lower === 'gotcha' || lower === 'pitfall' || lower === 'pitfalls' || lower === 'troubleshoot' || lower === 'learnings' || lower === 'learning') {
    return 'learnings';
  }
  if (lower === 'decisions' || lower === 'decision' || lower === 'adr' || lower === 'rule' || lower === 'rules') {
    return 'decisions';
  }
  
  // 严格安全收敛：未识别的非法枚举统一兜底为 learnings，杜绝脏数据入库
  return 'learnings';
}

/**
 * 读取完整的 MemHub 配置 (合并全局与项目级配置，并解析环境变量)
 */
export function getConfig(projectPath = process.cwd()) {
  const config = {
    idleMinutes: 120,
    scanRules: {
      watchDirectories: [],
      include: [],
      exclude: []
    },
    categories: [...DEFAULT_CATEGORIES]
  };

  // 1. 读取全局配置
  const globalConfigPath = path.join(MEMHUB_HOME, 'config.json');
  if (fs.existsSync(globalConfigPath)) {
    try {
      const g = JSON.parse(fs.readFileSync(globalConfigPath, 'utf8'));
      _mergeConfig(config, g);
    } catch (e) {}
  }

  // 2. 读取项目局部配置
  if (projectPath) {
    const p1 = path.join(projectPath, '.memhub', 'config.json');
    const p2 = path.join(projectPath, '.memory-hub', 'config.json');
    const p3 = path.join(projectPath, '.exobrain', 'config.json');
    const projConfigPath = [p1, p2, p3].find(p => fs.existsSync(p));
    if (projConfigPath) {
      try {
        const p = JSON.parse(fs.readFileSync(projConfigPath, 'utf8'));
        _mergeConfig(config, p);
      } catch (e) {}
    }
  }

  // 3. 环境变量覆盖与防腐校验
  if (process.env.MEMHUB_IDLE_MINUTES) {
    const envVal = parseInt(process.env.MEMHUB_IDLE_MINUTES, 10);
    if (!isNaN(envVal) && envVal > 0) {
      config.idleMinutes = envVal;
    }
  }

  // 非法值兜底
  if (typeof config.idleMinutes !== 'number' || isNaN(config.idleMinutes) || config.idleMinutes <= 0) {
    config.idleMinutes = 120;
  }

  return config;
}

function _mergeConfig(target, source) {
  if (!source || typeof source !== 'object') return;
  if (typeof source.idleMinutes === 'number' && source.idleMinutes > 0) {
    target.idleMinutes = source.idleMinutes;
  }
  if (source.scanRules && typeof source.scanRules === 'object') {
    if (Array.isArray(source.scanRules.watchDirectories)) {
      target.scanRules.watchDirectories = source.scanRules.watchDirectories;
    }
    if (Array.isArray(source.scanRules.include)) {
      target.scanRules.include = source.scanRules.include;
    }
    if (Array.isArray(source.scanRules.exclude)) {
      target.scanRules.exclude = source.scanRules.exclude;
    }
  }
  if (Array.isArray(source.categories)) {
    const set = new Set([...target.categories, ...source.categories]);
    target.categories = Array.from(set);
  }
}

/**
 * 动态获取可用分类列表
 */
export function getCategories(projectPath = process.cwd()) {
  const cfg = getConfig(projectPath);
  return cfg.categories;
}

export const CATEGORIES = DEFAULT_CATEGORIES;

export function ensureDirectories() {
  if (!fs.existsSync(MEMHUB_HOME)) {
    fs.mkdirSync(MEMHUB_HOME, { recursive: true });
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
