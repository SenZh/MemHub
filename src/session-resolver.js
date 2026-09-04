import path from 'node:path';
import { execSync } from 'node:child_process';
import { registry } from './adapters/index.js';

/**
 * 自动推导当前宿主环境的 Session 信息与项目上下文
 * 优先调用 Adapter 注册中心的多态适配器进行探测
 */
export function resolveSessionContext(explicitSessionId, explicitProject) {
  const cwd = explicitProject || process.cwd();
  let projectName = path.basename(cwd);
  let gitBranch = null;
  let gitCommit = null;

  // 1. 探测 Git 信息
  try {
    gitBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    gitCommit = execSync('git rev-parse --short HEAD', { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch (e) {
    // 忽略非 git 目录
  }

  // 2. 优先使用显式传递的 sessionId
  if (explicitSessionId) {
    return {
      sessionId: explicitSessionId,
      sourceAgent: 'explicit',
      projectPath: cwd,
      projectName,
      gitBranch,
      gitCommit
    };
  }

  // 3. 委派给适配器注册中心探测活跃 Session
  const adapterResolved = registry.resolveActiveContext(cwd);

  return {
    sessionId: adapterResolved.sessionId,
    sourceAgent: adapterResolved.sourceAgent,
    projectPath: cwd,
    projectName,
    gitBranch,
    gitCommit
  };
}
