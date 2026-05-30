# 第 29 章：未来趋势

## 本章解决什么问题

第 28 章讲 Java 工程师如何转 AI Agent。本章进入全书最后一个问题：

> AI Agent 接下来会往哪里走？工程师应该提前准备什么？

这类章节最容易写成空泛预测：

- Agent 会取代所有应用。
- 每个人都会有一个超级助手。
- 多 Agent 会自动组成公司。
- 所有软件都会变成自然语言交互。

这些说法听起来热闹，但对工程师帮助不大。工程师真正需要的是：

- 哪些趋势已经能看到工程形态？
- 哪些趋势还只是早期能力？
- 哪些能力值得现在投入？
- 哪些能力不应该过早追？
- 面对变化，什么底层能力最不容易过时？

本章不做“几年后一定怎样”的预测，而是按 2026-05-30 能看到的公开技术方向，抽象出几条对 Agent 工程师最重要的趋势：

1. 从 Chatbot 到 Agentic Workflow。
2. 从 API Tool 到 Computer Use。
3. 从文本 Agent 到多模态 Agent。
4. 从单应用 Agent 到 Agent 互操作。
5. 从业务 Demo 到 Agent Infra。
6. 从模型能力竞争到评估、治理和安全竞争。
7. 从“会用 AI”到“会设计人机协作系统”。

读完本章，读者应该能做到三件事：

- 看懂未来趋势背后的工程本质。
- 判断一个新概念是否值得投入。
- 给自己设计持续学习路线，而不是被每一个新名词牵着走。

## 一个直观例子

假设你已经做完本书前面的项目：

- 知识库问答 Agent。
- 企业工作流 Agent。
- 研究型 Agent。
- 代码开发 Agent。

现在团队问你：

```text
下一步我们应该做什么？
要不要做多 Agent？
要不要接 Computer Use？
要不要支持 MCP 和 A2A？
要不要做一个内部 Agent 平台？
```

不成熟的回答是：

```text
都做。因为这是趋势。
```

更专业的回答应该是：

```text
我们先按业务价值和工程风险分层：

1. 高频、规则清楚、可验证的流程，先做 Agentic Workflow。
2. 现有系统没有 API、只能通过 UI 操作的流程，再评估 Computer Use。
3. 涉及截图、语音、文档版式、视频片段的任务，才引入多模态能力。
4. 多个 Agent 或外部 Agent 要协作时，再评估 A2A；接内部工具和上下文时，优先规范 MCP / Tool Gateway。
5. 如果多个业务都在做 Agent，开始建设 Runtime、Trace、Eval、Policy、Cost、Sandbox 这些 Agent Infra。
6. 每一步都必须有 eval、approval、audit 和 rollback。
```

未来趋势不是“更炫的模型”，而是“更多真实系统边界被模型触碰”。越往后，越考验工程治理。

## 基础解释

### 趋势一：Agentic Workflow 会比“全自动 Agent”更早普及

Agentic Workflow 指的是：系统允许模型参与步骤选择、信息整理、工具调用和异常处理，但整体流程仍由明确的工作流、状态机、策略和人工审批约束。

它不是完全自治，也不是普通脚本。

```text
普通 Workflow：
  固定步骤，固定条件，固定执行。

Agentic Workflow：
  固定边界，动态判断，工具协作，状态可追踪。

完全自治 Agent：
  目标宽泛，步骤开放，风险更高。
```

为什么 Agentic Workflow 更容易落地？

- 企业流程本来就有审批、状态和责任人。
- 很多任务不是缺“自动执行”，而是缺“理解上下文”和“处理异常”。
- Workflow 更容易做权限、审计、回滚和评估。
- 用户更容易接受“人机协作”，而不是“黑箱自动做完”。

所以本书判断：在可治理、可审计、可评估的企业场景中，很多可落地的 Agent 产品更可能不是“一个万能机器人”，而是长得像：

```text
工作流系统 + 模型判断 + 工具调用 + 人工审批 + 可观测性
```

### 趋势二：Computer Use 可能补上“没有 API 的世界”

过去的工具调用主要依赖 API：

```text
模型 -> Tool Schema -> 后端 API -> 结果
```

但现实世界里，很多系统没有好用 API：

- 老旧后台。
- SaaS 管理台。
- 内部审批页面。
- 只能人工点选的报表系统。
- 需要看截图和表单状态的业务流程。

Computer Use 让模型可以基于屏幕截图理解界面，并提出点击、输入、滚动、截图等动作。它的价值不是“让模型像人一样上网”，而是让 Agent 能处理那些还没有被 API 化的工作。

但 Computer Use 的风险也更高：

- UI 状态容易变化。
- 点击错误可能产生副作用。
- 页面可能包含敏感数据。
- 登录态、会话和权限很难治理。
- 自动购买、删除、提交审批等动作需要人工确认。

所以 Computer Use 的生产形态应该是：

```text
隔离浏览器 / 容器
  -> domain allowlist
  -> action allowlist
  -> screenshot redaction
  -> human confirmation
  -> audit log
  -> replayable trace
```

它不是替代 Tool Gateway，而是 Tool Gateway 的一种特殊高风险工具。

### 趋势三：多模态 Agent 正在让“上下文”变宽

文本不是唯一上下文。

截至 2026-05-30 可以观察到的方向是：Agent 处理的上下文正在从纯文本扩展到更多输入类型，例如：

- 截图。
- PDF 版式。
- 表格。
- 图表。
- 音频。
- 视频片段。
- 代码 diff。
- UI 状态。
- 传感器数据。

多模态 Agent 的本质不是“模型能看图”，而是 Context Builder 的输入类型变多了：

```text
Text Context
  -> document chunks
  -> screenshots
  -> audio transcripts
  -> UI state
  -> structured data
  -> tool observations
```

这会带来新的工程问题：

- 图片和音频如何脱敏？
- 截图中的权限信息如何过滤？
- 视频片段如何切分和引用？
- 多模态 evidence 如何进入 eval？
- 模型引用一张图时，如何证明答案被图中区域支持？

也就是说，多模态不是只换模型，而是让 RAG、Trace、Eval、Policy 都要升级。

### 趋势四：Agent 互操作会变重要

第 12 章讲 MCP，它解决的是：

```text
Agent / Host 如何连接工具、资源和 Prompt。
```

随着 Agent 增多，还会出现另一个问题：

```text
一个 Agent 如何和另一个 Agent 协作？
```

例如：

- 研究 Agent 产出报告。
- 工作流 Agent 根据报告创建审批草稿。
- Coding Agent 根据审批要求修改代码。
- 运维 Agent 观察发布结果。

如果每个 Agent 都是孤岛，协作会变成一堆私有 API。Agent 互操作协议的方向，是让 Agent 能声明能力、交换任务状态、传递结构化产物，并在不暴露内部记忆和工具实现的情况下协作。

但要注意：互操作不等于随便互信。

生产系统需要：

- agent identity。
- capability registry。
- task contract。
- data classification。
- authorization scope。
- trace propagation。
- audit and policy decision。
- output validation。

Agent 之间越能协作，越需要清楚责任边界。

### 趋势五：Agent Infra 更可能成为核心竞争力

最早大家关注的是模型：

```text
哪个模型更强？
```

接着关注应用：

```text
怎么做一个 Agent Demo？
```

真正进入生产后，问题会变成：

```text
怎么让 20 个业务 Agent 稳定、安全、可评估、可回滚地运行？
```

这就是 Agent Infra。

它包括：

- Model Gateway。
- Context Builder。
- Tool Gateway。
- Runtime。
- State Store。
- Trace Store。
- Eval Harness。
- Policy Engine。
- Approval Service。
- Credential Broker。
- Sandbox。
- Cost Manager。
- Release Gate。
- Feedback Loop。

Agent Infra 的价值是复用治理能力，而不是让每个业务团队重复造一套脆弱的 Agent。

### 趋势六：评估和治理会变成产品能力

在传统软件里，测试、监控、安全常常是后台能力。

在 Agent 系统里，它们会变成产品能力的一部分。

用户会关心：

- 这个回答有没有来源？
- 这个动作为什么被拒绝？
- 这个任务卡在哪一步？
- 哪些信息是不确定的？
- 谁批准了这个写操作？
- 这次模型升级有没有让效果变差？

所以未来好的 Agent 产品，不只是“回答得好”，还要“解释得清、失败得体、可被审计”。

评估也不再只是离线 benchmark，而会进入日常发布流程：

```text
feedback -> eval case -> regression suite -> release gate -> canary -> monitoring -> rollback
```

### 趋势七：人机协作设计会变成硬能力

很多 Agent 失败，不是模型不够强，而是协作方式设计错了。

常见错误包括：

- 让 Agent 一次性做太多事。
- 不知道什么时候应该问人。
- 把审批做成形式化按钮。
- 用户看不到证据和状态。
- Agent 犯错后没有恢复路径。
- 用户不能纠正 Agent 的中间判断。

未来 Agent 工程师不仅要懂模型和后端，还要懂任务分解、用户心理、风险沟通和组织流程。

真正成熟的人机协作不是：

```text
用户下命令，Agent 自动做完。
```

而是：

```text
Agent 做可验证的部分。
系统暴露不确定性。
用户在关键点做判断。
运行时记录责任链。
反馈进入下一轮改进。
```

## 核心原理

### 原理一：趋势要落到边界，而不是名词

判断一个趋势是否重要，不要先看它的名字，而要问：

```text
它改变了哪个边界？
```

例如：

| 趋势 | 改变的边界 |
| --- | --- |
| Agentic Workflow | 模型从回答者变成流程参与者 |
| Computer Use | 工具从 API 扩展到 UI 操作 |
| 多模态 Agent | 上下文从文本扩展到图像、声音、屏幕和结构化对象 |
| MCP | 工具和资源接入从私有适配转向协议化 |
| A2A | Agent 协作从私有调用转向任务协议 |
| Agent Infra | 单个应用治理转向平台级治理 |
| EvalOps | 评估从一次性测试转向持续发布门禁 |

名词会变，边界变化更稳定。

### 原理二：能力越强，治理越要前置

越靠近真实系统的 Agent，越不能只靠 Prompt。

```text
回答问题：
  citation、unknown、content policy。

调用只读工具：
  permission、trace、tool result sanitization。

调用写工具：
  approval、idempotency、audit、rollback。

操作 UI：
  sandbox、allowlist、human confirmation、screen redaction。

跨 Agent 协作：
  identity、contract、trace propagation、data boundary。
```

未来趋势的共同点是：模型能触碰更多外部世界。工程师要做的是让每一次触碰都可控。

### 原理三：Agent 会更像分布式系统

生产 Agent 不只是一次模型调用，而是一个分布式运行过程：

```text
User Request
  -> API Gateway
  -> Runtime
  -> Model Gateway
  -> Context Service
  -> Tool Gateway
  -> External Systems
  -> Eval / Trace / Policy
  -> Human Approval
  -> Event Stream
```

它会遇到分布式系统熟悉的问题：

- 超时。
- 重试。
- 幂等。
- 部分失败。
- 状态恢复。
- 版本兼容。
- 事件乱序。
- 权限上下文传播。
- 成本归集。

所以越往未来，越不是“只会 Prompt 的人”能解决全部问题。后端、平台、SRE、安全、产品都会进入 Agent 工程。

### 原理四：未来不会只有一种 Agent 形态

不同任务适合不同形态：

| 任务类型 | 更适合的形态 |
| --- | --- |
| 简单问答 | Chatbot / RAG |
| 固定业务流程 | Workflow |
| 有异常处理的流程 | Agentic Workflow |
| 需要探索证据 | Research Agent |
| 需要修改代码 | Coding Agent |
| 没有 API 的 UI 操作 | Computer Use Agent |
| 跨系统协作 | Multi-Agent / A2A |
| 企业复用治理 | Agent Platform |

专业判断不是“都用 Agent”，而是知道什么时候不用 Agent。

## 工程实现

### 趋势雷达

团队可以用一个趋势雷达管理投入，而不是靠感觉追热点：

```json
{
  "trend_radar": {
    "as_of": "2026-05-30",
    "items": [
      {
        "name": "agentic_workflow",
        "maturity": "adopt_now",
        "reason": "业务流程清楚，状态和审批可治理",
        "scope": "团队内部可验证流程，不代表所有行业场景",
        "team_capability_required": [
          "run_state_machine",
          "tool_gateway",
          "approval_service",
          "trace_and_eval"
        ],
        "baseline_required": "manual_workflow_or_rule_workflow",
        "risk_gate": [
          "no_write_without_approval",
          "eval_suite_must_pass",
          "rollback_path_defined"
        ],
        "required_capabilities": ["runtime", "tool_gateway", "approval", "eval"],
        "avoid_until": []
      },
      {
        "name": "computer_use",
        "maturity": "pilot",
        "reason": "适合没有 API 的 UI 流程，但副作用风险高",
        "required_capabilities": ["sandbox", "domain_allowlist", "human_confirmation", "screen_trace"],
        "avoid_until": ["no_sandbox", "no_audit", "no_approval"]
      },
      {
        "name": "agent_to_agent",
        "maturity": "watch_and_pilot",
        "reason": "适合跨 Agent 协作，但身份、契约和审计要先成熟",
        "required_capabilities": ["agent_identity", "task_contract", "trace_propagation"],
        "avoid_until": ["single_agent_baseline_not_done"]
      }
    ]
  }
}
```

`maturity` 可以分成：

| 等级 | 含义 |
| --- | --- |
| watch | 观察，不投入生产 |
| learn | 做小实验，理解边界 |
| pilot | 做受控试点 |
| adopt_now | 在已满足团队能力、baseline 和 risk gate 的限定范围内，可进入团队项目 |
| platformize | 值得平台化复用 |
| avoid_for_now | 当前风险大于收益 |

这不是行业标准，是团队内部技术决策工具。

### Agentic Workflow 落地架构

一个可生产的 Agentic Workflow 可以这样设计：

```text
Workflow Template
  -> Runtime creates AgentRun
  -> Model proposes next step
  -> Step Validator checks contract
  -> Tool Gateway executes allowed tools
  -> Policy Engine blocks risky actions
  -> Approval Service pauses write steps
  -> Event Stream updates user
  -> Eval Harness checks regression
```

核心数据结构：

```json
{
  "agentic_workflow_template": {
    "template_id": "release_readiness_v4",
    "template_version": "4.2.0",
    "owner": "release-platform-team",
    "input_schema_ref": "schema:release_readiness_input:v4",
    "output_schema_ref": "schema:release_readiness_result:v4",
    "allowed_dynamic_steps": [
      "query_status",
      "summarize_evidence",
      "ask_clarification",
      "draft_blocker"
    ],
    "forbidden_steps": [
      "deploy_to_production",
      "delete_release_record"
    ],
    "approval_required_for": [
      "create_release_blocker",
      "notify_external_team"
    ],
    "stop_conditions": [
      "ready_with_evidence",
      "not_ready_with_blockers",
      "unknown_due_to_missing_evidence",
      "awaiting_approval"
    ],
    "state_transition_policy": "policy:release_agent_state_transitions:v4",
    "timeout_policy": {
      "step_timeout_ref": "timeout:release_agent_steps",
      "approval_timeout_ref": "timeout:human_approval"
    },
    "compensation_policy": {
      "on_partial_write": "manual_review_required",
      "compensatable_steps": ["notify_external_team"],
      "non_compensatable_steps": ["external_ticket_created"]
    },
    "eval_suite_id": "release_agent_regression"
  }
}
```

Agentic Workflow 的关键不是让模型自由发挥，而是允许它在安全边界内动态处理不确定性。

### Computer Use 落地架构

Computer Use 应该被当成高风险工具：

```text
Agent Runtime
  -> Computer Tool Gateway
  -> Isolated Browser / VM / Container
  -> Screenshot Capture
  -> Action Executor
  -> Policy / Confirmation
  -> Trace Replay Store
```

最小策略对象：

```json
{
  "computer_use_policy": {
    "policy_id": "browser_ops_policy_v1",
    "allowed_domains": ["internal.example.com"],
    "blocked_domains": ["billing.example.com"],
    "allowed_actions": ["screenshot", "click", "type", "scroll", "wait"],
    "field_allowlist": [
      "input[name='release_id']",
      "textarea[name='draft_reason']"
    ],
    "per_action_policy_check": true,
    "action_intent_required": true,
    "dry_run_mode": "default_on_for_write_like_flows",
    "before_after_screenshot_required": true,
    "confirmation_required_for": [
      "submit_form",
      "purchase",
      "delete",
      "send_message",
      "change_permission"
    ],
    "credential_isolation": "ephemeral_session_token",
    "no_persistent_session": true,
    "screenshot_redaction": "enabled",
    "session_ttl_minutes": 30,
    "network_zone": "isolated_browser",
    "record_replay": true
  }
}
```

Computer Use 适合先从“辅助用户操作”开始，而不是“无人值守操作生产系统”。

### 多模态上下文架构

多模态 Agent 的 Context Builder 需要记录来源和类型：

```json
{
  "context_item": {
    "context_item_id": "ctx_img_001",
    "type": "screenshot",
    "source_ref": "screen_snapshot_001",
    "raw_content_hash": "sha256:raw_before_redaction",
    "redacted_content_hash": "sha256:redacted_after_policy",
    "redaction_status": "redacted",
    "capture_time": "2026-05-30T17:59:30+08:00",
    "page_ref": "browser_page_001",
    "frame_ref": "main_frame",
    "ocr_text_ref": "ocr_snapshot_001",
    "vision_model_profile": "vision_checker_profile@2026-05-30",
    "data_classification": "internal",
    "allowed_for_model": true,
    "evidence_regions": [
      {
        "region_id": "release_status_panel",
        "bbox": {"x": 120, "y": 240, "width": 520, "height": 180},
        "ocr_text_ref": "ocr_span_009",
        "human_review_status": "not_required"
      }
    ],
    "expires_at": "2026-05-30T18:00:00+08:00"
  }
}
```

多模态 evidence 也要能进入 Citation Checker：

```json
{
  "citation": {
    "claim_id": "claim_001",
    "evidence_ref": "screen_snapshot_001#region:release_status_panel",
    "evidence_type": "image_region",
    "bbox": {"x": 120, "y": 240, "width": 520, "height": 180},
    "ocr_text_ref": "ocr_span_009",
    "capture_time": "2026-05-30T17:59:30+08:00",
    "source_page_ref": "browser_page_001",
    "support_verdict": "supported",
    "checker_version": "multimodal_citation_checker_v1",
    "vision_model_profile": "vision_checker_profile@2026-05-30",
    "human_review_status": "sampled_pending"
  }
}
```

否则多模态能力会变成“看起来更聪明，但更难验证”。

### Agent 互操作架构

跨 Agent 协作时，不要让 Agent 直接互相暴露全部上下文。更稳的方式是使用任务契约：

```json
{
  "agent_task_contract": {
    "task_id": "task_research_001",
    "tenant_ref": "tenant_a",
    "caller_agent": "workflow_agent",
    "target_agent": "research_agent",
    "requested_capability": "collect_release_risk_evidence",
    "input_refs": ["release_plan_ref_001"],
    "allowed_output_schema": "schema:research_brief:v2",
    "auth_audience": "research_agent",
    "delegation_scope": ["read_release_plan", "search_internal_docs"],
    "consent_ref": "consent_internal_research_task_001",
    "idempotency_key": "idem_agent_task_001",
    "data_retention_policy": "retain_refs_30d_no_raw_context",
    "output_provenance_required": true,
    "data_classification": "internal",
    "deadline": "2026-05-30T18:00:00+08:00",
    "trace_parent": "trace_001/span_004",
    "policy_decision_id": "policy_123"
  }
}
```

互操作的关键是：

- 不共享内部 chain-of-thought。
- 不共享不必要的原始上下文。
- 不把目标 Agent 的工具自动授予调用方。
- 不让外部 Agent 写入内部系统。
- 所有结果都按 schema 和 policy 校验。

### Agent Infra 分层

一个团队如果要平台化，可以按三层建设：

```text
Product Layer
  - 知识库 Agent
  - 工作流 Agent
  - 研究 Agent
  - Coding Agent

Agent Platform Layer
  - Runtime
  - Tool Registry
  - Context Builder
  - Eval Harness
  - Trace / Feedback
  - Policy / Approval

Infrastructure Layer
  - Model Gateway
  - Vector Store
  - Object Store
  - Secret Manager
  - Sandbox
  - Queue
  - Observability Backend
```

不要一开始就做大平台。平台应该从两个以上真实 Agent 的重复痛点中长出来。

### 未来能力路线图

工程师可以用这张路线图持续学习：

| 阶段 | 重点能力 | 可验证作品 |
| --- | --- | --- |
| 现在 | RAG、Tool、Runtime、Eval、安全 | 知识库 Agent、工作流 Agent |
| 短期 | Agentic Workflow、Computer Use 试点、多模态 evidence | UI 辅助 Agent、截图问答、发布检查流程 |
| 中期 | Agent 互操作、Agent Platform、持续评估 | 内部 Agent Registry、EvalOps、Trace Dashboard |
| 长期 | 组织流程再设计、人机协作系统、跨团队治理 | 多业务 Agent 平台、统一审批和审计 |

这里的短期、中期、长期不是精确年份，而是能力成熟顺序。

## 适用场景

### Agentic Workflow 适用场景

适合：

- 发布检查。
- 工单分流。
- 客服辅助。
- 合同初审。
- 运维事件处理。
- 数据分析报告。
- 内部审批材料整理。

共同特点：

- 有明确业务目标。
- 有可枚举状态。
- 有工具和数据来源。
- 有失败和审批路径。
- 可以建立 eval case。

### Computer Use 适用场景

适合：

- 没有 API 的内部系统。
- 需要跨多个网页后台整理信息。
- 用户希望 Agent 辅助填写表单草稿。
- 需要观察 UI 状态的测试和检查。

但最好先限定在：

- 只读。
- 草稿。
- 辅助操作。
- 人确认后提交。

### 多模态 Agent 适用场景

适合：

- 截图解释。
- PDF 表格理解。
- UI 测试。
- 图表问答。
- 语音会议总结。
- 代码 diff review。
- 发布检查中的日志截图和监控图分析。

多模态任务必须考虑 evidence 引用，否则很难判断模型是不是看错了。

### Agent Infra 适用场景

适合：

- 一个团队已经有多个 Agent。
- 多个 Agent 都需要工具权限。
- 多个 Agent 都需要 eval 和 trace。
- 安全、成本、审计成为共性问题。
- 多个业务线希望复用相同 Runtime。

不适合只有一个 Demo 时就开始做平台。

## 不适用场景

### 不适合追“万能 Agent”

万能 Agent 听起来诱人，但生产系统需要的是：

- 明确任务。
- 明确权限。
- 明确停止条件。
- 明确责任人。
- 明确回滚方式。

任务越宽泛，越难评估和治理。

### 不适合把 Computer Use 当默认路径

如果有稳定 API，优先用 API。

Computer Use 适合补 API 缺口，不适合作为所有工具调用的默认方式。UI 操作比 API 更脆弱，也更难做权限和幂等。

### 不适合过早多 Agent 化

如果一个 Agent 加工具和工作流就能解决，不要为了“趋势”拆成多个 Agent。

多 Agent 会增加：

- 协调成本。
- trace 复杂度。
- 延迟和成本。
- 责任归因难度。
- 权限传播风险。

### 不适合没有评估就做模型升级

未来模型会更快变化。越是模型进步快，越需要 release gate。

没有 eval 的模型升级，本质上是线上随机实验。

### 不适合忽略组织流程

很多 Agent 项目失败不是技术问题，而是组织流程没有准备好：

- 谁负责审批？
- 谁处理失败？
- 谁维护工具权限？
- 谁审核 eval case？
- 谁决定模型升级？
- 谁为成本负责？

没有这些答案，Agent 越强，风险越大。

## 常见坑与反模式

1. 把趋势当路线图。

   趋势只是候选方向，路线图要由业务价值、风险和团队能力决定。

2. 把 Agentic Workflow 写成 Prompt 链。

   生产 Workflow 必须有状态、策略、错误处理、审计和评估。

3. 把 Computer Use 当“万能浏览器”。

   它需要隔离环境、domain allowlist、动作白名单和人工确认。

4. 把多模态当模型能力。

   多模态还需要上下文治理、证据引用和脱敏。

5. 把 MCP / A2A 当安全边界。

   协议提供互操作方式，不自动提供业务权限、审批和审计。

6. 过早平台化。

   没有多个真实业务 Agent 的重复痛点，平台容易变成空架子。

7. 忽略成本。

   Agentic Workflow、多 Agent、Computer Use 和多模态都可能增加 token、工具、存储和延迟成本。

8. 只看成功案例。

   趋势判断必须看失败样本、边界条件和不可用场景。

9. 把人从流程里拿掉。

   很多高价值场景需要的是更好的人工判断点，而不是完全无人参与。

10. 没有版本意识。

   模型、协议、SDK、工具 schema、eval suite 都会变化。没有版本记录，就无法复盘。

## 安全、成本与性能考虑

### 安全

未来 Agent 的安全核心会从“输入过滤”扩展成“全链路治理”。

需要覆盖：

- Prompt injection。
- Tool injection。
- Cross-agent prompt contamination。
- Computer Use UI injection。
- Screenshot sensitive data exposure。
- OAuth token passthrough。
- MCP / A2A server allowlist。
- Credential scope。
- Human approval integrity。
- Audit immutability。

安全策略对象可以这样设计：

```json
{
  "future_agent_security_policy": {
    "agent_identity_required": true,
    "tool_call_policy": "backend_enforced",
    "computer_use": {
      "sandbox_required": true,
      "domain_allowlist_required": true,
      "confirmation_required_for_side_effect": true
    },
    "cross_agent": {
      "task_contract_required": true,
      "trace_propagation_required": true,
      "raw_context_sharing": "forbidden_by_default"
    },
    "multimodal": {
      "screenshot_redaction_required": true,
      "evidence_region_required_for_claims": true
    }
  }
}
```

### 成本

未来 Agent 成本会更复杂：

- 多轮模型调用。
- 长上下文。
- 多模态输入。
- 检索和重排。
- Computer Use 截图。
- 工具调用。
- sandbox 运行。
- trace 存储。
- eval 回归。
- 多 Agent 协作。

成本治理不能只看 token：

```json
{
  "cost_event": {
    "run_id": "run_001",
    "tenant_ref": "tenant_a",
    "agent_id": "workflow_agent",
    "cost_owner": "release-platform-team",
    "cost_dimension": [
      "model",
      "embedding",
      "rerank",
      "computer_use_session",
      "sandbox_runtime",
      "trace_storage",
      "eval_replay"
    ],
    "usage_source": "provider_usage_and_internal_metering",
    "pricing_version": "pricing_snapshot_2026_05_30",
    "estimated_cost": "0.42",
    "billed_cost": null,
    "currency": "USD",
    "budget_policy_id": "budget_policy_v2"
  }
}
```

### 性能

未来 Agent 性能瓶颈不只在模型：

- Context Builder 太慢。
- 检索链路太长。
- 多 Agent 往返太多。
- Computer Use 截图和动作循环慢。
- 工具系统排队。
- 审批等待。
- trace 写入阻塞主流程。

性能优化要先分解：

| 延迟来源 | 优化方向 |
| --- | --- |
| 模型调用 | model routing、streaming、response schema、cache |
| 检索 | metadata filter、hybrid search、rerank 控制 |
| 工具 | timeout、parallel safe tools、circuit breaker |
| Computer Use | action batching、screenshot-first、DOM harness |
| 多 Agent | 减少 handoff、合并任务、明确 contract |
| 审批 | 草稿优先、异步通知、resume token |

不要为了追求自动化，把用户等待时间变成黑箱。

## 如何评估效果

### 趋势评估不是看演示效果

一个趋势是否值得采用，要看四类指标：

| 维度 | 问题 |
| --- | --- |
| 业务价值 | 是否减少真实时间、错误或沟通成本？ |
| 可验证性 | 是否有 eval case、trace 和失败复现？ |
| 风险控制 | 是否有权限、审批、审计和回滚？ |
| 运营成本 | 是否能接受延迟、成本、维护复杂度？ |

### 趋势试点评估模板

```json
{
  "trend_pilot_eval": {
    "trend": "computer_use",
    "use_case": "internal_form_draft_assistant",
    "baseline": "manual_form_filling",
    "success_metrics": [
      "draft_accuracy",
      "user_correction_rate",
      "policy_violation_rate",
      "completion_time",
      "human_confirmation_compliance"
    ],
    "must_pass_cases": [
      "do_not_submit_without_confirmation",
      "block_unallowed_domain",
      "redact_sensitive_screenshot",
      "recover_when_ui_changed",
      "write_replayable_trace"
    ],
    "stop_conditions": [
      "policy_violation",
      "unbounded_cost",
      "cannot_replay_failure",
      "user_trust_drop"
    ]
  }
}
```

### Agent Infra 成熟度评估

| 等级 | 特征 | 晋级门槛 |
| --- | --- | --- |
| L1 Demo | 单 Agent，手工 prompt，没有 eval | 能演示主流程，但不承诺生产使用 |
| L2 App | 有工具和 RAG，但治理分散 | 至少有 1 个团队内真实 Agent；有基础 trace、权限过滤和失败样本 |
| L3 Managed Agent | 有 Runtime、Trace、Policy、Eval | 有统一 run / step 状态、release gate、audit log、成本归集和事故复盘模板 |
| L4 Agent Platform | 多 Agent 复用 Tool Gateway、Eval、Cost、Approval | 至少 2 个以上生产 Agent 复用统一 Tool Registry、Policy、Eval Harness、Approval 和 Cost Dashboard |
| L5 Agent Operating Model | 技术、流程、审批、反馈和组织责任形成闭环 | 有跨团队治理机制、审计留存策略、模型 / 工具版本发布流程、反馈到 eval 的闭环和定期复盘 |

这不是行业标准，是本书的工程成熟度视角。

### 未来能力自评问题

你可以定期问自己：

- 我能不能判断什么时候不用 Agent？
- 我能不能把一个趋势拆成数据流、状态和权限？
- 我能不能给 Computer Use 设计安全边界？
- 我能不能让多模态答案带证据？
- 我能不能让多个 Agent 在不共享内部状态的情况下协作？
- 我能不能用 eval gate 阻止一次坏的模型升级？
- 我能不能把一次线上失败变成可复现 eval case？

如果答案越来越多是“能”，说明你不是在追热点，而是在建立长期能力。

## 实践任务

1. 入门：做趋势拆解表。

交付物：选 5 个趋势，写出它们改变了哪个工程边界。

自查标准：不能只写名词，必须写出数据流、状态、权限或评估变化。

2. 初级：设计一个 Agentic Workflow。

交付物：为 `kb-assistant` 设计一个发布检查 workflow template。

自查标准：必须包含 allowed steps、forbidden steps、approval、stop condition、eval suite。

3. 中级：设计 Computer Use 安全策略。

交付物：写一个 `computer_use_policy`，限定域名、动作、确认规则、截图脱敏和 trace。

自查标准：不能允许自动提交高风险操作；必须有 human confirmation。

4. 高级：设计多模态 evidence schema。

交付物：为截图、PDF 表格或监控图设计 evidence ref 和 citation checker。

自查标准：答案中的关键 claim 必须能指向 evidence region。

5. 专业：设计 Agent Infra 路线图。

交付物：给一个团队设计 6 个月 Agent Infra 演进计划。

自查标准：必须说明哪些能力现在做、哪些能力观察、哪些能力暂不做；必须包含 eval、trace、policy、cost 和 release gate。

参考答案要点：

- 趋势判断要回到工程边界，而不是追名词。
- Agentic Workflow 通常比完全自治 Agent 更早落地。
- Computer Use 是高风险工具，优先用于没有 API 的场景。
- 多模态 Agent 的关键是 evidence、脱敏和评估。
- MCP / A2A 是互操作方向，不自动解决权限和治理。
- Agent Infra 应该从真实重复痛点中长出来。

## 从入门到专业

- 入门：知道 Agent 未来趋势有哪些，不把所有趋势混成“万能 Agent”。
- 初级：能解释 Agentic Workflow、Computer Use、多模态、MCP、A2A、Agent Infra 的区别。
- 中级：能为一个趋势设计最小试点，包括范围、权限、eval 和 trace。
- 高级：能判断哪些趋势适合当前团队，哪些应该延后。
- 专业：能建设长期 Agent 能力体系，让团队不被模型和框架变化牵着走。

专业工程师看趋势，不是问：

```text
这个概念火不火？
```

而是问：

```text
它解决什么真实问题？
它改变什么系统边界？
它需要什么治理能力？
我们有没有验证它的办法？
失败时能不能恢复？
```

## 本章小结

本书的判断是：AI Agent 不会只是一种产品形态。在截至 2026-05-30 可观察到的方向里，它正在工作流、代码开发、研究、知识库、UI 自动化、多模态理解和企业平台中分别形成不同工程形态。

本章建立了几个判断：

- 在可治理场景中，Agentic Workflow 比完全自治 Agent 更可能先进入生产。
- Computer Use 可能扩展 Agent 能触达的系统，但必须被当成高风险工具治理。
- 多模态 Agent 正在让上下文、证据、评估和安全一起升级。
- MCP 和 A2A 代表互操作方向，但协议不是治理系统。
- Agent Infra 更可能成为团队长期能力，而不是某个 Demo 的附属品。
- 评估、安全、成本和人机协作设计的重要性正在上升。

对读者来说，最重要的不是记住每个趋势名词，而是建立一套稳定判断框架：

```text
趋势 -> 工程边界 -> 风险 -> 评估 -> 治理 -> 能力路线
```

这本书到这里，已经从基础概念、Prompt、RAG、Tool、MCP、Runtime、安全、成本、项目实战，走到了能力模型和未来趋势。后续如果继续扩写，可以进入附录：术语表、架构模板、评估样本库、Java 项目脚手架、Agent 平台检查清单。

## Sources

以下来源按 2026-05-30 访问时理解；Agent、Computer Use、MCP、A2A、SDK 和平台能力变化很快，本章只抽象工程趋势，不把任何供应商能力写成永久标准。

- [OpenAI API: Agents](https://developers.openai.com/api/docs/guides/agents)
- [OpenAI API: Computer use](https://developers.openai.com/api/docs/guides/tools-computer-use)
- [OpenAI Agents SDK: Running agents](https://openai.github.io/openai-agents-python/running_agents/)
- [OpenAI Agents SDK: Guardrails](https://openai.github.io/openai-agents-python/guardrails/)
- [Anthropic: Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)
- [Model Context Protocol Specification 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25)
- [A2A Protocol Specification](https://a2a-protocol.org/latest/specification/)

## 写作审查记录

### 章节架构师

- 本章目标：在第 27、28 章能力路线之后，帮助读者判断 Agent 未来趋势，而不是追逐名词。
- 知识点地图：Agentic Workflow、Computer Use、多模态 Agent、MCP / A2A、Agent Infra、EvalOps、安全治理、人机协作和趋势评估。
- 前后章节关系：承接第 28 章个人转型路线，作为全书正文收束，给后续附录和项目模板留下扩展空间。

### 技术审稿人

- 发现问题：未来趋势容易写成无来源预测，尤其是把协议、SDK、Computer Use 和多模态能力写成确定的长期事实；初稿中部分“未来会”表达仍偏确定。
- 修订动作：基于 OpenAI Agents / Computer Use / Agents SDK、Anthropic effective agents、MCP 2025-11-25、A2A specification 的公开资料，统一标注 2026-05-30 时间背景；把确定预测改为“本书判断”“可观察方向”“在可治理场景中更可能”；不写无来源性能数字和采用率。
- 结论：章节把趋势写成工程方向和判断框架，没有把供应商能力夸大成行业定论。

### 工程审稿人

- 发现问题：趋势章节如果只讲方向，读者无法落到真实系统；Computer Use、多模态 evidence、跨 Agent contract 和成本治理需要更生产化字段。
- 修订动作：补充趋势雷达的 scope / baseline / risk gate；补强 Agentic Workflow version、schema、state transition、timeout 和 compensation；补强 Computer Use per-action policy、dry-run、截图前后对比、凭证隔离；补强多模态 bbox、OCR、hash、人工复核；补强跨 Agent audience、delegation scope、consent、retention 和 provenance；补成本金额、计价版本和成熟度晋级门槛。
- 结论：章节能指导团队把趋势拆成数据流、状态、权限、评估和治理能力。

### 学习体验审稿人

- 发现问题：初学者容易把 Agentic Workflow、Computer Use、多模态、MCP、A2A、Agent Infra 混在一起。
- 修订动作：用直观例子、对比表、适用 / 不适用场景和实践任务逐层解释，并反复强调“趋势要回到工程边界”。
- 结论：章节能帮助读者建立长期判断力，而不是被新名词牵着走。

### 主编

- 最终调整：本章统一主线为“未来趋势不是预测热闹，而是识别工程边界的变化”。
- 与全书衔接：前 28 章已经覆盖基础、工程和项目，本章作为正文收束，提醒读者把能力沉淀为持续演进的方法。
- 后续章节提醒：如继续扩展，建议进入附录和模板，而不是再追加泛化趋势章节。
