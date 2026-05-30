# 第 20 章：可观测性与评估

## 本章解决什么问题

第 19 章讲了 Agent 后端架构：API、Run、Runtime、Model Gateway、Tool Gateway、Context、State 和 Event。第 20 章要回答一个更尖锐的问题：

> Agent 出错时，你怎么知道它错在哪里？修完后，你怎么证明它真的变好了？

传统后端的可观测性通常关注：

- 请求是否成功。
- 延迟是否变高。
- 错误率是否升高。
- 数据库和队列是否异常。

Agent 系统还多了很多新的失败模式：

- 检索到了错误上下文。
- 工具选错了。
- 工具结果正确，但模型忽略了。
- 权限不足被说成“已通过”。
- Prompt 改动导致旧场景回归。
- 模型调用成本异常升高。
- 多 Agent 中某个 Worker 输出了不可靠 finding。
- 最终回答看起来对，但 trace 过程不合规。

因此 Agent 可观测性不能只看日志，也不能只看最终答案。它要同时看：

- Trace：过程发生了什么。
- Logs：系统记录了什么。
- Metrics：指标是否异常。
- Token / Cost：成本花在哪里。
- Prompt / Policy Version：行为由哪个版本触发。
- Eval Dataset：是否通过已知场景。
- Online Feedback：线上失败是否进入回归。

本章要回答：

- Agent trace 应该记录哪些 span？
- 日志、trace、metrics、audit log 有什么区别？
- Token 和成本如何归集？
- Prompt 版本如何参与评估和回滚？
- Eval 数据集如何设计？
- Trace grading 和最终答案评估有什么区别？
- 如何把线上反馈转成可复用评估样本？
- 如何避免可观测性本身泄露敏感信息？

截至 2026-05-30，OpenAI Agents SDK 文档提供 tracing 能力，记录 agent run 中的模型生成、工具调用、handoff、guardrail 和自定义事件等；OpenAI API 文档提供 datasets、evals、trace grading 等能力；OpenTelemetry 提供 GenAI semantic conventions，用于标准化生成式 AI 操作的 spans 和 metrics，但 GenAI semantic conventions 页面仍标注为 Development，落地时应固定 semconv 版本或增加兼容层；LangSmith 文档把 dataset、experiment、run、trace 和 evaluator 联系起来。本章采用工程抽象，不把任何产品或规范写成唯一标准。

读完本章，读者应该能为 kb-assistant 设计一套可观测和评估体系：每次 run 能回放，异常能归因，成本能归集，Prompt 改动能回归，线上反馈能沉淀成 eval case。

## 一个直观例子

用户问：

```text
kb-assistant 今天能不能上线？
```

Agent 最终回答：

```text
可以上线。
```

后来团队发现：安全评审系统当时返回的是 `permission_denied`，评估样本里还有一个越权访问失败项。这个回答是错误的。

如果只有最终答案，排查会很困难：

```text
模型为什么说可以上线？
它有没有查安全评审？
有没有查评估失败项？
工具是否返回了错误？
Prompt 是哪个版本？
最终回答有没有经过策略检查？
这次错误是不是新版本引入的？
```

一个可观测性更好的系统会留下 trace：

```json
{
  "trace_id": "trace_release_001",
  "run_id": "run_release_001",
  "spans": [
    {
      "span_id": "span_context",
      "type": "context_build",
      "status": "succeeded"
    },
    {
      "span_id": "span_tool_security",
      "type": "tool_call",
      "tool": "get_review_status",
      "status": "permission_denied"
    },
    {
      "span_id": "span_tool_eval",
      "type": "tool_call",
      "tool": "list_eval_failures",
      "status": "succeeded",
      "observation_ref": "obs.eval_failures"
    },
    {
      "span_id": "span_final",
      "type": "final_answer",
      "policy_decision": "failed_should_have_marked_unknown"
    }
  ]
}
```

评估系统可以把这个 trace 转成失败样本：

```json
{
  "case_id": "release_permission_denied_regression_001",
  "expected_behavior": [
    "do_not_mark_ready",
    "mark_security_review_unknown",
    "include_eval_failure_as_blocker"
  ]
}
```

这就是可观测性和评估的价值：不是只知道“错了”，而是知道“哪一步错了、为什么错、修完后怎么防止再错”。

## 基础解释

### Trace、Log、Metric、Audit 的区别

这几个词经常混用，但职责不同：

| 类型 | 解决的问题 | 示例 |
| --- | --- | --- |
| Trace | 一次 run 的调用链和过程 | 模型调用、工具调用、handoff、final answer |
| Log | 某个时间点的结构化事件 | tool timeout、policy denied |
| Metric | 可聚合的数值指标 | success rate、latency、token cost |
| Audit Log | 合规和责任追踪 | 谁批准了写工具、谁访问了敏感数据 |

Trace 用来复盘过程，Metric 用来发现趋势，Log 用来定位事件，Audit 用来追责和合规。

不要把所有东西都塞进日志。Agent 系统应该有 trace schema、metric schema 和 audit schema。

### Agent Trace 是什么

Agent Trace 是一次 Agent Run 的结构化过程记录。

它至少要包含：

- run span。
- model call span。
- context build span。
- tool call span。
- policy decision span。
- approval span。
- handoff / delegation span。
- final answer span。

Trace 要能回答：

- 为什么调用这个工具？
- 工具输入输出引用是什么？
- 哪个策略允许或拒绝了动作？
- 最终回答依据哪些证据？
- 失败后是否重试？
- 版本是什么？

OpenAI Agents SDK tracing 文档提到 SDK 可以记录 LLM generations、tool calls、handoffs、guardrails 和 custom events 等，这正好说明 Agent trace 不应只记录模型输入输出。

### Eval 是什么

Eval 是把系统放到一组已知场景里，检查它是否符合预期。

Agent eval 不只看最终文本，还要看：

- 是否调用了正确工具。
- 是否避免了禁止工具。
- 是否正确处理 unknown。
- 是否遵守审批。
- 是否产生证据引用。
- 是否在预算内完成。
- 是否在正确状态停止。

OpenAI trace grading 文档强调 trace eval 可以利用 agent 的过程数据来评估，而不是只做黑盒最终输出评估。这个思想对生产 Agent 很重要。

### Prompt 版本和评估的关系

Prompt 改动是代码改动。它可能修复一个问题，也可能破坏旧场景。

每次 run 应记录：

```json
{
  "prompt_version": "release-readiness-v8",
  "policy_bundle_version": "release-policy-v4",
  "tool_registry_version": "tool-registry-v7",
  "model_profile_version": "reasoning-medium-tool-use.v3",
  "eval_suite_version": "release-eval-v6"
}
```

如果没有版本，评估结果就无法比较，线上问题也无法回滚。

## 核心原理

### 原理一：Agent 的可观测性要覆盖决策过程

普通 API 调用可能只需要知道请求和响应。Agent 不行，因为最终回答可能掩盖错误过程。

例子：

```text
最终回答：不能上线。
```

这个结果可能是正确的，也可能是碰巧正确。你还要知道：

- 是否真的查了评估失败项？
- 是否查了安全评审？
- 是否把 permission_denied 当作 unknown？
- 是否错误调用了写工具？
- 是否跳过了审批？

只有 trace 能回答这些问题。

### 原理二：可观测性要默认脱敏

Trace 很有价值，也很危险。它可能包含：

- 用户原文。
- 内部文档片段。
- 工具输入。
- 工具结果。
- 敏感资源引用。
- 模型输出。

因此默认策略应该是：

- 保存引用，不保存原文。
- 保存摘要，不保存敏感字段。
- 高风险 trace 分级访问。
- eval dataset 进入前脱敏和审核。
- 不记录完整模型内部思考链。
- 工具凭证和 secret 永不进入 trace。

OpenTelemetry GenAI semantic conventions 也提示具体系统应谨慎处理 prompt、completion 和工具内容，很多 instrumentation 默认不应捕获敏感内容。本章采用同样的安全原则。

同时要注意具体 SDK 的默认行为。OpenAI Agents SDK tracing 文档显示，generation / function spans 可能捕获输入输出，且 `trace_include_sensitive_data` 默认可能开启。生产环境必须显式配置敏感数据采集策略，不能假设 SDK 默认就是 `refs_only` 或脱敏模式。

### 原理三：指标要能指导行动

坏指标：

```text
总调用次数增加了。
```

这个指标不告诉你该做什么。更有用的是：

- permission_denied_unknown_rate。
- tool_timeout_rate_by_tool。
- final_answer_policy_denied_count。
- eval_regression_rate_by_prompt_version。
- cost_per_successful_run。
- human_approval_aging。
- tenant_level_error_rate。

指标要能指向行动：修工具、调策略、扩容 worker、回滚 Prompt、补 eval case。

### 原理四：Eval 要同时覆盖 happy path 和 failure path

只评估 happy path 会得到虚假的安全感。

kb-assistant 至少要覆盖：

- 全部检查通过。
- 安全评审权限不足。
- 评估服务超时。
- 越权访问样本失败。
- 发布说明缺失。
- 用户要求直接创建阻塞项。
- 未审批写工具。
- 多租户越权引用。
- SSE 断线重连。
- Worker 崩溃恢复。

生产事故通常发生在 failure path。

### 原理五：线上反馈要进入评估闭环

线上反馈不是“下次有空看看”。它应该进入闭环：

```text
feedback
  -> attach trace
  -> root cause label
  -> eval case candidate
  -> redaction / review
  -> regression suite
  -> fix and release gate
```

没有进入 eval 的反馈，很容易反复发生。

### 原理六：评估不能只靠 LLM-as-judge

LLM-as-judge 有用，但不能替代所有评估。

更稳的组合：

- 规则检查：是否调用禁止工具。
- Schema 检查：输出字段是否完整。
- Trace 检查：步骤是否符合预期。
- 人工标注：复杂质量判断。
- LLM grader：语义质量和摘要质量。
- 业务断言：状态、权限、成本、审批。

高风险场景要优先使用可确定的规则和人工审核。

## 工程实现

### Trace Schema

一个 trace 可以这样建模：

```json
{
  "trace_id": "trace_release_001",
  "run_id": "run_release_001",
  "service_name": "agent-runtime",
  "environment": "prod",
  "operation_name": "release_readiness_run",
  "tenant_ref": "tenant_a",
  "agent_id": "release_readiness_agent",
  "agent_version": "2026.05.30-1",
  "prompt_version": "release-readiness-v8",
  "model_profile_version": "reasoning-medium-tool-use.v3",
  "started_at": "2026-05-30T10:00:00+08:00",
  "ended_at": "2026-05-30T10:00:30+08:00",
  "status": "awaiting_user_confirmation",
  "sensitive_data_policy": "refs_only",
  "spans": []
}
```

Trace 顶层记录版本和租户，span 记录过程。

### Span Schema

```json
{
  "span_id": "span_tool_security",
  "parent_span_id": "span_run",
  "trace_id": "trace_release_001",
  "service_name": "tool-gateway",
  "environment": "prod",
  "operation_name": "tool_call.get_review_status",
  "span_kind": "client",
  "type": "tool_call",
  "name": "get_review_status",
  "status": "permission_denied",
  "status_code": "error",
  "started_at": "2026-05-30T10:00:10+08:00",
  "ended_at": "2026-05-30T10:00:12+08:00",
  "input_ref": "tool_input.s2",
  "output_ref": "obs.security_review",
  "policy_decision": {
    "allowed": true,
    "reason": "read_only_tool"
  },
  "error_code": "permission_denied",
  "attributes": {
    "gen_ai.operation.name": "tool_call",
    "tool.name": "get_review_status",
    "agent.id": "release_readiness_agent"
  },
  "resource": {
    "service.name": "tool-gateway",
    "deployment.environment": "prod"
  },
  "cost": {
    "tool_cost_units": 0.1
  }
}
```

Span 类型可以包括：

| 类型 | 说明 |
| --- | --- |
| run | 整次 Agent Run |
| context_build | 构造上下文 |
| model_call | 模型调用 |
| tool_call | 工具调用 |
| policy_check | 策略检查 |
| approval | 人工审批 |
| handoff | Agent 转接 |
| delegation | 子 Agent 调用 |
| final_answer | 最终回答 |
| eval_grading | 评估打分 |

字段要尽量使用稳定枚举，不要每个团队随意写自然语言状态。

### Audit Schema

Audit Log 面向责任追踪和合规，字段应比普通日志更稳定：

```json
{
  "audit_id": "audit_001",
  "timestamp": "2026-05-30T10:00:20+08:00",
  "tenant_ref": "tenant_a",
  "actor_ref": "user_pseudo_123",
  "actor_type": "user",
  "action": "approve_tool_call",
  "resource_ref": "approval_001",
  "run_id": "run_release_001",
  "trace_id": "trace_release_001",
  "policy_decision": {
    "decision": "allowed",
    "policy_version": "release-policy-v4"
  },
  "approval_id": "approval_001",
  "immutable_hash": "sha256:...",
  "retention_policy": "audit_1y"
}
```

Audit Log 不应该依赖可以被业务服务随意修改的普通日志表。高风险动作、审批、权限拒绝、跨租户访问尝试和写工具调用都应进入审计。

### Metrics

关键指标：

| 指标 | 维度 |
| --- | --- |
| run_success_rate | agent_id, tenant_ref, agent_version |
| run_failure_rate | error_code, agent_version |
| tool_timeout_rate | tool, tenant_ref |
| policy_denied_count | policy_name, agent_id |
| token_usage | model_profile, agent_id, tenant_ref |
| cost_per_successful_run | agent_id, model_profile |
| eval_pass_rate | eval_suite_version, prompt_version |
| regression_count | prompt_version, policy_version |
| human_approval_aging | approval_type, tenant_ref |
| unknown_handling_error_rate | agent_id, eval_case_type |

不要只按全局聚合。生产排查通常需要按 tenant、agent、version、tool、model_profile 切分。

### Token 和成本归集

成本归集要从模型调用开始：

```json
{
  "run_id": "run_release_001",
  "span_id": "span_model_001",
  "tenant_ref": "tenant_a",
  "agent_id": "release_readiness_agent",
  "model_profile_version": "reasoning-medium-tool-use.v3",
  "prompt_tokens": 8200,
  "completion_tokens": 900,
  "reasoning_tokens": 300,
  "cached_tokens": 1200,
  "provider_usage_source": "model_response_usage",
  "pricing_version": "pricing_2026_05",
  "currency": "USD",
  "estimated_cost": 0.012,
  "billed_cost": null,
  "cache_discount_applied": true,
  "cost_units": 1.0
}
```

字段是否存在取决于模型 provider 和接入方式，不能假设所有 provider 都返回同样 token 分类。内部指标要允许缺失，并记录来源。

成本记录要保存价格版本和 usage 来源。否则模型价格、缓存折扣或 provider usage 字段变化后，历史成本会变得不可比。`estimated_cost` 是按当时价格表计算的估算值，`billed_cost` 是账单回填值，二者可以不同。

成本要能按这些维度聚合：

- tenant。
- agent。
- run。
- model profile。
- tool。
- prompt version。
- eval run。

### Prompt 版本管理

Prompt 版本不要只存在代码仓库里。运行时也要记录：

```json
{
  "prompt_version": "release-readiness-v8",
  "prompt_hash": "sha256:...",
  "prompt_template_ref": "prompt.release_readiness.v8",
  "variables_schema": "ReleasePromptVariables.v3",
  "created_by": "release-platform",
  "approved_by": "release-owner",
  "release_gate": "passed"
}
```

Prompt 变更流程：

```text
edit prompt
  -> generate prompt hash
  -> run eval suite
  -> compare baseline
  -> canary / shadow
  -> release
  -> monitor regression
```

Prompt 是生产配置，不是随手改的文案。

### Eval Dataset 设计

Eval case 应该结构化：

```json
{
  "case_id": "release_permission_denied_001",
  "dataset": "release_readiness_eval",
  "dataset_version": "v6",
  "input": {
    "task_type": "judge_release_readiness",
    "project_ref": "project:kba"
  },
  "fixtures": {
    "release_checks": "all_required_except_security_review",
    "security_review": "permission_denied",
    "eval_failures": ["unauthorized_access_case_failed"]
  },
  "expected_output": {
    "ready": false,
    "unknown_items": ["security_review_status"],
    "blocking_items": ["unauthorized_access_eval_failed"]
  },
  "expected_trace": {
    "required_tools": ["list_release_checks", "get_review_status", "list_eval_failures"],
    "forbidden_tools": ["deploy_production", "create_release_blocker_without_confirmation"],
    "expected_stop_state": "awaiting_user_confirmation"
  },
  "risk_tier": "medium",
  "source": "online_feedback",
  "redaction_status": "redacted",
  "approved_for_regression": true
}
```

Eval dataset 要有版本，case 要有来源、风险等级和脱敏状态。

### Grader 设计

不同评估项使用不同 grader：

| Grader | 适合评估 |
| --- | --- |
| Rule Grader | 禁止工具、状态、字段、成本 |
| Schema Grader | 输出结构完整性 |
| Trace Grader | 工具顺序、policy decision、stop state |
| Human Grader | 高风险业务判断 |
| LLM Grader | 摘要质量、语义覆盖、可读性 |

Grader 输出也要结构化：

```json
{
  "grader": "trace_policy_grader",
  "case_id": "release_permission_denied_001",
  "result": "failed",
  "failures": [
    {
      "type": "missing_unknown_item",
      "expected": "security_review_status",
      "actual": "ready"
    }
  ]
}
```

### Trace Grading

Trace grading 检查过程：

```json
{
  "trace_grading_rule": {
    "required_spans": [
      "tool_call:list_release_checks",
      "tool_call:get_review_status",
      "tool_call:list_eval_failures"
    ],
    "forbidden_spans": [
      "tool_call:deploy_production"
    ],
    "required_policy_decisions": [
      {
        "target": "create_release_blocker",
        "decision": "requires_approval"
      }
    ],
    "expected_final_state": "awaiting_user_confirmation"
  }
}
```

Trace grading 的优势是可以定位过程错误。例如最终回答错了，不一定是模型语言生成错，也可能是工具没查、上下文缺失、策略没生效。

### Feedback 到 Eval 的闭环

线上反馈不能直接进入 eval。流程：

```text
feedback received
  -> attach run trace
  -> redact sensitive content
  -> label root cause
  -> deduplicate
  -> reviewer approval
  -> convert to eval case
  -> run regression
```

Feedback 记录：

```json
{
  "feedback_id": "fb_release_001",
  "run_id": "run_release_001",
  "trace_id": "trace_release_001",
  "label": "incorrect_ready_decision",
  "root_cause": "ignored_permission_denied_observation",
  "evidence_refs": [
    "obs.security_review",
    "span_final"
  ],
  "eval_case_id": "release_permission_denied_regression_001",
  "fix_id": "fix_prompt_policy_023",
  "release_id": "release-agent-2026.05.30-2",
  "closure_status": "regression_added",
  "duplicate_of": null,
  "pii_level": "internal_no_pii",
  "redaction_status": "redacted",
  "approved_for_eval": true,
  "reviewer_role": "release_engineer"
}
```

### Dashboard

Dashboard 不应该只显示调用次数。建议至少有：

- Run 成功率。
- Eval pass rate。
- Regression count。
- Policy denied count。
- Tool timeout rate。
- Cost per successful run。
- Token usage by model profile。
- Unknown handling failures。
- Feedback closure rate。
- Top failing eval cases。

Dashboard 要能从指标跳到 trace，从 trace 跳到 eval case，从 eval case 跳到修复记录。

### 告警

告警要覆盖质量、安全和成本：

| 告警 | Severity | Owner | Time Window | Runbook | 自动动作 |
| --- | --- | --- | --- | --- | --- |
| policy_violation_count > 0 | critical | security-oncall | 5m | runbooks/policy-violation | pause rollout |
| eval_regression_rate above threshold | high | release-owner | release gate | runbooks/eval-regression | block release |
| cost_per_successful_run spikes | medium | platform-oncall | 30m | runbooks/cost-spike | reduce canary |
| tool_timeout_rate spikes | medium | tool-owner | 15m | runbooks/tool-timeout | degrade tool |
| unknown_handling_error_rate spikes | high | agent-owner | 15m | runbooks/unknown-handling | rollback candidate |
| feedback_severity_high untriaged | high | product-owner | 4h | runbooks/feedback-triage | page reviewer |

阈值、窗口、owner、runbook 和自动动作都要按业务设定。不要照抄示例数字。告警还要有 snooze policy，避免同一已知事故持续打扰，但 critical 安全告警不应被长期静默。

## 适用场景

### 玩具 Demo

Demo 可以只记录：

- run_id。
- prompt_version。
- model input / output 摘要。
- tool call。
- final answer。

目标是能复盘，不需要完整指标平台。

### 个人效率工具

个人工具可以用轻量记录：

- 本地 JSONL trace。
- 少量固定 eval case。
- 简单成本统计。
- 手工反馈标签。

例如个人文档整理 Agent，每次改 Prompt 后跑 10 个样本，检查格式和文件写入。

### 团队内部工具

团队工具需要：

- trace storage。
- metrics dashboard。
- eval suite。
- feedback queue。
- prompt version。
- release comparison。
- alerting。

kb-assistant 上线准备属于团队工具，必须能证明“不能上线”的判断来自哪些 evidence。

### 企业级系统

企业级需要平台化：

- 多租户 trace 隔离。
- 统一 OTel / tracing 集成。
- eval dataset 管理。
- grader registry。
- release gate。
- audit log。
- 数据保留策略。
- 成本归集。
- SLO / SLA。

企业级系统中，可观测性和评估不是辅助功能，而是上线资格的一部分。

## 不适用场景

不适合一开始就搭复杂观测平台。没有稳定任务和失败样本时，先用简单 trace 和手工 eval。

不适合把所有原文都记录进 trace。可观测性不能以泄露隐私为代价。

不适合只用 LLM-as-judge。高风险场景要结合规则、trace、人工和业务断言。

不适合只看全局成功率。全局指标会掩盖某个租户、工具、版本或场景的失败。

不适合让反馈只停留在工单里。反馈必须能进入回归评估，否则不会形成改进闭环。

## 常见坑与反模式

1. 只记录最终回答。

   无法知道 Agent 是如何得到答案的。

2. Trace 里存完整敏感原文。

   可观测性变成新的数据泄露面。

3. Eval 只有 happy path。

   生产事故通常发生在权限、超时、缺失、边界条件。

4. Prompt 改动不跑回归。

   修一个样本可能坏一批场景。

5. 成本只看总账单。

   无法知道哪个 agent、tenant、tool 或 prompt version 变贵。

6. 把 policy denied 当成错误率。

   有些拒绝是安全系统正常工作。

7. 不记录版本。

   无法复现某次行为。

8. LLM grader 没有校准。

   Grader 自己也可能漂移或偏差。

9. Feedback 不去重。

   一个线上问题可能重复污染 eval dataset。

10. Dashboard 没有行动入口。

   看到红灯却不能跳到 trace、case 和 owner，诊断效率很低。

## 安全、成本与性能考虑

### 安全

可观测性安全要求：

- 默认不记录完整用户原文。
- 工具输入输出用引用。
- secret 和凭证永不入 trace。
- trace 查询按 tenant 和角色授权。
- eval dataset 进入前脱敏和审核。
- audit log 防篡改。
- 数据保留有期限。

敏感数据是否可记录，要由数据分类和用途决定，不由开发者临时判断。

### 成本

可观测性也有成本：

- trace 存储。
- metrics 写入。
- eval model 调用。
- LLM grader 调用。
- dashboard 查询。
- 人工标注。

控制方式：

- 低风险 run 采样。
- 高风险 run 全量记录。
- 大字段用对象存储引用。
- eval 分快速集和全量集。
- LLM grader 只用于规则无法判断的样本。
- trace 保留分层。

### 性能

Trace 写入不能阻塞主链路太久。常见做法：

- 关键审计同步落库。
- 普通 trace 异步写入。
- metrics 批量上报。
- 大 observation 存对象存储。
- dashboard 查询走聚合表。

但异步不等于可以丢关键状态。影响审计、审批和副作用的记录必须可靠。

## 如何评估效果

可观测性与评估体系本身也要评估。

| 指标 | 问题 |
| --- | --- |
| Trace Coverage | 关键 run 是否都有 trace |
| Trace Completeness | trace 是否包含模型、工具、策略、最终回答 |
| Eval Coverage | eval 是否覆盖主要失败模式 |
| Regression Detection Rate | 回归是否能被发现 |
| Feedback Closure Rate | 反馈是否进入修复和回归 |
| Cost Attribution Accuracy | 成本是否能归集到正确维度 |
| Alert Precision | 告警是否有行动价值 |
| Sensitive Data Leakage | trace / eval 是否泄露敏感数据 |
| Time To Diagnose | 从告警到定位原因需要多久 |

评估样本：

```json
{
  "case_id": "observability_missing_tool_trace_001",
  "fault": "tool call executed but no tool span written",
  "expected_behavior": [
    "trace_completeness_check_fails",
    "release_gate_blocks_candidate",
    "owner_can_find_missing_span_type"
  ]
}
```

回归检测样本：

```json
{
  "case_id": "eval_regression_prompt_v9_001",
  "change": "prompt_version release-readiness-v9",
  "baseline": {
    "case": "permission_denied_not_ready",
    "result": "passed"
  },
  "candidate": {
    "case": "permission_denied_not_ready",
    "result": "failed",
    "failure": "marked_ready_despite_unknown_security_review"
  },
  "expected_behavior": [
    "release_gate_blocks_candidate",
    "regression_count_increments",
    "rollback_or_fix_required"
  ]
}
```

敏感数据样本：

```json
{
  "case_id": "trace_sensitive_data_001",
  "trace_field": "tool_output_raw",
  "contains_sensitive_data": true,
  "expected_behavior": [
    "redaction_check_fails",
    "raw_field_not_exported_to_eval_dataset",
    "security_review_required"
  ]
}
```

## 实践任务

1. 入门：设计 kb-assistant trace schema。

交付物：列出 run、context_build、model_call、tool_call、policy_check、final_answer span 的字段。

自查标准：每个 span 都能关联 run_id 和 trace_id。

2. 初级：设计指标面板。

交付物：列出 8 个指标，至少包含成功率、工具超时、policy denied、token cost、eval pass rate。

自查标准：每个指标都要有维度和行动建议。

3. 中级：设计 eval dataset。

交付物：写 5 个 eval case，覆盖 ready、permission denied、tool timeout、missing context、write requires approval。

自查标准：每个 case 都有 expected output 和 expected trace。

4. 高级：设计 feedback 到 eval 的闭环。

场景：用户反馈 Agent 错误地说“可以上线”。

交付物：写出 feedback 记录、root cause、脱敏策略、eval case 和 release gate 行为。

自查标准：不能直接把用户原文塞进 eval。

5. 生产化：设计 release regression dashboard。

交付物：说明如何比较 prompt v8 和 v9 的 eval pass rate、policy violation、成本和延迟。

自查标准：能明确阻止坏版本上线。

参考答案要点：

- Trace 要覆盖模型、工具、策略、审批、handoff、final answer。
- Metrics 要能按 tenant、agent、version、tool、model_profile 维度切分。
- Eval 要覆盖 failure path，不只 happy path。
- Token 和成本要能归集到 run、tenant、agent 和 model profile。
- Feedback 进入 eval 前必须脱敏、去重、归因和审核。
- LLM-as-judge 不能替代规则、trace 和人工审核。

## 从入门到专业

- 入门：知道日志、trace、metrics、audit 的区别。
- 初级：能为 Agent Run 设计基础 trace。
- 中级：能建立 eval dataset 和 prompt regression。
- 高级：能做 trace grading、成本归集、feedback loop 和 release gate。
- 专业：能把可观测性与评估做成平台能力，支撑多个 Agent 的持续改进。

完成任务 1 和 2，能开始复盘 Agent；完成任务 3 和 4，能让失败样本进入回归；完成任务 5，才具备生产发布治理能力。

专业工程师不会只问“这次回答对不对”。他会问：“过程对不对？为什么对？错在哪里？这类错以后会不会再发生？新版本是否用数据证明更好？”

## 本章小结

可观测性与评估解决的是“如何知道 Agent 发生了什么，以及如何证明它变好了”的问题。

本章建立了几个核心结论：

- Agent 可观测性要覆盖决策过程，不只覆盖最终回答。
- Trace、Log、Metric、Audit 各有职责。
- Trace 默认要脱敏，并使用引用代替敏感原文。
- Metrics 要能指导行动。
- Eval 要覆盖工具、策略、状态、最终回答和 failure path。
- Prompt 版本必须和 eval、trace、release gate 关联。
- 线上反馈要进入脱敏、归因、去重、审核和回归闭环。
- LLM-as-judge 有用，但不能单独承担高风险评估。

下一章会进入安全与权限。第 20 章讲如何看见问题和证明修复有效；第 21 章会进一步讲 Prompt Injection、Tool Injection、权限隔离、审批和审计机制。

## Sources

以下来源按 2026-05-30 访问时理解；不同平台对 trace、eval、dataset、grader 的命名不同，本章采用工程抽象，不将任何产品 API 写成统一标准。

- [OpenAI Agents SDK: Tracing](https://openai.github.io/openai-agents-python/tracing/)
- [OpenAI API: Getting started with datasets](https://developers.openai.com/api/docs/guides/evaluation-getting-started)
- [OpenAI API: Trace grading](https://developers.openai.com/api/docs/guides/trace-grading)
- [OpenTelemetry: Semantic conventions for generative AI systems](https://opentelemetry.io/docs/specs/semconv/gen-ai/)
- [OpenTelemetry: Semantic conventions for generative client AI spans](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/)
- [LangSmith Docs: Evaluation concepts](https://docs.langchain.com/langsmith/evaluation-concepts)

## 写作审查记录

### 章节架构师

- 本章目标：解释 Agent 系统如何通过 trace、logs、metrics、token、eval 和 feedback 建立可观测与评估闭环。
- 知识点地图：Trace Schema、Span Schema、Metrics、Token / Cost、Prompt Version、Eval Dataset、Grader、Trace Grading、Feedback Loop、Dashboard、Alert、隐私和发布回归。
- 前后章节关系：承接第 19 章后端架构，为第 21 章安全与权限铺垫。

### 技术审稿人

- 发现问题：不同平台对 trace、eval、dataset、grader 的术语和能力不同，不能混成一个统一产品 API；OpenAI tracing 的敏感数据采集默认行为和 OpenTelemetry GenAI semantic conventions 的演进状态也需要提醒。
- 修订动作：使用 OpenAI Agents SDK tracing、OpenAI datasets / trace grading、OpenTelemetry GenAI semantic conventions、LangSmith evaluation concepts 作为来源；正文采用工程抽象，避免写死具体 API；补充 `trace_include_sensitive_data` 生产配置提醒和 OTel semconv Development 状态说明。
- 结论：概念边界清楚，没有把某个平台能力写成行业标准。

### 工程审稿人

- 发现问题：只讲“记录日志和跑 eval”不足以指导生产排障；初版 trace、audit、cost、feedback 和 alert 字段还不够支撑真实平台。
- 修订动作：补充 trace schema、span schema、OTel 对齐字段、Audit schema、metrics、token 成本归集、价格版本、prompt 版本、eval dataset、grader、trace grading、feedback loop、dashboard、alert owner/runbook/自动动作和评估样本。
- 结论：章节能映射到真实后端系统，覆盖过程复盘、指标监控、成本归集、回归评估和反馈闭环。

### 学习体验审稿人

- 发现问题：读者容易把可观测性理解成日志，把评估理解成最终答案对错。
- 修订动作：沿用 kb-assistant 错误上线判断案例，展示没有 trace 时无法排查，有 trace 和 eval 时能归因和回归。
- 结论：章节能帮助读者建立“过程可见 + 数据证明”的工程直觉。

### 主编

- 最终调整：本章统一主线为“看见过程，证明改进”。
- 与全书衔接：第 19 章讲后端结构，本章讲可观测性与评估，第 21 章将讲安全与权限。
- 后续章节提醒：第 21 章应避免重复 trace schema，重点讲攻击面、权限边界、工具注入、审批和审计。
