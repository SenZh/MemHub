/**
 * 构建面向宿主 LLM 的做梦反思与记忆熔炼提示词
 * 目标：将 2~5 张相关的零散碎片卡片（Learnings / Decisions / Patterns / Business），
 * 交叉比对提炼为一套系统性、高密度的 L4 架构与工程实践规范。
 */
export function buildDreamPrompt(cluster) {
  const fragmentsText = cluster.items.map((item, idx) => {
    return [
      `【碎片 ${idx + 1}】ID: ${item.id}`,
      `标题: ${item.title}`,
      `分类: ${item.category}`,
      `标签: ${JSON.stringify(item.tags)}`,
      `背景: ${item.context_text || item.summary || '无'}`,
      `根因/设计理由: ${item.root_cause || '无'}`,
      `解决方案/正解代码:\n${item.solution_core || '无'}`,
      `涉及文件: ${JSON.stringify(item.related_files || [])}`
    ].join('\n');
  }).join('\n\n--------------------\n\n');

  return [
    `【MemHub 离线睡眠反思与记忆做梦熔炼任务 (Dreaming Consolidation)】`,
    `项目空间: ${cluster.project}`,
    `本次做梦候选簇包含以下 ${cluster.items.length} 张高度相关的历史工程碎片：`,
    ``,
    fragmentsText,
    ``,
    `====================================================`,
    `【架构师反思指令与生成规约】：`,
    `请像团队首席架构师一样，对以上碎片进行跨时间、跨会话的深度反省与综合熔炼：`,
    `1. 【深层因果共性抽象】：`,
    `   - 仔细比对这几张碎片是否存在共同的技术根因、通用设计模式或隐性业务流转逻辑？`,
    `   - 去除单次偶发的局部噪音，升华出一套通用的《标准设计规约 / 避坑 SOP》（L4 认知层）。`,
    `2. 【架构冲突自省 (Contradiction Radar)】：`,
    `   - 检查碎片之间是否存在相互矛盾的设计决策（如一个查主库、一个查从库；一个加事务、一个去事务）？`,
    `   - 若存在冲突，必须在正文中明确指出冲突点，并给出统一的技术裁决。`,
    `3. 【物理落盘与输出规范（拒绝八股文与碎字段）】：`,
    `   - 熔炼成功后，若具备 MCP 工具权限，请调用一次 MCP 工具 memhub_save 写入新生成的标准规约卡片；`,
    `   - 同时，必须在回复末尾附带一个标准的 JSON 代码块（\`\`\`json ... \`\`\`），以便离线管道校验与双轨落盘：`,
    `     {`,
    `       "title": "[技术栈/模块] 核心场景 -> 架构结论或终极正解 (20-40字)",`,
    `       "category": "排错避坑 | 业务知识 | 架构决策",`,
    `       "project": "${cluster.project}",`,
    `       "tags": ["核心技术标签1", "模块标签2"],`,
    `       "content": "自由连贯、包含业务背景、深度技术因果推导、完整可运行代码前后对比、排错推翻的假假设与防踩坑硬红线的高密度 Markdown 正文",`,
    `       "supersedes": "${cluster.card_ids.join(',')}"`,
    `     }`,
    `4. 【严禁强行捏合与空话敷衍】：`,
    `   - 若你判定这几条碎片虽然词汇相似但实际属于完全不同物理场景、无法抽象出高价值通用规范，请直接回复"放弃熔炼"，绝对不要调用 memhub_save 或输出上述规约 JSON！`,
    `   - 输出内容严禁出现“标准运行环境”、“结合业务场景评估”、“已通过功能测试”等无价值占位符，每一句话都必须具备可执行的技术实体与防御价值！`
  ].join('\n');
}
