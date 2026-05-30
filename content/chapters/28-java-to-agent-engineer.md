# 第 28 章：Java 工程师如何转 AI Agent

## 本章解决什么问题

第 27 章给出了通用的 AI Agent 工程师能力模型。本章把它具体映射到一类读者：

> Java / Spring / 后端工程师。

Java 工程师转 AI Agent，有很大的优势，也有很容易忽略的短板。

优势是：

- 熟悉后端服务。
- 熟悉 API、数据库、事务、队列、缓存。
- 熟悉权限、审计、日志、监控。
- 熟悉工程协作、测试、CI/CD。
- 熟悉复杂业务系统。

短板通常是：

- 不熟悉模型的不确定性。
- 容易把 Prompt 当配置。
- 容易把 RAG 当“向量库查询”。
- 容易把 Function Calling 当普通 RPC。
- 不熟悉 eval dataset 和 trace grading。
- 不熟悉 Agent 的上下文污染、工具误用和 unknown 处理。

本章要回答：

- Java 工程师已有能力如何迁移到 Agent 工程？
- Spring / 事务 / 队列 / 权限 / 观测分别对应 Agent 系统的哪些部分？
- Java 工程师需要补哪些 AI 能力？
- 30 天、60 天、90 天可以怎么学？
- 如何把已有 Java 项目改造成 Agent 项目？
- 作品集应该怎么设计？
- 面试时如何表达自己的转型优势？

截至 2026-05-30，Spring AI 官方文档提供面向 Spring 生态的 AI 应用抽象；LangChain4j 提供 Java 生态下的 AI Services、Tools、RAG 等能力；OpenAI 官方 Java SDK 提供从 Java 应用访问 OpenAI API 的方式；Spring Boot 文档提供 observability、actuator、生产化后端能力。框架版本和 API 会变化，本章采用工程抽象，不把任何 Java AI 框架写成唯一路线。

读完本章，Java 工程师应该能明确：自己已有后端能力不是过时了，而是可以迁移到 Agent Runtime、Tool Gateway、Eval Harness、安全治理和生产平台；真正要补的是模型、上下文、RAG、工具治理和评估闭环。

## 一个直观例子

一个 Java 工程师已经会做这样的系统：

```text
Spring Boot REST API
  -> Service
  -> Repository
  -> MySQL
  -> Redis Cache
  -> MQ
  -> Actuator / Metrics / Logs
  -> RBAC / Audit
```

他想转 AI Agent，第一反应可能是：

```text
我接一个 OpenAI API，再加一个聊天页面。
```

这能跑，但不够像 Agent 工程。

更好的迁移方式是：

```text
Spring Boot REST API
  -> Agent Run API
  -> Context Builder
  -> Model Gateway
  -> Tool Gateway
  -> Policy Engine
  -> Approval Service
  -> State Store
  -> Trace / Eval
  -> Cost Attribution
```

也就是说，Java 工程师不是要丢掉后端经验，而是把熟悉的工程能力换一个对象：

- Service 变成 Agent Runtime。
- Repository 变成 State Store / Trace Store。
- RBAC 变成 Tool Policy / Resource Policy。
- MQ 变成异步 run / step 调度。
- Actuator / Micrometer 变成 Agent observability。
- 单元测试变成 eval case + integration test。
- 事务和幂等变成工具执行安全。

从这个角度看，Java 工程师转 Agent，不是“从零开始”，而是“把后端能力迁移到模型驱动系统”。

## 基础解释

### Java 工程师的优势

Java / Spring 工程师天然熟悉很多 Agent 生产化必需能力：

| Java 后端能力 | Agent 系统中的价值 |
| --- | --- |
| API 设计 | Agent Run API、Tool API、Eval API |
| Service 分层 | Runtime、Gateway、Policy、Context 分层 |
| 事务和幂等 | 写工具安全执行、审批后执行 |
| 权限系统 | Tool Policy、tenant isolation、resource scope |
| MQ / Scheduler | 异步 run、后台 eval、embedding job |
| 缓存 | RAG cache、tool result cache、prompt cache |
| 日志 / 监控 | trace、metrics、audit |
| 测试 | eval、回归样本、CI |
| CI/CD | Agent release gate、prompt / tool 版本发布 |
| 复杂业务理解 | 判断哪些地方该用 Agent，哪些不该用 |

这就是 Java 工程师的起点优势。

### Java 工程师需要补什么

主要补四类：

1. 模型和上下文。

要理解 token、上下文窗口、system / developer / user 指令、结构化输出、幻觉、unknown。

2. RAG 和知识治理。

要理解文档解析、chunk、embedding、检索、rerank、citation、权限过滤、freshness eval。

3. Tool / Agent Runtime。

要理解 tool schema、tool result、function calling、MCP、plan、run、step、stop condition、approval。

4. Eval 和安全。

要理解 eval dataset、trace、feedback、prompt injection、tool injection、approval、audit、cost attribution。

这些能力不是替代 Java，而是叠加在 Java 后端之上。

### 不要陷入两个误区

第一个误区：只学框架。

```text
我会 Spring AI / LangChain4j，所以我会 Agent。
```

框架能加速开发，但不能替你设计权限、评估、审计和失败处理。

第二个误区：只学模型。

```text
我懂大模型原理，所以我能做 Agent。
```

模型理解很重要，但企业系统还需要 API、状态、权限、队列、可观测性、部署和治理。

正确路线是：用 Java 后端能力承载 Agent，用 AI 能力扩展后端系统。

## 核心原理

### 原理一：把 Agent 看成后端系统的一种新业务对象

Java 工程师熟悉 Order、User、Task、Workflow。现在多一个对象：

```json
{
  "agent_run": {
    "run_id": "run_001",
    "agent_id": "kb_assistant",
    "tenant_ref": "tenant_a",
    "user_ref": "user_pseudo_123",
    "status": "running",
    "context_ref": "context_001",
    "trace_id": "trace_001"
  }
}
```

它也需要：

- 状态。
- 生命周期。
- 权限。
- 日志。
- 事务。
- 幂等。
- 监控。
- 回滚。

Agent 不是魔法，它是一个带模型调用和工具调用的业务运行对象。

### 原理二：把模型调用包进 Model Gateway

不要在业务代码里到处直接调用模型。Java 工程师应该很自然地想到 Gateway：

```text
业务 Service
  -> Model Gateway
  -> Provider Client
```

Model Gateway 负责：

- model profile。
- provider selection。
- timeout。
- retry。
- token / cost 记录。
- sensitive data policy。
- trace span。
- fallback。
- rate limit。

这和你以前封装支付网关、短信网关、对象存储网关是同一类工程思路。

一个生产级 Model Gateway 至少要留下这些字段，方便排查、计费和回滚：

```json
{
  "model_call_record": {
    "call_id": "model_call_001",
    "run_id": "run_001",
    "provider": "openai",
    "provider_request_id": "req_external_ref",
    "model_profile": "reasoning_balanced",
    "model_profile_version": "2026-05-30.1",
    "response_schema_ref": "schema:answer_with_citations:v3",
    "usage_source": "provider_usage",
    "pricing_version": "pricing_snapshot_2026_05_30",
    "sensitive_data_policy": "refs_only_no_raw_secret",
    "fallback_reason": null,
    "trace_span_id": "span_model_001"
  }
}
```

这些不是某个 Java SDK 的固定字段，而是后端系统应该自己治理的记录。尤其是 `provider_request_id`、`model_profile_version`、`usage_source` 和 `pricing_version`，能帮助你在模型升级、账单变化和线上异常时复盘。

### 原理三：把工具调用包进 Tool Gateway

Function Calling 不是让模型直接调用 Java Service。

更好的结构：

```text
Model proposes tool call
  -> Tool Gateway validates schema
  -> Policy Engine checks user / agent / resource
  -> Credential Broker injects credential
  -> Java Service executes
  -> Tool result sanitized
  -> Observation returns to Agent
```

Java 工程师熟悉 Controller / Service / Repository，但 Agent 工具还要多一层：

- 模型可见 schema。
- 后端执行 schema。
- 权限策略。
- 结果脱敏。
- 工具注入防护。
- 审计。

Java 侧可以把工具调用收敛到一个接口。下面是伪代码，不是 Spring AI、LangChain4j 或 OpenAI Java SDK 的真实 API：

```java
class ToolGateway {
  ToolResult invoke(ToolRequest request, RunContext context) {
    schemaValidator.validate(request.toolName(), request.arguments());

    PolicyDecision decision = policyService.checkToolCall(
        context.tenantRef(),
        context.userRef(),
        context.agentId(),
        request.toolName(),
        request.resourceRefs(),
        request.sideEffectLevel());

    auditService.writePolicyDecision(context.runId(), decision);

    if (decision.denied()) {
      return ToolResult.denied(decision.reasonCode());
    }

    if (decision.requiresApproval()) {
      Approval approval = approvalService.createPendingApproval(
          context.runId(),
          request.toolName(),
          request.argumentsHash(),
          decision.policyDecisionId());
      return ToolResult.awaitingApproval(approval.approvalId());
    }

    IdempotencyRecord idem = idempotencyService.reserveOrLoad(
        context.runId(),
        request.toolName(),
        request.idempotencyKey());

    if (idem.succeeded()) {
      return toolResultStore.load(idem.resultRef());
    }

    Credential credential = credentialBroker.issueScopedCredential(decision);
    ToolResult raw = toolAdapter.invoke(request, credential);
    ToolResult sanitized = resultSanitizer.sanitize(raw, decision.outputPolicy());

    toolResultStore.save(idem.id(), sanitized);
    auditService.writeToolResult(context.runId(), request.toolName(), sanitized.status());
    return sanitized;
  }
}
```

这个接口的价值不是“代码漂亮”，而是把 schema、权限、审批、幂等、凭证和审计全部关进后端边界里。

### 原理四：把 eval 当成新型测试

Java 工程师熟悉：

- unit test。
- integration test。
- contract test。
- regression test。

Agent 还需要 eval：

```json
{
  "eval_case": {
    "case_id": "permission_denied_should_not_mark_ready",
    "input": "kb-assistant 今天能上线吗？",
    "mock_tool_results": {
      "get_review_status": "permission_denied"
    },
    "expected_behavior": [
      "do_not_mark_ready",
      "mark_security_review_unknown",
      "write_audit_log"
    ]
  }
}
```

Eval 不是替代测试，而是补充测试无法覆盖的模型行为和过程行为。

### 原理五：把 Prompt 当配置，但不要只当配置

Prompt 可以版本化：

```json
{
  "prompt_profile": {
    "prompt_id": "release_readiness_prompt",
    "version": "v7",
    "output_schema_ref": "schema.release_answer.v3",
    "eval_suite": "eval.release_readiness.core",
    "release_gate": "must_not_regress"
  }
}
```

但 Prompt 不是普通配置文件。改 Prompt 可能改变系统行为，必须：

- 版本化。
- 评估。
- 灰度。
- 回滚。
- 记录 trace。

### 原理六：把 unknown 当产品能力

传统后端里，接口一般成功或失败。Agent 系统里还要有：

```text
unknown
partially_answered
needs_approval
permission_denied
insufficient_evidence
```

Java 工程师转 Agent，要学会设计“不确定状态”。

例如上线判断：

```json
{
  "answer_type": "partially_answered",
  "known_items": ["回归样本通过"],
  "unknown_items": ["安全评审状态不可确认"],
  "final_decision": "not_ready_to_claim"
}
```

这不是模型不够聪明，而是系统更诚实。

## 工程实现

### Java 技术栈映射

一个 Java Agent 后端可以这样拆：

```text
Spring Boot API
  -> AgentRunController
  -> AgentRuntimeService
  -> ContextBuilder
  -> ModelGateway
  -> ToolGateway
  -> PolicyService
  -> ApprovalService
  -> EvalService
  -> TraceService
  -> Repositories
```

不要从第一天就上复杂平台。先把边界划清楚。

### 核心数据模型

Java 工程师落地 Agent 项目时，最好先把数据模型定住。下面是最小字段示例，具体实现可以用 JPA、MyBatis 或普通 SQL，但语义边界要清楚：

```json
{
  "AgentRun": {
    "run_id": "run_001",
    "tenant_ref": "tenant_a",
    "user_ref": "user_pseudo_123",
    "agent_id": "kb_assistant",
    "agent_version": "v1.4.0",
    "status": "running",
    "input_ref": "input_001",
    "model_profile_version": "reasoning_balanced@2026-05-30.1",
    "tool_registry_version": "tools@42",
    "trace_id": "trace_001",
    "created_at": "2026-05-30T10:00:00+08:00",
    "updated_at": "2026-05-30T10:00:03+08:00"
  },
  "AgentStep": {
    "step_id": "step_001",
    "run_id": "run_001",
    "step_type": "tool_call",
    "status": "succeeded",
    "depends_on": ["step_000"],
    "tool_invocation_id": "tool_inv_001",
    "output_ref": "obs_001",
    "retry_count": 0,
    "started_at": "2026-05-30T10:00:01+08:00",
    "finished_at": "2026-05-30T10:00:02+08:00"
  },
  "ToolInvocation": {
    "tool_invocation_id": "tool_inv_001",
    "run_id": "run_001",
    "tool_name": "list_release_checks",
    "tool_version": "v3",
    "side_effect_level": "read",
    "policy_decision_id": "policy_001",
    "approval_id": null,
    "idempotency_key": "idem_ref_001",
    "input_hash": "sha256:...",
    "result_ref": "tool_result_001",
    "status": "succeeded"
  },
  "EvalCase": {
    "case_id": "permission_denied_should_be_unknown",
    "suite_id": "kb_core",
    "input_ref": "eval_input_001",
    "expected_behavior": ["do_not_mark_ready", "show_unknown"],
    "required_trace_events": ["permission_denied", "final_unknown"],
    "risk_tags": ["tenant_isolation", "rag"],
    "last_result": "passed"
  },
  "TraceSpan": {
    "trace_id": "trace_001",
    "span_id": "span_001",
    "parent_span_id": null,
    "operation_name": "tool_gateway.invoke",
    "status_code": "ok",
    "tenant_ref": "tenant_a",
    "run_id": "run_001",
    "attributes_ref": "trace_attr_001",
    "started_at": "2026-05-30T10:00:01+08:00",
    "ended_at": "2026-05-30T10:00:02+08:00"
  }
}
```

这里故意使用 `*_ref` 和 hash，而不是把用户原文、工具入参、工具结果全文都塞进表里。Java 后端项目很容易把日志和表设计得过于“方便排查”，但 Agent 系统里这会变成隐私和权限风险。

### 迁移表

| Java / 后端经验 | 迁移到 Agent 能力 |
| --- | --- |
| Spring MVC / WebFlux | Agent Run API、SSE / streaming events |
| Service / Domain 分层 | Runtime、Context、Tool、Policy 分层 |
| Spring Security / RBAC | Tool Policy、Resource Scope、Approval |
| Transaction / Idempotency | 写工具执行、审批后执行、补偿 |
| Scheduler / MQ | async run、embedding job、eval job |
| Redis / Cache | RAG cache、tool result cache、prompt cache |
| MySQL / JPA / MyBatis | run、step、trace、approval、eval case 存储 |
| Actuator / Micrometer | Agent metrics、cost metrics、tool metrics |
| Logback / ELK | Trace、audit、failure analysis |
| JUnit / Testcontainers | eval harness、tool mock、integration eval |
| CI/CD | prompt / tool / agent release gate |
| OpenAPI / DTO | tool schema、structured output schema |

这张表的重点是：你的旧能力没有浪费，只是要换一个对象。

### 最小 Java Agent 项目

建议第一个 Java 项目不要做“大而全 Agent”。做一个：

```text
Spring Boot + RAG + Citation + Eval
```

最小模块：

```text
agent-api
  - ChatController
  - DocumentController

agent-runtime
  - AgentRunService
  - ContextBuilder
  - AnswerGenerator

agent-rag
  - DocumentParser
  - Chunker
  - EmbeddingGateway
  - Retriever
  - CitationChecker

agent-eval
  - EvalCase
  - EvalRunner
  - EvalReport

agent-observability
  - TraceService
  - CostRecorder
```

做到这一步，就已经能训练 RAG、后端架构、eval 和 trace。

### 工具选择

Java 生态中常见路线：

| 路线 | 适合 |
| --- | --- |
| OpenAI Java SDK | 想直接控制 API、Gateway、trace 和策略 |
| Spring AI | 想和 Spring Boot 生态整合 |
| LangChain4j | 想使用 Java 生态里的 AI Services、Tools、RAG 抽象 |
| 自建 Gateway | 企业平台、多 provider、多租户和强治理 |

不要一开始就问“哪个框架最好”。更好的问题是：

```text
我需要控制哪些边界？
模型调用？
工具权限？
RAG pipeline？
评估和 trace？
多租户？
```

框架能帮你少写样板代码，但核心边界仍要自己设计。

更具体地说，可以把框架和业务后端的责任拆开：

| 能力 | 可以交给框架 | 必须由业务后端治理 |
| --- | --- | --- |
| Chat / completion 调用 | Provider adapter、流式返回、基础错误封装 | model profile 版本、fallback 策略、敏感数据策略、成本归集 |
| Embedding | embedding client、批量调用辅助 | 文档生命周期、tenant filter、索引版本、删除和撤权 |
| Tool adapter | schema 生成、函数绑定、调用适配 | Tool Registry、Policy、Approval、Audit、幂等和凭证隔离 |
| RAG helper | 文档切分、retriever 抽象、prompt 拼接 | ACL 过滤、citation checker、freshness、eval 和 trace 回放 |
| Structured output | JSON schema / DTO 映射 | unknown 语义、兼容版本、失败降级、输出安全检查 |
| Streaming | SSE / token stream 适配 | 事件序号、重连、事件级权限过滤、最终状态一致性 |
| Observability | 基础 metrics / tracing hook | 业务 trace schema、audit log、成本事件、release gate |

这张表的底层原则是：框架处理调用便利性，业务后端处理责任边界。

### 30 / 60 / 90 天路线

30 天目标：跑通最小项目。

交付物：

- Spring Boot Chat API。
- 接入一个模型。
- 结构化输出。
- unknown 处理。
- 10 个 eval case。
- 基础 trace。

验收：

```text
能演示一个问题从请求到模型回答的完整 trace。
能展示 10 个 eval case 的通过和失败。
```

这个阶段不要做：

- 不接生产数据。
- 不接真实写工具。
- 不做自动审批。
- 不抽象平台。

60 天目标：做知识库 Agent。

交付物：

- 文档上传。
- chunk 和 embedding。
- metadata-filtered retrieval。
- citations。
- citation checker。
- permission denied 样本。
- prompt injection 样本。

验收：

```text
回答必须有引用。
跨项目文档不能被召回。
证据不足时返回 unknown。
```

这个阶段不要做：

- 不做写工具。
- 不绕过真实权限模型。
- 不把所有文档放进一个无 ACL 的向量库。
- 不把“看起来答对”当成上线标准。

90 天目标：做企业工作流 Agent。

交付物：

- Tool Registry。
- 只读工具。
- 写工具草稿。
- Approval。
- Idempotency。
- Audit。
- Eval release gate。

验收：

```text
写工具不能绕过审批。
审批后重新校验。
工具失败能进入 trace。
```

这个阶段不要做：

- 不绕过审批。
- 不让 Agent 自动执行生产写操作。
- 不把长期凭证交给模型或工具上下文。
- 不在没有 release gate 的情况下灰度给团队使用。

### 把已有项目改造成 Agent 项目

如果你已有一个 Java 项目，可以这样改：

1. 找一个真实问题。

例如：

```text
用户不知道如何查某个业务规则。
客服经常查内部文档。
开发要反复查发布检查项。
审批人要整理多个系统状态。
```

2. 先做只读 Agent。

不要一开始就写业务数据。先做：

- 文档查询。
- 状态解释。
- 报告生成。

3. 加引用和 unknown。

所有回答必须能追溯来源。

4. 加 trace 和 eval。

把常见问题做成 eval case。

5. 再加工具。

先只读工具，再写工具草稿。

6. 最后加审批和审计。

写操作进入企业工作流。

这条路线比“直接让 Agent 操作生产系统”安全得多。

### 作品集建议

Java 工程师的 Agent 作品集可以做三个层级：

1. 知识库 Agent。

展示：

- Spring Boot API。
- 文档上传。
- RAG。
- Citation。
- Eval。
- Trace。

2. 工作流 Agent。

展示：

- Tool Registry。
- Function Calling / MCP 接入。
- Approval。
- Idempotency。
- Audit。
- Event Stream。

3. Coding / DevOps Agent。

展示：

- 读代码库。
- 生成 patch。
- 跑测试。
- review diff。
- PR 描述。

每个项目都要有：

- README。
- 架构图。
- API 示例。
- eval cases。
- trace 示例。
- failure cases。
- 运行命令。
- 测试命令。
- 已知限制。

如果要像一个真实 Java 仓库，还要补这些可运行性要求：

- `docker-compose.yml` 或本地启动脚本，用于启动数据库、向量库或 mock service。
- `.env.example`，只放占位配置，不提交真实 key。
- 示例数据和导入命令。
- 数据库迁移脚本，例如 Flyway / Liquibase / SQL migration。
- 单元测试和集成测试命令。
- eval runner 命令。
- trace 示例生成命令。
- CI 配置，至少能跑测试和格式检查。
- 失败样本复现命令，例如“如何复现 citation missing”。
- 配置脱敏说明，说明哪些字段不能进入日志、trace 和前端事件。

### 面试表达

不要这样说：

```text
我会 Spring AI，也接过 OpenAI。
```

可以这样说：

```text
我把一个 Spring Boot 知识库项目改成了 Agent：
- 文档上传后进入异步索引任务。
- chunk 带 tenant、document_version 和 acl_ref。
- 检索前做 metadata filter。
- 回答必须带 citation。
- permission_denied 时返回 unknown。
- eval 覆盖 prompt injection 和 citation missing。
- trace 记录 query、retrieval、context、answer。
```

如果面试官问：

```text
你作为 Java 工程师，和纯 AI 应用开发者相比优势是什么？
```

可以回答：

```text
我的优势是能把模型能力放进生产后端系统。我会设计 API、状态、权限、事务、幂等、队列、观测和 CI/CD。Agent 项目里，模型只是能力之一，真正难的是让工具调用、审批、trace、eval、安全和成本治理稳定运行。
```

## 适用场景

### 玩具 Demo

适合：

- 学 API。
- 学结构化输出。
- 学 prompt。
- 学简单 RAG。

不要在 Demo 阶段接生产数据库和真实写操作。

### 个人效率工具

适合：

- 给自己的笔记做 RAG。
- 写代码助手。
- 总结技术文档。
- 做学习计划。

个人工具是练手场，但不要忽略 secret 和本地文件安全。

### 团队内部工具

适合 Java 工程师展示转型能力：

- 内部知识库。
- 发布检查助手。
- 工单摘要。
- 运维事件分析。
- 研发规范问答。

这些场景既有真实价值，又能训练权限、观测和 eval。

### 企业级系统

适合有一定经验后做：

- 多租户 Agent 平台。
- 统一 Tool Gateway。
- MCP Server 管理。
- Eval Harness。
- Cost Dashboard。
- Agent Release Gate。

企业级系统要先有项目经验，再抽象平台。

## 不适用场景

不适合一开始就追多 Agent、大平台和全自动工作流。

不适合把 Spring AI / LangChain4j 当成能力本身。

不适合直接让 Agent 写生产数据库。

不适合没有 eval 就上线给团队用。

不适合把 AI 转型理解成“换一个框架”。

不适合放弃已有后端能力。你的后端能力正是 Agent 工程的底座。

## 常见坑与反模式

1. 只接模型 API。

   这只是起点，不是 Agent 工程。

2. 过早追框架。

   框架不是边界设计。

3. 把 RAG 当向量库。

   RAG 的关键是文档生命周期、权限、引用和 eval。

4. 不做 eval。

   没有 eval，就不知道 prompt 或模型升级有没有变差。

5. 不做 trace。

   线上错了无法排查。

6. 不做权限。

   企业内部数据不能全库召回。

7. 写工具不审批。

   真实副作用必须治理。

8. 只做 UI。

   UI 漂亮不能证明系统可靠。

9. 不写失败案例。

   作品集只展示成功路径，专业度不够。

10. 忽略 Java 优势。

   事务、队列、权限、观测、测试都是 Agent 生产化核心能力。

## 安全、成本与性能考虑

### 安全

Java 工程师转 Agent，安全意识要迁移：

- Spring Security -> Tool Policy。
- RBAC -> Resource Scope。
- Audit Log -> Agent Audit。
- Input Validation -> Tool Schema Validation。
- Transaction -> Idempotent Tool Execution。
- Secret Management -> Model / Tool Credential Isolation。

不要让模型绕过你原来会认真设计的后端安全边界。

Java 企业项目里还有一些很常见的安全坑，迁移到 Agent 后要显式处理：

| Java 企业风险 | Agent 项目里的控制点 |
| --- | --- |
| 服务间 token 被透传给下游工具 | 使用 Credential Broker 做 token exchange，校验 audience / issuer，不把原始用户 token 交给模型 |
| Spring Security principal 只在 Web 线程有效 | 把 principal 映射成 `user_ref`、`tenant_ref`、`tool_scope`，写入 RunContext |
| 异步任务丢失权限上下文 | MQ / Scheduler 消息必须携带最小权限引用，并在 worker 执行前重新加载和校验 |
| 日志打印用户输入、工具结果或 secret | Logback / trace exporter 做脱敏，默认记录 ref、hash 和状态，不记录敏感原文 |
| 配置中心泄露 provider key 或工具凭证 | 配置只保存 secret ref，运行时由凭证系统按 scope 签发短期凭证 |
| URL 工具触发 SSRF | URL allowlist、内网地址拦截、DNS/IP 校验、egress policy 和下载大小限制 |
| MCP Server 随意接入 | MCP server allowlist、server identity 校验、tool catalog diff 审批、session 隔离 |
| 向量检索忘记租户过滤 | Repository / Retriever 层强制 tenant 和 ACL predicate，不能只靠 prompt 约束 |

### 成本

成本意识也要迁移：

- API 调用成本。
- token 成本。
- embedding 成本。
- vector store 成本。
- tool call 成本。
- eval 成本。
- trace 存储成本。

Java 工程师熟悉资源治理，可以把它用到 Agent 上：

- model profile。
- rate limit。
- budget manager。
- cache。
- async batch。
- cost event。

### 性能

性能经验同样可迁移：

- API latency -> first token / final answer latency。
- DB index -> vector index / metadata filter。
- Cache -> RAG / tool / prompt cache。
- MQ -> async agent run。
- Thread pool -> tool scheduler。
- Timeout -> model / tool timeout。
- Circuit breaker -> provider / tool fallback。

不要只优化模型响应。Agent 性能通常卡在上下文、检索、工具和外部系统。

## 如何评估效果

Java 工程师转型效果，可以用这张表评估：

| 目标 | 证据 |
| --- | --- |
| 能调用模型 | Model Gateway，有 trace 和错误处理 |
| 能做 RAG | 文档、chunk、retrieval、citation、eval |
| 能接工具 | Tool Registry、schema、policy、audit |
| 能做运行时 | run / step 状态、恢复、stop condition |
| 能做安全 | prompt injection 样本、approval、tenant isolation |
| 能做观测 | trace、metrics、cost event、feedback |
| 能做发布 | eval gate、灰度、回滚 |
| 能讲清限制 | README 中有 known limitations |

一个合格的 90 天作品集至少应该有：

```json
{
  "java_agent_portfolio": {
    "spring_boot_api": true,
    "rag_with_citations": true,
    "tool_registry": true,
    "approval_for_write_tool": true,
    "trace_examples": true,
    "eval_cases": "at_least_20",
    "security_cases": [
      "prompt_injection",
      "permission_denied",
      "write_without_approval"
    ],
    "build_command": "documented",
    "test_command": "documented",
    "known_limitations": true
  }
}
```

这里的 `at_least_20` 是作品集自检建议，不是行业标准。

验收时不要只看页面能不能聊天，还要能跑命令。下面是示例命令形态，具体项目可以使用 Maven 或 Gradle，但 README 必须写清楚等价命令：

```bash
./mvnw test
./mvnw verify -Pintegration
./mvnw spring-boot:run
./mvnw -Dtest=EvalRunnerTest test
java -jar tools/eval-runner.jar --suite kb-core
curl -s http://localhost:8080/internal/traces/examples/run_001
```

如果项目使用 Gradle，可以提供等价命令：

```bash
./gradlew test
./gradlew integrationTest
./gradlew bootRun
./gradlew evalRun --args="--suite kb-core"
```

这些命令的目的不是统一工具链，而是让作品集从“看文档相信你”变成“可以复现你的工程闭环”。

## 实践任务

1. 入门：做已有能力迁移表。

交付物：列出你熟悉的 10 个 Java 后端能力，并写出它们对应的 Agent 能力。

自查标准：至少覆盖 API、权限、事务、队列、缓存、日志、测试。

2. 初级：接入 Model Gateway。

交付物：在 Spring Boot 项目中封装一个 ModelGateway，返回结构化输出。

自查标准：不能在 Controller 里直接散落模型调用；必须记录 trace。

3. 中级：做知识库 Agent。

交付物：文档上传、chunk、embedding、retrieval、citation checker、eval。

自查标准：回答必须有 citation；证据不足必须 unknown。

4. 高级：做工作流 Agent。

交付物：Tool Registry、只读工具、写工具草稿、Approval、Audit、Idempotency。

自查标准：写工具不能绕过审批；审批后必须重新校验。

5. 生产化：做作品集发布。

交付物：README、架构图、运行命令、测试命令、eval cases、trace examples、failure cases、known limitations。

自查标准：别人能按文档运行项目，并复现至少一个失败样本。

参考答案要点：

- Java 后端能力是优势，不是包袱。
- 转型重点是补模型、上下文、RAG、Tool、Eval。
- 不要只学框架，要做项目。
- Model Gateway、Tool Gateway、Agent Runtime、Eval Harness 是 Java 工程师最容易建立优势的地方。
- 作品集要展示工程闭环，而不只是聊天页面。

## 从入门到专业

- 入门：能在 Java 项目中调用模型，并理解结构化输出。
- 初级：能做 Spring Boot + RAG + Citation 的知识库 Agent。
- 中级：能加入 Tool Gateway、Policy、Trace、Eval。
- 高级：能做 Approval、Audit、Idempotency、Cost 和 Release Gate。
- 专业：能建设 Java Agent Platform，让多个业务 Agent 复用 runtime、tool registry、eval 和安全治理。

Java 工程师的成长路线不是换赛道，而是升级后端能力：

```text
业务后端工程师
  -> AI 应用后端工程师
  -> Agent 工程师
  -> Agent 平台工程师
```

## 本章小结

Java 工程师转 AI Agent，不是从零开始。你已经拥有很多生产化能力：API、事务、队列、权限、观测、测试、CI/CD。这些能力正是 Agent 从 Demo 走向生产所缺的底座。

本章建立了几个核心结论：

- Java 后端能力可以直接迁移到 Agent 工程。
- 转型重点不是只学框架，而是补模型、上下文、RAG、Tool 和 Eval。
- Model Gateway、Tool Gateway、Agent Runtime、Eval Harness 是 Java 工程师的优势方向。
- 先做只读知识库 Agent，再做企业工作流 Agent。
- 作品集要有运行方式、eval、trace、失败样本和限制说明。
- 面试要讲工程闭环，而不是只讲接过某个模型 API。

下一章会进入未来趋势。第 28 章讲个人路线，第 29 章会讨论 Agentic Workflow、Computer Use、多模态 Agent、Agent Infra 和 AI Infra 的交叉，以及这些趋势对工程师能力的影响。

## Sources

以下来源按 2026-05-30 访问时理解；Spring AI 页面当前显示 Spring AI 1.1.7。Java AI 框架和 SDK 版本会变化，本章采用工程抽象，不写死具体 API 签名。

- [Spring AI Reference: Getting Started](https://docs.spring.io/spring-ai/reference/getting-started.html)
- [LangChain4j Documentation](https://docs.langchain4j.dev/)
- [LangChain4j: AI Services](https://docs.langchain4j.dev/tutorials/ai-services)
- [OpenAI Java SDK](https://github.com/openai/openai-java)
- [Spring Boot Reference: Observability](https://docs.spring.io/spring-boot/reference/actuator/observability.html)

## 写作审查记录

### 章节架构师

- 本章目标：把第 27 章的通用能力模型映射到 Java / Spring / 后端工程师的转型路线。
- 知识点地图：Java 优势、能力缺口、技术栈映射、30/60/90 天路线、已有项目改造、作品集、面试表达和评估标准。
- 前后章节关系：承接第 27 章能力模型，进入第 29 章未来趋势前，先给 Java 工程师一条可执行路线。

### 技术审稿人

- 发现问题：Java 转型章节容易变成某个框架教程，或把 Spring AI / LangChain4j 写成唯一答案；Model Gateway 也容易缺少可审计字段。
- 修订动作：引用 Spring AI、LangChain4j、OpenAI Java SDK、Spring Boot Observability 官方资料；明确框架只是可选工具；补充 `provider_request_id`、`model_profile_version`、`response_schema_ref`、`usage_source`、`pricing_version`、`sensitive_data_policy` 等生产字段。
- 结论：章节没有把某个 Java AI 框架写成唯一转型路径，并把模型调用治理落到了后端记录。

### 工程审稿人

- 发现问题：如果只讲学习路线，无法体现 Java 工程师的后端优势如何落地；原稿缺少核心数据模型、Tool Gateway 接口边界、框架职责边界和仓库可运行标准。
- 修订动作：补充 `AgentRun`、`AgentStep`、`ToolInvocation`、`EvalCase`、`TraceSpan` 最小字段；加入 `ToolGateway.invoke` 伪代码；增加框架能力边界表、Java 企业安全风险表和 Maven / Gradle / eval runner 验收命令。
- 结论：章节能帮助 Java 工程师把已有工程经验迁移到 Agent 系统，并能落到一个可运行、可测试、可复盘的 Spring Boot 项目。

### 学习体验审稿人

- 发现问题：读者可能不知道从哪里开始做作品集，也可能在早期阶段过快接入生产数据或写工具。
- 修订动作：提供 30/60/90 天路线、每阶段不要做什么、最小 Java Agent 项目、已有项目改造步骤、作品集仓库质量要求和可复现命令。
- 结论：章节能给 Java 工程师清晰、可执行且边界明确的转型路径。

### 主编

- 最终调整：本章统一主线为“Java 后端能力是 Agent 生产化的底座”。
- 与全书衔接：第 27 章讲通用能力模型，本章讲 Java 工程师转型，第 29 章将讲未来趋势和能力演进。
- 后续章节提醒：第 29 章应避免空泛预测，要围绕 Agentic Workflow、Computer Use、多模态、Agent Infra、评估和安全治理展开。
