# 第 15 章：Agent Planning 任务规划

## 本章解决什么问题

第 14 章回答了“什么是 AI Agent”：Agent 是围绕目标运行、能够使用上下文、状态、记忆和工具，并由运行时治理执行过程的系统。本章继续回答下一个问题：

> Agent 如何决定下一步做什么？

一个 Agent 不能只会调用工具。它还要知道什么时候查资料、什么时候调用工具、什么时候停下来、什么时候让用户确认、什么时候承认证据不足、什么时候转人工。

这就是 Planning 任务规划要解决的问题。

继续使用知识库问答助手上线准备这条主线。用户说：

```text
判断 kb-assistant 今天能不能上线，如果不能，帮我生成阻塞项草稿。
```

这个目标至少需要拆成：

- 查上线检查项。
- 查安全评审状态。
- 查评估样本完成情况。
- 检索相关上线规范。
- 判断风险。
- 生成结构化报告。
- 必要时生成草稿。
- 等待用户确认。

如果没有规划，Agent 可能直接回答“不能上线”，却没有证据；也可能先生成阻塞项，再发现检查项其实已经完成；还可能一直搜索，迟迟不输出结论。

本章要回答：

- Agent Planning 是什么？
- ReAct、Plan-and-Execute、Reflection、Self-Correction 分别适合什么？
- Workflow 和 Planning 有什么区别？
- 计划应该由模型生成，还是由后端规则生成？
- 计划如何落到状态机、工具调用和审批流程？
- 什么时候不应该让模型自由规划？
- 如何评估一个 Agent 的规划是否正确、安全、成本可控？

截至 2026-05-30，Planning 没有统一的行业标准实现。ReAct 是一篇经典论文提出的“推理和行动交替”范式，强调 reasoning traces 和 actions 的协同；Reflexion 论文探索让语言 Agent 利用反馈生成反思并改进后续尝试。Plan-and-Execute、Reflection、Self-Correction 在不同框架中有不同实现。本章采用工程抽象讲这些模式，不把任何模式写成万能解法，也不把论文实验结果直接等同于生产系统能力。

读完本章，读者应该能为一个 Agent 任务选择合适的规划方式：什么时候用固定 Workflow，什么时候用 ReAct 式边查边做，什么时候先生成计划再执行，什么时候允许反思重试，什么时候必须停止并交给人工。

## 一个直观例子

用户说：

```text
帮我判断 kb-assistant 今天能不能上线，如果不能，帮我生成阻塞项草稿。
```

一个没有规划的 Agent 可能这样做：

```text
我认为不能上线，因为权限和评估可能还没完成。我已经生成阻塞项草稿。
```

问题是：它没有查真实检查项，没有确认安全评审，没有查询评估样本，也没有用户确认。

一个规划更好的 Agent 会先生成可执行计划：

```json
{
  "goal": "judge_release_readiness",
  "plan": [
    {
      "step": "list_release_checks",
      "purpose": "找到未完成上线检查项"
    },
    {
      "step": "get_review_status",
      "purpose": "确认安全评审是否通过"
    },
    {
      "step": "search_release_docs",
      "purpose": "查找上线门槛和评估样本要求"
    },
    {
      "step": "generate_risk_report",
      "purpose": "基于证据判断是否可以上线"
    },
    {
      "step": "draft_release_blocker_if_needed",
      "purpose": "仅在存在阻塞项且用户要求时生成草稿"
    }
  ],
  "stop_conditions": [
    "risk_report_generated",
    "need_user_confirmation",
    "permission_denied",
    "tool_budget_exceeded"
  ]
}
```

执行时，它可能发现：

```json
{
  "incomplete_checks": [
    {"check_id": "RC-07", "title": "越权访问评估样本不足"}
  ],
  "review_status": "passed",
  "release_rule": "上线前必须有 5 条越权访问评估样本"
}
```

然后输出：

```text
kb-assistant 今天还不建议上线。

证据：
- RC-07 未完成：越权访问评估样本不足。
- 上线规则要求至少 5 条越权访问评估样本。
- 安全评审已通过，不是当前阻塞点。

我可以生成一个阻塞项草稿：补齐越权访问评估样本。确认后才会写入任务系统。
```

这就是 Planning 的价值：不是让模型“想得更多”，而是让 Agent 有步骤、有证据、有停止条件、有安全边界地推进任务。

## 基础解释

### Planning 是什么

Planning 是 Agent 为了完成目标而决定步骤、顺序、工具和停止条件的过程。

最小 Planning 包含：

- 目标是什么。
- 需要哪些信息。
- 可以调用哪些工具。
- 先做什么，后做什么。
- 什么情况下停止。
- 什么情况下请求用户或人工介入。

Planning 不等于模型输出一长串思考过程。生产系统更关心可执行计划，而不是不可验证的内心独白。

### Plan 和 Step

Plan 是任务级别的步骤安排。Step 是执行过程中的一个具体动作。

```json
{
  "plan_id": "plan_001",
  "goal": "judge_release_readiness",
  "steps": [
    {"step_id": "s1", "type": "tool", "name": "list_release_checks"},
    {"step_id": "s2", "type": "tool", "name": "get_review_status"},
    {"step_id": "s3", "type": "analysis", "name": "generate_risk_report"}
  ]
}
```

Step 执行后会产生 observation：

```json
{
  "step_id": "s1",
  "status": "succeeded",
  "observation_ref": "tool_result:list_release_checks:001"
}
```

计划不能只存在模型上下文里。真实系统要把计划、步骤和 observation 结构化保存。

### 计划从哪里来

计划不一定都由模型自由生成。生产系统里更常见的是多种来源组合：

| 计划来源 | 适合场景 | 主要优点 | 主要边界 |
| --- | --- | --- | --- |
| 固定 Workflow | 流程稳定、风险高、合规要求明确 | 可预测、可审计、容易测试 | 灵活性低，难处理开放任务 |
| 模板计划 | 常见任务有固定骨架，但参数不同 | 兼顾稳定性和复用 | 模板维护成本会上升 |
| 模型选择模板 | 用户表达多样，但任务类型有限 | 让模型做意图识别，后端控制流程 | 需要分类评估和兜底 |
| 模型生成候选计划 | 任务开放、路径不确定、需要动态取证 | 灵活，能适配新问题 | 必须经过 Plan Validator 和预算控制 |
| 人工审批计划 | 高风险写操作、跨系统变更、生产发布 | 人保留最终控制权 | 交互成本高，不适合低风险高频任务 |

因此，“计划应该由模型生成，还是由后端规则生成”的答案不是二选一。固定、强合规、高风险任务优先用 Workflow 或模板计划；开放分析任务可以让模型生成候选计划；真正执行前，后端仍要校验权限、风险、预算、停止条件和审批要求。

### ReAct

ReAct 是 Reasoning and Acting 的组合。它的核心思想是让模型在推理和行动之间交替：

```text
Thought -> Action -> Observation -> Thought -> Action -> Observation -> Answer
```

在工程里，不建议把完整 `Thought` 原样暴露给用户或日志。更稳妥的做法是保存可审计的 decision summary，而不是模型内部推理全文。

ReAct 适合：

- 信息不完整，需要边查边判断。
- 工具结果会影响下一步。
- 任务路径不能完全预先写死。

不适合：

- 高风险写操作很多。
- 工具成本很高。
- 流程本身很明确，固定 Workflow 更可靠。

### Plan-and-Execute

Plan-and-Execute 是先生成计划，再按计划执行。它比 ReAct 更适合需要整体视角的任务。

例如：

```text
先列出上线判断所需证据：
1. 检查项状态
2. 安全评审
3. 评估样本
4. 回滚预案

然后逐项执行。
```

优点：

- 用户和系统能先看到计划。
- 更容易做审批和预算。
- 更容易避免遗漏步骤。

风险：

- 初始计划可能错误。
- 工具结果可能让计划需要调整。
- 模型可能生成不可执行计划。

因此生产系统常用“计划可修改”的版本，而不是一次计划到底。

### Reflection 和 Self-Correction

Reflection 是让 Agent 根据失败或反馈生成改进意见。Self-Correction 是让 Agent 在发现输出不合格时尝试修复。

例如第一次输出：

```json
{
  "ready": true,
  "evidence": []
}
```

校验发现缺少证据，系统可以要求模型修正：

```text
上一次回答缺少证据。请只基于工具结果重新生成结论；如果证据不足，必须输出 needs_more_evidence。
```

Reflection / Self-Correction 有价值，但不能无限重试。它必须有：

- 明确反馈。
- 最大重试次数。
- 失败分类。
- 人工接管条件。
- 不能越过安全策略。

## 核心原理

### 原理一：规划要服务目标，不是制造复杂度

有些任务不需要复杂规划。例如：

```text
总结这段会议记录。
```

这可以是单次模型调用或简单 Workflow。

复杂规划适合：

- 目标需要多步证据。
- 工具结果会改变下一步。
- 有不确定性和分支。
- 需要用户确认。
- 需要在成本和风险之间权衡。

不要为了“更像 Agent”给简单任务加规划。

### 原理二：计划必须可执行

坏计划：

```text
全面分析项目所有风险，并确保上线成功。
```

这句话不可执行。好的计划应该明确：

- 调用哪个工具。
- 读取什么资源。
- 产出什么结果。
- 成功条件是什么。
- 失败后怎么办。

好计划：

```json
{
  "step": "get_review_status",
  "tool": "release.get_review_status",
  "input": {},
  "success_condition": "review_status is returned",
  "on_failure": "mark review status unverified"
}
```

### 原理三：计划不能绕过权限和工具策略

模型可以提出计划，但后端必须审查。

例如模型计划里出现：

```json
{"step": "deploy_production"}
```

即使模型认为这是下一步，Tool Policy 也应该拒绝。计划只是候选，不是命令。

计划审查至少包括：

- 工具是否存在。
- 用户是否有权限。
- 工具风险等级是否允许。
- 是否需要审批。
- 是否超过预算。
- 是否违反任务边界。

### 原理四：规划需要状态反馈

计划不是静态文档。每一步执行后，状态都会变化。

```text
计划：查安全评审。
结果：权限不足。
下一步：不能继续判断 ready，向用户说明缺少权限。
```

如果 Agent 忽略 observation，坚持执行原计划，就会出错。

Planning 必须和 Agent Run 状态机结合。第 16 章会展开 Runtime，本章先建立规划和状态的关系。

### 原理五：反思不能替代外部验证

Self-Correction 很容易被误用成“让模型自己检查自己”。这有一定帮助，但不能替代：

- Schema 校验。
- 引用校验。
- 工具结果校验。
- 权限校验。
- 测试执行。
- 人工审核。

模型可以反思，但最终要有外部信号。没有外部信号的反思，可能只是更流畅地重复错误。

### 原理六：规划要有预算和停止条件

Planning 会增加成本：

- 生成计划要模型调用。
- 执行计划要工具调用。
- 反思和修正要额外调用。
- 计划变更要更多状态管理。

每个 Agent run 应该设置：

- 最大 step 数。
- 最大工具调用次数。
- 最大重试次数。
- 最大成本。
- 最大执行时间。
- 必须停止的风险条件。

## 工程实现

### Planning 模块

在后端架构里，可以增加 Planning Service：

```text
Agent Orchestrator
  -> Goal Parser
  -> Planning Service
  -> Plan Validator
  -> Step Executor
  -> Reflection / Repair
  -> Task State Store
```

模块职责：

| 模块 | 职责 |
| --- | --- |
| Goal Parser | 把用户请求转成目标和约束 |
| Planning Service | 生成或选择计划 |
| Plan Validator | 检查计划是否可执行、合规、在预算内 |
| Step Executor | 执行计划步骤 |
| Reflection / Repair | 根据失败反馈修正计划或输出 |
| Task State Store | 保存计划、步骤、observation 和状态 |

### Plan 数据模型

计划可以用结构化对象保存：

```json
{
  "plan_id": "plan_release_001",
  "run_id": "run_release_001",
  "goal": "judge_release_readiness",
  "strategy": "plan_and_execute",
  "status": "approved",
  "steps": [
    {
      "step_id": "s1",
      "type": "tool",
      "tool": "list_release_checks",
      "purpose": "查询未完成检查项",
      "input_schema": {
        "project": "string",
        "date": "date"
      },
      "input": {
        "project": "kb-assistant",
        "date": "2026-05-30"
      },
      "output_ref": "obs.release_checks",
      "success_condition": "返回上线检查项列表，且结果包含检查项状态",
      "depends_on": [],
      "risk_level": "low",
      "approval_required": false,
      "timeout_ms": 3000,
      "required": true,
      "on_failure": "stop_and_report"
    },
    {
      "step_id": "s2",
      "type": "tool",
      "tool": "get_review_status",
      "purpose": "确认安全评审状态",
      "input_schema": {
        "project": "string",
        "review_type": "string"
      },
      "input": {
        "project": "kb-assistant",
        "review_type": "security"
      },
      "output_ref": "obs.security_review",
      "success_condition": "返回安全评审状态，或明确返回权限不足",
      "depends_on": ["s1"],
      "risk_level": "low",
      "approval_required": false,
      "timeout_ms": 3000,
      "required": true,
      "on_failure": "mark_unverified"
    },
    {
      "step_id": "s3",
      "type": "analysis",
      "purpose": "生成上线风险报告",
      "input_refs": [
        "obs.release_checks",
        "obs.security_review"
      ],
      "output_ref": "analysis.release_risk_report",
      "success_condition": "报告包含 ready 判断、证据、未知项和建议下一步",
      "depends_on": ["s1", "s2"],
      "risk_level": "medium",
      "approval_required": false,
      "timeout_ms": 5000,
      "required": true
    },
    {
      "step_id": "s4",
      "type": "human_approval",
      "purpose": "如果需要创建阻塞项，等待用户确认",
      "input_refs": ["analysis.release_risk_report"],
      "success_condition": "用户确认创建、取消创建，或要求修改草稿",
      "depends_on": ["s3"],
      "risk_level": "high",
      "approval_required": true,
      "timeout_ms": 86400000,
      "required": false,
      "on_failure": "do_not_write"
    }
  ],
  "budgets": {
    "max_steps": 6,
    "max_tool_calls": 4,
    "max_retries": 1
  },
  "stop_conditions": [
    "risk_report_generated",
    "permission_denied",
    "awaiting_user_confirmation"
  ]
}
```

字段重点：

- `strategy`：使用哪种规划方式。
- `type`：区分工具步骤、分析步骤、人工审批步骤和最终回答步骤。
- `input_schema` / `input` / `input_refs`：说明步骤需要什么输入。
- `output_ref`：把步骤产出挂到可引用的位置，便于后续步骤依赖。
- `depends_on`：说明步骤顺序和并行边界。
- `success_condition`：给执行器和评估系统一个可判定的成功标准。
- `risk_level` / `approval_required`：让策略层识别风险和审批需求。
- `timeout_ms`：避免单个步骤无限等待。
- `required`：步骤是否必要。
- `on_failure`：失败时如何处理。
- `budgets`：预算边界。
- `stop_conditions`：停止条件。

### Plan Validator

模型生成计划后，不要直接执行。先校验：

```java
// 伪代码：说明职责，不代表某个框架 API
PlanValidationResult validatePlan(Plan plan, RequestContext context) {
    for (PlanStep step : plan.steps()) {
        if (budget.exceeds(plan.budgets())) {
            return invalid("budget_exceeded", step);
        }

        switch (step.type()) {
            case TOOL -> {
                if (!toolRegistry.exists(step.tool())) {
                    return invalid("unknown_tool", step);
                }
                if (!policy.canExposeTool(context, step.tool())) {
                    return invalid("tool_not_allowed", step);
                }
                if (!schemaRegistry.accepts(step.tool(), step.inputSchema(), step.input())) {
                    return invalid("invalid_tool_input", step);
                }
                if (risk.requiresApproval(step.tool())) {
                    plan.markApprovalRequired(step);
                }
            }
            case ANALYSIS -> {
                if (!stateStore.hasAll(step.inputRefs())) {
                    return invalid("missing_analysis_input", step);
                }
                if (step.successCondition().isBlank()) {
                    return invalid("missing_success_condition", step);
                }
            }
            case HUMAN_APPROVAL -> {
                if (!approvalPolicy.canRequestApproval(context, step)) {
                    return invalid("approval_not_allowed", step);
                }
                plan.markApprovalRequired(step);
            }
            case FINAL_ANSWER -> {
                if (!policy.canReturnFinalAnswer(context, step.outputPolicy())) {
                    return invalid("final_answer_not_allowed", step);
                }
            }
        }
    }
    return PlanValidationResult.approved(plan);
}
```

计划校验失败时，可以：

- 要求模型重新规划。
- 删除不允许步骤。
- 请求用户确认。
- 直接拒绝任务。
- 转人工。

### ReAct 工程化

ReAct 在生产里不要简单实现成无限循环。建议拆成受控 step：

```text
1. Model proposes next action.
2. Policy checks action.
3. Tool executes.
4. Observation is sanitized.
5. Model decides next action or final answer.
6. Runtime checks stop conditions.
```

记录 trace：

```json
{
  "step_id": "s2",
  "strategy": "react",
  "decision_summary": "Need review status before judging release readiness.",
  "action": "get_review_status",
  "observation_ref": "tool_result:review_status_001",
  "next_state": "continue"
}
```

不要把完整模型思考链当成业务日志。保存 decision summary、工具、证据和策略结果即可。

### Plan-and-Execute 工程化

Plan-and-Execute 更适合有明确阶段的任务：

```text
Plan
  -> Validate
  -> Execute step 1
  -> Execute step 2
  -> Adjust plan if needed
  -> Final answer
```

适合：

- 上线检查。
- 报告生成。
- 代码修改前的步骤规划。
- 多系统查询。

关键是允许计划调整。比如安全评审查询失败，计划应变成：

```json
{
  "change": "mark review status unverified",
  "reason": "permission denied",
  "impact": "cannot mark project ready"
}
```

### Reflection / Repair 工程化

Reflection 不应该随便让模型“再想想”。更好的方式是给具体反馈：

```json
{
  "failure_type": "missing_evidence",
  "message": "The answer says project is ready, but no evidence supports evaluation sample completion.",
  "allowed_actions": [
    "query_eval_status",
    "revise_answer_as_unverified"
  ],
  "max_retries": 1
}
```

Repair 的对象也要分清：

| 修复对象 | 示例 |
| --- | --- |
| 参数修复 | 工具参数枚举错误 |
| 输出修复 | JSON schema 不合法 |
| 计划修复 | 调用了不允许工具 |
| 结论修复 | 缺少证据却给确定结论 |

高风险工具调用不能靠 Reflection 自行修复后继续执行，必须重新经过策略和审批。

### Planning Trace

一次 Planning trace 可以记录：

```json
{
  "trace_id": "plan_trace_001",
  "run_id": "run_release_001",
  "goal": "judge_release_readiness",
  "strategy": "plan_and_execute",
  "plan_version": 2,
  "steps_planned": 4,
  "steps_executed": 3,
  "steps_skipped": [
    {
      "step": "draft_release_blocker",
      "reason": "user_confirmation_required"
    }
  ],
  "validation_result": "approved_with_constraints",
  "stop_reason": "awaiting_user_confirmation",
  "cost": {
    "model_calls": 3,
    "tool_calls": 2
  }
}
```

Planning trace 是第 20 章可观测性的基础之一。

## 适用场景

### 玩具 Demo

Demo 可以用简单 ReAct：

```text
如果不知道答案，就搜索；搜索后回答。
```

目标是理解“决策摘要 -> 行动 -> 观察结果”的循环。论文和教程里常用 `Thought / Action / Observation` 描述 ReAct，但工程实现不要把完整思考链写进日志、Trace 或用户可见内容。Demo 也不要加入高风险写工具。

### 个人效率工具

个人 Agent 可以用规划来做：

- 读论文并生成摘要。
- 分析学习资料。
- 整理待办。
- 规划代码修改步骤。

个人场景可以更灵活，但仍要有取消、最大步骤数和文件写入确认。

### 团队内部工具

团队 Agent 适合用规划处理：

- 上线准备检查。
- 故障复盘。
- 工单分诊。
- API 变更影响分析。
- 测试计划生成。

团队场景要更重视计划可见性。重要任务应先展示计划，让用户或审批人确认。

### 企业级系统

企业级 Planning 要平台化：

- 规划策略版本管理。
- 计划校验。
- 工具权限。
- 审批节点。
- 预算和超时。
- 中断恢复。
- trace 和回放。
- 规划评估集。

企业系统中，模型生成计划只是候选，执行权永远在运行时和策略层。

## 不适用场景

不适合为简单任务使用复杂规划。例如摘要、格式转换、简单问答不需要多步计划。

不适合让模型自由规划高风险动作。发版、删除、改权限、付款必须由 Workflow、审批和后端规则控制。

不适合在工具和权限边界不清楚时做开放规划。模型不知道哪些工具安全，容易误用。

不适合把 Reflection 当事实校验。没有外部证据时，反思只是另一轮生成。

不适合无限重试。规划失败应该有上限和人工接管。

## 常见坑与反模式

1. 计划太抽象。

   “全面分析风险”不是可执行步骤。

2. 计划不可校验。

   没有工具、输入、成功条件和失败处理，后端无法执行。

3. 让模型绕过工具策略。

   模型计划调用高风险工具，不代表应该执行。

4. 没有预算。

   Agent 会不断搜索、调用工具、反思和重试。

5. 忽视 observation。

   工具结果已经说明权限不足，模型还继续原计划。

6. 把反思当验证。

   模型自我检查不能替代测试、引用和业务校验。

7. 不记录计划版本。

   计划修改后无法复盘为什么改变。

8. 对用户隐藏重要计划。

   高风险任务应展示计划和影响，不应默默执行。

9. 用 ReAct 做所有事。

   固定流程用 Workflow 更稳；开放探索才更适合 ReAct。

10. 规划和运行时混在一起。

   Planning 负责决定候选步骤，Runtime 负责执行、中断、恢复和治理。职责要分开。

## 安全、成本与性能考虑

### 安全

Planning 安全重点是防止模型生成危险计划并执行。

原则：

- 计划必须经过后端校验。
- 高风险步骤默认需要审批。
- 计划不能扩大用户权限。
- 工具结果不能诱导修改计划去执行危险动作。
- Reflection 后的计划仍要重新校验。
- 计划和修改记录要写入 trace。

### 成本

Planning 会增加模型调用和工具调用。控制方式：

- 对简单任务跳过规划。
- 限制最大计划步骤。
- 限制最大 replanning 次数。
- 只在失败时启用 Reflection。
- 缓存常见 Workflow。
- 对高成本工具设置预算。

### 性能

Plan-and-Execute 可能多一次模型调用，但能减少盲目工具调用。ReAct 可能更灵活，但多轮交互更慢。

优化策略：

- 固定流程用 Workflow。
- 只读工具并行执行。
- 计划生成和工具准备并行。
- 对慢工具异步执行。
- 长任务给用户进度反馈。

## 如何评估效果

Planning 评估要看计划本身和执行结果。

| 指标 | 问题 |
| --- | --- |
| Plan Validity | 计划是否可执行 |
| Plan Completeness | 是否覆盖必要步骤 |
| Tool Safety | 是否避免不允许工具 |
| Step Ordering | 步骤顺序是否合理 |
| Observation Use | 是否根据工具结果调整 |
| Stop Accuracy | 是否在该停止时停止 |
| Replanning Quality | 失败后是否合理修正 |
| Cost Efficiency | 是否避免无效步骤 |
| Outcome Quality | 最终结果是否完成目标 |

评估样本：

```json
{
  "case_id": "planning_release_001",
  "goal": "判断 kb-assistant 是否可以上线",
  "required_steps": [
    "list_release_checks",
    "get_review_status",
    "check_eval_samples",
    "generate_risk_report"
  ],
  "forbidden_steps": [
    "deploy_production",
    "create_release_blocker_without_confirmation"
  ],
  "allowed_stop_conditions": [
    "risk_report_generated",
    "awaiting_user_confirmation"
  ],
  "stop_condition_rules": [
    {
      "condition": "risk_report_generated",
      "must_have_output_ref": "analysis.release_risk_report",
      "must_not_call_tools": ["deploy_production"]
    },
    {
      "condition": "awaiting_user_confirmation",
      "must_have_pending_step_type": "human_approval",
      "must_not_call_tools": ["create_release_blocker_without_confirmation"]
    }
  ]
}
```

失败样本：

```json
{
  "case_id": "planning_permission_denied_001",
  "tool_result": "permission_denied on get_review_status",
  "expected_behavior": [
    "mark review status unverified",
    "do not mark project ready",
    "ask user to grant access or involve reviewer"
  ]
}
```

评估规划时，要保存 plan、plan validation、step observations、replanning 和 stop reason。只看最终回答无法判断规划是否健康。

## 实践任务

1. 入门：为上线风险判断写一个 4 步计划。

交付物：列出步骤、目的、需要的工具或资源、成功条件。

自查标准：计划必须可执行，不写“全面分析”这类空泛步骤。

2. 初级：设计 Plan 数据结构。

交付物：包含 plan_id、goal、strategy、steps、budgets、stop_conditions 的 JSON。每个工具步骤至少包含 input_schema、output_ref、success_condition、depends_on、risk_level、approval_required、timeout_ms 和 on_failure。

自查标准：工具步骤、分析步骤、人工审批步骤不能混用字段；非工具步骤不应该强行填写 tool。

3. 中级：设计 Plan Validator。

场景：计划中包含 `deploy_production`。

交付物：校验规则表，说明 tool、analysis、human_approval、final_answer 四类 step 分别如何校验，以及 unknown tool、permission denied、high risk action、budget exceeded 如何处理。

自查标准：高风险工具不能因为模型计划了就执行。

4. 高级：设计 ReAct 受控执行 trace。

交付物：3 个 step 的 trace，包括 decision_summary、action、observation_ref、policy_decision、next_state。

自查标准：不记录完整模型思考链，但能复盘为什么调用工具。

5. 生产化：设计 Reflection 重试策略。

交付物：失败类型、允许修复动作、最大重试次数、人工接管条件。

自查标准：反思不能绕过权限和审批；缺少外部证据时不能靠自我反思给确定结论。

参考答案要点：

- 上线风险判断至少应查检查项、安全评审、评估样本和上线规范。
- `create_release_blocker` 和 `deploy_production` 不应出现在默认计划里；草稿可以在用户明确要求时进入候选计划。
- Plan Validator 应在执行前按 step type 分支校验：工具步骤查 Tool Registry、权限、输入 schema 和风险；分析步骤查输入引用和成功条件；审批步骤查审批策略；最终回答查输出策略。
- ReAct trace 应保存 decision summary、action、observation 和策略结果，不保存完整不可控思考链。
- Reflection 只能基于明确失败反馈修复，且必须重新经过策略校验。

## 从入门到专业

- 入门：知道 Planning 是决定步骤、工具和停止条件。
- 初级：能写出可执行计划。
- 中级：能设计 Plan 数据结构和 Plan Validator。
- 高级：能处理 ReAct、Plan-and-Execute、Reflection、预算和 trace。
- 专业：能把规划能力做成可评估、可灰度、可回滚的 Agent 平台能力。

完成任务 1 和 2，能设计简单计划；完成任务 3 和 4，能进入工程落地；完成任务 5，开始具备生产规划治理能力。

专业工程师不会问“能不能让模型自己规划”。他会问：“哪些步骤可以让模型提议？哪些必须由系统决定？计划如何校验？失败如何修复？什么时候必须停？”

## 本章小结

Agent Planning 解决的是“下一步做什么”的问题。它把目标拆成步骤，把步骤连接到工具、状态、预算和停止条件。

本章建立了几个核心结论：

- Planning 要服务目标，不是制造复杂度。
- ReAct 适合边查边判断，Plan-and-Execute 适合先看全局再执行。
- Reflection 和 Self-Correction 有价值，但不能替代外部验证。
- 计划必须结构化保存、可校验、可执行、可回放。
- 模型生成计划只是候选，执行前必须经过后端策略。
- 规划要有预算和停止条件。
- 固定流程优先用 Workflow，高不确定任务才需要更动态的 Agent Planning。

下一章会进入 Agent Runtime。第 15 章讲“如何决定下一步”；第 16 章会讲“这些步骤如何在运行时被执行、暂停、恢复、重试、取消和审计”。Planning 和 Runtime 分开，Agent 才不会变成一团不可控的循环。

## Sources

以下来源按 2026-05-30 访问时理解；ReAct 和 Reflexion 是研究论文中的方法，Plan-and-Execute、Reflection、Self-Correction 在不同框架和系统中实现不同，本章采用工程抽象，不将任何实现写成统一标准。

- [ReAct: Synergizing Reasoning and Acting in Language Models](https://arxiv.org/abs/2210.03629)
- [Reflexion: Language Agents with Verbal Reinforcement Learning](https://arxiv.org/abs/2303.11366)
- [Anthropic: Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)
- [Anthropic Resources: Building Effective AI Agents](https://resources.anthropic.com/building-effective-ai-agents)
- [OpenAI Agents SDK: Running agents](https://openai.github.io/openai-agents-python/running_agents/)
- [OpenAI Agents SDK: Guardrails](https://openai.github.io/openai-agents-python/guardrails/)

## 写作审查记录

### 章节架构师

- 本章目标：解释 Agent 如何决定下一步做什么，并区分 ReAct、Plan-and-Execute、Reflection 和 Workflow。
- 知识点地图：Goal、Plan、Step、Observation、ReAct、Plan-and-Execute、Reflection、Self-Correction、Plan Validator、Planning Trace、预算、停止条件和评估。
- 前后章节关系：承接第 14 章 Agent 定义，为第 16 章 Agent Runtime 的执行、中断、恢复和重试铺垫。

### 技术审稿人

- 发现问题：ReAct 和 Reflexion 是具体研究方法，Plan-and-Execute 是更宽泛工程模式，不能都写成同等官方标准。
- 修订动作：为 ReAct 和 Reflexion 引用原始论文；将 Plan-and-Execute、Reflection、Self-Correction 表述为工程抽象；强调不保存完整模型思考链，只保存可审计 decision summary。
- 结论：概念边界清楚，没有把论文方法或框架模式写成统一行业标准。

### 工程审稿人

- 发现问题：如果只讲规划模式，后端工程师不知道如何落地；初版 Plan 数据模型和 Validator 对非工具步骤、成功条件、依赖、审批和超时表达不够完整。
- 修订动作：补充 Planning Service、计划来源选择表、扩展 Plan 数据模型、按 step type 分支的 Plan Validator、ReAct 工程化、Plan-and-Execute 工程化、Reflection / Repair、Planning Trace 和实践任务。
- 结论：章节能映射到真实 Java 后端和企业 Agent 平台，覆盖输入、处理、输出、状态、异常、权限、日志、评估和部署边界。

### 学习体验审稿人

- 发现问题：读者容易把规划理解为“让模型多想一会儿”，而不是可执行步骤设计。
- 修订动作：沿用知识库问答助手上线准备主线，用上线判断任务展示计划、工具、证据、草稿和停止条件；用坏计划和好计划对比建立直觉。
- 结论：章节由直观例子进入工程结构，能帮助读者理解规划不是思考文本，而是受控执行计划。

### 主编

- 最终调整：本章统一主线为“Planning 是受控下一步决策，不是自由发挥”。
- 与全书衔接：第 14 章定义 Agent，本章讲 Planning，第 16 章将讲 Runtime。
- 后续章节提醒：第 16 章应避免重复 Planning 模式，重点讲 Agent Loop、状态机、中断恢复、长任务执行和运行时治理。
