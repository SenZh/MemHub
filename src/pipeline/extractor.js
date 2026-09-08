import { normalizeCategory } from '../config.js';

/**
 * 知识提炼领域服务 (Knowledge Extraction Domain Service)
 *
 * 核心原则：
 *  1. 物理终态证据检验门禁 (Truth Verification Gate)：未见成功证据严禁提取，杜绝半拉子与有害推测；
 *  2. 严禁离线启发式造假：坚决废除硬编码模板与泛化占位假卡，无价值或无 LLM 深度提炼一律不落库；
 *  3. 支持对宿主 LLM 产出进行严格格式规约校验与结构化实体解析。
 */
export class KnowledgeExtractor {
  /**
   * 物理终态证据检验门禁 (Truth Verification Gate)
   * 检查是否具备可信成功指标（退出码0、测试通过、构建成功或用户明确确认）
   */
  static verifyTruthGate(textBlocks) {
    if (!Array.isArray(textBlocks) || textBlocks.length < 2) return false;
    const combinedTail = textBlocks.slice(-3).join('\n').toLowerCase();
    
    // 成功物理证据特征
    const successEvidenceSignatures = [
      'exit code 0',
      'tests passed',
      'test passed',
      'all tests pass',
      'built in',
      'compiled successfully',
      'started application',
      '0 failed',
      'ok',
      '通过',
      '搞定',
      '生效',
      '成功',
      '完美解决'
    ];

    return successEvidenceSignatures.some(sig => combinedTail.includes(sig));
  }

  /**
   * 纯离线环境无 LLM 介入时，严禁硬编码捏造假知识卡片。
   * 若无有价值真实提炼产物或未通过物理证据门禁，一律返回 null，杜绝垃圾数据污染。
   * @param {Object} session - { id, title, projectPath }
   * @param {Array<string>} textBlocks - 会话文本列表
   * @returns {Object|null}
   */
  static extract(session, textBlocks) {
    // 1. 物理证据门禁检查
    if (!this.verifyTruthGate(textBlocks)) {
      return null;
    }

    // 2. 彻底废除离线硬编码模板（禁止根据关键词捏造 workbuddy / 403 / 充值 / 泛化工程实践假卡）
    // 真正的知识提炼完全委托给宿主 LLM（通过 opencode HTTP 驱动并调用 memhub_save）。
    // 离线扫描若未接入 LLM，安全返回 null。
    return null;
  }

  /**
   * 单会话多卡提取（纯离线回退安全空列表，真正抽取由 LLM 驱动）
   * @param {Object} session
   * @param {Array<string>} textBlocks
   * @returns {Array<Object>}
   */
  static extractAll(session, textBlocks) {
    const single = this.extract(session, textBlocks);
    return single ? [single] : [];
  }

  /**
   * 解析宿主 LLM 返回的内容（支持 JSON 代码块或结构化文本），提取出多张规范卡片
   * 用于接收宿主 LLM 回复并进行门禁与校验
   * @param {string} llmOutput - 宿主 LLM 文本响应
   * @param {Object} sessionContext - 会话上下文 { id, title, projectPath }
   * @returns {Array<Object>} 校验通过的高质量卡片实体列表
   */
  static parseLLMExtraction(llmOutput, sessionContext = {}) {
    if (!llmOutput || typeof llmOutput !== 'string') return [];

    const trimmed = llmOutput.trim();
    if (
      trimmed.includes('无需沉淀') ||
      trimmed.includes('无高价值') ||
      trimmed.includes('无需记录') ||
      trimmed.length < 20
    ) {
      return [];
    }

    const cards = [];

    // 尝试提取 Markdown 中的 ```json 块
    const jsonMatches = [...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/g)];
    for (const match of jsonMatches) {
      try {
        const parsed = JSON.parse(match[1]);
        const items = Array.isArray(parsed) ? parsed : [parsed];
        for (const item of items) {
          if (item && item.title && item.solution) {
            cards.push(this._sanitizeCard(item, sessionContext));
          }
        }
      } catch {
        // 忽略非卡片 JSON
      }
    }

    // 若无代码块，尝试整段当 JSON 解析
    if (cards.length === 0) {
      try {
        const parsed = JSON.parse(trimmed);
        const items = Array.isArray(parsed) ? parsed : [parsed];
        for (const item of items) {
          if (item && item.title && item.solution) {
            cards.push(this._sanitizeCard(item, sessionContext));
          }
        }
      } catch {
        // 纯文本形式未解析为 JSON，交由 LLM 直接调用 memhub_save（推荐主路径）
      }
    }

    return cards;
  }

  /**
   * 清洗并规范化 LLM 提炼出的单张卡片
   */
  static _sanitizeCard(raw, session = {}) {
    const category = normalizeCategory(raw.category || 'learnings');
    return {
      title: String(raw.title || '').trim(),
      category,
      tags: Array.isArray(raw.tags) ? raw.tags.map(t => String(t).trim().toLowerCase()) : [],
      context: String(raw.context || raw.background || `会话操作: ${session.title || ''}`).trim(),
      symptom: raw.symptom ? String(raw.symptom).trim() : undefined,
      root_cause: raw.root_cause ? String(raw.root_cause).trim() : undefined,
      solution: String(raw.solution || '').trim(),
      related_files: Array.isArray(raw.related_files) ? raw.related_files : (session.projectPath ? [session.projectPath] : []),
      session_id: session.id,
      project_path: session.projectPath,
      topic_fingerprint: raw.topic_fingerprint || undefined,
      ineffective_attempts: Array.isArray(raw.ineffective_attempts) ? raw.ineffective_attempts : undefined,
      prevention: raw.prevention ? String(raw.prevention).trim() : undefined,
      impact: raw.impact ? String(raw.impact).trim() : undefined,
      guardrails: Array.isArray(raw.guardrails) ? raw.guardrails : undefined,
      alternatives: Array.isArray(raw.alternatives) ? raw.alternatives : undefined,
      boundaries: raw.boundaries ? String(raw.boundaries).trim() : undefined,
      prerequisites: raw.prerequisites ? String(raw.prerequisites).trim() : undefined
    };
  }
}
