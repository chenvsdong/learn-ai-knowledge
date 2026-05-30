# 第 27 章：AI Agent 工程师能力模型

## 本章解决什么问题

前面 26 章已经完成了从原理到项目的完整路径：

- 第 1-9 章：理解 AI、机器学习、深度学习、大模型、Prompt、上下文和 RAG。
- 第 10-17 章：理解 Function Calling、Tool Use、MCP、Skill、Agent、Planning、Runtime 和 Multi-Agent。
- 第 18-22 章：理解 Harness、后端架构、可观测性、安全、性能和成本。
- 第 23-26 章：完成知识库 Agent、企业工作流 Agent、研究型 Agent、代码开发 Agent 四个项目。

现在要回答一个更个人化的问题：

> 学完这些内容后，怎样才算具备 AI Agent 工程师能力？

AI Agent 工程师不是“会调大模型 API 的后端工程师”，也不是“会写 Prompt 的产品经理”。它是一种交叉能力：

- 懂模型，但不迷信模型。
- 会 Prompt，但不把 Prompt 当系统边界。
- 会 RAG，但知道检索、权限、引用和评估比向量库更重要。
- 会 Tool / MCP，但知道工具调用必须放进权限、审批和审计。
- 会后端工程，但知道 Agent 系统多了不确定性、评估和反馈闭环。
- 会产品判断，但知道什么时候该回答、什么时候该 unknown、什么时候该让人审批。

本章要回答：

- AI Agent 工程师需要哪些核心能力？
- 每种能力从入门到专业怎么分层？
- Java / 后端工程师已有能力怎么迁移？
- 怎样判断自己不是只会 Demo？
- 怎样设计作品集和学习路线？
- 面试或项目评估时应该展示什么？
- 哪些能力应该优先补，哪些可以后续深入？

截至 2026-05-30，OpenAI 和 Anthropic 的公开材料都强调：Agent 不只是模型调用，还涉及工具、指令、工作流、评估、安全和运行环境；MCP 规范把工具、资源和提示作为外部能力接口；OpenAI Codex 文档体现了代码开发 Agent 对沙箱、工具、权限和仓库上下文的要求。本章基于这些公开资料和本书前 26 章的工程抽象整理能力模型，不把任何厂商认证、岗位名称或工具栈写成行业统一标准。

读完本章，读者应该能给自己做一次能力盘点：哪些能力已经具备，哪些还停留在 Demo，下一步应该做哪个项目，如何把自己的作品集从“能调用 API”升级成“能设计可生产 Agent 系统”。

## 一个直观例子

两个人都说自己会做 AI Agent。

第一个人展示：

```text
我写了一个聊天机器人，可以调用大模型回答问题。
Prompt 里写了“请你查资料并回答”。
```

第二个人展示：

```text
我做了一个 kb-assistant：

1. 文档上传后异步解析、切分和索引。
2. 检索前做 tenant / ACL 过滤。
3. 回答必须绑定 evidence_ref。
4. 证据不足时返回 unknown。
5. 工具调用进入 Tool Gateway。
6. 写操作需要 approval、idempotency 和 audit。
7. trace 能回放每次 run。
8. eval 覆盖 citation missing、permission denied、prompt injection、tool timeout。
9. 成本按 tenant / agent / run / model_profile 归集。
10. 部署用 GitHub Actions，页面自动渲染章节内容。
```

这两个人的差距，不是“谁用的模型更强”，而是工程能力模型不同。

AI Agent 工程师的核心能力，是把不确定的模型能力放进确定的工程边界里。

## 基础解释

### AI Agent 工程师是什么

AI Agent 工程师是能够设计、实现、评估和治理 Agent 系统的工程师。

它需要同时理解：

- 模型如何理解和生成。
- 上下文如何构建。
- 工具如何暴露和调用。
- 后端如何承载运行时。
- 权限如何控制。
- 评估如何证明改动有效。
- 生产系统如何观测、回滚和持续优化。

如果只会调用模型 API，还不是 Agent 工程师。如果只懂后端系统，但不知道模型的不确定性、上下文和评估，也还不完整。

### Agent 工程师和传统后端工程师的区别

| 维度 | 传统后端工程师 | AI Agent 工程师 |
| --- | --- | --- |
| 主要对象 | API、数据库、消息队列、业务逻辑 | 模型、上下文、工具、运行时、评估 |
| 行为确定性 | 输入输出相对确定 | 模型输出有概率性和上下文敏感性 |
| 测试方式 | 单元测试、集成测试、压测 | Eval dataset、trace grading、红队样本、回归集 |
| 失败模式 | 异常、超时、数据不一致 | 幻觉、工具误用、上下文污染、越权、unknown 处理错误 |
| 安全边界 | Auth、RBAC、审计 | Auth + Tool Policy + Prompt Injection 防护 + 审批 |
| 交付物 | 服务和接口 | Agent 能力、运行时、工具生态、评估闭环 |

后端能力非常重要，但需要加上模型、上下文和评估这几层。

### Agent 工程师和 Prompt Engineer 的区别

Prompt 很重要，但 Prompt 不是全部。

Prompt Engineer 更关注：

- 指令表达。
- 输出格式。
- few-shot 示例。
- 角色设定。
- 模型行为调优。

Agent 工程师还要关注：

- 工具 schema。
- Context Builder。
- Retrieval Pipeline。
- Tool Gateway。
- Policy Engine。
- Runtime State。
- Trace / Eval。
- Approval / Audit。
- Cost / Latency。
- Release Gate。

好的 Agent 工程师会写 Prompt，但不会把系统可靠性交给 Prompt。

### 能力不是线性学习

AI Agent 能力不是按“先学完模型，再学完后端，再学完安全”的线性顺序增长。更真实的路径是：

```text
做一个最小项目
  -> 遇到上下文问题
  -> 学 RAG
  -> 遇到工具问题
  -> 学 Tool / MCP
  -> 遇到生产问题
  -> 学 Runtime / Trace / Eval
  -> 遇到安全问题
  -> 学 Policy / Approval / Audit
```

能力模型的作用，是帮你知道自己卡在哪一层。

## 核心原理

### 原理一：Agent 能力是组合能力

AI Agent 工程不是单点技能，而是组合能力：

```text
Model Understanding
  + Prompt / Context
  + RAG / Memory
  + Tool / MCP
  + Runtime / State
  + Backend Architecture
  + Observability / Eval
  + Security / Permission
  + Product Judgment
```

任何一项过弱，都会影响系统质量。

例如：

- 只懂模型，不懂权限，会做出危险 Agent。
- 只懂后端，不懂 eval，会不知道 Agent 是否变好。
- 只懂 RAG，不懂引用校验，会做出“看起来有来源”的幻觉系统。
- 只懂工具，不懂审批，会让模型直接执行高风险动作。

### 原理二：专业能力体现在边界判断

初学者常问：

```text
这个能不能让模型做？
```

专业工程师会问：

```text
这个应该由模型做，还是由规则、工具、权限系统、人工审批做？
```

边界判断包括：

- 什么时候让模型分类。
- 什么时候让模型规划。
- 什么时候必须由后端校验。
- 什么时候必须让人审批。
- 什么时候应该返回 unknown。
- 什么时候应该拒绝。
- 什么时候应该缓存。
- 什么时候必须刷新。

Agent 工程的成熟度，很大程度上体现在这些边界上。

### 原理三：所有能力都要可验证

不能只说“我会 RAG”。要能证明：

- 检索召回是否提升。
- 回答是否忠实于 evidence。
- 权限过滤是否生效。
- Prompt Injection 是否被拦截。
- 工具调用是否按策略执行。
- 成本是否可归因。
- 失败是否可回放。

因此每项能力都要配 eval、trace 或测试。

### 原理四：作品集比证书更能说明能力

AI Agent 工程仍在快速变化。工具和 API 会变，但优秀作品集能说明：

- 你能理解问题。
- 你能设计系统。
- 你能处理异常。
- 你能验证效果。
- 你能把 Demo 做到生产边界。

一个好作品集不是“我接了某某模型”，而是：

```text
我做了一个 Agent 项目，并说明：
- 解决什么问题。
- 架构怎么设计。
- 工具怎么治理。
- 评估集怎么设计。
- 安全边界是什么。
- 失败案例怎么修复。
- 成本和延迟怎么观察。
```

### 原理五：学习路线要和项目绑定

只看文档很容易变成“知道很多名词”。更有效的方法是每学一层能力，都放进项目：

- 学 Prompt：改进回答格式和 unknown。
- 学 RAG：加入引用和权限过滤。
- 学 Tool：加入只读工具。
- 学 Approval：加入写操作审批。
- 学 Trace：让每次 run 可回放。
- 学 Eval：让失败样本变成回归。
- 学 Cost：让每次调用可归因。

项目是能力的容器。

## 工程实现

### 能力地图

可以把 AI Agent 工程师能力分成 10 组：

| 能力 | 说明 |
| --- | --- |
| Model Understanding | 理解模型能力、限制、上下文和输出不确定性 |
| Prompt / Context Engineering | 设计指令、上下文、输出结构和边界 |
| RAG / Knowledge Engineering | 文档、chunk、embedding、检索、引用、权限 |
| Tool / MCP Engineering | 工具 schema、注册、调用、MCP 接入、工具结果治理 |
| Agent Runtime | run、step、state、planning、stop condition、恢复 |
| Backend Architecture | API、队列、worker、存储、流式事件、多租户 |
| Observability / Eval | trace、metrics、eval dataset、feedback、release gate |
| Security / Permission | prompt injection、tool policy、approval、audit、secret |
| Performance / Cost | 模型路由、缓存、并发、降级、成本归集 |
| Product / Domain Judgment | 场景边界、用户体验、unknown、人工协作、商业价值 |

这 10 组能力不是职位描述，而是自评工具。

### 分级模型

每项能力可以按 5 级评估：

| 等级 | 表现 |
| --- | --- |
| L1 入门 | 能解释概念，跑通 Demo |
| L2 初级 | 能在项目中使用，知道常见坑 |
| L3 中级 | 能接入真实后端，处理权限、状态和异常 |
| L4 高级 | 能做评估、观测、安全、成本和发布治理 |
| L5 专业 | 能建设平台能力，支持多个 Agent 和团队复用 |

不要把 L1 当成完成。AI Agent 最大的坑，往往出现在从 Demo 到真实系统之间。

更细的判定可以这样理解：

| 能力 | L1 | L2 | L3 | L4 | L5 |
| --- | --- | --- | --- | --- | --- |
| Model Understanding | 能解释 token、上下文、幻觉 | 能选择模型并写基础调用 | 能按任务风险选择 model profile | 能做模型回归、fallback 和质量门禁 | 能建设多模型网关和升级策略 |
| Prompt / Context | 能写清晰指令 | 能设计结构化输出和 few-shot | 能建设 Context Builder 和 unknown 规则 | 能做 prompt version、eval 和安全边界 | 能平台化 Prompt / Context 管理 |
| RAG / Knowledge | 能跑通向量检索 Demo | 能设计 chunk 和 citation | 能做权限过滤、版本和 citation checker | 能做 retrieval / answer / freshness eval | 能建设多租户知识平台 |
| Tool / MCP | 能调用一个 function | 能写 tool schema 和参数校验 | 能做 Tool Registry、allowlist 和 Tool Gateway | 能做 MCP 接入、安全审查和审批 | 能建设企业工具生态和治理平台 |
| Runtime / State | 能跑单轮 agent loop | 能记录 run / step | 能做状态机、stop condition 和恢复 | 能做异步、审批等待、幂等和补偿 | 能建设通用 Agent Runtime |
| Backend Architecture | 能写 API 服务 | 能接入队列、存储和 SSE | 能支持多租户、worker 和 tool adapter | 能做灰度、回滚、容量和故障隔离 | 能建设 Agent Platform 后端 |
| Observability / Eval | 能看日志 | 能记录 trace 和基础指标 | 能建设 eval dataset 和 feedback 闭环 | 能做 trace grading、release gate 和线上回归 | 能建设统一 Eval Harness |
| Security / Permission | 知道 Prompt Injection 风险 | 能做基础 tool allowlist | 能做 policy、approval、audit、tenant isolation | 能做红队样本、MCP 安全和 secret 治理 | 能建设企业 Agent 安全平台 |
| Performance / Cost | 知道 token 成本 | 能记录 token / latency | 能做模型路由、缓存和并发 | 能做成本归集、降级和 canary | 能建设预算、路由和优化平台 |
| Product Judgment | 能描述用户场景 | 能设计基本体验 | 能处理 unknown、确认和人工协作 | 能做 trade-off、失败体验和价值验证 | 能定义 Agent 产品线和落地策略 |

这张表仍然是本书的自评工具，不是行业认证。使用时要配证据，而不是只选一个等级。

### 能力矩阵

自评表可以这样写：

```json
{
  "agent_engineer_skill_matrix": {
    "rag_knowledge": {
      "level": "L3",
      "evidence_ref": "kb-assistant: citation checker + retrieval eval",
      "gap": "freshness eval 还不完整",
      "next_task": "补 document_version stale 样本"
    },
    "security_permission": {
      "level": "L2",
      "evidence_ref": "tool allowlist + prompt injection samples",
      "gap": "approval / audit 还没有落到项目",
      "next_task": "给 create_release_blocker 加 approval object"
    }
  }
}
```

这个矩阵不是打分游戏，而是找下一步学习重点。

例如 Java 后端工程师常见画像：

```text
Backend Architecture：L4
Runtime / State：L3
Security / Permission：L3
Model Understanding：L1-L2
Prompt / Context：L2
RAG / Eval：L1-L2
```

这说明转型重点不是重学后端，而是补模型、上下文、RAG、工具和 eval。

### 四个项目对应能力

本书四个项目分别训练不同能力：

| 项目 | 训练能力 |
| --- | --- |
| 知识库问答 Agent | RAG、引用、权限过滤、unknown、eval |
| 企业工作流 Agent | Tool、MCP、审批、状态机、幂等、审计 |
| 研究型 Agent | 搜索、来源治理、冲突处理、报告事实核查 |
| 代码开发 Agent | 代码阅读、patch、测试、review、工作区安全 |

如果你能把这四个项目都做出可运行版本，并且每个项目都有 trace、eval 和安全边界，就已经超过“会调用大模型 API”的层次。

更细的项目-能力矩阵：

| 项目 | Model | Context | RAG | Tool | Runtime | Backend | Eval | Security | Cost | Product |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 知识库问答 | 中 | 强 | 强 | 弱 | 中 | 中 | 强 | 强 | 中 | 中 |
| 企业工作流 | 中 | 中 | 弱 | 强 | 强 | 强 | 强 | 强 | 中 | 强 |
| 研究型 Agent | 中 | 强 | 中 | 中 | 中 | 中 | 强 | 强 | 中 | 强 |
| 代码开发 Agent | 中 | 强 | 弱 | 强 | 中 | 中 | 强 | 强 | 中 | 强 |

“弱”不是不需要，而是不是该项目的主要训练点。例如代码开发 Agent 也需要上下文，但不主要训练 RAG。

### 作品集结构

每个作品集项目建议包含：

```text
README.md
  - 项目解决什么问题
  - 环境要求
  - 启动命令
  - 测试命令
  - 示例数据
  - 架构图
  - 核心流程
  - 数据模型
  - 工具和权限
  - 安全边界
  - Eval 样本
  - Trace 示例
  - 失败样本复现方式
  - 运行方式
  - 已知限制
```

最好再加：

- `docs/architecture.md`
- `docs/security.md`
- `docs/eval.md`
- `docs/failure-cases.md`
- `examples/traces/`
- `examples/eval-cases/`

面试或交流时，别人看这些材料，就能判断你是不是只做了一个 UI Demo。

作品集必须能被复现。至少要回答：

```text
如何启动？
如何跑测试？
如何导入示例数据？
如何复现一个失败样本？
如何查看 trace？
如何运行 eval？
哪些功能还没做？
```

### 能力证据

不同能力需要不同证据：

| 能力 | 可展示证据 |
| --- | --- |
| RAG | chunk schema、retrieval eval、citation checker |
| Tool | tool registry、policy decision、tool trace |
| Runtime | run / step 状态机、恢复样本 |
| Eval | eval cases、失败样本、release gate |
| Security | prompt injection 样本、approval、audit |
| Cost | cost event、model routing、cache policy |
| Coding Agent | patch record、test output、diff review |
| Product Judgment | unknown 设计、用户确认、降级策略 |

能力证据越具体，越能避免空泛描述。

### 学习路线

一个现实学习路线：

```text
阶段 1：模型和 Prompt
  -> 能写结构化输出和 unknown
  -> 验收：至少 5 个输入样本，覆盖 answered / unknown / invalid

阶段 2：RAG 和引用
  -> 做知识库问答 Agent
  -> 验收：至少 10 个 eval case，回答包含 citations，缺证据能 unknown

阶段 3：Tool 和 Runtime
  -> 做企业工作流 Agent
  -> 验收：至少 4 个工具，1 个写操作 approval，run / step 可恢复

阶段 4：Trace 和 Eval
  -> 给前两个项目加评估和反馈
  -> 验收：每次 run 可回放，失败 feedback 能进入 eval

阶段 5：Security 和 Permission
  -> 加审批、审计、注入样本
  -> 验收：prompt injection、tool injection、cross-tenant、write without approval 样本通过

阶段 6：Performance 和 Cost
  -> 加模型路由、缓存、成本归集
  -> 验收：成本按 tenant / agent / run 归集，缓存不绕过权限

阶段 7：Research / Coding 项目
  -> 扩展到开放网页和代码库
  -> 验收：研究报告 claim 有 evidence；coding agent 能保护 dirty worktree

阶段 8：平台化
  -> 抽象 Tool Registry、Eval Harness、Agent Runtime
  -> 验收：至少两个 Agent 复用同一套 registry / eval / runtime
```

这不是唯一顺序。已有后端经验的人，可以更早进入 Runtime 和 Tool；已有算法经验的人，可能更快理解模型和检索，但需要补后端治理。

### 面试表达

面试里不要只说：

```text
我熟悉 LangChain / Spring AI / OpenAI API。
```

更有说服力的表达是：

```text
我做过一个知识库 Agent：
- 文档按版本切分和索引。
- 检索前做 tenant / ACL filter。
- 回答必须绑定 evidence_ref。
- 缺证据返回 unknown。
- eval 覆盖 citation missing、permission denied、prompt injection。
- trace 能回放 query、retrieval、context、answer。
```

再进一步：

```text
我发现一次失败是检索召回了过期文档，于是加了 document_version 和 freshness eval。
```

这种表达能体现真实工程能力。

面试中还要能讲失败复盘：

```text
一次失败是：模型在 permission_denied 时仍然回答“可以上线”。
原因是：工具结果进入上下文后，没有 output policy 检查 unknown。
修复是：增加 final answer guardrail 和 eval case。
验证是：release_permission_denied_regression_001 进入回归集。
取舍是：回答会更保守，但避免错误 ready 判断。
```

也要能回答反向问题：

```text
为什么不用普通规则系统？
```

好的回答不是“因为 Agent 更智能”，而是：

```text
规则系统适合确定流程；Agent 适合处理自然语言入口、非结构化资料、证据整理和动态工具选择。
本项目中，权限、审批和最终执行仍由规则系统负责，Agent 只负责理解意图、整理证据和生成候选动作。
```

## 适用场景

### 玩具 Demo

Demo 阶段适合：

- 熟悉模型 API。
- 尝试 Prompt。
- 跑通 RAG。
- 调用一个工具。
- 做一个简单 UI。

Demo 的价值是学习概念，但不能证明生产能力。

### 个人效率工具

个人工具适合训练：

- Prompt / Context。
- 本地知识库。
- 简单工具调用。
- 文件整理。
- 研究报告。
- 小代码任务。

个人工具能让你遇到真实问题，但权限、审计和多租户压力较小。

### 团队内部工具

团队工具适合训练：

- 多用户权限。
- Trace。
- Eval。
- Feedback。
- Tool Policy。
- 成本归集。
- 运维和告警。

这是从“会做 Demo”走向“能进生产”的关键层级。

### 企业级系统

企业级系统适合训练：

- Agent Platform。
- 多租户。
- 安全合规。
- 审批审计。
- Release Gate。
- 成本治理。
- 多 Agent 协作。
- 统一 Tool / Skill / MCP 管理。

企业级能力不是一开始就要做，但要知道终局长什么样。

## 不适用场景

不适合用能力模型给自己制造焦虑。它是导航图，不是一次性清单。

不适合只追逐最新框架。框架会变，Context、Tool、Runtime、Eval、安全这些底层问题不会消失。

不适合把模型能力当成自己的工程能力。模型变强会降低某些门槛，但不会替你设计权限、审计和评估。

不适合只做 UI Demo。没有 trace、eval、权限和失败样本的 Demo，很难证明专业能力。

不适合一开始就做“大而全平台”。先做项目，再抽象平台。

## 常见坑与反模式

1. 只学 Prompt。

   Prompt 重要，但 Agent 工程远不止 Prompt。

2. 只追框架。

   会用框架不等于理解 Agent 系统。

3. 项目没有评估。

   没有 eval，就不知道系统是否变好。

4. 没有失败样本。

   只展示成功 demo，无法证明可靠性。

5. 忽略安全。

   Tool、RAG、MCP、Coding Agent 都有越权和注入风险。

6. 忽略后端工程。

   Agent 最终要落到 API、状态、队列、存储、权限和运维。

7. 过早平台化。

   没有项目经验的平台抽象容易空转。

8. 只看模型榜单。

   模型选择重要，但系统设计决定上限。

9. 不会解释 trade-off。

   专业工程师要能说明为什么这样设计、放弃了什么、风险在哪里。

10. 作品集没有代码和文档。

   只有截图和口头描述，很难建立信任。

## 安全、成本与性能考虑

### 安全

能力成长中要始终保留安全意识：

- Prompt 不是安全边界。
- 工具调用必须过 Policy。
- RAG 文档是 untrusted data。
- MCP Server 需要 allowlist。
- 写操作要审批。
- Coding Agent 要保护工作区。
- Trace 不能泄露敏感原文和 secret。

安全不是最后补的章节，而是贯穿所有 Agent 项目的能力。

### 成本

学习时也要关注成本：

- 不要每次都用最强模型。
- 小样本 eval 先跑 smoke set。
- 大规模研究任务用后台队列。
- 文档 embedding 做增量更新。
- 测试命令先 focused，再全量。
- 记录 token、工具调用和运行时间。

成本意识不是省钱小气，而是理解系统能否规模化。

### 性能

性能能力体现在：

- 首屏响应。
- 流式输出。
- 异步任务。
- 工具并发。
- 缓存。
- 降级。
- 长尾延迟分析。

不要把性能优化理解成“让模型快点”。多数 Agent 性能问题来自上下文、工具、队列和外部系统。

## 如何评估效果

评估自己是否具备 AI Agent 工程能力，可以看这些问题：

| 问题 | 如果回答不了，说明 |
| --- | --- |
| 你的 Agent 如何处理 unknown？ | 可能还停留在聊天 Demo |
| 每条关键结论能否追到 evidence？ | RAG / research 能力不完整 |
| 工具调用前谁做权限检查？ | Tool / security 边界不清 |
| 写操作如何审批和幂等？ | 工作流能力不足 |
| 失败样本如何进入 eval？ | 评估闭环不足 |
| trace 能否回放一次 run？ | 可观测性不足 |
| 成本如何归因？ | 生产治理不足 |
| 用户改动如何保护？ | Coding Agent 能力不足 |
| 如何证明新版本更好？ | Release Gate 不完整 |

一个成熟作品集至少应包含：

```json
{
  "portfolio_readiness": {
    "has_running_demo": true,
    "has_architecture_doc": true,
    "has_eval_cases": true,
    "has_trace_examples": true,
    "has_security_notes": true,
    "has_failure_cases": true,
    "has_cost_or_latency_notes": true,
    "has_known_limitations": true
  }
}
```

这些不是形式化材料，而是你对系统理解的证据。

团队评审表可以用 0-2 分：

| 维度 | 0 分 | 1 分 | 2 分 |
| --- | --- | --- | --- |
| 功能 | 只能演示 happy path | 核心流程可用 | 覆盖异常、unknown 和降级 |
| 架构 | 无清晰模块 | 有基本架构图 | 模块边界、状态、数据模型清楚 |
| Eval | 无 eval | 有少量样本 | 有失败样本、回归集和 release gate |
| Trace | 只能看日志 | 有 run trace | 能回放 context、tool、policy、answer |
| 安全 | 只靠 prompt | 有 allowlist / 基础权限 | 有 policy、approval、audit、注入样本 |
| 成本 | 未记录 | 记录 token / latency | 能按 tenant / run / tool / model 归集 |
| 可运行性 | 只能作者本机跑 | 有启动说明 | 有环境、测试、示例数据和复现步骤 |
| 限制说明 | 不写限制 | 简单说明 | 明确边界、风险和后续路线 |

一个团队内部工具至少应接近 12 分以上，并且安全、eval、可运行性不能为 0。这个分数不是行业标准，只是帮助团队做一致评审的工具。

## 实践任务

1. 入门：做能力自评。

交付物：按 10 组能力给自己标 L1-L5。

自查标准：每个分数都要写一个证据，而不是凭感觉。

2. 初级：整理一个项目作品集。

交付物：为知识库 Agent 写 README、架构图、数据模型、eval 样本和 trace 示例。

自查标准：不能只有 UI 截图。

3. 中级：补齐项目短板。

交付物：选择一个现有项目，补 trace、eval、security notes 中至少两项。

自查标准：必须能展示失败样本如何被修复。

4. 高级：做能力迁移分析。

交付物：如果你是 Java / 后端工程师，写出已有能力、缺口能力和 30 天补齐计划。

自查标准：计划必须绑定具体项目任务。

5. 生产化：设计作品集评审表。

交付物：设计一张评审表，用于判断一个 Agent 项目是否达到团队内部工具水平。

自查标准：评审表必须覆盖功能、架构、安全、eval、trace、成本、限制和可运行性。

参考答案要点：

- 能力模型用于定位短板，不用于焦虑。
- Agent 工程能力是组合能力。
- Prompt、RAG、Tool、Runtime、Eval、安全、后端和产品判断都重要。
- 作品集要展示失败和修复，而不只是成功 demo。
- 每项能力最好有代码、文档、trace 或 eval 证据。

## 从入门到专业

- 入门：能解释 Agent、RAG、Tool、Context、Eval 的基本概念。
- 初级：能做一个可运行 Demo。
- 中级：能把 Demo 接进后端，处理权限、状态和异常。
- 高级：能建立 trace、eval、安全、成本和发布门禁。
- 专业：能抽象平台能力，支持多个 Agent、多个团队和持续优化。

从入门到专业，不是靠看更多文章，而是靠一轮轮把项目做深：

```text
能跑 -> 能解释 -> 能评估 -> 能治理 -> 能复用
```

这是 AI Agent 工程师的成长路径。

## 本章小结

AI Agent 工程师的能力，不是单一技术点，而是一组围绕模型不确定性建立工程边界的能力。

本章建立了几个核心结论：

- Agent 工程师不是只会调 API，也不是只会写 Prompt。
- 专业能力体现在边界判断。
- 所有能力都要可验证。
- 作品集比空泛描述更有说服力。
- 学习路线要和项目绑定。
- 四个项目分别训练知识、流程、研究和代码四类 Agent 能力。
- 从 Demo 到生产，需要 trace、eval、安全、成本和失败样本。

下一章会进入更具体的人群路线：Java 工程师如何转 AI Agent。第 27 章给出通用能力模型，第 28 章会把它映射到 Java / 后端工程师的已有优势和补齐路径。

## Sources

以下来源按 2026-05-30 访问时理解；Agent 工程能力模型仍在发展，本章采用工程抽象，不把任何厂商文档或岗位名称写成统一标准。

- [OpenAI: A practical guide to building agents](https://openai.com/business/guides-and-resources/a-practical-guide-to-building-ai-agents/)
- [OpenAI Agents SDK: Tools](https://openai.github.io/openai-agents-python/tools/)
- [Anthropic: Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)
- [Model Context Protocol: Specification 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25)
- [OpenAI Codex: CLI](https://developers.openai.com/codex/cli)

## 写作审查记录

### 章节架构师

- 本章目标：把前 26 章的知识和项目抽象成 AI Agent 工程师能力模型。
- 知识点地图：能力地图、分级模型、作品集、能力证据、学习路线、面试表达和自评方法。
- 前后章节关系：承接四个项目章，进入第 28 章 Java 工程师转型路线前，先定义通用能力框架。

### 技术审稿人

- 发现问题：能力模型容易被写成无来源的行业标准或岗位认证。
- 修订动作：引用 OpenAI Agents、Anthropic effective agents、MCP、Codex 等官方资料；明确本章是本书工程抽象，不代表行业统一标准；把 L1-L5 写成行为和证据判定，而不是岗位认证。
- 结论：章节没有把能力模型伪装成官方认证或通用岗位标准。

### 工程审稿人

- 发现问题：能力模型如果只讲概念，无法指导读者补齐工程短板。
- 修订动作：把能力拆成 Model、Context、RAG、Tool、Runtime、Backend、Eval、Security、Cost、Product 10 组，补充逐项 L1-L5 判定、项目-能力矩阵、证据型能力矩阵、作品集复现要求和团队评分表。
- 结论：章节能落到真实学习和项目建设，避免空泛职业建议。

### 学习体验审稿人

- 发现问题：读者可能学完项目后不知道下一步如何自评和继续深入。
- 修订动作：提供 L1-L5 分级、自评矩阵、项目对应能力、作品集结构、阶段验收门槛、面试失败复盘模板和实践任务。
- 结论：章节能帮助读者从“学过内容”转向“规划能力成长”。

### 主编

- 最终调整：本章统一主线为“AI Agent 工程师能力是可验证的组合能力”。
- 与全书衔接：第 23-26 章是项目训练，本章抽象能力模型，第 28 章进入 Java 工程师转型路径。
- 后续章节提醒：第 28 章应把本章能力模型映射到 Java 工程师已有能力，例如后端架构、Spring、权限、事务、队列、观测和工程协作。
