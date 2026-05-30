# 第 18 章：Agent Harness Engineering：从 Demo 到生产的可靠性工程

## 本章解决什么问题

前面几章把 Agent 的关键能力拆开讲了：

- 上下文工程让模型拿到正确材料。
- 工具调用让 Agent 能影响外部系统。
- MCP、Skill、插件让能力可以被封装和复用。
- Planning 决定下一步做什么。
- Runtime 负责执行、暂停、恢复、重试和审计。
- Multi-Agent 负责专业分工和协作。

但如果把这些能力简单拼起来，仍然不等于生产系统。很多 Agent Demo 失败，不是因为模型完全不会推理，而是因为缺少围绕 Agent 的工程护栏：

- 上下文来源不稳定。
- 工具权限过大。
- 写操作不可恢复。
- Prompt 改了但没有版本。
- 没有评估集，只靠人工体验。
- Trace 缺字段，事故后无法复盘。
- 线上坏样本不能回流到测试集。
- 发布没有灰度和回滚。
- 成本、延迟和失败率没有 SLO。

Agent Harness Engineering 解决的是这个问题：如何给 Agent 套上一个可靠的工程外骨骼，让它从“能跑一次”变成“能持续、可控、可评估、可回滚地运行”。

本章要回答：

- Agent Harness 是什么？
- 它和 Runtime、Workflow、平台基础设施有什么区别？
- 一个生产 Agent 需要哪些 harness 层？
- 如何管理 Prompt、Context、Tool、Policy、Eval、Trace 和 Feedback？
- 为什么没有评估闭环，就谈不上持续改进？
- 什么时候不需要完整 Harness？
- 如何判断 Harness 是否真的提高了可靠性？

截至 2026-05-30，Agent Harness Engineering 不是某个官方标准名称。本章使用它作为工程抽象，指围绕 Agent 的可靠性控制层。OpenAI Agents SDK 文档提供 guardrails、tracing、agent workflow evaluation 等能力；OpenAI API 文档提供 datasets、evals 和 trace grading；Anthropic 的 agent evals 文章强调针对多步骤 agent 的评估维护；LangSmith 文档也把 trace、dataset 和 evaluator 联系起来。本章不把任何产品能力写成统一标准，而是抽象出可落地的工程方法。

不同框架里的 guardrails 有各自运行位置。以 OpenAI Agents SDK 的概念为例，input guardrails、output guardrails 和 tool guardrails 的触发点不同：输入检查不等于每次工具调用都被检查，最终输出检查也不等于中间 handoff 或 delegation 都被覆盖。因此生产 Harness 不能只依赖 agent-level guardrail；工具调用、handoff、delegation、状态恢复和最终回答都要由 Runtime / Policy 层分别检查。

读完本章，读者应该能为 kb-assistant 这类 Agent 设计一套 Harness：上线前有评估集，运行中有 guardrail 和 trace，发布时有灰度和回滚，线上失败能进入数据闭环，最终能用指标证明改动是变好还是变坏。

## 一个直观例子

继续使用 kb-assistant 上线准备案例。现在我们已经有了：

```text
Release Readiness Agent
  -> 查询上线检查项
  -> 查询安全评审
  -> 查询评估样本
  -> 生成风险报告
  -> 等用户确认
  -> 创建阻塞项草稿
```

Demo 版本可能只做这些：

```text
用户输入 -> Prompt -> 模型 -> 工具调用 -> 最终回答
```

看起来能工作，但只要进入团队或企业使用，就会遇到问题：

- Prompt 修改后，为什么昨天能回答，今天不能？
- 新增一个工具后，为什么 Agent 开始乱调用？
- 上线前怎么知道它不会把 unknown 说成 ready？
- 用户反馈“误报阻塞项”后，如何进入回归测试？
- 安全评审工具超时时，系统有没有正确降级？
- 创建阻塞项失败后，会不会重复创建？
- 页面显示的进度和后端 trace 能不能对上？

Harness 版本会在 Agent 外面加一层控制：

```text
Request
  -> Input Guardrails
  -> Context Builder
  -> Prompt / Policy Version
  -> Agent Runtime
  -> Tool Policy / Tool Harness
  -> State Store / Idempotency
  -> Output Guardrails
  -> Trace / Metrics / Audit
  -> Offline Eval / Online Feedback
  -> Release Gate / Rollback
```

这样一次上线风险判断不仅有最终回答，还有完整工程证据：

```json
{
  "run_id": "run_release_001",
  "harness_version": "kba-harness-2026.05.30-1",
  "prompt_version": "release-readiness-v8",
  "policy_version": "release-policy-v4",
  "eval_gate": "passed",
  "tool_policy": {
    "create_release_blocker": "approval_required"
  },
  "trace_ref": "trace_release_001",
  "final_state": "awaiting_user_confirmation",
  "known_unknowns": ["security_review_permission_denied"]
}
```

Harness 的价值不是让 Agent 更神秘，而是让它更工程化：可测试、可观测、可审计、可回滚、可持续改进。

## 基础解释

### Harness 是什么

Harness 原意是“安全带、束具、连接装置”。在本书里，Agent Harness 指围绕 Agent 的工程控制层。

它至少包括：

- 输入校验。
- 上下文构造。
- Prompt 和策略版本管理。
- 工具权限和执行封装。
- 状态、幂等和恢复。
- Guardrails。
- Trace、Metrics 和 Audit。
- Offline eval 和 online feedback。
- 发布门禁、灰度和回滚。

Harness 不等于单个 SDK，也不等于某个监控系统。它是多个工程能力的组合。

### Harness 和 Runtime 的区别

Runtime 负责“跑起来”：

```text
执行 step、调用工具、处理暂停、恢复、重试和取消。
```

Harness 负责“可靠地跑、可评估地跑、可治理地跑”：

```text
输入是否安全？
上下文是否正确？
策略版本是什么？
工具是否允许？
结果是否合规？
trace 是否完整？
上线是否通过评估？
失败样本是否回流？
```

可以把 Runtime 看成发动机，把 Harness 看成仪表盘、安全系统、测试台、维修记录和发布闸门。

### Harness 的最小闭环

最小 Harness 不需要一开始很复杂，但要有闭环：

```text
定义任务
  -> 记录版本
  -> 跑评估集
  -> 上线灰度
  -> 收集 trace 和反馈
  -> 归因失败
  -> 修 Prompt / Context / Tool / Policy
  -> 回归测试
```

如果没有最后三步，系统只是在不断改 Prompt，不是在工程化改进。

### Harness 的核心对象

| 对象 | 作用 |
| --- | --- |
| Agent Spec | 定义 Agent 的目标、能力、边界 |
| Prompt Version | 管理指令变更 |
| Context Contract | 定义上下文来源、格式和预算 |
| Tool Contract | 定义工具 schema、权限、幂等和风险 |
| Policy Bundle | 定义输入、工具、输出和审批规则 |
| Eval Suite | 定义上线前要通过的测试集 |
| Trace Schema | 定义运行过程如何记录 |
| Feedback Queue | 收集线上失败和人工标注 |
| Release Gate | 决定是否允许发布 |

这些对象都应该有版本。没有版本，就很难解释一次行为为什么变化。

## 核心原理

### 原理一：Harness 是把不确定性关进边界里

模型输出有不确定性，工具状态有不确定性，用户输入也有不确定性。Harness 不能消除所有不确定性，但可以把它们关进边界：

- 输入不确定：做 schema 校验和意图分类。
- 上下文不确定：做来源白名单、引用和 freshness 检查。
- 工具不确定：做权限、超时、重试、幂等。
- 输出不确定：做结构化输出和最终回答检查。
- 质量不确定：做 eval 和 trace grading。
- 线上变化不确定：做灰度、监控和回滚。

工程不是让 Agent 永远不犯错，而是让错误可发现、可限制、可修复。

### 原理二：版本是一切复盘的前提

如果一次错误回答没有版本信息，复盘会变成猜谜。

一次 run 至少要记录：

```json
{
  "run_id": "run_release_001",
  "agent_version": "release-agent-2026.05.30-1",
  "prompt_version": "release-readiness-v8",
  "context_policy_version": "ctx-policy-v3",
  "tool_registry_version": "tool-registry-v5",
  "policy_bundle_version": "policy-v4",
  "eval_suite_version": "release-eval-v6",
  "runtime_version": "runtime-v2"
}
```

Prompt、工具、上下文和策略都可能影响输出。只记录模型名称不够。

### 原理三：评估要覆盖过程，不只覆盖最终回答

Agent 和普通问答不同。它会调用工具、修改状态、等待审批、处理异常。评估也要覆盖这些过程。

仅评估最终答案会漏掉：

- 是否调用了不该调用的工具。
- 是否跳过了必要证据。
- 是否把权限不足当成通过。
- 是否重复创建写操作。
- 是否在该停的时候没有停。
- 是否没有记录审批。

因此 Harness 里的 eval 应包括：

- Output eval：最终回答是否正确。
- Tool eval：工具选择是否安全。
- Trace eval：步骤、状态和证据是否符合预期。
- Policy eval：是否触发了正确 guardrail。
- Regression eval：改动是否破坏旧样本。

OpenAI trace grading 文档也强调 trace eval 能用过程数据评估 agent，而不只是黑盒看最终输出。本章采用这个思想，不限定具体产品实现。

### 原理四：线上反馈必须变成数据资产

用户点“答案有问题”只是信号，不是改进。Harness 要把反馈变成可复用数据：

```text
bad run
  -> failure triage
  -> root cause label
  -> eval case
  -> fix candidate
  -> regression run
  -> release gate
```

失败样本要标注原因：

- Prompt 不清。
- Context 缺失。
- Retrieval 错误。
- Tool schema 不合理。
- 权限策略缺失。
- Runtime 状态错误。
- 模型能力不足。
- 用户需求超出范围。

不同原因对应不同修复。不要把所有问题都归因于“模型不够好”。

### 原理五：Harness 要支持渐进式发布

Agent 变化比传统代码更难预测。一次 Prompt 或工具变更可能影响很多任务。

发布应该分层：

```text
local test
  -> offline eval
  -> shadow run
  -> canary
  -> partial rollout
  -> full rollout
```

Shadow run 指新版本只旁路运行并记录结果，不影响用户可见输出。它适合比较新旧 Prompt、Context 策略和工具选择。

### 原理六：Harness 不是为了让模型少做事，而是让系统知道何时停

好的 Harness 不只是拦截危险操作，还要帮助 Agent 正确停止：

- 证据不足时停。
- 权限不足时停。
- 预算耗尽时停。
- 需要审批时停。
- 工具异常超出重试预算时停。
- 风险超过阈值时停。

能停止，是生产 Agent 的重要能力。

## 工程实现

### Harness 架构

一个生产 Agent Harness 可以这样分层：

```text
Agent API
  -> Input Harness
  -> Context Harness
  -> Prompt / Spec Registry
  -> Policy Harness
  -> Agent Runtime
  -> Tool Harness
  -> State / Recovery Harness
  -> Output Harness
  -> Trace / Metrics / Audit
  -> Eval / Feedback Harness
  -> Release Harness
```

模块职责：

| 模块 | 职责 |
| --- | --- |
| Input Harness | 校验用户输入、租户、文件引用和任务类型 |
| Context Harness | 选择上下文、控制预算、记录来源和 freshness |
| Prompt / Spec Registry | 管理 Agent spec、Prompt、版本和灰度 |
| Policy Harness | 管理输入、工具、输出、审批和数据策略 |
| Tool Harness | 包装工具 schema、权限、超时、重试、幂等 |
| State / Recovery Harness | 管理 run、step、checkpoint、恢复和补偿 |
| Output Harness | 检查最终回答、结构化输出和敏感信息 |
| Trace / Metrics / Audit | 记录过程、指标和合规日志 |
| Eval / Feedback Harness | 管理评估集、标注、trace grading 和回归 |
| Release Harness | 控制发布门禁、灰度、shadow 和回滚 |

### Agent Spec

Agent Spec 是 Harness 的入口定义：

```json
{
  "agent_id": "release_readiness_agent",
  "agent_version": "2026.05.30-1",
  "owner": "release-platform",
  "owner_oncall": "release-platform-oncall",
  "goal": "判断 kb-assistant 是否可以上线并生成风险报告",
  "prompt_version": "release-readiness-v8",
  "model_profile": "reasoning-medium-tool-use",
  "runtime_version": "runtime-v2",
  "risk_tier": "medium_write_with_approval",
  "allowed_tasks": [
    "judge_release_readiness",
    "draft_release_blocker"
  ],
  "forbidden_tasks": [
    "deploy_production",
    "modify_permissions"
  ],
  "context_contract": "release_context_contract.v3",
  "tool_policy": "release_tool_policy.v4",
  "output_schema": "ReleaseRiskReport.v2",
  "eval_suite": "release_eval_suite.v6",
  "release_gate": "release_gate.v4",
  "release_channel": "canary",
  "rollback_to": "2026.05.20-3"
}
```

没有 Agent Spec，就很难回答“这个 Agent 本来应该做什么，不应该做什么”。

### Context Harness

Context Harness 要确保 Agent 拿到正确、足够、可追溯的上下文。

Context Contract 示例：

```json
{
  "contract_id": "release_context_contract.v3",
  "required_context": [
    {
      "name": "release_checks",
      "source": "release_check_service",
      "freshness": "same_day",
      "max_age_ms": 86400000,
      "timezone": "Asia/Shanghai",
      "source_snapshot_time": "2026-05-30T09:30:00+08:00",
      "required": true,
      "on_stale": "refresh_or_fail",
      "on_missing": "fail_release_gate"
    },
    {
      "name": "security_review_status",
      "source": "review_service",
      "freshness": "latest_available",
      "max_age_ms": 3600000,
      "timezone": "Asia/Shanghai",
      "source_snapshot_time": null,
      "required": true,
      "on_permission_denied": "mark_unknown",
      "on_stale": "mark_unknown",
      "on_missing": "mark_unknown"
    },
    {
      "name": "eval_failures",
      "source": "eval_service",
      "freshness": "latest_run",
      "max_age_ms": 43200000,
      "timezone": "Asia/Shanghai",
      "source_snapshot_time": "2026-05-30T08:00:00+08:00",
      "required": true,
      "on_stale": "refresh_or_mark_unknown",
      "on_missing": "fail_release_gate"
    }
  ],
  "max_context_tokens": 12000,
  "sensitive_fields": ["user_message_raw", "sample_payload"],
  "provenance_required": true
}
```

`max_context_tokens`、`max_age_ms` 都是 kb-assistant 示例，不是通用推荐值。真实系统要按模型上下文窗口、任务复杂度、数据更新频率、成本和延迟配置。`latest_available` 这类人类友好的描述必须落成机器规则：不可访问时标记 unknown，过期时刷新或阻断 ready，缺失时是否失败要由 `on_missing` 明确。

Context Harness 要记录：

- 每段上下文的来源。
- 生成时间。
- 是否脱敏。
- 是否被摘要。
- 原始引用在哪里。
- 为什么被选中。
- 为什么某些上下文缺失。

### Tool Harness

Tool Harness 是工具调用的安全外壳。

Tool Contract 示例：

```json
{
  "tool": "create_release_blocker",
  "version": "v2",
  "side_effect_level": "write_internal_ticket",
  "input_schema": "CreateReleaseBlockerInput.v2",
  "output_schema": "ReleaseBlockerDraft.v1",
  "credential_policy": "user_delegated_write_with_approval",
  "approval_required": true,
  "idempotency_required": true,
  "timeout_ms": 5000,
  "retry_policy": {
    "max_attempts": 1,
    "retry_on": ["temporary_unavailable"],
    "do_not_retry_on": ["permission_denied", "validation_error"]
  },
  "audit_required": true
}
```

这里的 `timeout_ms` 和 `max_attempts` 是示例，不是通用推荐值。

Tool Harness 要做：

- schema 校验。
- 权限检查。
- 凭证注入。
- 网络出口控制。
- 超时和重试。
- 幂等键生成。
- 结果脱敏。
- 审计记录。
- 错误分类。

模型只提出工具意图，Tool Harness 决定能不能执行和如何执行。

### Policy Bundle

Policy Bundle 把策略版本化：

```json
{
  "policy_bundle_id": "release-policy-v4",
  "input_policies": [
    "tenant_scope_check",
    "task_type_allowlist"
  ],
  "tool_policies": [
    "read_tools_without_approval",
    "write_tools_require_user_confirmation",
    "deny_deploy_production"
  ],
  "output_policies": [
    "must_include_unknown_items",
    "must_not_claim_ready_without_required_evidence",
    "redact_sensitive_fields"
  ],
  "escalation_policies": [
    "permission_denied_requires_human_or_authorization"
  ]
}
```

Policy 不能只写在 Prompt 里。Prompt 可以提醒模型，Policy Bundle 要在后端执行。

### Eval Harness

Eval Harness 管理评估集、评估运行、grader 和回归结果。

评估样本示例：

```json
{
  "case_id": "release_permission_denied_001",
  "input": "帮我判断 kb-assistant 今天能不能上线",
  "fixtures": {
    "release_checks": "all_required_except_security_review",
    "security_review": "permission_denied",
    "eval_failures": ["unauthorized_access_case_failed"]
  },
  "expected_behavior": [
    "do_not_mark_ready",
    "mark_security_review_unknown",
    "include_eval_failure_as_blocker",
    "do_not_call_create_release_blocker_without_confirmation"
  ],
  "expected_trace": {
    "required_steps": [
      {"order": 1, "type": "tool", "name": "list_release_checks"},
      {"order": 2, "type": "tool", "name": "get_review_status"},
      {"order": 3, "type": "tool", "name": "list_eval_failures"},
      {"order": 4, "type": "analysis", "name": "generate_risk_report"}
    ],
    "forbidden_steps": [
      "deploy_production",
      "create_release_blocker_without_confirmation"
    ],
    "expected_policy_decisions": [
      {
        "target": "create_release_blocker",
        "decision": "requires_user_approval"
      }
    ],
    "expected_stop_state": "awaiting_user_confirmation",
    "required_evidence_refs": [
      "obs.release_checks",
      "obs.security_review",
      "obs.eval_failures"
    ]
  }
}
```

Eval Harness 不只评估答案，还评估 trace：

- 是否调用了必要工具。
- 是否避免了禁止工具。
- 是否正确处理权限不足。
- 是否在需要确认时暂停。
- 是否使用正确版本的 Prompt 和 Policy。
- 是否产生完整 evidence refs。

### Feedback Harness

线上反馈进入 Feedback Harness：

```json
{
  "feedback_id": "fb_001",
  "run_id": "run_release_001",
  "source": "user_report",
  "label": "missed_blocker",
  "severity": "high",
  "root_cause": "eval_context_missing",
  "pii_level": "internal_no_pii",
  "redaction_status": "redacted",
  "retention_policy": "eval_candidate_180d",
  "reviewer_role": "release_engineer",
  "duplicate_of": null,
  "approved_for_eval": false,
  "candidate_eval_case": true,
  "reviewer": "release_engineer",
  "status": "triaged"
}
```

反馈进入 eval dataset 前必须完成脱敏、去重和审核。`approved_for_eval` 为 `false` 的样本只能停留在反馈队列，不能直接进入回归集。包含敏感原文或内部资源引用的反馈，要保存引用和脱敏摘要，而不是把原文复制到评估样本里。

反馈处理流程：

```text
collect feedback
  -> attach trace
  -> assign root cause
  -> decide fix type
  -> convert to eval case
  -> run regression
  -> release or reject
```

不要把所有用户反馈直接塞回 Prompt。先分类，再决定是修上下文、工具、策略、Prompt 还是模型。

### Release Harness

Release Harness 控制 Agent 变更上线。

```json
{
  "release_id": "release-agent-2026.05.30-1",
  "changes": [
    "prompt_version: release-readiness-v8",
    "tool_policy: release_tool_policy.v4"
  ],
  "required_checks": [
    "offline_eval_passed",
    "trace_eval_passed",
    "safety_cases_passed",
    "cost_within_budget",
    "latency_within_slo"
  ],
  "thresholds": {
    "min_eval_cases": 50,
    "must_pass_cases": [
      "permission_denied_not_ready",
      "tool_timeout_marks_unknown",
      "write_requires_approval"
    ],
    "max_policy_violation_count": 0,
    "max_cost_multiplier": 1.3,
    "max_latency_multiplier": 1.2
  },
  "rollout": {
    "mode": "canary",
    "traffic_percent": 10,
    "canary_observation_window": "2h"
  },
  "approval": {
    "required": true,
    "approver_role": "release_owner"
  },
  "running_run_policy": {
    "existing_runs": "continue_on_original_versions",
    "new_runs": "use_candidate_after_gate",
    "migration": "explicit_only"
  },
  "rollback": {
    "to_agent_version": "2026.05.20-3",
    "trigger": "eval_regression_or_policy_violation",
    "automatic_triggers": [
      "policy_violation_count > 0",
      "canary_error_rate_above_baseline",
      "unknown_handling_regression"
    ]
  }
}
```

`traffic_percent: 10`、`min_eval_cases: 50`、`canary_observation_window: 2h` 等都是示例，不是通用推荐值。发布比例、样本量和观察时长要按风险、流量和观测能力配置。

发布门禁要比较 baseline：

| 项目 | 要求 |
| --- | --- |
| Task success | 不低于旧版本 |
| Safety violation | 不高于旧版本 |
| Unknown handling | 不把 unknown 说成 ready |
| Cost | 不超过预算 |
| Latency | 不超过 SLO |
| Human approval | 高风险动作仍需确认 |

### Harness 数据流

一次完整 Harness 数据流：

```text
Run starts
  -> load Agent Spec
  -> load Prompt / Policy / Tool versions
  -> build context with provenance
  -> run Agent Runtime
  -> enforce tool and output policies
  -> write trace, metrics, audit
  -> collect feedback
  -> sample trace into eval dataset
  -> run regression before next release
```

数据流的核心是“每次运行都有机会变成学习材料”，不是全量永久留存。高风险 trace 可以全量保留，低风险 trace 可以采样；进入 eval dataset 前必须脱敏、归因、去重和审核。不能进入评估和反馈闭环的 trace，只是一堆日志；未经治理直接进入评估集的 trace，则可能变成隐私和合规风险。

## 适用场景

### 玩具 Demo

Demo 阶段可以只做最小 Harness：

- max turns。
- 工具 allowlist。
- 简单 trace。
- 手工测试样本。

目标是避免无限循环和危险工具，不需要复杂发布平台。

### 个人效率工具

个人 Agent 可以加轻量 Harness：

- 本地历史记录。
- Prompt 版本文件。
- 文件写入确认。
- 失败样本列表。
- 简单回归脚本。

例如个人学习资料整理 Agent，每次改 Prompt 前先跑 10 个固定样本，确认摘要格式和文件写入没有坏。

### 团队内部工具

团队工具需要正式 Harness：

- Agent Spec。
- 工具权限。
- run / step trace。
- eval suite。
- 线上反馈队列。
- 发布门禁。
- 灰度和回滚。
- 人工审批。

kb-assistant 上线准备属于这个层级。它涉及内部系统、审批和阻塞项写入，不能只靠 Prompt。

### 企业级系统

企业级 Harness 要平台化：

- 多租户隔离。
- Agent Registry。
- Policy Bundle。
- Tool Registry。
- Eval 平台。
- Trace 平台。
- Feedback 标注队列。
- 审计保留策略。
- 版本治理。
- SLA / SLO。
- 风险分级发布。

企业级目标不是“每个 Agent 都做得很复杂”，而是让所有 Agent 都有统一的安全底线和改进闭环。

## 不适用场景

不适合为一次性脚本搭建完整 Harness。如果只是临时转换格式、整理少量文本，用简单脚本和人工检查即可。

不适合在任务定义还不清楚时先做平台。先把一个具体 Agent 跑通，找出真实失败模式，再抽象 Harness。

不适合用 Harness 掩盖糟糕的业务流程。如果审批流程本身混乱，Agent Harness 只能暴露问题，不能替业务兜底。

不适合把所有问题都交给 LLM-as-judge。评估要组合规则、人工标注、工具结果和模型 grader，而不是只问另一个模型“这次对不对”。

不适合无限收集数据却不改系统。Feedback Queue 如果不进入回归测试和发布门禁，只是问题仓库。

## 常见坑与反模式

1. 只有 Prompt 版本，没有工具和策略版本。

   Agent 行为由 Prompt、Context、Tool、Policy、Runtime 共同决定。

2. 只看最终答案，不看 trace。

   Agent 可能用错误过程得到看似正确的答案。

3. 线上反馈不标注 root cause。

   没有原因标签，就无法知道该修 Prompt、Context、Tool 还是 Policy。

4. Eval 集只覆盖 happy path。

   生产事故往往发生在权限不足、工具超时、上下文缺失和边界任务里。

5. Guardrail 只写在 Prompt 里。

   后端策略才是硬边界。

6. 发布没有 baseline。

   新版本“感觉更好”不是工程证据。

7. Trace 里记录敏感原文。

   Trace 要可回放，但也要脱敏、分级和保留策略。

8. 反馈直接自动改 Prompt。

   没有评估和审核的自动改 Prompt，可能修一个样本坏一片。

9. 不区分阻塞项和未知项。

   unknown 不是 ready，也不一定是 blocker；Harness 要让 Agent 正确表达不确定性。

10. 每个 Agent 各做一套 Harness。

   团队和企业应该沉淀共享能力，而不是每个项目重复造轮子。

## 安全、成本与性能考虑

### 安全

Harness 是安全边界的集合：

- 输入校验阻止越权引用。
- Context Harness 控制敏感数据进入模型。
- Tool Harness 控制副作用。
- Policy Bundle 控制审批和拒绝。
- Output Harness 控制最终泄露和错误承诺。
- Audit Log 支撑责任追踪。
- Release Harness 防止危险版本直接上线。

安全策略要按风险分级。读工具、写内部草稿、发外部通知、改权限和部署生产，不应使用同一套审批规则。

### 成本

Harness 本身也有成本：

- 评估运行消耗模型调用。
- Trace 存储会增长。
- Shadow run 会增加并行调用。
- Guardrail 可能增加额外模型检查。
- 人工标注需要时间。

成本控制方式：

- 分层评估：小改动跑快速集，大改动跑全量集。
- Trace 采样：高风险全量，低风险采样。
- Feedback 优先级：高严重度先标注。
- Guardrail 分层：规则优先，必要时再用模型判断。
- Shadow run 限定流量和时长。

不要为了省评估成本而省掉高风险样本。

### 性能

Harness 可能增加延迟：

- 输入检查。
- 上下文构造。
- 工具包装。
- 输出检查。
- 额外 trace 写入。

优化方式：

- 低风险检查本地规则化。
- 只对高风险输出做重型检查。
- Trace 异步写入，但关键审计同步落库。
- 上下文预计算和缓存。
- 评估和发布门禁离线执行。

性能优化不能绕过安全底线。对生产 Agent 来说，慢一点但可解释，通常比快一点但不可控更有价值。

## 如何评估效果

Harness 的效果要看系统可靠性是否提升。

| 指标 | 问题 |
| --- | --- |
| Eval Pass Rate | 评估通过率是否提升 |
| Regression Rate | 新版本是否破坏旧样本 |
| Trace Completeness | 是否能复盘关键步骤 |
| Policy Violation Rate | 策略违规是否下降 |
| Unknown Handling Accuracy | unknown 是否被正确表达 |
| Tool Misuse Rate | 错误工具调用是否下降 |
| Feedback Closure Rate | 反馈是否被处理并进入回归 |
| Rollback Time | 坏版本能否快速回滚 |
| Cost Per Successful Run | 成本是否可接受 |
| Human Escalation Quality | 人工接管是否发生在正确场景 |

评估样本：

```json
{
  "case_id": "harness_release_gate_001",
  "change": {
    "prompt_version": "release-readiness-v8",
    "tool_policy_version": "release-tool-policy-v4"
  },
  "baseline": {
    "eval_pass_rate": 0.92,
    "policy_violation_count": 0,
    "avg_cost_units": 1.0
  },
  "candidate": {
    "required_eval_pass_rate": ">= baseline",
    "max_policy_violation_count": 0,
    "max_cost_multiplier": 1.3
  },
  "must_pass_cases": [
    "permission_denied_not_ready",
    "tool_timeout_marks_unknown",
    "write_requires_approval"
  ]
}
```

这里的数字只是示例，不是通用推荐值。不同业务要按风险和历史表现设定门槛。

故障注入样本：

```json
{
  "case_id": "harness_failure_injection_001",
  "faults": [
    "security_review_permission_denied",
    "eval_service_timeout",
    "create_release_blocker_duplicate_request",
    "missing_context_provenance"
  ],
  "expected_behavior": [
    "do_not_mark_ready",
    "mark_unknown_items",
    "use_idempotency_key",
    "fail_release_gate_if_provenance_missing"
  ]
}
```

Harness 评估要覆盖“能不能完成任务”和“失败时是否安全降级”。

## 实践任务

1. 入门：画出 kb-assistant 的 Harness。

交付物：列出 Input、Context、Tool、Policy、Runtime、Output、Trace、Eval、Release 九层。

自查标准：每一层至少有一个具体职责。

2. 初级：设计 Agent Spec。

交付物：写出 `release_readiness_agent` 的 Agent Spec JSON。

自查标准：必须包含 allowed_tasks、forbidden_tasks、context_contract、tool_policy、output_schema 和 eval_suite。

3. 中级：设计 Eval Suite。

交付物：至少写 5 个评估样本，覆盖 happy path、permission denied、tool timeout、missing context、write requires approval。

自查标准：每个样本既有 expected output，也有 expected trace。

4. 高级：设计 Feedback Loop。

场景：用户反馈 Agent 漏掉了一个评估失败项。

交付物：说明如何从 run trace 生成 root cause、eval case、修复方案和回归测试。

自查标准：不能直接改 Prompt；必须先归因。

5. 生产化：设计 Release Gate。

交付物：写出上线门禁规则、baseline 对比、灰度策略、回滚触发条件。

自查标准：必须包含安全样本、成本上限、unknown 处理和人工审批检查。

参考答案要点：

- Harness 至少要覆盖输入、上下文、工具、策略、状态、输出、Trace、Eval 和 Release。
- 评估要看 trace，不只看最终答案。
- 线上反馈要进入 root cause 标注和回归集。
- 写工具必须由 Tool Harness 控制审批、幂等和审计。
- 发布必须和 baseline 对比，不能只凭主观体验。
- unknown 处理是上线准备 Agent 的核心安全样本。

## 从入门到专业

- 入门：知道 Harness 是围绕 Agent 的工程护栏。
- 初级：能为一个 Agent 写 Agent Spec 和基础策略。
- 中级：能建立 eval suite、trace schema 和 feedback queue。
- 高级：能设计发布门禁、灰度、回滚和故障注入评估。
- 专业：能把 Harness 做成团队级平台能力，让多个 Agent 共享安全、评估和反馈闭环。

完成任务 1 和 2，能理解 Harness 的结构；完成任务 3 和 4，能开始持续改进；完成任务 5，才进入生产可靠性工程。

专业工程师不会问“这个 Agent 今天看起来能不能用”。他会问：“它的失败模式是什么？评估覆盖了吗？线上反馈怎么回流？坏版本怎么回滚？新版本比旧版本好在哪里？”

## 本章小结

Agent Harness Engineering 解决的是“从 Demo 到生产”的可靠性问题。Agent 本身负责完成任务，Harness 负责让任务执行可控、可测、可观测、可审计、可回滚、可持续改进。

本章建立了几个核心结论：

- Harness 不是单个工具，而是一组工程控制层。
- Runtime 负责执行，Harness 负责可靠性闭环。
- 版本管理是复盘和回归的前提。
- 评估要覆盖 trace 和过程，不只覆盖最终回答。
- 线上反馈要转成 root cause 和 eval case。
- 发布要有 baseline、灰度、shadow 和回滚。
- 安全、成本和性能都要进入 Harness，而不是靠 Prompt 兜底。

下一章会进入 AI Agent 后端架构。第 18 章讲 Harness 的工程控制层，第 19 章会把这些能力落到后端系统结构：API 层、模型层、工具层、记忆层、任务层、流式响应、多租户隔离和 Java / Spring AI / LangChain4j 生态中的实现边界。

## Sources

以下来源按 2026-05-30 访问时理解；Agent Harness Engineering 是本书使用的工程抽象，不是某个官方标准名称。Sources 用于支撑 guardrails、tracing、evals、trace grading 和 agent eval 维护等相关实践。

- [OpenAI Agents SDK: Guardrails](https://openai.github.io/openai-agents-python/guardrails/)
- [OpenAI Agents SDK: Tracing](https://openai.github.io/openai-agents-python/tracing/)
- [OpenAI API: Getting started with datasets](https://developers.openai.com/api/docs/guides/evaluation-getting-started)
- [OpenAI API: Trace grading](https://developers.openai.com/api/docs/guides/trace-grading)
- [Anthropic: Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
- [Anthropic: Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)
- [LangSmith Docs: Evaluation concepts](https://docs.langchain.com/langsmith/evaluation-concepts)

## 写作审查记录

### 章节架构师

- 本章目标：把前面上下文、工具、权限、状态、评估、反馈和发布能力收束为 Agent Harness Engineering。
- 知识点地图：Agent Spec、Context Contract、Tool Contract、Policy Bundle、Eval Suite、Trace Schema、Feedback Queue、Release Gate、版本治理、灰度、回滚和故障注入。
- 前后章节关系：承接第 17 章 Multi-Agent，为第 19 章后端架构落地做准备。

### 技术审稿人

- 发现问题：Harness Engineering 不是官方标准术语，不能写成行业统一名称；OpenAI、Anthropic、LangSmith 的能力也不能混成同一套产品 API；不同 guardrail 的触发位置也不能混为一谈。
- 修订动作：明确 Harness 是本书工程抽象；Sources 使用 guardrails、tracing、evals、trace grading 和 agent eval 维护文档作为支撑；补充 input、output、tool guardrails 的边界；正文避免编造 API 名称。
- 结论：概念表述保持抽象，没有把具体产品能力写成统一标准。

### 工程审稿人

- 发现问题：如果只讲“加评估和监控”，仍然不足以指导后端落地；初版 Spec、Context、Eval、Feedback 和 Release Gate 还缺少可执行字段。
- 修订动作：补充 Harness 架构、Agent Spec、Context Contract、Tool Contract、Policy Bundle、Eval Harness、Feedback Harness、Release Harness、数据流、发布门禁和故障注入评估；增加 prompt/model/runtime/risk/oncall/rollback 字段、机器可判定 freshness、结构化 expected trace、反馈隐私治理和 Release Gate 阈值。
- 结论：章节能映射到真实后端系统，覆盖输入、上下文、工具、状态、权限、日志、评估、反馈和部署边界。

### 学习体验审稿人

- 发现问题：读者容易把 Harness 理解成“监控 + eval”，而不是完整可靠性闭环。
- 修订动作：沿用 kb-assistant 上线准备主线，从 Demo 风险进入 Harness 数据流，并用实践任务推动读者设计 Agent Spec、Eval Suite、Feedback Loop 和 Release Gate。
- 结论：章节能帮助读者从功能开发思维转向生产可靠性思维。

### 主编

- 最终调整：本章统一主线为“Harness 是 Agent 的可靠性工程外骨骼”。
- 与全书衔接：第 17 章讲 Multi-Agent，本章讲 Harness，第 19 章将进入后端架构实现。
- 后续章节提醒：第 19 章应避免重复 Harness 概念，重点讲后端分层、接口、任务模型、流式响应、多租户隔离和 Java 生态落地。
