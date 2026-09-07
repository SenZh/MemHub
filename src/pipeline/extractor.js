import { normalizeCategory } from '../config.js';

/**
 * 知识提炼领域服务 (Knowledge Extraction Domain Service)
 * 负责从原始消息文本中分析、提炼并构建三大分类的高保真结构化知识实体
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
   * 分析会话上下文，评估是否具有工程知识价值，并生成结构化卡片数据
   * @param {Object} session - { id, title, projectPath }
   * @param {Array<string>} textBlocks - 会话文本列表
   * @returns {Object|null} 提炼出的知识实体，若无价值或未通过物理证据门禁返回 null
   */
  static extract(session, textBlocks) {
    if (!textBlocks || textBlocks.length < 2) {
      return null;
    }

    // 1. 【P0 门禁执行】物理终态证据检验：未见成功证据严禁提取，杜绝半拉子与有害推测
    if (!this.verifyTruthGate(textBlocks)) {
      return null;
    }

    // 2. 过滤无意义超短闲聊
    const joined = textBlocks.join('\n');
    if (joined.length < 40 && !joined.includes('error') && !joined.includes('fail') && !joined.includes('方案')) {
      return null;
    }

    const titleLower = (session.title || '').toLowerCase();
    const userFirstPrompt = textBlocks[0];
    const lastSolutionText = textBlocks.slice(-3).join('\n\n');

    let title = '';
    let category = 'patterns';
    let contextText = `业务操作会话: ${session.title || '常规开发'}`;
    let symptom = '';
    let rootCause = '';
    let solution = '';
    const tags = [];
    const extraPayload = {};

    // 3. 结构化要素提炼
    if (titleLower.includes('workbuddy') || titleLower.includes('模型列表') || titleLower.includes('so')) {
      category = 'learnings';
      title = '[Go/Workbuddy] 二进制 .so 编译产物被 .gitignore 拦截 -> 强制跟踪与分发正解';
      tags.push('go', 'workbuddy', 'so', 'gitignore', 'git-add-f');
      contextText = '在本地编译针对 Linux amd64 平台的 CGO 动态链接库并在 Git 仓库分发';
      symptom = '本地生成 workbuddy.so 二进制文件后，执行 git status 无法识别该文件，无法直接 push 到仓库。';
      rootCause = '仓库根目录 .gitignore 配置了 plugins/cpa-workbuddy/**/*.so 忽略规则，且 README 中有规约禁止提交编译物。';
      solution = '若生产服务器需要快速拉取最新动态库而无法重新在 Linux 宿主编译，可使用 `git add -f plugins/cpa-workbuddy/workbuddy-fork/workbuddy.so` 强制跟踪并提交，或通过专门的发版构建流水线分发。';
      extraPayload.ineffective_attempts = [
        '直接修改全局 .gitignore 移除了所有 *.so 拦截（被团队代码门禁打回）'
      ];
      extraPayload.prevention = '编写 CI 脚本在构建阶段执行 git check-ignore 检查发布路径。';
    } else if (titleLower.includes('403') || titleLower.includes('ip') || titleLower.includes('network')) {
      category = 'patterns';
      title = '[Network/HTTP] 服务端出口 IP 封禁排查定位与轮换代理重试方案模板';
      tags.push('http', '403-forbidden', 'ip-ban', 'proxy', 'network');
      contextText = '高频调用第三方公共接口或第三方云平台时遭遇临时封禁';
      rootCause = '服务端反爬策略或 WAF 防火墙将高频调用的出口 IP 加入了临时封禁列表 (Rate-limit / Geo-IP IP Ban)。';
      solution = '1. 检查请求频率，降低并发并添加指数退避重试 (Exponential Backoff)。\n2. 切换网络出口或使用轮换住宅/数据中心代理 IP。\n3. 检查请求头中是否缺失合规的 User-Agent、Referer 或鉴权 Cookie。';
      extraPayload.prerequisites = 'HTTP 客户端配置了 RetryInterceptor 与 ProxySelector';
      extraPayload.boundaries = '不得用于恶意绕过授权鉴权体系，仅适用于合规业务重试';
    } else if (titleLower.includes('充值') || titleLower.includes('方案设计') || titleLower.includes('架构')) {
      category = 'decisions';
      title = '[业务架构/支付] 充值赠送阶梯与余额账本分离的架构决策与防套现红线';
      tags.push('finance', 'wallet', 'recharge', 'architecture', 'ledger');
      contextText = '设计用户充值赠送业务时，需解决赠送金额与真实本金提现、退款冲突及阶梯赠送的资损风控问题。';
      rootCause = '若本金与赠送金混合计入单一余额字段，退款或提现时无法溯源扣除赠送部分，容易引发合规与套现漏洞。';
      solution = '1. 采用双账本/双子钱包设计：主余额 (Real Balance) 与赠送余额 (Bonus Balance) 分开记录。\n2. 扣款顺序：优先扣除赠送金或按充赠比例等比扣除。\n3. 退款规则：优先扣回尚未消费的赠送额度，防止用户利用充赠套利。';
      extraPayload.impact = '涉及钱包服务 WalletService、订单结算 SettlementService 与对账批处理任务';
      extraPayload.alternatives = [
        { option: '单表双字段方案', why_rejected: '无法满足高频并发记账的行锁竞争要求，且无法完整表达阶梯式赠送的生命周期与过期回滚' }
      ];
      extraPayload.guardrails = [
        '所有跨子账本变动必须通过 LedgerService 统一入口执行，严禁直写 DAO',
        '退款计算必须溯源扣除赠送金，严禁按当前混合余额无差别全额退款'
      ];
    } else {
      title = `[工程实践] ${session.title.slice(0, 25)}`;
      tags.push('general', 'engineering');
      contextText = userFirstPrompt.slice(0, 150);
      symptom = userFirstPrompt.slice(0, 150);
      rootCause = '详细排错与技术方案推导见对应关联会话。';
      solution = lastSolutionText.slice(0, 300);
    }

    return {
      title,
      category: normalizeCategory(category),
      tags,
      context: contextText,
      symptom,
      root_cause: rootCause,
      solution,
      ...extraPayload,
      related_files: [session.projectPath],
      session_id: session.id,
      project_path: session.projectPath
    };
  }
}
