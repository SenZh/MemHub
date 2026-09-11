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

export const DEFAULT_CATEGORIES = ['learnings', 'decisions', 'patterns', 'business'];

/**
 * 分类别名归一化映射
 * 保证历史别名与近义词（如 solutions -> patterns, pitfall -> learnings, rules -> business）平滑归一
 * 非法分类统一收敛为默认顶级分类 'learnings'
 */
export function normalizeCategory(rawCategory) {
  if (!rawCategory || typeof rawCategory !== 'string') return 'learnings';
  const lower = rawCategory.trim().toLowerCase();
  
  // 1. 排错避坑类 (learnings)
  if (
    lower === 'learnings' || lower === 'learning' || lower === 'gotchas' || lower === 'gotcha' || 
    lower === 'pitfall' || lower === 'pitfalls' || lower === 'troubleshoot' ||
    lower === '排错避坑' || lower === '排错' || lower === '避坑' || lower === '故障' || lower === '踩坑'
  ) {
    return 'learnings';
  }
  
  // 2. 架构决策类 (decisions)
  if (
    lower === 'decisions' || lower === 'decision' || lower === 'adr' ||
    lower === '架构决策' || lower === '架构' || lower === '决策' || lower === '架构方案'
  ) {
    return 'decisions';
  }

  // 3. 业务知识类 (business)
  if (
    lower === 'business' || lower === 'biz' || lower === 'business_rule' || lower === 'business_rules' ||
    lower === 'business-rule' || lower === 'business-rules' || lower === 'domain' || lower === 'rule' ||
    lower === 'rules' || lower === '业务' || lower === '业务知识' || lower === '业务规则' || lower === '业务模块'
  ) {
    return 'business';
  }

  // 4. 最佳实践与模板类 (patterns)
  if (
    lower === 'solutions' || lower === 'solution' || lower === 'patterns' || lower === 'pattern' || 
    lower === 'guide' || lower === '模板' || lower === '最佳实践' || lower === '代码模板' || lower === '工程实践'
  ) {
    return 'patterns';
  }
  
  // 严格安全收敛：未识别的非法枚举统一兜底为 learnings，杜绝脏数据入库
  return 'learnings';
}

/**
 * 项目名称防腐与归一化映射 (Normalize Project Name)
 * 解决大模型大小写突变、连字符混乱、或别名造成的项目命名裂变
 */
export function normalizeProjectName(rawProject) {
  if (!rawProject || typeof rawProject !== 'string') return 'global';
  const trimmed = rawProject.trim();
  const lower = trimmed.toLowerCase();

  // 1. 特殊业务工程别名权威收敛
  if (lower === 'omsdubhe' || lower === 'oms-dubhe' || lower === 'dubhe-oms' || lower === 'dubheoms') {
    return 'oms';
  }
  if (lower === 'productservice' || lower === 'product-service' || lower === 'product_service') {
    return 'ProductService';
  }
  if (lower === 'memhub' || lower === 'mem-hub' || lower === 'memory-hub' || lower === 'exobrain') {
    return 'MemHub';
  }
  if (lower === 'global' || lower === 'all' || lower === 'common' || lower === '全局通用' || lower === '全局') {
    return 'global';
  }

  // 默认保留原字符串两端去空
  return trimmed;
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
    categories: [...DEFAULT_CATEGORIES],
    // 后台定时守护 daemon 配置块（memhub daemon 使用）
    daemon: {
      intervalMinutes: 30,
      windowDays: 7,
      idleMinutes: 120,
      autoExtract: false,
      silentWindow: { start: 0, end: 0 },
      cooldownMinutes: 10,
      opencodeUrl: null
    },
    // AI 做梦自省与认知熔炼 dream 配置块（极简 Cron 定时驱动）
    dream: {
      enabled: true,
      cron: '0 3 * * *',          // 定时触发表达式 (默认每天凌晨 3:00 执行)
      intervalMinutes: 1440,      // 简易间隔兜底 (默认 24 小时)
      minAffinity: 0.40,          // 连通聚类亲和度阈值 (0.0~1.0，0.40 能自然发现同模块高相关碎片簇)
      maxClusterSize: 5           // 单个主题簇最大卡片数量
    }
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

  // 3.5 daemon 相关环境变量覆盖（优先级高于配置文件，低于显式入参）
  const envNum = (v) => { const n = parseInt(v, 10); return !isNaN(n) && n > 0 ? n : null; };
  if (process.env.MEMHUB_DAEMON_INTERVAL) { const n = envNum(process.env.MEMHUB_DAEMON_INTERVAL); if (n) config.daemon.intervalMinutes = n; }
  if (process.env.MEMHUB_DAEMON_WINDOW_DAYS) { const n = envNum(process.env.MEMHUB_DAEMON_WINDOW_DAYS); if (n) config.daemon.windowDays = n; }
  if (process.env.MEMHUB_DAEMON_IDLE_MINUTES) { const n = envNum(process.env.MEMHUB_DAEMON_IDLE_MINUTES); if (n) config.daemon.idleMinutes = n; }
  if (process.env.MEMHUB_DAEMON_AUTO_EXTRACT) {
    config.daemon.autoExtract = process.env.MEMHUB_DAEMON_AUTO_EXTRACT === '1' || process.env.MEMHUB_DAEMON_AUTO_EXTRACT === 'true';
  }
  if (process.env.MEMHUB_OPENCODE_URL && String(process.env.MEMHUB_OPENCODE_URL).length) {
    config.daemon.opencodeUrl = String(process.env.MEMHUB_OPENCODE_URL);
  }

  // 3.6 dream 做梦配置环境变量覆盖
  if (process.env.MEMHUB_DREAM_ENABLED !== undefined) {
    config.dream.enabled = process.env.MEMHUB_DREAM_ENABLED === '1' || process.env.MEMHUB_DREAM_ENABLED === 'true';
  }
  if (process.env.MEMHUB_DREAM_CRON) {
    config.dream.cron = String(process.env.MEMHUB_DREAM_CRON);
  }
  if (process.env.MEMHUB_DREAM_AFFINITY) {
    const af = parseFloat(process.env.MEMHUB_DREAM_AFFINITY);
    if (!isNaN(af) && af >= 0 && af <= 1) config.dream.minAffinity = af;
  }
  if (process.env.MEMHUB_DREAM_INTERVAL) {
    const n = envNum(process.env.MEMHUB_DREAM_INTERVAL);
    if (n) config.dream.intervalMinutes = n;
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
  // daemon 后台定时守护配置块
  if (source.daemon && typeof source.daemon === 'object') {
    const d = target.daemon;
    if (typeof source.daemon.intervalMinutes === 'number' && source.daemon.intervalMinutes > 0) {
      d.intervalMinutes = source.daemon.intervalMinutes;
    }
    if (typeof source.daemon.windowDays === 'number' && source.daemon.windowDays > 0) {
      d.windowDays = source.daemon.windowDays;
    }
    if (typeof source.daemon.idleMinutes === 'number' && source.daemon.idleMinutes > 0) {
      d.idleMinutes = source.daemon.idleMinutes;
    }
    if (typeof source.daemon.autoExtract === 'boolean') {
      d.autoExtract = source.daemon.autoExtract;
    }
    if (typeof source.daemon.cooldownMinutes === 'number' && source.daemon.cooldownMinutes > 0) {
      d.cooldownMinutes = source.daemon.cooldownMinutes;
    }
    if (typeof source.daemon.opencodeUrl === 'string' && source.daemon.opencodeUrl) {
      d.opencodeUrl = source.daemon.opencodeUrl;
    }
    if (source.daemon.silentWindow && typeof source.daemon.silentWindow === 'object') {
      if (typeof source.daemon.silentWindow.start === 'number') d.silentWindow.start = source.daemon.silentWindow.start;
      if (typeof source.daemon.silentWindow.end === 'number') d.silentWindow.end = source.daemon.silentWindow.end;
    }
  }
  // dream 做梦配置块
  if (source.dream && typeof source.dream === 'object') {
    const dr = target.dream;
    if (typeof source.dream.enabled === 'boolean') dr.enabled = source.dream.enabled;
    if (typeof source.dream.cron === 'string' && source.dream.cron.trim()) dr.cron = source.dream.cron.trim();
    if (typeof source.dream.intervalMinutes === 'number' && source.dream.intervalMinutes > 0) dr.intervalMinutes = source.dream.intervalMinutes;
    if (typeof source.dream.minAffinity === 'number' && source.dream.minAffinity >= 0 && source.dream.minAffinity <= 1) dr.minAffinity = source.dream.minAffinity;
    if (typeof source.dream.maxClusterSize === 'number' && source.dream.maxClusterSize > 0) dr.maxClusterSize = source.dream.maxClusterSize;
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
