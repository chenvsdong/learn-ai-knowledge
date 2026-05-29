# 第 16 章：Agent Runtime 运行时

## 本章解决什么问题

第 15 章讲 Planning：Agent 如何决定下一步做什么。第 16 章讲 Runtime：这些候选步骤如何被真正执行、暂停、恢复、重试、取消和审计。

很多人第一次做 Agent，会把运行时写成一段 while 循环：

```java
while (!done) {
    ModelOutput output = callModel(messages);
    if (output.hasToolCall()) {
        ToolResult result = callTool(output.toolCall());
        messages.add(result);
    } else {
        return output.text();
    }
}
```

这个循环能跑 Demo，但很难进生产。因为真实系统会遇到：

- 工具调用超时。
- 用户中途取消。
- 高风险步骤需要审批。
- 执行到一半进程重启。
- 同一个工具结果被重复提交。
- 模型一直循环，迟迟不结束。
- 需要把过程流式展示给用户。
- 需要审计每一步为什么发生。
- 需要从失败点恢复，而不是从头重跑。

Agent Runtime 解决的是“运行控制平面”的问题。它不是模型，不是 Prompt，也不是工具本身，而是把模型、工具、状态、策略、预算、事件和观测连接起来的执行系统。

本章要回答：

- Agent Loop 到底是什么？
- Run、Turn、Step、Action、Observation 有什么区别？
- 为什么不能只靠一个 while 循环？
- Runtime 如何处理暂停、恢复、取消、重试和超时？
- 高风险工具审批应该放在哪里？
- 如何避免重复执行、无限循环和状态丢失？
- 如何评估一个 Agent Runtime 是否可靠？

截至 2026-05-30，不同框架对 Runtime 的命名和抽象并不统一。OpenAI Agents SDK 文档使用 Runner、RunState、max turns、streaming、guardrails、tracing 等概念；LangGraph 文档强调 interrupt、state persistence 和 resume；Temporal 文档强调 Durable Execution。本章采用工程抽象来讲 Agent Runtime，不把任何一个框架的 API 写成唯一标准。

读完本章，读者应该能设计一个最小 Agent Runtime：接收目标，加载计划，执行步骤，持久化状态，处理工具结果，遇到审批暂停，失败时按策略重试，最终输出可审计结果。

## 一个直观例子

继续使用前面的 kb-assistant 上线准备案例。用户说：

```text
帮我判断 kb-assistant 今天能不能上线，如果不能，帮我生成阻塞项草稿。
```

第 15 章中的 Planning Service 可能生成候选计划：

```json
{
  "goal": "judge_release_readiness",
  "steps": [
    {
      "step_id": "s1",
      "type": "tool",
      "tool": "list_release_checks",
      "output_ref": "obs.release_checks"
    },
    {
      "step_id": "s2",
      "type": "tool",
      "tool": "get_review_status",
      "output_ref": "obs.security_review"
    },
    {
      "step_id": "s3",
      "type": "analysis",
      "output_ref": "analysis.release_risk_report"
    },
    {
      "step_id": "s4",
      "type": "human_approval",
      "purpose": "确认是否创建阻塞项"
    },
    {
      "step_id": "s5",
      "type": "tool",
      "tool": "create_release_blocker",
      "purpose": "在用户确认后创建阻塞项草稿",
      "depends_on": ["s4"],
      "approval_required": true,
      "idempotency_key": "hmac(run_release_001:s5:create_release_blocker:v1)",
      "output_ref": "obs.release_blocker_draft"
    }
  ]
}
```

Runtime 接手后，它关心的不是“计划看起来是否合理”，而是：

- 这个 run 的唯一 ID 是什么？
- 当前执行到哪一步？
- 每一步输入从哪里来？
- 工具结果写到哪里？
- 权限检查是否通过？
- 超时后怎么处理？
- 如果用户关掉页面，回来后能不能继续？
- 如果服务重启，是否会重复创建阻塞项？
- 最终结果如何审计？

一个更像生产系统的执行过程会是：

```text
Run created
  -> validate plan
  -> execute s1: list_release_checks
  -> persist observation obs.release_checks
  -> execute s2: get_review_status
  -> persist observation obs.security_review
  -> execute s3: generate release risk report
  -> pause at s4: awaiting user approval
  -> user confirms
  -> execute s5: create_release_blocker with idempotency key
  -> finalize run
```

如果 `get_review_status` 返回权限不足，Runtime 不应该假装评审通过，也不应该无限重试。它应该把步骤标记为 `failed_with_known_reason` 或 `unverified`，把 run 转到可解释的状态，然后输出：

```text
当前无法确认安全评审状态，所以不能给出“可以上线”的结论。
我已生成风险报告，并等待你授权查询评审系统或指定评审人确认。
```

这就是 Runtime 的价值：把 Agent 从“会调用工具的模型”变成“受控、可恢复、可审计的执行系统”。

## 基础解释

### Agent Runtime 是什么

Agent Runtime 是负责执行 Agent 任务的系统层。它通常包括：

- Agent Loop。
- 状态机。
- 工具执行器。
- 策略检查。
- 审批和人工介入。
- 重试、超时和取消。
- checkpoint 和恢复。
- 事件流和日志。
- trace 和评估数据。

Runtime 不直接决定业务目标，也不应该替代 Planning。Planning 负责提出候选步骤；Runtime 负责安全、可靠、可观测地执行这些步骤。

### Run、Turn、Step、Action、Observation

几个词要先分清：

| 概念 | 含义 | 示例 |
| --- | --- | --- |
| Run | 一次 Agent 任务执行 | 判断 kb-assistant 是否可上线 |
| Turn | 一次模型调用和其后续处理 | 模型读取工具结果后决定下一步 |
| Step | Runtime 中可追踪的执行单元 | 调用 `get_review_status` |
| Action | 模型或计划提出的动作 | 调用工具、请求审批、输出最终回答 |
| Observation | Action 执行后的结果 | 工具返回检查项列表 |

一个 Run 可以包含多个 Turn，一个 Turn 可以产生一个或多个 Action，每个 Action 可以形成一个 Step，Step 完成后产生 Observation。

放到 kb-assistant 例子里，可以这样理解：

```text
Run: 判断 kb-assistant 是否可上线
  Turn 1: 模型读取目标和计划，提出两个只读工具 Action
    Step s1: list_release_checks -> Observation obs.release_checks
    Step s2: get_review_status -> Observation obs.security_review
  Turn 2: 模型基于 observation 生成风险报告 Action
    Step s3: generate_risk_report -> Observation analysis.release_risk_report
  Turn 3: Runtime 发现写入阻塞项需要确认
    Step s4: human_approval -> Run 暂停在 awaiting_approval
```

Turn 更接近“模型和 Runtime 的一轮交互”，Step 更接近“可持久化、可重试、可审计的执行单元”。同一个 Turn 里可以产生多个 Step，尤其是多个只读工具可以并行执行时。

工程实现里，不一定所有系统都这样命名，但最好有等价的结构。没有这些结构，Agent 很快会变成一串难以追踪的消息。

### Agent Loop

Agent Loop 是 Runtime 的核心循环。抽象模型如下：

```text
load run state
while run is active:
    build model input
    call model or load next planned step
    classify output
    validate action
    execute action
    record observation
    update state
    check stop conditions
finalize run
```

如果模型返回最终答案，Run 可以结束。如果模型提出工具调用，Runtime 执行工具并把 observation 回填。如果模型触发 handoff 或人工审批，Runtime 更新状态并暂停或切换执行者。

这里要注意：Loop 不是“模型想干什么就干什么”。每次 Action 都要过策略、预算、权限和状态检查。

### Decision Summary、Action、Observation

很多论文和教程会用 `Thought / Action / Observation` 解释 Agent 循环。生产系统不应该记录完整模型思考链，也不应该把它暴露给用户。

更适合工程落地的三元组是：

```json
{
  "decision_summary": "需要查询安全评审状态，因为上线判断依赖该证据。",
  "action": {
    "type": "tool",
    "tool": "get_review_status"
  },
  "observation_ref": "obs.security_review"
}
```

`decision_summary` 是可审计摘要，不是模型内部推理全文，也不等于 API 中可能返回的 reasoning summary。更稳妥的生成方式是基于可验证输入、policy decision、tool metadata 和 observation 生成，例如“因为上线判断缺少安全评审证据，所以调用只读评审查询工具”。如果摘要由模型生成，也只能当作不可信的解释候选，需要过滤、脱敏和校验，不能声称它代表模型内部真实推理。

### Runtime 和 Workflow 的关系

Workflow 的控制流主要由代码或图定义，Runtime 是执行系统。这里说“确定”是相对模型动态决策而言，不表示 Workflow 不能分支、等待外部事件或处理消息；像 durable workflow 这类系统也可以有等待、信号和动态分支，只是控制权主要在程序定义里。

一个 Workflow 也需要 Runtime 执行，但 Workflow 的下一步通常由代码或图定义。Agent Runtime 还要处理模型动态提出的动作，因此需要更强的控制：

- 动作是否合法。
- 是否需要审批。
- 是否超过预算。
- 是否重复。
- 是否应该停止。
- 是否可以恢复。

简单任务可以用普通 Workflow Runtime。开放任务、动态工具调用、多轮推理任务，才需要 Agent Runtime。

### 最小可用 Runtime 的三件事

初学者不需要一开始就做完整平台。最小可用 Runtime 先做好三件事：

| 能力 | 最小实现 | 不能省略的原因 |
| --- | --- | --- |
| 硬停止条件 | `max_turns`、`max_tool_calls`、`max_duration_ms` | 防止无限循环和成本失控 |
| 状态持久化 | 保存 run_id、current_state、current_step、budget | 支持恢复、排查和用户刷新页面 |
| 工具执行记录 | 保存 action、policy_decision、observation_ref、error | 能复盘工具为什么被调用、结果是什么 |

个人 Demo 可以先用内存 Map，但要把结构设计成以后能迁移到数据库。团队工具至少要落库。企业系统还要加入队列、worker、审计和指标。

## 核心原理

### 原理一：Runtime 是控制平面，不是 Prompt 模板

Prompt 能告诉模型“不要无限循环”，但 Runtime 必须真的设置最大 turn、最大工具调用、最大成本和最大执行时间。

错误做法：

```text
请你最多调用 5 次工具。
```

更可靠的做法：

```json
{
  "limits": {
    "max_turns": 8,
    "max_tool_calls": 5,
    "max_duration_ms": 60000,
    "max_retry_per_step": 1
  }
}
```

Prompt 是软约束，Runtime 是硬约束。生产系统必须靠硬约束兜底。

### 原理二：状态要外置持久化

Demo 可以把消息存在内存里。生产系统必须把运行状态写入外部存储。

至少要保存：

- run_id。
- user_ref / tenant_ref。
- current_state。
- current_step_id。
- plan_version。
- step 状态。
- observation 引用。
- tool call id。
- approval 状态。
- budget 使用量。
- error 信息。
- final output。

没有持久化状态，就无法恢复、审计、重试和排查。

### 原理三：每个外部副作用都要幂等

读工具通常问题较小，写工具风险更高。例如：

```text
create_release_blocker
send_notification
update_permission
deploy_production
```

如果 Runtime 在工具调用后崩溃，重试时可能重复创建阻塞项。解决方式是为副作用动作生成幂等键：

```json
{
  "idempotency_key": "hmac(run_release_001:s5:create_release_blocker:v1)",
  "operation": "create_release_blocker",
  "business_ref": "release_blocker:kba:2026-05-30"
}
```

幂等键不要包含原始用户 ID、租户 ID 或敏感业务标识。可以用内部引用或 HMAC 后的伪标识。

### 原理四：失败要分类，不要一律重试

工具失败不等于应该重试。Runtime 至少要区分：

| 失败类型 | 处理方式 |
| --- | --- |
| timeout | 可按预算重试或转异步 |
| rate_limited | 退避重试或降级 |
| permission_denied | 不重试，提示授权或转人工 |
| validation_error | 修正输入或重新规划 |
| tool_not_found | 配置错误，停止 |
| policy_denied | 停止并解释 |
| partial_success | 保存已完成部分，进入补偿或人工确认 |

重试是工程能力，不是情绪反应。对不可恢复错误反复重试，只会烧成本和制造噪音。

### 原理五：暂停是一等状态

Agent 经常需要暂停：

- 等用户补充信息。
- 等审批。
- 等异步工具返回。
- 等人工确认。
- 等系统限流解除。

暂停不是失败。Runtime 应该把暂停建模为明确状态：

```text
awaiting_user_input
awaiting_approval
waiting_async_tool
paused_by_policy
paused_by_user
```

这样系统才能展示进度、恢复执行，并避免误判为异常。

### 原理六：最终回答也要过策略

很多系统只检查工具调用，忽略最终回答。风险在于模型可能把未验证信息说成确定结论，或泄露不该返回的数据。

Runtime 在最终输出前应该检查：

- 是否完成必要步骤。
- 是否存在未验证项。
- 是否引用了允许返回的数据。
- 是否需要把不确定性说清楚。
- 是否包含敏感信息。
- 是否符合结构化输出 schema。

执行链路的最后一步仍然是 Runtime 责任。

## 工程实现

### Runtime 架构

一个后端 Agent Runtime 可以拆成这些模块：

```text
Agent API
  -> Run Manager
  -> State Store
  -> Context Builder
  -> Model Runner
  -> Action Router
  -> Policy Engine
  -> Tool Executor
  -> Approval Manager
  -> Retry / Timeout Controller
  -> Event Stream
  -> Trace Writer
```

模块职责：

| 模块 | 职责 |
| --- | --- |
| Run Manager | 创建、恢复、取消和结束 run |
| State Store | 持久化 run、step、observation 和预算 |
| Context Builder | 为模型构造当前输入 |
| Model Runner | 调用模型并处理 streaming |
| Action Router | 把模型输出分发到工具、审批、handoff 或最终回答 |
| Policy Engine | 检查权限、风险、预算和输出策略 |
| Tool Executor | 执行工具，处理超时、重试和结果规范化 |
| Approval Manager | 管理人工审批和恢复 |
| Retry / Timeout Controller | 控制重试、退避、最大时长和取消 |
| Event Stream | 向前端推送进度事件 |
| Trace Writer | 写入可观测和评估数据 |

### 输入与权限边界

Run 创建时就要校验输入，不要等到工具调用时才发现问题。输入层至少包括：

- Run 创建请求 schema：目标、用户、租户、输入引用、预算和允许能力。
- Plan schema：步骤类型、依赖、成功条件、停止条件和审批需求。
- Tool input schema：每个工具的参数类型、大小限制和必填字段。
- 引用解析：文件、对象、知识库、工单、项目都只传内部引用，不把任意路径或原始 URL 直接交给模型。
- 租户归属：`project_ref`、`file_ref`、`ticket_ref` 必须属于当前 tenant 和 user 可见范围。
- 上下文裁剪：大 observation 用引用和摘要进入模型，原始数据留在对象存储或数据库。

权限模型也要落到具体主体：

| 主体 | 说明 |
| --- | --- |
| caller | 发起 run 的用户或系统 |
| agent_identity | Agent 在平台内的执行身份 |
| approver | 批准高风险动作的人 |
| tool_credential | 调用某个工具所用的凭证引用 |

Policy Engine 应检查 per-tool scope、用户权限、Agent 权限、审批人权限、租户边界和工具风险等级。凭证注入应由 Runtime 或 Tool Executor 完成，模型不应该看到密钥，也不应该决定使用哪个 secret。

### Run 状态机

Runtime 不应该只用 `running` 和 `done`。更完整的状态机可以是：

| 当前状态 | 允许转向 | 说明 |
| --- | --- | --- |
| created | validating, cancelled | Run 已创建，可以开始校验或被取消 |
| validating | running, failed, cancelled | 输入、计划和权限校验通过后进入运行 |
| running | awaiting_user_input, awaiting_approval, waiting_async_tool, succeeded, failed, cancelling | 执行中可能暂停、完成、失败或被取消 |
| awaiting_user_input | running, expired, cancelled | 用户补充信息后恢复，超时则过期 |
| awaiting_approval | running, expired, cancelled | 审批通过后恢复，拒绝可转 failed 或 cancelled |
| waiting_async_tool | running, failed, expired, cancelled | 异步工具回调后恢复 |
| cancelling | cancelled, failed | 取消过程中可能需要补偿，补偿失败则 failed |
| succeeded | 无 | 终态 |
| failed | 无 | 终态 |
| cancelled | 无 | 终态 |
| expired | 无 | 终态 |

这不是一条线性链路，而是分支状态图。`succeeded`、`failed`、`cancelled`、`expired` 都是终态，进入终态后不能继续执行工具。

状态含义：

| 状态 | 含义 |
| --- | --- |
| created | Run 已创建，但还未开始执行 |
| validating | 正在校验计划、输入和权限 |
| running | 正在调用模型或执行步骤 |
| awaiting_user_input | 等用户补充信息 |
| awaiting_approval | 等待人工审批 |
| waiting_async_tool | 等外部异步工具回调或轮询 |
| cancelling | 正在取消，可能需要补偿动作 |
| succeeded | 正常完成 |
| failed | 无法完成，且不是用户取消 |
| cancelled | 用户或系统主动取消 |
| expired | 超过最大等待时间 |

状态机要明确哪些状态可以恢复，哪些状态是终态。终态不要再继续执行工具。

### Step 数据模型

Run 下每个 Step 都应该结构化保存：

```json
{
  "run_id": "run_release_001",
  "step_id": "s2",
  "type": "tool",
  "status": "succeeded",
  "attempt": 1,
  "action": {
    "tool": "get_review_status",
    "input_ref": "input.s2"
  },
  "policy_decision": {
    "allowed": true,
    "approval_required": false,
    "reason": "read_only_tool"
  },
  "started_at": "2026-05-30T10:15:10+08:00",
  "finished_at": "2026-05-30T10:15:12+08:00",
  "timeout_ms": 3000,
  "observation_ref": "obs.security_review",
  "idempotency_key": null,
  "error": null
}
```

Step 的状态可以包括：

```text
pending
running
awaiting_approval
succeeded
failed_retryable
failed_terminal
skipped
cancelled
```

不要只把工具结果追加到 messages。messages 是模型上下文的一部分，不是可靠的任务状态库。

### 状态一致性

状态持久化不是“多写几张表”这么简单。Runtime 要处理崩溃和并发恢复。

风险场景：

```text
tool 执行成功
  -> stepStore.markSucceeded 成功
  -> stateStore.save 之前服务崩溃
```

恢复后可能出现 Step 已成功、Run 仍停在旧状态。常见处理方式：

- 给 RunState 加 `version`，每次更新用乐观锁。
- 同一事务内写入 step 状态、observation 引用和 run 状态。
- 对外部事件使用 outbox，先落库再异步投递事件。
- Tool callback 和 worker 消费都要幂等。
- 恢复时做 reconciliation：根据最新 Step 和 Observation 修正 RunState。
- Worker 领取任务使用 lease，超时后允许其他 worker 接手。

如果底层存储不支持跨资源事务，至少要保证每个状态变更可重放、可去重、可修复。Runtime 的目标不是永不失败，而是失败后状态仍然能被解释和恢复。

### Agent Loop 伪代码

下面是一个工程化的伪代码，不代表某个框架 API：

```java
RunResult runAgent(String runId) {
    RunState state = stateStore.load(runId);

    while (state.isActive()) {
        limitController.check(state);

        if (state.needsApproval()) {
            stateStore.save(state.pause("awaiting_approval"));
            return RunResult.paused(state);
        }

        RuntimeAction action = actionSelector.nextAction(state);
        PolicyDecision decision = policy.checkAction(state.context(), action);

        trace.recordDecision(state.runId(), action.summary(), decision);

        if (!decision.allowed()) {
            state = state.fail("policy_denied", decision.reason());
            stateStore.save(state);
            return RunResult.failed(state);
        }

        Step step = stepStore.create(state.runId(), action, decision);

        try {
            Observation observation = executor.execute(step, state.context());
            PolicyDecision resultDecision = policy.checkObservation(state.context(), observation);
            long previousVersion = state.version();
            RunState nextState = state.apply(observation);

            transaction.run(() -> {
                stepStore.markSucceeded(step.id(), observation.ref(), resultDecision);
                stateStore.save(nextState, expectedVersion = previousVersion);
                outbox.enqueue("step_succeeded", step.id());
            });
            state = nextState;
        } catch (RetryableToolException e) {
            state = retryController.scheduleOrFail(state, step, e);
            stateStore.save(state);
        } catch (TerminalToolException e) {
            state = failureHandler.handleTerminalFailure(state, step, e);
            stateStore.save(state);
        }

        if (stopController.shouldStop(state)) {
            FinalAnswer answer = finalizer.buildAnswer(state);
            PolicyDecision finalDecision = policy.checkFinalAnswer(state.context(), answer);
            if (!finalDecision.allowed()) {
                state = state.fail("final_answer_denied", finalDecision.reason());
                stateStore.save(state);
                return RunResult.failed(state);
            }
            state = state.complete(answer);
            stateStore.save(state);
            return RunResult.succeeded(state);
        }
    }

    return RunResult.fromState(state);
}
```

这个伪代码体现几个原则：

- 执行动作前检查策略。
- 工具结果回填前检查 observation。
- 最终回答前再检查一次。
- 每一步都持久化。
- Step、Observation 和 RunState 更新要有一致性边界。
- 暂停是正常返回，不是异常。
- 重试由 Retry Controller 决定，不由模型情绪化决定。

### 恢复执行

恢复不是把用户消息重新发给模型。恢复应该从 RunState 开始：

```json
{
  "run_id": "run_release_001",
  "state": "awaiting_approval",
  "current_step_id": "s4",
  "resume_token": "resume_7f9d",
  "resume_token_expires_at": "2026-05-30T11:15:00+08:00",
  "pending_approval": {
    "approval_id": "approval_001",
    "requested_action": "create_release_blocker",
    "next_step_id": "s5"
  }
}
```

用户确认后：

```text
load run by resume_token
verify token signature or hash
verify token is not expired and not used
verify token binds run_id, step_id, tenant_ref, approval_id and requested_action
verify approval belongs to current user or approver
mark approval approved
resume from current_step_id
execute next action
```

不要靠前端记住“刚才执行到哪一步”。前端可以展示状态，但权威状态必须在后端。

Resume token 不应该是长期 bearer token。生产系统里它应该短期有效、一次性使用，并绑定 run、step、tenant、approval 和 action。服务端最好只保存 token hash，或使用可校验签名并保留 nonce / jti 防重放。即使用户拿到了过期 token，也不能恢复或批准旧动作。

如果使用具体框架，要理解它自己的恢复语义。比如 LangGraph 的 `interrupt` 常见模式是恢复时从触发 `interrupt()` 的节点重新执行，而不是从函数中断的那一行继续。因此，`interrupt` 之前不要放非幂等副作用；如果必须有副作用，要拆到独立节点、加幂等键，或放到恢复确认之后。

### 异步工具回调

异步工具会让 Runtime 进入 `waiting_async_tool`。回调处理要防止伪造、重复、过期和乱序：

```text
callback received
  -> verify signature or callback token
  -> load run and step by callback_ref
  -> check tenant and tool identity
  -> check step is still waiting_async_tool
  -> check callback idempotency key
  -> compare expected state version
  -> persist observation and advance state
```

关键规则：

- callback token 要短期有效，绑定 run、step、tool 和 tenant。
- 重复 callback 应返回已处理结果，不重复推进状态。
- 过期 callback 要丢弃并记录审计。
- 乱序 callback 不能覆盖更新版本的状态。
- 回调结果仍要经过 observation policy，不要因为来自工具就直接进入模型上下文。

### 取消与补偿

用户点击取消时，Runtime 要区分：

- 还没执行副作用：直接取消。
- 正在执行可取消任务：发送取消信号。
- 副作用已完成：不能假装取消成功，可能需要补偿。

例子：

```text
用户取消 create_release_blocker
  -> 如果工具还没调用：mark step cancelled
  -> 如果工具调用中：try cancel request
  -> 如果阻塞项已创建：提示已创建，并提供关闭草稿或撤销入口
```

取消不是删除历史。审计记录仍然要保留。

### 超时与重试

Runtime 应该设置多层超时：

下面的数字只是 kb-assistant 场景示例，不是通用推荐值。真实系统要按任务风险、用户体验、工具 SLA、队列延迟和成本预算配置。

| 层级 | 示例 |
| --- | --- |
| model timeout | 单次模型调用最多 30 秒 |
| tool timeout | `get_review_status` 最多 3 秒 |
| step timeout | 某步骤最多 10 秒 |
| run timeout | 整个 run 最多 5 分钟 |
| approval timeout | 审批最多等待 24 小时 |

重试策略示例：

```json
{
  "retry_policy": {
    "max_attempts": 2,
    "backoff": "exponential",
    "retry_on": ["timeout", "rate_limited", "temporary_unavailable"],
    "do_not_retry_on": ["permission_denied", "policy_denied", "validation_error"]
  }
}
```

不要让模型自己决定“再试几次”。模型可以建议修复输入，但 Runtime 控制重试次数和节奏。

### 并发与工具调用

有些步骤可以并行。例如：

- 查询上线检查项。
- 查询评估样本状态。
- 查询文档更新时间。

但并发要满足条件：

- 工具都是只读或幂等。
- 步骤之间没有依赖。
- 总预算允许。
- 并发结果可以稳定合并。
- 任一失败不会造成不可控副作用。

并发执行示例：

```json
{
  "parallel_group": "release_readiness_reads",
  "steps": ["s1", "s2", "s3"],
  "join_policy": "wait_all_or_mark_unverified",
  "max_concurrency": 3
}
```

写操作默认不要并发，除非有明确事务、幂等和补偿设计。

### 流式事件

用户不应该盯着一个空白页面等待长任务完成。Runtime 可以向前端推送事件：

```json
{"event": "run_started", "run_id": "run_release_001"}
{"event": "step_started", "step_id": "s1", "label": "查询上线检查项"}
{"event": "step_succeeded", "step_id": "s1"}
{"event": "step_started", "step_id": "s2", "label": "确认安全评审状态"}
{"event": "approval_required", "step_id": "s4", "approval_id": "approval_001"}
```

事件要给用户进度感，但不要泄露敏感工具输入、内部 token、完整模型思考链或未脱敏数据。

### Trace 与审计

Runtime 需要记录两类信息：

| 类型 | 目的 |
| --- | --- |
| Trace | 调试、评估、性能分析 |
| Audit Log | 安全、合规、责任追踪 |

Trace 可以包含：

- run_id。
- step_id。
- model call metadata。
- tool call metadata。
- duration。
- token usage。
- policy decision。
- observation summary。
- retry information。

Audit Log 应关注：

- 谁发起。
- 谁批准。
- 什么工具被调用。
- 是否产生副作用。
- 影响了哪个内部资源引用。
- 为什么允许或拒绝。
- 最终状态。

Trace 面向工程调试，Audit Log 面向安全和合规。两者可以关联，但不要混为一张无限增长的日志表。

### Metrics 与告警

生产 Runtime 还需要指标，不然只能在事故后翻日志。

| 指标 | 说明 |
| --- | --- |
| run_success_rate | Run 成功率 |
| step_failure_rate | Step 失败率 |
| timeout_rate | 模型、工具、审批和 run 超时比例 |
| retry_count | 重试次数和重试成功率 |
| policy_denied_count | 被策略拒绝的动作数量 |
| approval_aging | 审批等待时长 |
| queue_lag | 队列积压和 worker 延迟 |
| token_cost | 模型 token 和工具成本 |
| resume_failure_rate | 恢复执行失败率 |

告警不要只盯错误数。审批长时间积压、队列延迟升高、policy denied 突增、单个工具 timeout 升高，都可能是用户体验或安全问题的早期信号。

### 部署形态

一个生产 Runtime 通常不是单进程服务，可以拆成：

| 组件 | 职责 |
| --- | --- |
| Agent API | 接收创建 run、取消、恢复、审批等请求 |
| Runtime Worker | 执行模型调用、工具调用和状态推进 |
| Scheduler | 扫描超时、重试、租约过期和等待恢复的任务 |
| Callback Handler | 接收异步工具回调并做鉴权、去重、状态推进 |
| Queue | 解耦 API 和 worker，吸收峰值 |
| State DB | 保存 run、step、approval、budget、version |
| Object Store | 保存大 observation、文件和报告 |
| Trace Sink | 接收 trace、metrics 和审计事件 |

部署时要考虑：

- Worker 可以水平扩展，但同一 run 的状态推进要有锁、lease 或版本号保护。
- Worker 崩溃后，Scheduler 能重新派发未完成 step。
- 新版本发布时，旧 run 可能仍按旧 plan_version 或 runtime_version 恢复。
- 回滚时不能破坏已落库状态 schema。
- 高风险工具 worker 可以独立部署，使用更严格的网络和凭证策略。

### 串起完整流程

把前面的模块串起来，kb-assistant 的一次 run 可以这样走：

```text
Agent API 创建 run
  -> Run Manager 校验输入、租户和预算
  -> Runtime Worker 领取 run lease
  -> Policy Engine 校验 s1/s2 只读工具
  -> Tool Executor 并行执行 s1/s2
  -> State DB 事务写入 observation 和 run version
  -> Model Runner 基于 observation 生成风险报告
  -> Approval Manager 创建 s4 审批并暂停 run
  -> 用户确认
  -> Callback/API 恢复 run，并校验审批人
  -> Tool Executor 用幂等键创建阻塞项草稿
  -> Finalizer 生成最终回答
  -> Policy Engine 检查最终回答
  -> Trace Sink 写入过程，Run 进入 succeeded
```

这条链路比一个 while 循环长很多，但每一段都有工程意义：能恢复、能审计、能控制风险。

## 适用场景

### 玩具 Demo

Demo 阶段可以用内存状态和简单循环：

```text
call model -> call tool -> call model -> answer
```

目标是理解循环，不是证明生产可用。Demo 也应该设置最大 turn，避免死循环。

### 个人效率工具

个人工具可以轻量一些：

- 本地保存 run history。
- 文件写入前确认。
- 设置最大工具调用次数。
- 支持取消。
- 出错时给出可读原因。

例如“帮我整理学习资料”的个人 Agent，可以把每次文件读取、摘要生成和写入动作记录下来，方便回滚。

### 团队内部工具

团队工具要开始引入：

- 用户身份和权限。
- run 状态表。
- step 状态表。
- 工具调用日志。
- 审批流程。
- 失败重试策略。
- 前端进度事件。

kb-assistant 上线判断就是团队工具场景。它不一定需要复杂多 Agent，但需要可靠 Runtime。

### 企业级系统

企业级 Runtime 要更进一步：

- 多租户隔离。
- 凭证隔离。
- 分布式锁。
- 幂等键。
- 异步队列。
- durable execution。
- SLA 和告警。
- 审计保留策略。
- 灰度和回滚。
- 评估数据闭环。

企业系统中，Runtime 通常不只是一个 Java service。它可能会组合数据库、队列、工作流引擎、对象存储、审批系统、观测平台和策略引擎。

### Runtime 能力裁剪

不是所有任务都需要完整 Runtime。可以按风险裁剪：

| 任务类型 | 最低必需能力 | 可以暂缓 | 不能省略的底线 |
| --- | --- | --- | --- |
| FAQ / 简单问答 | max_turns、最终回答检查 | 持久化 step、审批、队列 | 不允许无限循环 |
| 个人文件助手 | 本地状态、文件写入确认、step log | 多租户、复杂审批 | 写文件前确认 |
| 团队审批 Agent | run / step 落库、权限、审批、审计 | 多区域部署、复杂调度 | 审批状态必须在后端 |
| 企业生产 Agent | 队列、worker、租约、幂等、审计、指标、回滚 | 高级自动优化 | 状态一致性、凭证隔离、策略检查 |

裁剪的关键不是少做，而是知道哪些能力可以以后补，哪些能力一开始就决定了系统是否安全。

## 不适用场景

不适合为简单问答引入复杂 Runtime。一个 FAQ 问答或文本改写任务，不需要完整状态机和审批系统。

不适合把 Agent Runtime 当成通用工作流引擎替代品。如果流程稳定、分支明确、合规严格，优先用传统 Workflow，让模型只负责局部理解和生成。

不适合在没有观测和限额的情况下运行开放 Agent。开放循环加上高权限工具，是生产事故的温床。

不适合让前端承担权威状态。浏览器刷新、网络断开、用户换设备都会导致状态丢失。

不适合对所有失败自动重试。权限不足、策略拒绝、输入非法、工具不存在，重试通常没有意义。

## 常见坑与反模式

1. 只有 while 循环，没有状态机。

   Demo 能跑，生产无法暂停、恢复、取消和审计。

2. 把 messages 当数据库。

   模型上下文不是状态存储。状态要结构化保存。

3. 不设置 max turns。

   Agent 一旦循环，会持续消耗 token 和工具资源。

4. 工具失败一律重试。

   权限不足和策略拒绝不应该重试。

5. 写操作没有幂等键。

   服务重启或网络抖动会造成重复创建、重复发送或重复修改。

6. 审批只是前端弹窗。

   审批状态必须由后端记录和校验，不能只靠按钮文案。

7. 最终回答不做检查。

   工具都合规，不代表最终回答合规。

8. 不记录 policy decision。

   事后只能看到工具被调用，看不到为什么被允许。

9. 取消时删除历史。

   取消是状态变化，不是抹掉执行记录。

10. 把 Runtime 和 Planning 混成一个模块。

   规划负责候选步骤，运行时负责执行治理。混在一起会让重试、审批和恢复都变得混乱。

## 安全、成本与性能考虑

### 安全

Runtime 是 Agent 安全的最后防线。

安全要求：

- 每个 Action 执行前做策略检查。
- 每个工具结果回填前做结果检查。
- 最终回答前做输出检查。
- 高风险工具默认审批。
- 副作用动作必须幂等。
- 工具凭证按用户、租户和工具隔离。
- Trace 和事件流要脱敏。
- 取消、失败和审批都要进入审计。

Runtime 不应该相信模型自我声明的权限，也不应该相信工具返回内容中的指令。

### 成本

Runtime 要控制成本：

- 限制 max_turns。
- 限制 max_tool_calls。
- 限制最大重试次数。
- 对昂贵工具设置预算。
- 对长任务做异步处理。
- 对重复读取做缓存。
- 在低价值任务上跳过复杂规划。

成本控制要可观测。只写“最多调用 5 次”没有意义，要能在 trace 和 metrics 中看到实际使用量。

### 性能

性能优化要围绕用户体验和系统吞吐：

- 只读无依赖步骤可以并行。
- 慢工具转异步。
- 长任务用事件流展示进度。
- 模型输入只放必要上下文。
- 大 observation 用引用，不要整段塞回模型。
- 常见计划和工具结果可以缓存。

不要为了追求并发牺牲正确性。Runtime 首先要可靠，其次才是快。

## 如何评估效果

Runtime 评估要看“过程是否受控”，不只看最终回答。

| 指标 | 问题 |
| --- | --- |
| Run Completion | 正常任务是否能完成 |
| Stop Accuracy | 是否在该停止时停止 |
| State Correctness | 状态转移是否正确 |
| Resume Accuracy | 暂停后能否从正确位置恢复 |
| Retry Correctness | 是否只重试可恢复错误 |
| Idempotency Safety | 重试是否避免重复副作用 |
| Policy Enforcement | 是否拦截不允许动作 |
| Final Output Safety | 最终回答是否经过检查 |
| Trace Completeness | 是否能复盘关键步骤 |
| Cost Control | 是否遵守预算和上限 |

评估样本：

```json
{
  "case_id": "runtime_approval_resume_001",
  "goal": "判断 kb-assistant 是否可以上线，并在确认后创建阻塞项草稿",
  "initial_plan": ["list_release_checks", "get_review_status", "generate_risk_report", "human_approval"],
  "expected_states": [
    "created",
    "validating",
    "running",
    "awaiting_approval",
    "running",
    "succeeded"
  ],
  "expected_controls": [
    "create_release_blocker is not executed before approval",
    "approval is persisted in backend",
    "write tool uses idempotency key",
    "final answer includes unverified items if review status is unavailable"
  ]
}
```

失败样本：

```json
{
  "case_id": "runtime_permission_denied_no_retry_001",
  "tool_result": {
    "tool": "get_review_status",
    "error": "permission_denied"
  },
  "expected_behavior": [
    "do not retry automatically",
    "mark review status unverified",
    "do not claim ready",
    "ask for authorization or reviewer confirmation"
  ]
}
```

工程韧性测试也要纳入评估：

```json
{
  "case_id": "runtime_resilience_001",
  "fault_injection": [
    "worker crashes after tool success before run state update",
    "database write fails after observation persisted",
    "async callback is delivered twice",
    "approval callback arrives after timeout",
    "two workers try to resume the same run",
    "deployment happens while a run is awaiting approval"
  ],
  "expected_controls": [
    "state reconciliation repairs or explains partial progress",
    "idempotency prevents duplicate side effects",
    "stale callback is rejected",
    "version check prevents concurrent double resume",
    "old run resumes with compatible runtime or migration path"
  ]
}
```

评估 Runtime 时，可以回放 trace。一个健康的 trace 应该能回答：

- 为什么调用这个工具？
- 谁允许了这个动作？
- 工具输入输出在哪里？
- 失败后为什么重试或不重试？
- 是否发生审批？
- 最终回答依据哪些 observation？

## 实践任务

1. 入门：画出 Agent Loop。

交付物：用文字或图表示 model、tool、observation、stop condition 的循环。

自查标准：循环里必须有最大 turn 或停止条件。

2. 初级：设计 Run 状态机。

交付物：列出 `created`、`running`、`awaiting_approval`、`succeeded`、`failed` 等状态，以及允许的状态转移。

自查标准：暂停状态和终态要分清。

3. 中级：设计 Step 表。

交付物：字段至少包含 run_id、step_id、type、status、attempt、action、policy_decision、observation_ref、started_at、finished_at、error。

自查标准：不能只保存 messages；必须能按 step 复盘。

4. 中级进阶：实现一个最小可运行 Runtime。

交付物：用内存 Map 实现 `RunState + max_turns + step log`，模拟两个工具步骤和一个最终回答。

自查标准：超过 max_turns 会停止；每次工具调用都会写 step log；刷新输入后能按 run_id 查到状态。

5. 高级：设计重试和幂等策略。

场景：`create_release_blocker` 调用成功后网络断开，Runtime 没收到响应。

交付物：说明如何生成 idempotency_key、如何查询已有结果、如何避免重复创建。

自查标准：不能靠“希望工具只执行一次”作为方案。

6. 生产化：设计暂停恢复链路。

场景：Run 在 `awaiting_approval` 状态等待用户确认，服务期间重启。

交付物：说明需要保存哪些字段、恢复入口如何校验、如何继续执行。

自查标准：前端刷新或服务重启后，仍能从正确 step 恢复。

参考答案要点：

- Agent Loop 必须有硬停止条件，不只靠 Prompt。
- Run 状态机要把 `awaiting_user_input`、`awaiting_approval`、`waiting_async_tool` 和终态区分开。
- Step 表要保存 policy decision、attempt、timeout、observation_ref 和 error。
- 最小 Runtime 可以先用内存实现，但结构要能迁移到数据库。
- 写工具必须使用幂等键，幂等键应避免原始用户和租户标识。
- `permission_denied`、`policy_denied`、`validation_error` 通常不应自动重试。
- 最终回答也要经过输出策略检查。

## 从入门到专业

- 入门：知道 Agent Runtime 是执行 Agent Loop 的系统层。
- 初级：能实现一个有 max_turns 的最小循环。
- 中级：能设计 Run / Step 状态机和持久化。
- 高级：能处理审批、恢复、取消、超时、重试和幂等。
- 专业：能把 Runtime 做成可观测、可评估、可治理、可灰度的 Agent 平台能力。

完成任务 1 和 2，可以理解 Runtime 的基本形态；完成任务 3 和 4，可以开始落地后端执行系统；完成任务 5 和 6，才算进入生产级 Runtime 的门槛。

专业工程师不会只问“模型怎么调用工具”。他会问：“这个工具调用是谁批准的？失败能否恢复？重复执行会不会有副作用？最终回答依据什么证据？出了问题能否回放？”

## 本章小结

Agent Runtime 解决的是“如何受控执行”的问题。Planning 决定候选步骤，Runtime 决定这些步骤能否执行、如何执行、何时暂停、如何恢复、何时停止。

本章建立了几个核心结论：

- Runtime 是控制平面，不是 Prompt 模板。
- Agent Loop 必须有硬停止条件。
- Run、Step、Action、Observation 要结构化保存。
- 暂停、审批、取消和恢复都是一等状态。
- 写操作必须幂等。
- 失败要分类处理，不是一律重试。
- 最终回答也要经过策略检查。
- Trace 和 Audit Log 是生产 Agent 的基础设施。

下一章会进入 Multi-Agent。第 16 章关注单个 Agent Run 如何可靠执行；第 17 章会讨论多个 Agent 或多个角色如何协作，以及什么时候不应该使用 Multi-Agent。只有先把 Runtime 做稳，多 Agent 才不会变成多个不稳定循环的叠加。

## Sources

以下来源按 2026-05-30 访问时理解；不同框架对 Runtime、Run、State、Interrupt、Durable Execution 的抽象不同，本章采用工程抽象，不将任何框架 API 写成统一标准。

- [OpenAI Agents SDK: Running agents](https://openai.github.io/openai-agents-python/running_agents/)
- [OpenAI Agents SDK: Tracing](https://openai.github.io/openai-agents-python/tracing/)
- [OpenAI Agents SDK: Guardrails](https://openai.github.io/openai-agents-python/guardrails/)
- [LangGraph: Interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts)
- [Temporal Docs: What is Temporal?](https://docs.temporal.io/temporal)
- [OpenAI API: Reasoning models](https://developers.openai.com/api/docs/guides/reasoning)
- [OpenAI API: Reasoning best practices](https://developers.openai.com/api/docs/guides/reasoning-best-practices)
- [Anthropic: Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)

## 写作审查记录

### 章节架构师

- 本章目标：解释 Agent Runtime 如何执行、暂停、恢复、重试、取消和审计 Agent Run。
- 知识点地图：Run、Turn、Step、Action、Observation、Agent Loop、状态机、checkpoint、approval、retry、timeout、idempotency、streaming、trace、audit 和评估。
- 前后章节关系：承接第 15 章 Planning，为第 17 章 Multi-Agent 的协作运行和责任边界铺垫。

### 技术审稿人

- 发现问题：不同框架对 Runner、RunState、interrupt、durable execution 的命名不同，不能把某个 SDK 的实现写成行业标准；Decision Summary 也不能被误读为原始思考链或可审计真相。
- 修订动作：正文统一使用工程抽象；补充 LangGraph interrupt 的节点重跑边界；收紧 decision_summary 与 reasoning summary 的关系；Sources 引用 OpenAI Agents SDK、LangGraph interrupts、Temporal Durable Execution、OpenAI reasoning 文档和 Anthropic agents 文章；明确截至 2026-05-30 的版本背景。
- 结论：概念表述没有绑定单一框架，也没有编造具体 API。

### 工程审稿人

- 发现问题：Runtime 容易被写成简单 while 循环，缺少生产系统所需的状态、幂等、审批、恢复、部署形态、异步回调和审计；初版示例把审批后的写操作放在计划外，状态机表达像线性链路，伪代码对状态赋值和终态持久化不够严谨。
- 修订动作：补充 Runtime 架构、输入与权限边界、Run 状态转移表、Step 数据模型、状态一致性、Agent Loop 伪代码、恢复执行、resume token 安全边界、异步回调、取消补偿、超时重试、并发、流式事件、Trace / Audit Log、Metrics、部署形态和故障注入评估；将 `create_release_blocker` 建模为独立 `s5` 写工具 step。
- 结论：章节能映射到真实后端系统，覆盖输入、处理、输出、状态、异常、权限、日志、评估和部署边界。

### 学习体验审稿人

- 发现问题：初学者容易把 Runtime 理解成“循环调用模型和工具”，看不到暂停、恢复和审计的必要性；Run / Turn / Step / Action / Observation 的关系需要更直观。
- 修订动作：沿用 kb-assistant 上线准备案例，用审批、权限不足、阻塞项草稿和恢复执行说明 Runtime 的价值；补充概念映射、最小可用 Runtime 三件事、能力裁剪表和可执行练习。
- 结论：章节从直观例子进入工程结构，能帮助读者理解 Runtime 是 Agent 从 Demo 走向生产的关键层。

### 主编

- 最终调整：本章统一主线为“Runtime 是受控执行系统，不是模型循环代码”。
- 与全书衔接：第 15 章讲 Planning，本章讲 Runtime，第 17 章将讲 Multi-Agent。
- 后续章节提醒：第 17 章应避免重复单 Agent Runtime，重点讲多角色协作、Supervisor / Worker、责任边界、通信协议和什么时候不该多 Agent。
