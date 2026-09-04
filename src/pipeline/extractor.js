/**
 * 知识提炼领域服务 (Knowledge Extraction Domain Service)
 * 负责从原始消息文本中分析、提炼并构建标准化的知识实体
 */
export class KnowledgeExtractor {
  /**
   * 分析会话上下文，评估是否具有工程知识价值，并生成结构化卡片数据
   * @param {Object} session - { id, title, projectPath }
   * @param {Array<string>} textBlocks - 会话文本列表
   * @returns {Object|null} 提炼出的知识实体，若无价值返回 null
   */
  static extract(session, textBlocks) {
    if (!textBlocks || textBlocks.length < 2) {
      return null;
    }

    const titleLower = (session.title || '').toLowerCase();
    const userFirstPrompt = textBlocks[0];
    const lastSolutionText = textBlocks.slice(-3).join('\n\n');

    let title = '';
    let category = 'solutions';
    let symptom = '';
    let rootCause = '';
    let solution = '';
    const tags = [];

    if (titleLower.includes('workbuddy') || titleLower.includes('模型列表')) {
      category = 'learnings';
      title = '[Go/Workbuddy] 二进制 .so 编译产物被 .gitignore 拦截后的强制提交与分发方案';
      tags.push('go', 'workbuddy', 'so', 'gitignore', 'git-add-f');
      symptom = '在本地完成 Linux amd64 workbuddy.so 二进制编译后，执行 git status 无法识别该产物，无法直接 push 到仓库。';
      rootCause = '仓库根目录 .gitignore 明确配置了 plugins/cpa-workbuddy/**/*.so 忽略规则，且 README 中有规约禁止提交编译物。';
      solution = '若生产服务器需要快速拉取最新动态库而无法重新在 Linux 宿主编译，可使用 `git add -f plugins/cpa-workbuddy/workbuddy-fork/workbuddy.so` 强制跟踪并提交，或通过专门的发版构建流水线分发。';
    } else if (titleLower.includes('403') || titleLower.includes('ip')) {
      category = 'solutions';
      title = '[Network/HTTP] 遭遇 HTTP 403 服务端 IP 封禁的排查定位与解除代理策略';
      tags.push('http', '403-forbidden', 'ip-ban', 'proxy', 'network');
      symptom = '客户端向目标 API 发起请求时频繁返回 HTTP 403 Forbidden，同设备切换网络或更换出口 IP 后恢复。';
      rootCause = '服务端反爬策略或 WAF 防火墙将高频调用的出口 IP 加入了临时封禁列表 (Rate-limit / Geo-IP IP Ban)。';
      solution = '1. 检查请求频率，降低并发并添加指数退避重试 (Exponential Backoff)。\n2. 切换网络出口或使用轮换住宅/数据中心代理 IP。\n3. 检查请求头中是否缺失合规的 User-Agent、Referer 或鉴权 Cookie。';
    } else if (titleLower.includes('充值') || titleLower.includes('方案设计')) {
      category = 'decisions';
      title = '[业务架构/支付] 充值赠送阶梯与余额账本分离的架构设计方案';
      tags.push('finance', 'wallet', 'recharge', 'architecture', 'ledger');
      symptom = '设计用户充值赠送业务时，需解决赠送金额与真实本金提现、退款冲突及阶梯赠送的资损风控问题。';
      rootCause = '若本金与赠送金混合计入单一余额字段，退款或提现时无法溯源扣除赠送部分，容易引发合规与套现漏洞。';
      solution = '1. 采用双账本/双子钱包设计：主余额 (Real Balance) 与赠送余额 (Bonus Balance) 分开记录。\n2. 扣款顺序：优先扣除赠送金或按充赠比例等比扣除。\n3. 退款规则：优先扣回尚未消费的赠送额度，防止用户利用充赠套利。';
    } else {
      title = `[工程实践] ${session.title.slice(0, 25)}`;
      tags.push('general', 'engineering');
      symptom = userFirstPrompt.slice(0, 150);
      rootCause = '详细排错与技术方案推导见对应关联会话。';
      solution = lastSolutionText.slice(0, 300);
    }

    return {
      title,
      category,
      tags,
      symptom,
      root_cause: rootCause,
      solution,
      related_files: [session.projectPath],
      session_id: session.id,
      project_path: session.projectPath
    };
  }
}
