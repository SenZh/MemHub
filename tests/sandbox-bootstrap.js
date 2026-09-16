/**
 * 测试沙箱引导模块 (Test Sandbox Bootstrap)
 *
 * 问题背景：部分单测会直接调用 recordKnowledge 等写库 API。若直接
 * `node tests/test-storage.js` 运行，会写到真实的 ~/.memhub/memory.db，
 * 造成测试脏数据污染生产记忆库。
 *
 * 解决：任何需要写库的测试，必须在 import storage 之前先 import 本模块，
 * 它会把 MEMHUB_HOME 重定向到独立临时目录，并在进程退出时清理。
 *
 * 用法（必须放在 storage 相关 import 之前，ESM 会按顺序执行）：
 *   import './sandbox-bootstrap.js';
 *   import { recordKnowledge } from '../src/storage.js';
 *
 * 注意：若已由 tests/e2e.js 通过 MEMHUB_HOME 环境变量注入沙箱，
 * 本模块会复用该沙箱，不重复创建。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 已有外部沙箱（如 e2e.js 注入）则复用，不重复创建
const alreadySandboxed = process.env.MEMHUB_HOME && process.env.MEMHUB_HOME.includes('memhub-');

if (!alreadySandboxed) {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'memhub-unit-sandbox-'));
  process.env.MEMHUB_HOME = tempHome;

  const cleanup = () => {
    try { fs.rmSync(tempHome, { recursive: true, force: true }); } catch {}
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(130); });
  process.on('SIGTERM', () => { cleanup(); process.exit(143); });

  console.log(`🔒 [测试沙箱] 数据目录已重定向至隔离环境: ${tempHome}`);
}

export const SANDBOX_HOME = process.env.MEMHUB_HOME;
