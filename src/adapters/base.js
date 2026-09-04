/**
 * AgentAdapter 抽象基类
 * 定义所有宿主 Agent (OpenCode, Cursor, Claude Code 等) 必须遵守的接口契约
 */
export class AgentAdapter {
  constructor(name) {
    if (new.target === AgentAdapter) {
      throw new TypeError('不能直接实例化抽象类 AgentAdapter');
    }
    this.name = name;
  }

  /**
   * 探测当前系统环境下该 Agent 是否可用/已安装
   * @returns {boolean}
   */
  isAvailable() {
    throw new Error('未实现 isAvailable()');
  }

  /**
   * 扫描待提炼的候选 Session 列表
   * @param {Object} options - { limit, excludeIds }
   * @returns {Array<{ id, title, projectPath, timeCreated, timeUpdated }>}
   */
  scanCandidateSessions(options = {}) {
    throw new Error('未实现 scanCandidateSessions()');
  }

  /**
   * 读取指定会话的技术文本上下文
   * @param {string} sessionId
   * @returns {Array<string>} 历史消息文本列表
   */
  readSessionContext(sessionId) {
    throw new Error('未实现 readSessionContext()');
  }

  /**
   * 根据当前工作目录反查当前活跃的 Session ID
   * @param {string} cwd
   * @returns {string|null}
   */
  resolveActiveSessionId(cwd) {
    throw new Error('未实现 resolveActiveSessionId()');
  }
}
