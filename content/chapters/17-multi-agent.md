# 第 17 章：Multi-Agent 多智能体

## 本章解决什么问题

第 14 章定义了 Agent，第 15 章讲 Planning，第 16 章讲 Runtime。现在进入一个很容易被过度使用的话题：Multi-Agent。

Multi-Agent 听起来很诱人：一个 Agent 负责规划，一个负责检索，一个负责写报告，一个负责审查，一个负责执行工具。它像一个小团队，看起来比单个 Agent 更聪明。

但真实工程里，多 Agent 往往先带来这些问题：

- 上下文在多个 Agent 之间传来传去，越来越乱。
- 每个 Agent 都认为自己在负责，但没有人真正负责最终结果。
- 成本翻倍，质量没有提升。
- Handoff 后谁有权限调用工具说不清。
- 子 Agent 输出不稳定，Supervisor 不知道该不该相信。
- 多个 Agent 互相讨论，却没有外部证据。
- Trace 变成一团嵌套对话，很难评估。
- 错误从一个 Agent 传播到另一个 Agent，最后很难定位。

本章要回答：

- Multi-Agent 是什么？
- 它和单 Agent + 多工具有什么区别？
- Supervisor / Worker、Handoff、Agent-as-Tool、Evaluator-Optimizer 分别适合什么？
- 多 Agent 之间应该传什么，不应该传什么？
- 谁拥有最终回答权、工具权限和责任边界？
- 什么时候不应该使用 Multi-Agent？
- 如何评估一个 Multi-Agent 系统是否真的比单 Agent 更好？

截至 2026-05-30，多 Agent 没有统一行业标准。OpenAI Agents SDK 文档区分了 manager 调用 specialist agent 作为工具、handoff 给 specialist 接管对话等模式；Anthropic 的文章讨论了 workflow、orchestrator-workers、evaluator-optimizer 等架构；LangChain/LangGraph 文档也提供 supervisor、subagents、handoffs 和 subgraphs 等实现路径。本章采用工程抽象，不把任何框架 API 写成唯一正确做法。

读完本章，读者应该能判断：一个任务到底需要 Multi-Agent，还是一个单 Agent 加清晰工具、规划和运行时就够了；如果确实需要 Multi-Agent，应该怎样设计角色、上下文、权限、通信、评估和回滚。

## 一个直观例子

继续使用 kb-assistant 上线准备案例。用户说：

```text
帮我判断 kb-assistant 今天能不能上线，如果不能，帮我生成阻塞项草稿。
```

单 Agent 可以这样做：

```text
一个 Release Readiness Agent
  -> 查询上线检查项
  -> 查询安全评审
  -> 查询评估样本
  -> 生成风险报告
  -> 等用户确认
  -> 创建阻塞项草稿
```

如果任务规模变大，比如要同时分析安全、评估、文档、灰度计划和用户影响，可以拆成多个角色：

```text
Supervisor Agent
  -> Security Reviewer Agent
  -> Evaluation Analyst Agent
  -> Release Notes Agent
  -> Risk Report Agent
```

但拆成多个 Agent 后，问题变成：

- Security Reviewer 能不能调用安全评审系统？
- Evaluation Analyst 能不能看到用户数据？
- Release Notes Agent 能不能写入发布说明？
- Risk Report Agent 能不能直接创建阻塞项？
- Supervisor 如何判断子 Agent 输出是真的，还是只是看起来合理？
- 如果 Security Reviewer 说“无法确认”，最终报告如何表达不确定性？

一个更健康的 Multi-Agent 设计会把责任说清：

```json
{
  "run_id": "run_release_001",
  "supervisor": "release_supervisor",
  "workers": [
    {
      "agent_id": "security_reviewer",
      "task": "检查安全评审状态",
      "allowed_tools": ["get_review_status"],
      "output_schema": "SecurityReviewFinding",
      "can_write": false
    },
    {
      "agent_id": "eval_analyst",
      "task": "检查评估样本与失败项",
      "allowed_tools": ["list_eval_runs", "get_eval_failures"],
      "output_schema": "EvalFinding",
      "can_write": false
    },
    {
      "agent_id": "risk_reporter",
      "task": "合并证据并生成风险报告",
      "allowed_tools": [],
      "output_schema": "ReleaseRiskReport",
      "can_write": false
    }
  ],
  "write_actions": [
    {
      "tool": "create_release_blocker",
      "owner": "release_supervisor",
      "requires_user_approval": true
    }
  ]
}
```

这里有一个关键点：多 Agent 不是让所有 Agent 都自由行动，而是把复杂任务拆给专业角色，同时把最终责任和写权限收在清晰边界里。

## 基础解释

### Multi-Agent 是什么

Multi-Agent 是由多个具备不同职责、上下文、工具或决策权限的 Agent 组成的系统。它们通过调用、handoff、消息、共享状态或图结构协作完成任务。

最小 Multi-Agent 包含：

- 至少两个不同 Agent。
- 每个 Agent 有不同职责或上下文。
- 存在协作机制。
- 有统一的任务目标或上层编排。
- 有责任归属和停止条件。

如果只是一个 Agent 调用了多个普通工具，不叫 Multi-Agent。如果只是一个 Prompt 里写“你扮演三个角色”，也不一定是工程意义上的 Multi-Agent。工程上的 Multi-Agent 需要可追踪、可隔离、可评估的执行单元。

### Agent、Tool、Sub-Agent 的区别

| 概念 | 主要职责 | 是否自主决策 | 是否有独立上下文 |
| --- | --- | --- | --- |
| Tool | 执行确定能力 | 否 | 通常没有 |
| Agent | 根据目标选择动作 | 是 | 有 |
| Sub-Agent | 被上层 Agent 或 Runtime 调用的专门 Agent | 有限或完整 | 有 |

一个“文档搜索工具”只是 Tool。一个“评估分析 Agent”可以自己选择先查哪个评估 run、如何归纳失败样本、如何输出结构化结论，它就是 Sub-Agent。

### Supervisor / Worker

Supervisor / Worker 是企业工程中很常见的一类 Multi-Agent 模式：

```text
Supervisor
  -> 分解任务
  -> 分配给 Worker
  -> 收集结果
  -> 检查输出
  -> 生成最终答案或决定下一步
```

Worker 负责某个专业子任务：

```text
Security Worker: 查安全评审
Eval Worker: 查评估结果
Docs Worker: 查发布文档
Risk Worker: 生成风险摘要
```

Supervisor 不应该只是“聊天主持人”。它要拥有明确职责：

- 选择 Worker。
- 约束 Worker 输入。
- 校验 Worker 输出。
- 合并证据。
- 决定是否继续、停止或交给人工。
- 对最终回答负责。

### Agent-as-Tool 和 Handoff

多 Agent 协作常见两种方式。

Agent-as-Tool：

```text
Supervisor 调用 Security Agent
Security Agent 返回结构化结果
Supervisor 继续掌控对话
```

适合：

- 子任务边界清楚。
- 需要 Supervisor 统一合并。
- 子 Agent 不应该直接回复用户。
- 需要集中执行最终策略检查。

Handoff：

```text
Triage Agent 判断应该交给 Security Agent
Security Agent 接管后续对话
```

适合：

- 用户应该直接和专家 Agent 交互。
- 后续上下文主要属于该专家。
- 路由本身是任务的一部分。
- 专家 Agent 的指令和工具与原 Agent 差异很大。

OpenAI Agents SDK 文档也区分了这两类思想：manager agent 可以把 specialist agents 作为工具调用，也可以通过 handoff 让 specialist 接管后续对话。在 SDK 实现中，handoff 也是以工具调用形式触发，但语义上是接收 Agent 成为 active agent。本章不绑定具体 SDK，只保留这个工程区分。

模式选择可以先看这个表：

| 问题 | Agent-as-Tool | Handoff | Supervisor / Worker |
| --- | --- | --- | --- |
| 是否转移用户对话控制权 | 否 | 是 | 通常否 |
| 是否需要统一合并多个结果 | 适合 | 不适合 | 适合 |
| 子 Agent 是否直接面向用户 | 通常不直接 | 可以直接 | Worker 通常不直接 |
| 是否适合企业审批 | 适合集中审批 | 需要额外控制 | 适合 |
| 典型场景 | 专家 Agent 完成一个子任务 | 转给客服、法务、安全专家继续沟通 | 多个专业 Worker 并行取证 |

### Evaluator-Optimizer

Evaluator-Optimizer 是另一个常见模式，但它不一定是 Multi-Agent，也可以只是代码编排的 workflow。

```text
Generator LLM / Agent role -> 生成结果
Evaluator LLM / Agent role -> 评价结果
Optimizer code / Agent role -> 根据反馈修订
```

它适合：

- 输出质量需要多轮打磨。
- 有明确评价标准。
- 失败反馈能转化为可执行修复。

它不适合：

- 没有外部证据的事实判断。
- 高风险动作审批。
- 只靠两个模型互相说服对方。

在 kb-assistant 里，Evaluator 可以检查风险报告是否包含证据、未知项、建议下一步；但它不能凭空确认“安全评审已通过”。

## 核心原理

### 原理一：先证明单 Agent 不够，再引入多 Agent

Multi-Agent 不应该是默认选项。先问：

- 一个单 Agent 加清晰工具是否能解决？
- 一个 Workflow 是否更稳定？
- 一个 Agent-as-Tool 是否够用？
- 是上下文太长，还是 Prompt 太乱？
- 是专业知识不同，还是只是想让系统看起来更高级？

适合拆成多 Agent 的典型原因：

- 子任务有明显专业边界。
- 子任务需要不同工具权限。
- 子任务可以并行。
- 子任务上下文互相污染会降低质量。
- 需要独立评估或审查。
- 不同团队拥有不同 Agent。

如果只是为了“让模型互相讨论”，通常不值得。

### 原理二：角色必须对应工程边界

坏角色：

```text
聪明规划 Agent
严谨分析 Agent
优秀总结 Agent
```

这些角色听起来有差异，但工程边界不清。好的角色应该能映射到工具、输入、输出和权限：

```json
{
  "agent_id": "eval_analyst",
  "purpose": "分析 kb-assistant 评估结果",
  "input_schema": "EvalAnalysisTask",
  "allowed_tools": ["list_eval_runs", "get_eval_failures"],
  "output_schema": "EvalFinding",
  "forbidden_tools": ["create_release_blocker", "deploy_production"]
}
```

角色不是文案，是权限、上下文、输出和责任的集合。

### 原理三：Supervisor 要拥有最终责任

如果每个 Worker 都能直接给用户最终结论，最终结果会很难控制。多数企业场景里，Supervisor 应该负责：

- 定义子任务。
- 限制子 Agent 可见上下文。
- 检查子 Agent 输出 schema。
- 标注冲突和不确定性。
- 决定是否需要更多证据。
- 生成最终回答。
- 触发审批或写操作。

Worker 的输出是 evidence，不是最终事实。Supervisor 不能盲信 Worker，也不能把 Worker 的自然语言原样拼接成最终答案。

### 原理四：通信要结构化，不要只靠聊天记录

多 Agent 如果只互相发自然语言，会很快失控。

更好的 Worker 输出：

```json
{
  "agent_id": "security_reviewer",
  "status": "unverified",
  "evidence": [
    {
      "type": "tool_result",
      "ref": "obs.security_review",
      "summary": "权限不足，无法读取安全评审状态"
    }
  ],
  "risk": "cannot_claim_ready",
  "recommended_next_step": "ask_user_to_grant_access_or_assign_reviewer",
  "confidence": "low"
}
```

这种输出便于 Supervisor 合并、评估、回放和审计。

### 原理五：上下文隔离比共享全文更重要

多 Agent 不是把完整上下文复制给每个 Agent。每个 Agent 只应该看到完成任务所需的最小上下文。

例如：

- Security Agent 需要项目引用、评审类型、权限上下文。
- Eval Agent 需要评估 run 引用和失败样本摘要。
- Risk Reporter 需要结构化 finding，不需要原始敏感样本。

上下文传递要遵守：

- 最小必要。
- 引用优先，原文按需。
- 敏感数据脱敏。
- 工具结果摘要和原始结果分离。
- Handoff 历史可过滤。

OpenAI Handoffs 文档中也提供 input filter 这类机制，用于控制接收 Agent 看到的输入。需要注意，具体 SDK 可能默认让接收 Agent 看到前序对话历史，input filter、history mapper 或类似机制是用来改变这个默认行为的。具体框架不同，但工程目标一致：不要把不该传的上下文传给下一个 Agent。

### 原理六：多 Agent 放大 Runtime 问题

单 Agent 已经需要状态、重试、幂等、审批和 Trace。多 Agent 会放大这些问题：

- 每个子 Agent 都可能失败。
- 子 Agent 之间可能并发。
- Handoff 后权限边界可能变化。
- Trace 嵌套更深。
- 成本更难预测。
- 最终责任更容易模糊。

因此第 16 章的 Runtime 是 Multi-Agent 的前置基础。没有稳定 Runtime，不要急着上多 Agent。

## 工程实现

### Multi-Agent 架构

一个后端 Multi-Agent 系统可以这样拆：

```text
Agent API
  -> Multi-Agent Orchestrator
  -> Supervisor Agent Runtime
  -> Worker Agent Registry
  -> Context Router
  -> Policy Engine
  -> Agent Invocation Service
  -> Shared State / Evidence Store
  -> Trace Writer
```

模块职责：

| 模块 | 职责 |
| --- | --- |
| Multi-Agent Orchestrator | 管理多 Agent run、任务分配和状态推进 |
| Supervisor Agent Runtime | 执行 supervisor 的 planning、delegation 和 finalization |
| Worker Agent Registry | 注册 Worker 的能力、工具、权限、输出 schema |
| Context Router | 决定给每个 Agent 哪些上下文 |
| Policy Engine | 检查 agent 调用、handoff、工具权限和输出策略 |
| Agent Invocation Service | 调用子 Agent，并处理超时、重试、取消 |
| Shared State / Evidence Store | 保存 finding、evidence、observation 和冲突 |
| Trace Writer | 记录跨 Agent 调用链 |

一次完整执行顺序可以是：

```text
用户请求
  -> Supervisor 判断需要安全、评估、文档三个 Worker
  -> Supervisor 生成 delegation task
  -> Policy Engine 检查每个 Worker 的工具和数据权限
  -> Worker 调用只读工具取证
  -> Worker 输出结构化 finding
  -> Supervisor 合并 finding，处理冲突和 unknown
  -> 如果需要写阻塞项，进入用户审批
  -> Runtime 使用幂等键执行写工具
  -> Final Answer Policy 检查最终回答
  -> Trace / Audit / Metrics 落盘
```

后面的 JSON 对象都服务于这条链路：Registry 说明“谁能做什么”，Delegation Task 说明“这次让谁做什么”，Worker Output 说明“做完得到什么证据”，Trace 说明“整个过程如何回放”。

### Agent Registry

每个 Agent 都应该注册为结构化能力，而不是只写一个名称：

```json
{
  "agent_id": "security_reviewer",
  "display_name": "Security Reviewer Agent",
  "owner": "release-platform",
  "purpose": "检查上线前安全评审状态",
  "input_schema": "SecurityReviewTask",
  "output_schema": "SecurityReviewFinding",
  "allowed_tools": ["get_review_status"],
  "forbidden_tools": ["create_release_blocker", "deploy_production"],
  "data_classification": ["internal"],
  "credential_policy": "user_delegated_readonly",
  "side_effect_level": "read_only",
  "write_policy": "forbidden",
  "approval_policy": "not_applicable",
  "network_scope": ["review-service.internal"],
  "max_turns": 4,
  "timeout_ms": 10000,
  "handoff_enabled": false,
  "can_return_to_user": false
}
```

这里的 `timeout_ms: 10000` 只是 kb-assistant 示例，不是通用推荐值。真实系统要根据工具 SLA、用户体验、队列延迟和成本预算配置。

字段重点：

- `owner`：谁维护这个 Agent。
- `purpose`：它解决什么问题。
- `input_schema` / `output_schema`：输入输出边界。
- `allowed_tools` / `forbidden_tools`：工具权限。
- `data_classification`：可处理的数据级别。
- `credential_policy`：使用哪类凭证。
- `side_effect_level` / `write_policy`：是否允许产生副作用。
- `approval_policy`：是否需要人工审批。
- `network_scope`：允许访问的内部网络或服务边界。
- `handoff_enabled`：是否允许接管对话。
- `can_return_to_user`：是否能直接回复用户。

没有 Registry，多 Agent 系统很容易变成“Supervisor 想叫谁就叫谁”。

### 权限矩阵

Worker 不能因为 Supervisor 有权限，就自动继承全部权限。真实系统要把用户身份、Agent 身份、工具权限和租户边界拆开：

| 维度 | 示例 | 规则 |
| --- | --- | --- |
| 用户身份 | `user_ref: u_pseudo_123` | 决定用户本来能访问哪些项目和数据 |
| Agent 身份 | `agent_id: eval_analyst` | 决定这个 Agent 的能力范围 |
| 工具权限 | `list_eval_runs: read` | 每个工具单独授权 |
| 数据分类 | `internal`, `restricted` | Worker 只能处理注册范围内的数据 |
| 租户边界 | `tenant_ref: tenant_a` | 禁止跨租户读取和写入 |
| 审批要求 | `create_release_blocker: approval_required` | 高风险动作需要人确认 |
| 凭证策略 | `user_delegated_readonly` | 凭证由 Runtime 注入，模型不可见 |

Handoff 后权限应默认收窄，而不是扩大。接收 Agent 的权限应取“用户权限、Agent Registry、handoff 允许范围、审批状态”的交集。

### Delegation Task

Supervisor 分配任务时，要生成结构化 delegation task：

```json
{
  "delegation_id": "delegation_security_001",
  "parent_run_id": "run_release_001",
  "target_agent": "security_reviewer",
  "objective": "检查 kb-assistant 安全评审状态",
  "input": {
    "project_ref": "project:kba",
    "review_type": "security"
  },
  "context_refs": ["obs.release_checks"],
  "expected_output_schema": "SecurityReviewFinding",
  "deadline_ms": 10000,
  "allowed_stop_conditions": [
    "finding_returned",
    "permission_denied",
    "timeout"
  ]
}
```

这里的 `deadline_ms: 10000` 是 kb-assistant 示例，不是通用推荐值。

这样 Worker 接到的是任务，不是整段聊天记录。

### Run / Delegation 状态机

Multi-Agent 不只有 root run，还要管理每个 delegation 的状态：

| 当前状态 | 允许转向 | 说明 |
| --- | --- | --- |
| pending | running, cancelled | 等待 Worker 执行 |
| running | succeeded, failed_retryable, failed_terminal, timeout, cancelled, needs_human | Worker 正在执行 |
| failed_retryable | running, failed_terminal | 可按预算重试 |
| timeout | running, partial, failed_terminal | 可重试、标记 unknown 或终止 |
| needs_human | running, cancelled, timeout | 等人工补充或审批 |
| partial | succeeded, failed_terminal | 部分 Worker 完成，Supervisor 可带 unknown 合并 |
| succeeded | 无 | 终态 |
| failed_terminal | 无 | 终态 |
| cancelled | 无 | 终态 |

异常处理规则：

- `permission_denied`：不自动重试，输出 unknown 或请求授权。
- `schema_validation_failed`：可要求 Worker 重试一次，仍失败则标记 Worker 输出无效。
- `tool_timeout`：按预算重试；超过预算后标记 unknown。
- `policy_denied`：终止该 delegation，并进入审计。
- `partial_success`：保存已完成 finding，不把缺失项当作通过。

重试要去重：同一个 `delegation_id + agent_id + task_version` 只能产生一个有效 finding 版本；写操作必须使用独立幂等键；审批请求要有 `approval_id`，不能因为重试重复发起多个有效审批。

### Worker Output

Worker 输出必须结构化：

```json
{
  "delegation_id": "delegation_security_001",
  "agent_id": "security_reviewer",
  "agent_version": "2026.05.30-1",
  "schema_version": "SecurityReviewFinding.v2",
  "generated_at": "2026-05-30T10:20:00+08:00",
  "status": "unverified",
  "findings": [
    {
      "claim": "无法确认安全评审是否通过",
      "evidence_ref": "obs.security_review",
      "evidence_timestamp": "2026-05-30T10:19:58+08:00",
      "observation_time": "2026-05-30T10:19:58+08:00",
      "reason": "permission_denied"
    }
  ],
  "risks": ["cannot_claim_ready"],
  "recommended_actions": [
    "ask_user_to_grant_review_access",
    "request_security_reviewer_confirmation"
  ],
  "confidence": "low"
}
```

Supervisor 只消费结构化 finding，并把原始输出、工具结果和 trace 作为证据引用保存。

### Supervisor 合并结果

Supervisor 合并结果时，不是简单拼接：

```text
Security Agent 说：无法确认安全评审。
Eval Agent 说：越权访问样本失败。
Docs Agent 说：发布说明未更新。
```

它应该生成统一判断：

```json
{
  "ready": false,
  "blocking_items": [
    {
      "source_agent": "eval_analyst",
      "reason": "越权访问评估样本未通过",
      "evidence_ref": "obs.eval_failures"
    }
  ],
  "unknown_items": [
    {
      "source_agent": "security_reviewer",
      "reason": "安全评审状态无法读取",
      "next_step": "需要授权或评审人确认"
    }
  ],
  "recommended_action": "不要标记为 ready；先补齐评估和安全确认"
}
```

最终回答由 Supervisor 生成，并经过第 16 章讲过的 final answer policy。

### Handoff 设计

Handoff 要特别小心，因为它意味着控制权转移。

Handoff 记录至少包括：

```json
{
  "handoff_id": "handoff_security_001",
  "root_run_id": "run_release_001",
  "parent_span_id": "span_supervisor",
  "previous_active_agent": "release_triage",
  "from_agent": "release_triage",
  "to_agent": "security_reviewer",
  "return_to_agent": "release_supervisor",
  "reason": "用户需要继续排查安全评审状态",
  "input_filter": "security_review_minimal_context",
  "handoff_input_ref": "handoff_input.security_review_001",
  "allowed_tools_after_handoff": ["get_review_status"],
  "current_depth": 1,
  "max_depth": 2,
  "policy_decision": {
    "allowed": true,
    "reason": "security_review_specialist_allowed"
  },
  "can_return_to_user": true,
  "expires_at": "2026-05-30T11:30:00+08:00"
}
```

Handoff 需要回答：

- 谁把控制权交给谁？
- 为什么交？
- 传递哪些上下文？
- 接收 Agent 能使用哪些工具？
- 谁负责最终回答？
- 是否能再 handoff 给别人？
- 如何回到原 Supervisor？

不要让 Handoff 变成无限转接。系统应该限制最大 handoff 深度和允许的目标 Agent。

Handoff 也不能绕过 guardrail。每次转接前要检查 handoff policy；接收 Agent 的每次工具调用仍要过 Runtime / Policy；最终输出也要过接收 Agent 或上层 Runtime 的 final answer policy。不要假设原 Agent 的输入输出 guardrail 会自动覆盖所有后续 Agent。

### Agent-as-Tool 设计

Agent-as-Tool 在需要集中最终回答权、结构化合并和统一 guardrail 的场景中更合适，团队和企业系统尤其常见：

```json
{
  "tool_name": "run_eval_analyst_agent",
  "target_agent": "eval_analyst",
  "input_schema": "EvalAnalysisTask",
  "output_schema": "EvalFinding",
  "timeout_ms": 15000,
  "max_turns": 5,
  "returns_to": "release_supervisor"
}
```

它的好处是：

- Supervisor 仍然拥有最终回答权。
- 子 Agent 输出可以结构化校验。
- 权限更容易集中管理。
- Trace 更容易挂在 parent run 下。

代价是子 Agent 不适合直接和用户长时间互动。

### Shared State 与 Evidence Store

多 Agent 需要共享状态，但不能所有 Agent 随意读写同一块内存。

建议拆成：

| 存储 | 用途 |
| --- | --- |
| Run State | 记录父 run 和子 run 状态 |
| Delegation State | 记录任务分配、超时、重试 |
| Evidence Store | 保存 finding、observation、证据引用 |
| Conversation State | 保存用户可见对话 |
| Audit Log | 保存权限、handoff、审批和写操作 |

Worker 不应该直接改 Supervisor 的结论。它只能提交 finding。Supervisor 负责把 finding 合并到最终报告。

### 并行与聚合

多 Agent 的一个价值是并行：

```text
Security Agent  -> 查安全评审
Eval Agent      -> 查评估失败样本
Docs Agent      -> 查发布说明
```

聚合策略要明确：

```json
{
  "parallel_group": "release_readiness_workers",
  "agents": ["security_reviewer", "eval_analyst", "docs_checker"],
  "join_policy": "wait_all_or_mark_unknown",
  "timeout_ms": 20000,
  "on_partial_result": "include_unknown_items",
  "on_conflict": "escalate_to_supervisor"
}
```

这里的 `timeout_ms: 20000` 同样只是 kb-assistant 示例，不是通用推荐值。

如果 Security Agent 超时，Supervisor 不能默认安全通过，只能标记为 unknown。

### 冲突处理

多 Agent 常见冲突：

- 一个 Agent 说 ready，另一个说 not ready。
- 一个 Agent 有证据，另一个只是推测。
- 两个 Agent 引用了不同时间的结果。
- 子 Agent 输出 schema 合法，但结论不一致。

冲突处理规则：

```json
{
  "conflict_policy": {
    "prefer_evidence_over_opinion": true,
    "prefer_newer_observation": true,
    "require_supervisor_review": true,
    "do_not_auto_resolve_high_risk_conflict": true
  }
}
```

高风险结论不要让模型投票决定。应基于证据、时间、权限和业务规则处理。

### Trace

Multi-Agent trace 要能还原调用树：

```json
{
  "trace_id": "trace_release_001",
  "root_run_id": "run_release_001",
  "spans": [
    {
      "span_id": "span_supervisor",
      "agent_id": "release_supervisor",
      "type": "supervisor_run"
    },
    {
      "span_id": "span_security",
      "parent_span_id": "span_supervisor",
      "agent_id": "security_reviewer",
      "type": "delegation",
      "status": "unverified"
    },
    {
      "span_id": "span_eval",
      "parent_span_id": "span_supervisor",
      "agent_id": "eval_analyst",
      "type": "delegation",
      "status": "blocking_found"
    }
  ]
}
```

Trace 要回答：

- Supervisor 为什么调用这个 Worker？
- 给了 Worker 什么上下文？
- Worker 调用了哪些工具？
- Worker 输出了什么 finding？
- Supervisor 如何合并？
- 最终结论来自哪些 evidence？

### Metrics / Logs / Alerts

Trace 能回放单次执行，指标和告警用来发现系统性问题。

关键指标：

| 指标 | 说明 |
| --- | --- |
| delegation_failure_rate | Worker 任务失败率 |
| handoff_depth | Handoff 链路深度 |
| schema_validation_failure_rate | Worker 输出 schema 校验失败比例 |
| unknown_item_rate | 最终报告中 unknown 项比例 |
| worker_latency_ms | 各 Worker 平均耗时 |
| cost_over_budget_count | 成本超预算次数 |
| human_takeover_rate | 人工接管比例 |
| conflict_rate | Worker 结论冲突比例 |

结构化日志至少应包含 `root_run_id`、`delegation_id`、`agent_id`、`agent_version`、`schema_version`、`policy_decision`、`status`、`error_code` 和 `evidence_ref`。日志和指标中不要写入原始敏感数据、完整工具结果或模型内部推理。

告警示例：

- `handoff_depth` 突然升高，可能出现无限转接。
- `unknown_item_rate` 升高，可能是权限或工具故障。
- `schema_validation_failure_rate` 升高，可能是 Agent 版本和 schema 不兼容。
- 单个 Worker latency 升高，可能拖慢整个 Supervisor。

### 部署与版本治理

Multi-Agent 部署要管理 Agent 版本和 schema 版本，否则 Supervisor 和 Worker 很容易不兼容。

```json
{
  "agent_id": "eval_analyst",
  "agent_version": "2026.05.30-1",
  "input_schema_version": "EvalAnalysisTask.v2",
  "output_schema_version": "EvalFinding.v2",
  "rollout": {
    "strategy": "percentage",
    "traffic_percent": 10
  },
  "compatible_supervisors": ["release_supervisor@>=2026.05.20"],
  "rollback_to": "2026.05.20-3"
}
```

治理规则：

- Root run 记录 Supervisor 和 Worker 的版本。
- 长任务恢复时优先使用创建 run 时的版本，或走显式迁移。
- Worker 灰度要有 per-agent 指标，不要只看整体成功率。
- 输出 schema 升级要保持兼容，或让 Supervisor 同时支持新旧版本。
- 回滚时要说明正在运行的 run 是继续、迁移还是终止。
- 高风险 Worker 可以先 shadow run，只记录结果，不影响最终回答。

## 适用场景

### 玩具 Demo

Demo 可以用两个 Agent：

```text
Eval Agent -> 返回模拟评估结果
Report Agent -> 根据模拟结果写上线风险摘要
```

目标是理解角色拆分，不代表生产可靠性。Demo 里可以先不用真实工具，但也要限制最大轮数和最大 handoff 次数。

### 个人效率工具

个人场景适合轻量 Multi-Agent：

- Eval Agent 整理本地评估记录。
- Docs Agent 检查本地发布说明。
- Critic Agent 检查风险报告遗漏。

但个人工具也要避免无限互评。更现实的做法是把 Critic 输出作为修改建议，而不是自动循环到满意为止。

### 团队内部工具

团队场景更适合 Supervisor / Worker：

- 发布准备：安全、评估、文档、灰度计划分别检查。
- 工单分诊：产品、后端、数据、客服分别给建议。
- API 影响分析：代码、文档、监控、调用方分别分析。

团队场景要重视权限和审计：哪个 Agent 看了哪些数据、调用了哪些工具、谁批准了写操作，都要能追踪。

### 企业级系统

企业级 Multi-Agent 常见于：

- 多部门审批和合规审查。
- 大规模代码变更分析。
- 安全事件调查。
- 客服复杂问题分诊。
- 数据分析和报告生成。

企业级要求：

- Agent Registry。
- 上下文隔离。
- 子 Agent 权限隔离。
- 跨 Agent trace。
- 统一 final answer policy。
- 成本预算。
- 人工接管。
- 灰度和回滚。
- 离线评估集。

同一个 kb-assistant 上线准备任务，可以这样逐级升级：

| 层级 | 实现方式 | 关键边界 |
| --- | --- | --- |
| Demo | 两个模拟 Agent 生成风险摘要 | 只理解流程，不接生产工具 |
| 个人工具 | 本地 eval/docs Agent 读取个人资料 | 文件写入前确认 |
| 团队工具 | Supervisor 调用安全、评估、文档 Worker | 权限、审批、trace、结构化 finding |
| 企业系统 | Agent Registry、版本治理、灰度、审计、指标 | 租户隔离、凭证隔离、回滚和合规 |

工程要求也会逐级提高：

| 能力 | 个人 | 团队 | 企业 |
| --- | --- | --- | --- |
| 权限 | 本地确认 | 用户和工具权限 | 租户、Agent、工具、审批交集 |
| 状态存储 | 本地文件或轻量 DB | Run / delegation 落库 | 版本化状态、队列、恢复 |
| 审计 | 简单历史 | 工具调用和审批记录 | 合规审计和保留策略 |
| 评估 | 少量样本 | 团队回归集 | baseline、灰度、线上反馈 |
| 部署 | 单机 | 服务化 | 多 worker、版本治理、回滚 |
| 人工接管 | 用户确认 | 审批人确认 | 分级审批和责任追踪 |

## 不适用场景

不适合为了“看起来高级”而使用 Multi-Agent。一个单 Agent 能清楚完成的任务，不要拆成多个 Agent。

不适合没有明确角色边界的任务。如果只是“一个负责思考，一个负责总结，一个负责检查”，但它们看同样上下文、用同样工具、输出同样内容，通常只会增加成本。

不适合高风险写操作完全交给多个 Agent 自主讨论。付款、发版、删库、改权限、发送外部通知，都应该由 Workflow、审批和 Runtime 控制。

不适合没有评估集的场景。多 Agent 增加复杂度，如果没有评估，很难证明它比单 Agent 好。

不适合用模型投票替代事实核查。多个模型都同意一个错误结论，仍然是错误。

## 常见坑与反模式

1. Agent 太多。

   每多一个 Agent，就多一份上下文、成本、失败点和评估负担。

2. 角色只是名字不同。

   没有不同工具、输入、输出和权限的角色，通常没有工程价值。

3. Supervisor 不负责。

   Worker 都输出了观点，但没人负责最终判断。

4. 子 Agent 直接写生产系统。

   写操作应收敛到明确 owner，并经过审批、幂等和审计。

5. Handoff 无限转接。

   多次 handoff 会让用户体验和责任边界变差。

6. 共享完整上下文。

   所有 Agent 都看全部历史，既浪费 token，也增加泄露和污染风险。

7. 自然语言拼接结果。

   Worker 输出应该结构化，Supervisor 不能只拼接文本。

8. 用投票解决事实冲突。

   事实冲突要看证据，不是看哪个 Agent 数量多。

9. 不评估单 Agent baseline。

   没有 baseline，就不知道 Multi-Agent 是否真的提升。

10. Trace 只记录最终回答。

   多 Agent 必须记录 delegation、handoff、worker output、policy decision 和 evidence。

## 安全、成本与性能考虑

### 安全

Multi-Agent 的安全重点是权限隔离和责任归属：

- 每个 Agent 只拿必要上下文。
- 每个 Agent 只暴露必要工具。
- Handoff 要有输入过滤。
- Worker 输出要经过 schema 校验。
- 写操作集中到明确 owner。
- 高风险动作必须审批。
- 跨 Agent trace 要脱敏。
- 子 Agent 不能提升自己的权限。
- 最终回答仍由 final answer policy 检查。

尤其要防止“工具结果注入”。一个 Worker 读到的外部内容，不能诱导 Supervisor 调用高风险工具。

### 成本

Multi-Agent 会增加模型调用、上下文传输和工具调用。

成本控制方式：

- 先跑单 Agent baseline。
- 限制 Worker 数量。
- 限制每个 Worker 的 max_turns。
- 并行默认优先用于互不依赖的只读任务；涉及写操作时必须有幂等、锁、审批或事务边界。
- Worker 输出用结构化摘要，不传全文。
- 缓存稳定 finding。
- 对 evaluator-optimizer 设置最大轮数。

不要用多个 Agent 互相讨论来弥补缺少工具和证据。

### 性能

Multi-Agent 可以通过并行提升速度，也可能因为编排变慢。

性能策略：

- 可并行子任务并行执行。
- 有依赖的任务串行执行。
- 慢 Worker 设置 deadline。
- 部分结果超时标记 unknown。
- 子 Agent 大结果用引用。
- Supervisor 合并时只读取必要 evidence。

高风险场景中，准确性和可解释性通常比速度更重要。

## 如何评估效果

Multi-Agent 评估必须和单 Agent baseline 对比。

| 指标 | 问题 |
| --- | --- |
| Task Success | 是否完成任务 |
| Baseline Lift | 是否优于单 Agent |
| Delegation Accuracy | Supervisor 是否分配给正确 Worker |
| Context Minimality | 子 Agent 是否只看到必要上下文 |
| Worker Output Validity | Worker 输出是否符合 schema |
| Evidence Grounding | 结论是否有证据 |
| Conflict Handling | 冲突是否被正确处理 |
| Handoff Accuracy | Handoff 是否转给正确 Agent |
| Cost Efficiency | 成本是否可接受 |
| Trace Completeness | 是否能回放跨 Agent 决策 |

判定例子：

- Delegation Accuracy 失败：用户只问发布说明是否更新，Supervisor 却调用了 `billing_agent` 或安全审查 Agent。
- Context Minimality 失败：Eval Agent 为了查看评估失败样本，却收到了完整用户聊天记录和安全评审原文。
- Evidence Grounding 失败：Risk Reporter 给出“可以上线”，但没有引用任何 Worker finding 或 tool observation。

评估样本：

```json
{
  "case_id": "multi_agent_release_001",
  "goal": "判断 kb-assistant 是否可以上线",
  "single_agent_baseline_result": {
    "status": "completed_with_unknowns",
    "missed_items": ["docs_checker"],
    "cost_units": 1.0,
    "latency_units": 1.0
  },
  "expected_lift": {
    "must_reduce_missed_items": true,
    "must_improve_evidence_coverage": true,
    "must_not_reduce_safety": true
  },
  "max_cost_multiplier": 2.5,
  "max_latency_multiplier": 1.8,
  "expected_delegations": [
    "security_reviewer",
    "eval_analyst",
    "docs_checker"
  ],
  "forbidden_delegations": [
    "billing_agent",
    "general_chat_agent"
  ],
  "expected_controls": [
    "workers cannot call create_release_blocker",
    "supervisor marks security status unknown if permission denied",
    "final report cites evidence refs",
    "write action requires user approval"
  ]
}
```

冲突样本：

```json
{
  "case_id": "multi_agent_conflict_001",
  "worker_outputs": [
    {
      "agent": "security_reviewer",
      "status": "unverified",
      "evidence": "permission_denied"
    },
    {
      "agent": "release_reporter",
      "status": "ready",
      "evidence": null
    }
  ],
  "expected_behavior": [
    "do not mark ready",
    "prefer evidence over unsupported claim",
    "list security review as unknown",
    "ask for authorization or human confirmation"
  ]
}
```

评估时要记录：

- 单 Agent baseline 结果。
- Multi-Agent 结果。
- 每个 Worker 的输入和输出。
- Supervisor 的合并逻辑。
- 成本和耗时。
- 错误类型。

如果 Multi-Agent 没有明显提升成功率、可解释性、并行速度或权限隔离，就不值得引入。

## 实践任务

1. 入门：判断是否需要 Multi-Agent。

场景：kb-assistant 上线准备。

交付物：列出单 Agent 方案和 Multi-Agent 方案，各自优缺点。

自查标准：必须说明为什么单 Agent 不够，不能只写“多角色更专业”。

2. 初级：设计 Agent Registry。

交付物：为 `security_reviewer`、`eval_analyst`、`risk_reporter` 写 registry JSON。

自查标准：每个 Agent 都有 input_schema、output_schema、allowed_tools、forbidden_tools 和 can_return_to_user。

3. 中级：设计 Delegation Task 和 Worker Output。

交付物：写出 Supervisor 分配给 Eval Agent 的任务 JSON，以及 Eval Agent 的结构化输出。

自查标准：Worker 输出必须包含 evidence_ref、risk、recommended_action 和 confidence。

4. 高级：设计冲突处理策略。

场景：一个 Agent 说 ready，另一个 Agent 说 unknown。

输入材料：

```json
{
  "worker_outputs": [
    {
      "agent": "security_reviewer",
      "status": "unverified",
      "reason": "permission_denied",
      "evidence_ref": "obs.security_review"
    },
    {
      "agent": "eval_analyst",
      "status": "blocking_found",
      "risk": "unauthorized_access_eval_failed",
      "evidence_ref": "obs.eval_failures"
    },
    {
      "agent": "docs_checker",
      "status": "timeout",
      "evidence_ref": null
    }
  ]
}
```

交付物：写出 conflict_policy 和最终回答规则。

自查标准：不能用模型投票；必须基于证据和权限处理。

5. 生产化：设计 Multi-Agent Trace。

交付物：画出 root run、supervisor span、worker span、tool span、final answer span 的关系。

自查标准：能回答“谁调用了谁、为什么调用、给了什么上下文、输出了什么证据、最终结论怎么来的”。

参考答案要点：

- 如果只是上线准备检查，单 Agent + 清晰工具可能足够；当安全、评估、文档和灰度计划由不同系统和权限负责时，Multi-Agent 才更有价值。
- Worker 默认不应拥有写工具。
- Supervisor 应拥有最终回答权和写操作审批入口。
- Handoff 要限制目标、深度、上下文和工具。
- Worker 输出要结构化，不能只返回自然语言。
- 冲突要基于 evidence 和 policy 处理，不靠投票。

## 从入门到专业

- 入门：知道 Multi-Agent 是多个 Agent 协作，不是一个 Prompt 扮演多个角色。
- 初级：能区分 Agent-as-Tool、Handoff、Supervisor / Worker。
- 中级：能设计 Agent Registry、Delegation Task 和 Worker Output。
- 高级：能处理上下文隔离、权限、冲突、trace 和成本。
- 专业：能判断什么时候不用 Multi-Agent，并用评估证明它真的带来收益。

完成任务 1 和 2，能做角色设计；完成任务 3 和 4，能进入工程编排；完成任务 5，开始具备生产级 Multi-Agent 治理能力。

专业工程师不会问“能不能多加几个 Agent”。他会问：“每个 Agent 的职责是什么？它能看到什么？能调用什么？输出如何验证？最终责任是谁？比单 Agent 好在哪里？”

## 本章小结

Multi-Agent 解决的是复杂任务中的专业分工问题，但它不是智能的免费午餐。多 Agent 会带来更多上下文、更多状态、更多权限边界、更多成本和更多失败点。

本章建立了几个核心结论：

- 先证明单 Agent 不够，再引入 Multi-Agent。
- 角色必须映射到工具、输入、输出、权限和责任。
- Supervisor / Worker 适合集中最终责任。
- Agent-as-Tool 适合边界清晰的子任务。
- Handoff 适合专家接管对话，但要限制上下文和深度。
- Worker 输出应结构化，并作为 evidence 交给 Supervisor。
- 冲突要基于证据和策略处理，不靠投票。
- Multi-Agent 必须和单 Agent baseline 对比评估。

下一章会进入 Agent Harness Engineering。第 17 章讲多 Agent 如何协作；第 18 章会把前面所有能力收束到“从 Demo 到生产”的可靠性工程：上下文、工具、权限、状态、评估、反馈和治理如何形成完整 Harness。

## Sources

以下来源按 2026-05-30 访问时理解；多 Agent 编排在不同框架中命名和实现不同，本章采用工程抽象，不将任何框架 API 写成统一标准。

- [OpenAI Agents SDK: Agent orchestration](https://openai.github.io/openai-agents-python/multi_agent/)
- [OpenAI Agents SDK: Handoffs](https://openai.github.io/openai-agents-python/handoffs/)
- [Anthropic: Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)
- [LangChain Docs: Build a personal assistant with subagents](https://docs.langchain.com/oss/python/langchain/multi-agent/subagents-personal-assistant)
- [LangChain Docs: Subagents](https://docs.langchain.com/oss/python/langchain/multi-agent/subagents)
- [LangChain Docs: Handoffs](https://docs.langchain.com/oss/python/langchain/multi-agent/handoffs)
- [LangGraph Docs: Subgraphs](https://docs.langchain.com/oss/python/langgraph/use-subgraphs)

## 写作审查记录

### 章节架构师

- 本章目标：解释 Multi-Agent 的适用条件、常见模式、工程边界和反模式。
- 知识点地图：Supervisor / Worker、Agent-as-Tool、Handoff、Evaluator-Optimizer、Agent Registry、Delegation Task、Worker Output、Context Routing、Shared State、Conflict Policy、Trace、评估和成本。
- 前后章节关系：承接第 16 章 Runtime，为第 18 章 Harness Engineering 的生产治理铺垫。

### 技术审稿人

- 发现问题：多 Agent 容易被写成某个框架的固定范式，或把 handoff、agent-as-tool、supervisor 混为一谈；Evaluator-Optimizer 也容易被误写成必须由多个自治 Agent 组成；handoff guardrail 的适用边界需要明确。
- 修订动作：正文采用工程抽象；区分 Agent-as-Tool、Handoff 和 Supervisor / Worker；补充 OpenAI handoff 默认上下文和 input filter 边界；明确每次 handoff、工具调用和最终输出都要过 Runtime / Policy；将 Evaluator-Optimizer 表述为 workflow 或 Agent role 均可；参考 OpenAI Agents SDK 的 orchestration / handoffs、Anthropic 架构文章、LangChain/LangGraph 的 supervisor、subagents、handoffs 和 subgraphs 文档；明确截至 2026-05-30 的时间背景。
- 结论：没有把具体框架 API 写成统一标准，也没有把多 Agent 说成默认最佳实践。

### 工程审稿人

- 发现问题：多 Agent 如果只讲角色协作，会缺少真实后端系统所需的权限、上下文、状态、冲突、部署版本治理、监控告警和审计边界；Worker 输出与 Handoff 记录也需要支撑版本、时间、恢复和责任追踪。
- 修订动作：补充完整执行顺序、Agent Registry、写权限字段、权限矩阵、Delegation Task、Run / Delegation 状态机、Worker Output 版本和时间字段、Supervisor 合并、Handoff 记录恢复字段、Agent-as-Tool 设计、Shared State / Evidence Store、并行聚合、冲突处理、Multi-Agent Trace、Metrics / Logs / Alerts 和部署与版本治理。
- 结论：章节能映射到真实后端系统，覆盖输入、处理、输出、状态、异常、权限、日志、评估和部署边界。

### 学习体验审稿人

- 发现问题：读者容易把 Multi-Agent 理解为“多个模型互相聊天”，而不是可治理的职责拆分；初版工程对象较多，完整流程、模式选择和 baseline 评估还可以更直观。
- 修订动作：沿用 kb-assistant 上线准备主线，用安全、评估、文档和风险报告角色展示什么时候需要拆分；补充模式选择表、完整执行顺序、分层升级表、评估判定例子、baseline 对比字段和带输入材料的冲突处理练习。
- 结论：章节由直观例子进入工程结构，能帮助读者理解 Multi-Agent 的价值和代价。

### 主编

- 最终调整：本章统一主线为“Multi-Agent 是专业分工，不是复杂度装饰”。
- 与全书衔接：第 16 章讲 Runtime，本章讲 Multi-Agent，第 18 章将讲 Harness Engineering。
- 后续章节提醒：第 18 章应把上下文、工具、权限、状态、评估和反馈闭环整合成生产可靠性工程，不重复 Multi-Agent 模式本身。
