import { ScannerService } from './pipeline/scanner-service.js';

export function runOfflineScan(limit = 2, options = {}) {
  const service = new ScannerService();
  const opts = typeof limit === 'object' ? { ...limit } : { limit, ...options };
  console.log(`🚀 开始执行 MemHub 离线 Session 扫描任务 (目标处理: ${opts.limit || 2} 个)...`);
  const result = service.scanAndProcess(opts);
  console.log(`📋 扫描完成，共成功处理 ${result.processedCount} 个候选会话。\n`);
  for (const r of result.results || []) {
    if (r.status === 'extracted') {
      const ids = (r.cardIds && r.cardIds.length) ? r.cardIds.join(', ') : r.cardId;
      const titles = (r.titles && r.titles.length > 1) ? ` (${r.titles.length} 张卡)` : '';
      console.log(`✅ [${r.sessionId}] 成功提炼${titles}: [${ids}]`);
    } else {
      console.log(`⏩ [${r.sessionId}] 已跳过 (${r.reason})`);
    }
  }
  return result;
}
