#!/usr/bin/env node

import { 
  searchKnowledge, 
  getKnowledge, 
  listRecent, 
  getDatabase, 
  backupDatabase, 
  exportToMarkdown, 
  getStats, 
  syncEmbeddings, 
  getMcpAuditLogs,
  deleteKnowledge
} from './storage.js';
import { 
  getDreamCandidateItems, 
  clusterCandidateItems 
} from './dream/clustering.js';
import { runDreamPipeline } from './dream/pipeline.js';
import { runOfflineScan } from './scanner.js';
import { 
  runDaemon, 
  stopDaemon, 
  getDaemonStatus, 
  showDaemonLogs 
} from './daemon.js';
import { startWebServer } from './server/index.js';
import { MEMHUB_HOME, VAULT_DIR, BACKUP_DIR, DB_PATH } from './config.js';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const command = args[0];

function printHelp() {
  console.log(`
MemHub (memhub / mem-hub) CLI - AI 编程知识中枢与工程长效记忆

用法:
  memhub scan [数量]           离线扫描超过静默时间未活跃的历史 Session 跟踪状态
  memhub daemon [start|stop|status|logs]  后台常驻定时提炼守护服务 (默认后台运行)
  memhub search / find <词>    全文/混合检索历史避坑经验与决策 (支持 --project, --category, --tag)
  memhub get <id>              查看某张知识卡片的完整详细内容与代码正文
  memhub delete / rm <id>      物理删除指定的知识卡片与索引 (支持 -y/--yes)
  memhub list [选项]           查看最近沉淀的知识列表 (支持 --limit, --project, --category, --tag)
  memhub stats [选项]          查看全局/项目研发态势与项目维度分类大盘 (支持 --json, --project)
  memhub audit [条数]          查看 MCP 工具调用审计流水 (支持 --tool <name>, --json)
  memhub dream [选项]          执行做梦引擎离线记忆熔炼与碎片聚类 (支持 --dry-run, --project, --affinity)
  memhub backup [路径]         执行 SQLite 原生 VACUUM INTO 无损原子热备份
  memhub export [目录]         将 SQLite 数据库无损导出为结构化 Markdown 目录树 (Obsidian兼容)
  memhub embed                 全量/增量为已有知识计算 384 维语义向量并持久化
  memhub ui / web [选项]       启动内置 HTTP 服务并打开 WebUI 可视化外脑看板
  memhub path                  打印知识库物理路径与数据库位置

daemon 守护指令:
  memhub daemon                默认后台静默启动守护进程
  memhub daemon start          后台启动守护进程
  memhub daemon stop           停止正在后台运行的守护进程
  memhub daemon status         查看后台守护进程运行状态与 PID
  memhub daemon logs [-n 30]   查看守护进程最近输出的日志

daemon 可选参数:
  --foreground, -f    强制前台运行并输出控制台日志
  --interval <分钟>   轮询周期 (默认 30)
  --window-days <N>   扫描窗口: 只处理最近 N 天更新的会话 (默认 7)
  --idle <分钟>       静默阈值: 距现在超过 N 分钟 (默认 120)
  --limit <条数>      单轮最多处理会话数 (默认 3)
  --once              只执行一轮后退出
  --dry-run           测试桩模式 (不真发 HTTP POST)
  --force             强制重新处理已跳过的会话
  --ui                伴生启动 WebUI 看板服务 (默认端口 3900)
  --ui-port <端口>    指定 WebUI 伴生服务端口 (默认 3900)

ui / web 可选参数:
  --port <端口>       HTTP 服务监听端口 (默认 3900)
  --host <主机>       HTTP 服务监听主机 (默认 127.0.0.1)
  --no-open           启动后不自动唤起默认浏览器
`);
}

switch (command) {
  case 'scan': {
    const limit = parseInt(args[1], 10) || 2;
    console.log(`🔍 开始扫描历史已结束（静默完成态）的 OpenCode 会话...`);
    runOfflineScan(limit);
    break;
  }

  case 'daemon': {
    const subAction = args[1];

    if (subAction === 'stop') {
      stopDaemon();
      break;
    }

    if (subAction === 'status') {
      getDaemonStatus();
      break;
    }

    if (subAction === 'logs') {
      let lines = 30;
      const nIdx = args.indexOf('-n');
      if (nIdx !== -1 && args[nIdx + 1]) {
        lines = parseInt(args[nIdx + 1], 10) || 30;
      }
      showDaemonLogs({ lines });
      break;
    }

    // 排除 start 关键字后的其余参数
    const rest = (subAction === 'start') ? args.slice(2) : args.slice(1);
    const cliOpts = { once: false, foreground: false };

    for (let i = 0; i < rest.length; i++) {
      const a = rest[i];
      if (a === '--foreground' || a === '-f') cliOpts.foreground = true;
      else if (a === '--interval') cliOpts.interval = parseInt(rest[++i], 10) || undefined;
      else if (a === '--window-days') cliOpts.windowDays = parseInt(rest[++i], 10) || undefined;
      else if (a === '--idle') cliOpts.idleMinutes = parseInt(rest[++i], 10) || undefined;
      else if (a === '--limit') cliOpts.limit = parseInt(rest[++i], 10) || undefined;
      else if (a === '--once') cliOpts.once = true;
      else if (a === '--dry-run') cliOpts.dryRun = true;
      else if (a === '--force') cliOpts.force = true;
      else if (a === '--ui') cliOpts.ui = true;
      else if (a === '--ui-port' && rest[i + 1]) cliOpts.uiPort = parseInt(rest[++i], 10) || undefined;
    }

    runDaemon(cliOpts);
    break;
  }

  case 'find':
  case 'search': {
    const rawArgs = args.slice(1);
    let project = null;
    let category = null;
    const tags = [];
    const queryTokens = [];

    for (let i = 0; i < rawArgs.length; i++) {
      const arg = rawArgs[i];
      if (arg === '--project' || arg === '-w' || arg === '--workspace') {
        project = rawArgs[++i];
      } else if (arg === '--category' || arg === '-c') {
        category = rawArgs[++i];
      } else if (arg === '--tag' || arg === '-t') {
        tags.push(rawArgs[++i]);
      } else {
        queryTokens.push(arg);
      }
    }

    const query = queryTokens.join(' ');
    if (!query) {
      console.log('请输入搜索关键词，例如: memhub find Alpine --project bindCenter --tag docker');
      process.exit(1);
    }
    const results = searchKnowledge(query, { 
      limit: 5,
      project,
      category,
      tags
    });
    if (results.length === 0) {
      console.log(`未找到与 "${query}" 相关的知识。`);
    } else {
      console.log(`\n🔍 找到 ${results.length} 条相关知识索引 (L1 级):\n`);
      results.forEach((r, idx) => {
        console.log(`${idx + 1}. [${r.id}] \x1b[36m${r.title}\x1b[0m`);
        console.log(`   分类: ${r.category} | 项目: ${r.project || 'global'}`);
        console.log(`   标签: ${r.tags.join(', ')}`);
        if (r.summary) {
          console.log(`   摘要: ${r.summary}`);
        }
        console.log('');
      });
      console.log('提示: 输入 `memhub get <id>` 查看完整正解代码与技术根因 (L2/L3 级)');
    }
    break;
  }

  case 'get': {
    const id = args[1];
    if (!id) {
      console.log('请输入知识卡片 ID，例如: memhub get kb-xxxx');
      process.exit(1);
    }
    const card = getKnowledge(id);
    if (!card) {
      console.log(`未找到 ID 为 "${id}" 的卡片。`);
    } else {
      console.log('\n' + card.content + '\n');
    }
    break;
  }

  case 'delete':
  case 'rm': {
    const rawArgs = args.slice(1);
    let targetId = null;
    let autoYes = false;

    for (const a of rawArgs) {
      if (a === '--yes' || a === '-y' || a === '--force') {
        autoYes = true;
      } else if (!a.startsWith('-') && !targetId) {
        targetId = a;
      }
    }

    if (!targetId) {
      console.log('用法: memhub delete <id> [--yes/-y]');
      process.exit(1);
    }

    const doDelete = () => {
      try {
        const res = deleteKnowledge(targetId);
        if (res.notFound) {
          console.error(`❌ ${res.message}`);
          process.exit(1);
        }
        console.log(`✅ ${res.message}`);
        console.log(`   • 标题: ${res.title}`);
        process.exit(0);
      } catch (err) {
        console.error(`❌ 删除失败: ${err.message}`);
        process.exit(1);
      }
    };

    if (autoYes) {
      doDelete();
    } else {
      import('node:readline').then(readline => {
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout
        });
        rl.question(`⚠️ 确认要彻底物理删除知识卡片 [${targetId}] 吗？(y/N): `, answer => {
          rl.close();
          if (answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes') {
            doDelete();
          } else {
            console.log('ℹ️ 已取消删除操作。');
            process.exit(0);
          }
        });
      });
    }
    break;
  }

  case 'list': {
    const rawArgs = args.slice(1);
    let project = null;
    let category = null;
    const tags = [];
    let limit = 10;

    for (let i = 0; i < rawArgs.length; i++) {
      const arg = rawArgs[i];
      if (arg === '--project' || arg === '-w' || arg === '--workspace') {
        project = rawArgs[++i];
      } else if (arg === '--category' || arg === '-c') {
        category = rawArgs[++i];
      } else if (arg === '--tag' || arg === '-t') {
        tags.push(rawArgs[++i]);
      } else if (arg === '--limit' || arg === '-n') {
        limit = parseInt(rawArgs[++i], 10) || 10;
      } else if (!isNaN(parseInt(arg, 10)) && !rawArgs[i - 1]?.startsWith('-')) {
        limit = parseInt(arg, 10);
      }
    }

    const list = listRecent({ limit, project, category, tags });
    console.log(`\n📚 最近沉淀的知识索引 (共 ${list.length} 条 | 项目过滤: ${project || '全部/穿透global'}):\n`);
    if (list.length === 0) {
      console.log(`  (未找到匹配条件的知识条目)`);
    } else {
      list.forEach((item, idx) => {
        console.log(`${idx + 1}. [${item.id}] [${item.category.padEnd(9)}] \x1b[36m${item.title}\x1b[0m (项目: ${item.project || 'global'})`);
      });
    }
    console.log('');
    break;
  }

  case 'stats': {
    let project = null;
    let jsonMode = false;
    let detailed = false;

    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--json') {
        jsonMode = true;
      } else if (args[i] === '--detailed') {
        detailed = true;
      } else if (args[i] === '--project' && args[i + 1]) {
        project = args[++i];
      } else if (!args[i].startsWith('-') && !project) {
        project = args[i];
      }
    }

    const stats = getStats({ project });

    if (jsonMode) {
      console.log(JSON.stringify(stats, null, 2));
      break;
    }

    console.log(`\n============================================================`);
    console.log(`              📊 MemHub 研发态势与知识资产大盘              `);
    console.log(`============================================================`);
    console.log(`【作用范围】: ${stats.project}`);
    console.log(`【长效资产】: ${stats.total_knowledge_entries} 篇 (估算规避试错节省 ~${stats.estimated_saved_tokens.toLocaleString()} tokens)`);
    
    console.log(`\n【📂 四大基石分类分布】:`);
    if (stats.categories.length === 0) {
      console.log(`  (暂无分类数据)`);
    } else {
      const maxCount = Math.max(...stats.categories.map(c => c.count), 1);
      stats.categories.forEach(c => {
        const barLen = Math.max(1, Math.round((c.count / maxCount) * 16));
        const bar = '█'.repeat(barLen).padEnd(16);
        console.log(`  • ${c.category.padEnd(12)} [${bar}] ${c.count} 篇`);
      });
    }

    console.log(`\n【🏢 按 Project 项目维度汇总分布】:`);
    if (!stats.projects || stats.projects.length === 0) {
      console.log(`  (暂无项目维度数据)`);
    } else {
      const maxProjCount = Math.max(...stats.projects.map(p => p.total), 1);
      stats.projects.forEach(p => {
        const barLen = Math.max(1, Math.round((p.total / maxProjCount) * 12));
        const bar = '█'.repeat(barLen).padEnd(12);
        console.log(`  • ${p.project.padEnd(18)} [${bar}] 总计: ${String(p.total).padStart(2)} 篇 (排错: ${p.learnings}, 决策: ${p.decisions}, 模式: ${p.patterns}, 业务: ${p.business})`);
      });
    }

    console.log(`\n【🤖 会话扫描与萃取流水】:`);
    if (stats.sessions_scanned.length === 0) {
      console.log(`  (暂未扫描历史会话)`);
    } else {
      stats.sessions_scanned.forEach(s => {
        console.log(`  • 状态 ${s.status.padEnd(12)}: ${s.count} 个会话`);
      });
    }

    console.log(`\n【🌙 做梦引擎自省与认知熔炼】:`);
    const dr = stats.dreaming || {};
    if (!dr.synthesized_l4 && !dr.consolidated_fragments && !dr.dream_rounds) {
      console.log(`  (暂未发生做梦自省熔炼)`);
    } else {
      console.log(`  • L4 升华卡片    : ${dr.synthesized_l4 || 0} 篇 (由碎片自动熔炼生成)`);
      console.log(`  • 已封存碎片    : ${dr.consolidated_fragments || 0} 篇 (被熔炼退出常规池)`);
      console.log(`  • 做梦熔炼轮次  : ${dr.dream_rounds || 0} 轮 (台账 knowledge_dream_history)`);
      console.log(`  • 待做梦候选池  : ${dr.candidate_pool || 0} 篇 (active 且过冷却期)`);
      if (dr.cooling_down) {
        console.log(`  • 失败冷却中    : ${dr.cooling_down} 篇 (暂缓重试)`);
      }
    }

    console.log(`\n【⚡ MCP 工具调用频次与响应】:`);
    if (!stats.mcp_tool_calls || stats.mcp_tool_calls.length === 0) {
      console.log(`  (暂无 MCP 调用审计记录)`);
    } else {
      stats.mcp_tool_calls.forEach(m => {
        const avg = m.avg_duration_ms ? `${Math.round(m.avg_duration_ms)}ms` : '0ms';
        console.log(`  • ${m.tool_name.padEnd(20)}: ${String(m.count).padStart(4)} 次 (平均耗时: ${avg})`);
      });
    }
    console.log(`============================================================\n`);
    break;
  }

  case 'audit': {
    let limit = 20;
    let tool = null;
    let project = null;
    let jsonMode = false;

    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--json') {
        jsonMode = true;
      } else if (args[i] === '--tool' && args[i + 1]) {
        tool = args[++i];
      } else if (args[i] === '--project' && args[i + 1]) {
        project = args[++i];
      } else if (!isNaN(parseInt(args[i], 10))) {
        limit = parseInt(args[i], 10);
      }
    }

    const logs = getMcpAuditLogs({ limit, tool, project });

    if (jsonMode) {
      console.log(JSON.stringify(logs, null, 2));
      break;
    }

    console.log(`\n============================================================`);
    console.log(`              🔍 MemHub MCP 工具调用审计流水                `);
    console.log(`============================================================`);
    if (logs.length === 0) {
      console.log(`  (暂无 MCP 调用审计记录)`);
    } else {
      logs.forEach(l => {
        const timeStr = new Date(l.created_at).toISOString().replace('T', ' ').slice(0, 19);
        const statusBadge = l.status === 'SUCCESS' ? '✅' : '❌';
        const durationStr = `${l.duration_ms}ms`.padStart(6);
        const toolStr = l.tool_name.padEnd(16);
        const projStr = (l.project || 'global').padEnd(12);
        const queryStr = (l.query_summary || '-').slice(0, 45);
        console.log(`[${timeStr}] ${statusBadge} ${toolStr} | ${projStr} | 耗时:${durationStr} | 命中:${String(l.hits_count).padStart(2)} | 目标: ${queryStr}`);
      });
    }
    console.log(`============================================================\n`);
    break;
  }

  case 'dream': {
    let project = null;
    let dryRun = false;
    let jsonMode = false;
    let limit = 100;
    let minAffinity = 0.55;

    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--dry-run') {
        dryRun = true;
      } else if (args[i] === '--json') {
        jsonMode = true;
      } else if (args[i] === '--project' && args[i + 1]) {
        project = args[++i];
      } else if (args[i] === '--limit' && args[i + 1]) {
        limit = parseInt(args[++i], 10);
      } else if (args[i] === '--affinity' && args[i + 1]) {
        minAffinity = parseFloat(args[++i]);
      } else if (!args[i].startsWith('-') && !project) {
        project = args[i];
      }
    }

    const candidates = getDreamCandidateItems({ project, limit });
    const clusters = clusterCandidateItems(candidates, { minAffinity });

    if (jsonMode) {
      console.log(JSON.stringify({
        total_candidates: candidates.length,
        total_clusters: clusters.length,
        clusters
      }, null, 2));
      break;
    }

    console.log(`\n============================================================`);
    console.log(`          🌙 MemHub AI 做梦自省引擎 (Dreaming Phase 1)         `);
    console.log(`============================================================`);
    console.log(`【候选池碎片】: ${candidates.length} 张 active 状态未升华卡片`);
    console.log(`【聚类亲和度】: >= ${minAffinity} (结合 Tag Jaccard + File Overlap + 384维向量)`);
    console.log(`【形成主题簇】: ${clusters.length} 个可熔炼簇 (2~5张卡片)`);

    if (clusters.length === 0) {
      console.log(`\n  ℹ️ 当前知识库碎片相关度较分散，暂未形成满足条件的做梦主题簇。`);
      console.log(`  建议继续日常编码积累长效资产，或使用 --affinity 0.40 调宽初筛阈值。`);
    } else {
      console.log(`\n【📦 候选做梦主题簇预览 (Dream Clusters)】:`);
      clusters.forEach((cl, idx) => {
        console.log(`\n  [主题簇 ${idx + 1}] 项目空间: ${cl.project} | 包含 ${cl.items.length} 张碎片`);
        console.log(`   └─ 指纹: ${cl.fingerprint.slice(0, 16)}...`);
        cl.items.forEach(it => {
          console.log(`      • [${it.category.padEnd(9)}] ${it.id} - ${it.title}`);
        });
      });
    }

    if (dryRun) {
      console.log(`\n  [DRY-RUN 模式] 仅进行拓扑连通聚类与指纹运算，未调用宿主 LLM。`);
    } else {
      console.log(`\n🚀 正在启动做梦执行管道，尝试借宿主 LLM 执行深度反思与熔炼...`);
      try {
        const pipeRes = await runDreamPipeline({ project, minAffinity, dryRun: false });
        if (pipeRes.skipped_reason) {
          console.log(`  ℹ️ ${pipeRes.skipped_reason}`);
        } else {
          console.log(`  ✅ 成功派发 ${pipeRes.processed} 个主题簇进行深度熔炼！`);
        }
      } catch (e) {
        console.error(`  ❌ 做梦流水线异常: ${e.message}`);
      }
    }
    console.log(`============================================================\n`);
    break;
  }

  case 'backup': {
    const targetPath = args[1] || null;
    console.log(`🔄 正在执行 SQLite 原生 VACUUM INTO 原子无损热备份...`);
    try {
      const backupFile = backupDatabase(targetPath);
      console.log(`✅ 备份成功！单文件归档镜像已生成:\n   ${backupFile}`);
    } catch (e) {
      console.error(`❌ 备份失败: ${e.message}`);
    }
    break;
  }

  case 'export': {
    const targetDir = args[1] || VAULT_DIR;
    console.log(`🔄 正在将 SQLite 知识库导出为 Markdown 文件...`);
    try {
      const res = exportToMarkdown(targetDir);
      console.log(`✅ 导出成功！共导出 ${res.totalExported} 篇 Markdown 卡片至:\n   ${res.exportDir}`);
    } catch (e) {
      console.error(`❌ 导出失败: ${e.message}`);
    }
    break;
  }

  case 'embed': {
    console.log(`🔄 正在执行知识向量化与同步维护 (384 维语义空间)...`);
    try {
      const res = syncEmbeddings();
      console.log(`✅ 向量化同步完成！新计算并持久化了 ${res.processed} 条卡片向量。`);
    } catch (e) {
      console.error(`❌ 向量同步失败: ${e.message}`);
    }
    break;
  }

  case 'path': {
    console.log(`\nMemHub 物理路径配置:`);
    console.log(`  • 根目录:   ${MEMHUB_HOME}`);
    console.log(`  • SQLite库: ${DB_PATH}`);
    console.log(`  • Vault导出: ${VAULT_DIR}`);
    console.log(`  • 归档目录: ${BACKUP_DIR}\n`);
    break;
  }

  case 'ui':
  case 'web':
  case 'server': {
    let port = 3900;
    let host = '127.0.0.1';
    let autoOpen = true;

    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--port' && args[i + 1]) {
        port = parseInt(args[++i], 10) || 3900;
      } else if (args[i] === '--host' && args[i + 1]) {
        host = args[++i];
      } else if (args[i] === '--no-open') {
        autoOpen = false;
      }
    }

    try {
      const { server } = await startWebServer({ port, host, open: autoOpen });

      const stopServer = () => {
        console.log('\n[memhub ui] 收到退出信号，正在关闭 Web 服务...');
        server.close(() => process.exit(0));
      };
      process.on('SIGINT', stopServer);
      process.on('SIGTERM', stopServer);
    } catch (e) {
      process.exit(1);
    }
    break;
  }

  default:
    printHelp();
}
