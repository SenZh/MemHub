import { ScannerService } from './pipeline/scanner-service.js';

export function runOfflineScan(limit = 2) {
  const service = new ScannerService();
  console.log(`🚀 开始执行 ExoBrain 离线 Session 扫描任务 (目标处理: ${limit} 个)...`);
  const result = service.scanAndProcess(limit);
  console.log(`📋 扫描完成，共成功处理 ${result.processedCount} 个候选会话。\n`);
  for (const r of result.results || []) {
    if (r.status === 'extracted') {
      console.log(`✅ [${r.sessionId}] 成功提炼: [${r.cardId}] "${r.title}"`);
    } else {
      console.log(`⏩ [${r.sessionId}] 已跳过 (${r.reason})`);
    }
  }
  return result;
}
