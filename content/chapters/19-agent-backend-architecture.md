# 第 19 章：AI Agent 后端架构

## 本章解决什么问题

第 18 章讲 Agent Harness Engineering：如何用工程护栏把 Agent 从 Demo 推向生产。第 19 章进入后端架构：这些护栏、运行时、工具、状态、评估和流式响应，如何落到一个真实后端系统里。

很多 Agent Demo 是这样写的：

```text
Controller -> call model -> call tool -> return answer
```

这个结构很快会遇到问题：

- 用户刷新页面后，任务状态丢失。
- SSE 流式输出和工具执行状态对不上。
- 工具权限只在 Prompt 里约束，后端没有硬边界。
- 多租户共享向量库，检索结果串租户。
- Prompt 改了没有版本，事故无法复盘。
- 模型调用、工具调用和最终回答没有统一 trace。
- 长任务阻塞 HTTP 请求。
- 写操作没有幂等，重试后重复创建工单。
- Spring AI 或 LangChain4j 的框架能力和业务状态混在一起。

本章要回答：

- AI Agent 后端应该如何分层？
- API 层、任务层、运行时层、模型层、工具层、记忆层、评估层分别负责什么？
- SSE / WebSocket 流式响应如何和任务状态解耦？
- 多租户、权限、凭证和数据隔离应该放在哪里？
- Java 后端使用 Spring AI 或 LangChain4j 时，哪些能力可以复用，哪些仍要自己做？
- 如何避免把框架 Demo 直接当生产架构？
- 如何评估一个 Agent 后端架构是否可靠？

截至 2026-05-30，Spring AI 和 LangChain4j 都在快速演进。Spring AI 官方文档提供 ChatClient、Advisors、Tool Calling、Chat Memory、Observability 等能力；LangChain4j 官方文档提供 AI Services、ChatModel / StreamingChatModel、Tools、Chat Memory、RAG 等能力。本章只引用这些公开能力的工程边界，不写死具体版本的类名和方法签名；涉及代码时采用伪代码或接口草图。

读完本章，读者应该能为 kb-assistant 设计一个后端架构：HTTP API 接收请求，Task Service 管理 run，Agent Runtime 推进状态，Model Gateway 统一模型调用，Tool Gateway 控制工具权限，Memory / Context Service 管理上下文，Event Gateway 推送进度，Trace / Eval / Policy 贯穿全链路。

## 一个直观例子

用户在网页上点击：

```text
判断 kb-assistant 今天能不能上线。
```

一个 Demo 后端可能这样做：

```text
POST /chat
  -> 拼 Prompt
  -> 调模型
  -> 如果模型要工具，就调用工具
  -> 返回最终文本
```

如果只是演示，这能跑。但团队内部使用时，用户会期待：

- 页面能看到“正在查询上线检查项”。
- 工具慢的时候任务不中断。
- 用户关掉页面后回来还能看到进度。
- 权限不足时显示 unknown，而不是失败堆栈。
- 创建阻塞项前必须确认。
- 最终报告有证据引用。
- 管理员能在后台看到 trace、成本和错误。

更合理的后端链路是：

```text
POST /agent-runs
  -> 创建 run
  -> 返回 run_id

GET /agent-runs/{run_id}/events
  -> SSE 推送 run_started / step_started / tool_result / approval_required / final_answer

Agent Worker
  -> 从队列领取 run
  -> 加载 Agent Spec / Policy / Context
  -> 调用模型
  -> 经 Tool Gateway 调用工具
  -> 持久化 run / step / observation
  -> 写 trace / metrics / audit
```

这个设计把“请求响应”和“Agent 执行”拆开。HTTP 请求不再承载完整长任务，前端通过事件流看进度，后端通过 run state 保证恢复和审计。

## 基础解释

### 后端架构的核心目标

AI Agent 后端不是简单的模型代理。它至少要保证：

- 请求可验证。
- 状态可恢复。
- 工具可控。
- 上下文可追溯。
- 输出可检查。
- 过程可观测。
- 成本可管理。
- 租户可隔离。
- 版本可回滚。

这些目标决定了后端必须分层，而不是把所有逻辑写在一个 Controller 里。

### 最小分层模型

一个最小生产级 Agent 后端可以分成：

```text
API Layer
  -> Task / Run Layer
  -> Agent Runtime Layer
  -> Model Gateway
  -> Tool Gateway
  -> Context / Memory Layer
  -> State Store
  -> Event Gateway
  -> Observability / Eval / Policy
```

每层职责不同：

| 层 | 职责 |
| --- | --- |
| API Layer | 接收请求、鉴权、返回 run_id、提供查询和取消接口 |
| Task / Run Layer | 管理 run、step、approval、timeout、状态机 |
| Agent Runtime Layer | 推进 Agent Loop、执行计划、处理工具和停止条件 |
| Model Gateway | 统一模型调用、路由、重试、限流和成本记录 |
| Tool Gateway | 控制工具 schema、权限、凭证、幂等和审计 |
| Context / Memory Layer | 构造上下文、管理短期历史、长期记忆和 RAG |
| State Store | 持久化 run、step、observation、版本和租户 |
| Event Gateway | SSE / WebSocket 推送进度事件 |
| Observability / Eval / Policy | 贯穿全链路的 trace、评估、策略和发布门禁 |

### Java 生态中的角色

Java 后端通常已经有成熟能力：

- Spring MVC / WebFlux 提供 HTTP 和流式响应。
- Spring Security 提供认证授权基础。
- 数据库和事务管理成熟。
- 队列、调度、缓存、观测体系成熟。
- Spring AI 或 LangChain4j 提供模型、工具、记忆、RAG 等抽象。

因此 Java Agent 后端的重点不是“把所有东西塞进框架”，而是把 AI 框架能力接进已有后端工程体系。

### Spring AI 和 LangChain4j 的位置

Spring AI 更贴近 Spring 生态，官方文档强调 ChatClient、Advisors、Tool Calling、Chat Memory、Vector Store 和 Observability 等能力。

LangChain4j 更贴近“Java 里的 LLM 应用组件库”，官方文档强调 AI Services、ChatModel / StreamingChatModel、Tools、Chat Memory、RAG 和多种集成。

它们可以帮助你做：

- 调模型。
- 定义工具。
- 做流式输出。
- 管理部分 chat memory。
- 接入 RAG。
- 接入观测。

但通常仍然需要业务后端自己实现：

- 多租户权限。
- Agent run 状态机。
- 审批流程。
- 工具凭证隔离。
- 幂等和补偿。
- 业务审计。
- 发布门禁。
- 线上反馈闭环。

框架提供积木，架构决定房子怎么建。

## 核心原理

### 原理一：HTTP 请求不是 Agent Run

一个 Agent Run 可能持续几秒、几分钟，甚至等待人工审批几个小时。HTTP 请求不应该等到整个 run 完成。

推荐模型：

```text
POST /agent-runs -> 创建任务，立即返回 run_id
GET /agent-runs/{run_id} -> 查询当前状态
GET /agent-runs/{run_id}/events -> 订阅事件流
POST /agent-runs/{run_id}/cancel -> 取消任务
POST /agent-runs/{run_id}/approvals/{approval_id} -> 提交审批
```

HTTP API 管理 run，Worker 执行 run。这样才能支持刷新页面、恢复、取消、审批和重试。

### 原理二：模型调用要通过 Gateway

不要让业务代码到处直接调用模型 provider。Model Gateway 统一处理：

- 模型路由。
- 供应商切换。
- 超时。
- 重试。
- 速率限制。
- token 统计。
- 成本归集。
- prompt / model profile 版本。
- 安全参数。
- trace span。

模型调用是基础设施，不是业务 Controller 的私有逻辑。

### 原理三：工具调用要通过 Tool Gateway

Tool Gateway 是所有外部副作用的入口。

它要处理：

- schema 校验。
- 用户和租户权限。
- Agent 权限。
- 凭证注入。
- 网络出口。
- 超时和重试。
- 幂等键。
- 审批。
- 审计。
- 结果脱敏。

模型不能直接拿到数据库连接、HTTP token 或内部服务凭证。工具应该是受控能力，而不是任意代码执行。

### 原理四：上下文层要和记忆层分开

Context 是“本次运行要放进模型的材料”。Memory 是“跨轮、跨任务保存的历史或偏好”。RAG 是“从外部知识库检索上下文”。

不要混成一个概念：

| 概念 | 生命周期 | 示例 |
| --- | --- | --- |
| Request Context | 单次请求 | 用户当前问题、项目引用 |
| Run Context | 一次 run | 已查到的检查项、评估结果 |
| Chat Memory | 多轮会话 | 用户前几轮问答 |
| Long-term Memory | 长期偏好或事实 | 用户常用项目、写作偏好 |
| RAG Context | 外部知识检索结果 | 发布规范、API 文档 |

生产系统中，Context Builder 应该决定哪些材料进入模型，而不是把所有 memory 都塞进去。

### 原理五：状态表是 Agent 后端的脊柱

没有状态表，就没有恢复、审计和评估。

至少需要：

- run 表。
- step 表。
- observation 表或对象引用。
- approval 表。
- tool call 表。
- trace span 表或 trace sink。
- feedback 表。

这些表不一定都在同一个数据库，但必须能通过 `run_id` 串起来。

### 原理六：流式响应只是事件视图，不是权威状态

SSE / WebSocket 给用户看进度，但权威状态在后端 State Store。

前端断线后重新连接时：

```text
load run state
return snapshot
continue streaming new events
```

不要把“已经推给前端的事件”当成系统状态。事件可以丢，状态不能丢。

## 工程实现

### 总体架构

后端可以拆成：

```text
Client
  -> API Gateway
  -> Agent API Service
  -> Run Service
  -> Queue
  -> Agent Worker
      -> Runtime Engine
      -> Model Gateway
      -> Tool Gateway
      -> Context Service
      -> Memory Service
      -> Policy Service
  -> State DB
  -> Object Store
  -> Event Stream
  -> Trace / Metrics / Audit
```

职责表：

| 组件 | 职责 |
| --- | --- |
| Agent API Service | 创建 run、查询 run、取消、审批、订阅事件 |
| Run Service | 状态机、版本、租约、幂等、恢复 |
| Queue | 解耦 API 和 Worker，支持重试和削峰 |
| Agent Worker | 执行 run，推进 step |
| Runtime Engine | Agent Loop、Planning、Tool call、Stop condition |
| Model Gateway | 模型调用和成本治理 |
| Tool Gateway | 工具执行和安全治理 |
| Context Service | 上下文构造、RAG、freshness 和 provenance |
| Memory Service | chat memory、long-term memory、租户隔离 |
| Policy Service | 输入、工具、输出、审批策略 |
| Event Stream | SSE / WebSocket 事件 |
| Trace / Metrics / Audit | 可观测性、评估和合规 |

### API 设计

API 不应该只提供 `/chat`。更合理的是任务 API：

```http
POST /api/agent-runs
GET /api/agent-runs/{run_id}
GET /api/agent-runs/{run_id}/events
POST /api/agent-runs/{run_id}/cancel
POST /api/agent-runs/{run_id}/approvals/{approval_id}
GET /api/agent-runs/{run_id}/trace
```

创建 run 请求示例：

```json
{
  "agent_id": "release_readiness_agent",
  "tenant_ref": "tenant_a",
  "user_ref": "user_pseudo_123",
  "client_request_id": "req_20260530_001",
  "idempotency_key": "hmac(tenant_a:user_pseudo_123:judge_release_readiness:project_kba:2026-05-30)",
  "task_type": "judge_release_readiness",
  "input": {
    "project_ref": "project:kba",
    "release_date": "2026-05-30"
  },
  "client_capabilities": {
    "streaming": true,
    "approval_ui": true
  }
}
```

返回：

```json
{
  "run_id": "run_release_001",
  "status": "created",
  "events_url": "/api/agent-runs/run_release_001/events"
}
```

注意：`tenant_ref`、`user_ref` 应使用内部引用或伪标识，不要把原始敏感标识直接暴露给模型或日志。`client_request_id` 用于前端排查和重试关联，`idempotency_key` 用于服务端去重。同一 tenant、user、task、关键 input 在幂等窗口内重复提交时，应返回同一个 run 或明确返回已有 run 状态，而不是创建多个 run。

### Run 数据模型

```json
{
  "run_id": "run_release_001",
  "tenant_ref": "tenant_a",
  "user_ref": "user_pseudo_123",
  "agent_id": "release_readiness_agent",
  "agent_version": "2026.05.30-1",
  "model_profile_version": "reasoning-medium-tool-use.v3",
  "tool_registry_version": "tool-registry-v7",
  "runtime_version": "runtime-v2",
  "trace_id": "trace_release_001",
  "client_request_id": "req_20260530_001",
  "idempotency_key": "hmac(tenant_a:user_pseudo_123:judge_release_readiness:project_kba:2026-05-30)",
  "status": "running",
  "current_step_id": "s2",
  "input_ref": "input.run_release_001",
  "context_snapshot_ref": "ctx.run_release_001.v1",
  "policy_bundle_version": "release-policy-v4",
  "cost_budget": {
    "max_cost_units": 1.5,
    "max_tool_calls": 6
  },
  "cancellation_requested_at": null,
  "created_at": "2026-05-30T10:00:00+08:00",
  "updated_at": "2026-05-30T10:00:12+08:00",
  "version": 7,
  "lease_owner": "worker-03",
  "lease_expires_at": "2026-05-30T10:00:42+08:00"
}
```

Run 表需要支持：

- 乐观锁。
- worker lease。
- 状态转移校验。
- 幂等创建。
- 取消和恢复。
- 版本记录。

### Step 数据模型

```json
{
  "run_id": "run_release_001",
  "tenant_ref": "tenant_a",
  "step_id": "s2",
  "type": "tool",
  "name": "get_review_status",
  "status": "succeeded",
  "attempt": 1,
  "tool_call_id": "tool_call_s2_001",
  "input_ref": "tool_input.s2",
  "observation_ref": "obs.security_review",
  "idempotency_key": null,
  "side_effect_level": "read_only",
  "timeout_ms": 3000,
  "worker_version": "agent-worker-2026.05.30-1",
  "policy_decision": {
    "allowed": true,
    "reason": "read_only_tool"
  },
  "started_at": "2026-05-30T10:00:10+08:00",
  "finished_at": "2026-05-30T10:00:12+08:00",
  "error_code": null
}
```

Step 表要能回答：

- 做了什么？
- 为什么允许？
- 输入和输出在哪里？
- 是否重试？
- 是否失败？
- 是否产生副作用？

### Worker 与队列

Agent Worker 从队列领取 run 或 step：

```text
poll queue
  -> acquire run lease
  -> load run state
  -> execute next step
  -> persist state transactionally
  -> emit event
  -> ack queue message
```

关键规则：

- ack queue message 前必须持久化状态。
- worker 崩溃后 lease 到期，其他 worker 可接手。
- 同一 run 同时只能有一个 active worker 推进状态。
- 写工具要有幂等键。
- Worker 版本要写入 trace。

不要让 HTTP 线程直接执行长任务。HTTP 层应该创建任务，Worker 层负责执行任务。

### SSE / WebSocket 事件

SSE 适合服务器向浏览器单向推送进度。WebSocket 适合双向实时交互。大多数 Agent 进度展示，SSE 已经足够。

事件示例：

```json
{
  "event_id": "evt_000001",
  "seq": 1,
  "event": "run_started",
  "run_id": "run_release_001",
  "run_status": "running",
  "created_at": "2026-05-30T10:00:00+08:00"
}
{
  "event_id": "evt_000002",
  "seq": 2,
  "event": "step_started",
  "run_id": "run_release_001",
  "run_status": "running",
  "step_id": "s1",
  "label": "查询上线检查项",
  "created_at": "2026-05-30T10:00:02+08:00"
}
{
  "event_id": "evt_000005",
  "seq": 5,
  "event": "approval_required",
  "run_id": "run_release_001",
  "run_status": "awaiting_approval",
  "approval_id": "approval_001",
  "created_at": "2026-05-30T10:00:20+08:00"
}
```

事件设计原则：

- 事件只承载用户可见摘要。
- 敏感数据用引用，不直接推送。
- 每个事件有序号，支持断线重连。
- 前端重连后先拉 snapshot，再用 `Last-Event-ID` 或 `?after_event_id=evt_000005` 这类协议继续订阅新事件。
- 最终回答也要落库，不只通过流推给前端。

### Model Gateway

Model Gateway 统一模型调用：

```text
Runtime Engine
  -> Model Gateway
      -> provider adapter
      -> model profile
      -> prompt version
      -> cost tracker
      -> trace span
```

Model Profile 示例：

```json
{
  "model_profile": "reasoning-medium-tool-use",
  "provider": "openai",
  "model": "configured_by_environment",
  "timeout_ms": 30000,
  "max_output_tokens": 2000,
  "tool_calling": true,
  "streaming": true
}
```

这里的数字是 kb-assistant 示例，不是通用推荐值。具体模型、超时和 token 上限要由部署环境和任务风险决定。

Model Gateway 不应该把供应商 API 细节泄漏到业务层。业务层只关心 model profile。

### Tool Gateway

Tool Gateway 统一工具调用：

```text
Runtime Engine
  -> Tool Gateway
      -> schema validation
      -> policy check
      -> credential injection
      -> idempotency
      -> tool adapter
      -> observation normalization
      -> audit log
```

工具注册示例：

```json
{
  "tool": "create_release_blocker",
  "version": "v2",
  "tenant_scope": "tenant_a",
  "side_effect_level": "write_internal_ticket",
  "approval_required": true,
  "idempotency_required": true,
  "credential_ref": "cred_ref_7f3a91",
  "network_zone": "internal",
  "allowed_resource_patterns": ["project:kba:*"]
}
```

模型看到的是工具描述，Tool Gateway 持有真实凭证和执行策略。`credential_ref` 只存在 Tool Gateway 内部配置中，不进入模型上下文、前端事件或普通 trace；日志中也应写不可反推出系统含义的内部引用，而不是暴露具体系统用途的 secret 名称。

### Context / Memory Layer

Context Service 负责构造本次模型输入：

```text
request input
  -> load run state
  -> retrieve chat memory
  -> retrieve RAG documents
  -> load tool observations
  -> apply context policy
  -> build model input
```

Memory Service 要处理：

- 会话隔离。
- 租户隔离。
- 记忆过期。
- 隐私删除。
- 向量库 namespace。
- memory summarization。
- 检索 provenance。

Spring AI 的 Chat Memory 和 Advisors、LangChain4j 的 Chat Memory / RAG 组件都可以提供一部分能力。但生产系统仍要自己管理 tenant、permission、freshness、provenance 和 deletion。

### 多租户隔离

多租户隔离要覆盖：

| 资源 | 隔离方式 |
| --- | --- |
| Run / Step | 所有查询必须带 tenant_ref |
| Memory | tenant namespace + user scope |
| Vector Store | tenant namespace 或物理隔离 |
| Tool Credential | tenant / user / tool 绑定 |
| Object Store | tenant prefix + signed access |
| Trace | tenant-scoped query policy |
| Eval Dataset | 生产数据进入 eval 前脱敏和审批 |

强制机制要落到代码和存储层：

- Repository 层默认注入 tenant predicate，禁止无 tenant 查询。
- 向量检索必须带 tenant metadata filter，缺失 filter 直接拒绝。
- 对象存储 signed URL 绑定 tenant、resource、user 和过期时间。
- Tool Gateway 校验 resource pattern 和 tenant scope。
- Trace 查询走 tenant-scoped policy，不允许按 trace_id 裸查。
- Eval Dataset 从生产数据生成时必须先脱敏、审批和去重。

常见错误：

- 只在 API 层检查 tenant，内部查询忘记带 tenant。
- 向量库只存文本，不存 tenant metadata。
- 工具凭证按系统全局共享。
- Trace 里保存原始敏感内容。
- Feedback 进入 eval 时没有脱敏。

### Spring AI 落地边界

Spring AI 适合 Spring Boot 应用直接接入模型和 AI 能力：

- ChatClient 适合作为模型调用入口。
- Advisors 适合在调用前后增强请求，例如 RAG、memory 或上下文增强。
- Tool Calling 适合暴露受控 Java 方法或工具能力。
- Chat Memory 适合管理会话历史。
- Observability 适合接入 Micrometer / tracing 体系。

工程建议：

```text
Controller 不直接调用 ChatClient
  -> Application Service 创建 run
  -> Worker / Runtime 调 Model Gateway
  -> Model Gateway 内部封装 Spring AI ChatClient
```

这样可以避免业务层到处散落框架调用，也便于统一 trace、成本、策略和切换模型。

不要把 Advisor 当成所有治理的唯一入口。权限、审批、幂等、租户隔离和审计仍应该在后端服务层和 Gateway 层实现。

### LangChain4j 落地边界

LangChain4j 适合 Java 应用用更高层抽象组织 LLM 能力：

- AI Services 适合把 LLM 能力包装成接口。
- ChatModel / StreamingChatModel 适合非流式和流式模型调用。
- Tools 适合暴露 Java 方法作为工具。
- Chat Memory 适合管理会话上下文。
- RAG 组件适合构建检索增强应用。

工程建议：

```text
AI Service / ChatModel
  -> 放在 Model Gateway 或 Agent Adapter 内
  -> 不直接拥有业务数据库写权限
  -> 工具调用仍走 Tool Gateway
  -> memory id 必须和 tenant / user / conversation 绑定
```

如果使用 AI Services，要特别注意：

- 输入输出 schema。
- memory id。
- 工具权限。
- trace span。
- 异常和超时。
- 多租户隔离。

框架的“方便”不等于生产边界已经完成。

### 事务与一致性

Agent 后端经常跨多个系统：

- 数据库。
- 队列。
- 模型 provider。
- 内部工具服务。
- 对象存储。
- 事件流。

不能假设它们有一个大事务。

常见策略：

- 本地事务保存 run / step / outbox。
- outbox 异步发送事件。
- 工具写操作使用幂等键。
- 外部回调用 callback token 和状态版本校验。
- 失败后 reconciliation。
- 最终一致性配合可解释状态。

目标不是所有东西强一致，而是状态可解释、操作可去重、失败可恢复。

## 适用场景

### 玩具 Demo

Demo 可以是：

```text
Controller -> Model -> Tool -> Answer
```

但即使 Demo，也建议加：

- max turns。
- 工具 allowlist。
- 简单 run_id。
- 简单日志。

### 个人效率工具

个人工具可以轻量：

- 单机进程。
- 本地 SQLite 或文件状态。
- 简单 SSE。
- 本地 memory。
- 文件写入确认。

例如个人文档整理 Agent，不需要多租户，但仍要避免误删文件和无限循环。

### 团队内部工具

团队工具需要完整后端：

- API + Worker。
- Run / Step 表。
- Tool Gateway。
- Context Service。
- Event Stream。
- Trace。
- 权限和审批。
- 基础 eval。

kb-assistant 上线准备属于团队工具。它涉及多个内部系统和写阻塞项，因此不能只是一个同步 `/chat` 接口。

### 企业级系统

企业级系统需要平台化：

- 多租户隔离。
- 多 Agent Registry。
- 统一 Model Gateway。
- 统一 Tool Gateway。
- 统一 Memory / RAG。
- 统一 Policy。
- 统一 Observability。
- Eval / Feedback / Release Gate。
- 高可用和灾备。

企业级架构的目标是让多个 Agent 共享基础设施，而不是每个 Agent 都复制一套后端。

## 不适用场景

不适合为一次性脚本搭建完整后端架构。如果只是离线处理一批文本，脚本加人工检查可能足够。

不适合在没有明确业务任务时先搭平台。先做一个具体 Agent，观察失败模式，再抽象平台。

不适合直接把 AI 框架示例当生产架构。示例展示能力，生产系统还需要权限、状态、审计、评估和回滚。

不适合让模型层直接访问业务数据库。工具和数据访问必须经过服务层和策略层。

不适合在流式响应里传输敏感原文。流式事件是用户体验层，不是审计数据通道。

## 常见坑与反模式

1. 一个 `/chat` 接口承载所有任务。

   长任务、审批、取消、恢复都会变得困难。

2. Controller 直接调用模型和工具。

   逻辑散落，难以统一权限、成本、trace 和版本。

3. 把 memory 当状态库。

   Memory 是模型上下文材料，不是 run state。

4. 向量库没有租户隔离。

   这是 RAG 系统最危险的错误之一。

5. SSE 事件里放敏感原文。

   前端事件要最小可见，不要把内部工具结果全量推给用户。

6. 工具凭证全局共享。

   工具凭证要按租户、用户、工具和风险隔离。

7. 框架对象泄漏到业务层。

   业务层依赖具体 provider 或框架 API，会让迁移和治理很困难。

8. 没有任务租约。

   Worker 崩溃后，run 可能永远卡住。

9. 没有 outbox。

   状态更新和事件发送不一致，会导致前端和后端状态对不上。

10. 没有版本字段。

   事故复盘时不知道是哪套 Prompt、工具、策略和模型 profile 导致的行为。

## 安全、成本与性能考虑

### 安全

安全边界：

- API 层做认证和租户校验。
- Policy 层做任务、工具、输出策略。
- Tool Gateway 做凭证和副作用控制。
- Context Service 做数据最小化和脱敏。
- State Store 做 tenant-scoped 查询。
- Event Gateway 只推送用户可见摘要。
- Trace / Audit 做访问控制和保留策略。

不要相信模型自称“用户有权限”。权限来自后端身份系统。

### 成本

成本来自：

- 模型调用。
- 工具调用。
- RAG 检索。
- trace 存储。
- eval 运行。
- 流式连接。

控制方式：

- Model Gateway 记录 token 和成本。
- Context Service 控制上下文预算。
- Tool Gateway 控制昂贵工具。
- Worker 控制 max turns 和 max tool calls。
- Eval 分层运行。
- Trace 按风险采样。

成本要按 tenant、agent、run、tool 和 model profile 归集。

### 性能

性能关注：

- 首 token 延迟。
- 最终完成时间。
- 工具耗时。
- 队列等待时间。
- SSE 连接稳定性。
- RAG 检索延迟。
- Worker 并发。

优化方式：

- 创建 run 后立即返回。
- 慢工具异步执行。
- 只读工具并行。
- 上下文缓存。
- 向量检索预过滤。
- 大 observation 用引用。
- 事件异步投递。

不要为了降低延迟绕过策略检查。Agent 后端首先要正确和安全。

## 如何评估效果

后端架构评估要看可靠性、可恢复性和隔离性。

| 指标 | 问题 |
| --- | --- |
| Run Success Rate | 正常任务完成率 |
| Resume Success Rate | 暂停后恢复成功率 |
| Tenant Isolation | 是否严格隔离租户数据 |
| Tool Policy Enforcement | 工具权限是否生效 |
| Streaming Consistency | 前端事件和后端状态是否一致 |
| Trace Completeness | 是否能复盘模型、工具、状态 |
| Cost Attribution | 成本是否能归集到 tenant / agent / run |
| Queue Lag | 队列是否积压 |
| Worker Recovery | Worker 崩溃后是否能接手 |
| Version Reproducibility | 能否复现某次 run 的版本 |

评估样本：

```json
{
  "case_id": "backend_tenant_isolation_001",
  "input": {
    "tenant_ref": "tenant_a",
    "project_ref": "project:tenant_b:kba"
  },
  "expected_behavior": [
    "reject_cross_tenant_project_ref",
    "do_not_call_model",
    "do_not_call_tools",
    "write_audit_log"
  ]
}
```

故障注入样本：

```json
{
  "case_id": "backend_worker_crash_001",
  "fault": "worker_crashes_after_tool_success_before_event_emit",
  "expected_behavior": [
    "run_state_persisted",
    "outbox_replays_event",
    "no_duplicate_tool_write",
    "new_worker_resumes_from_next_step"
  ]
}
```

流式一致性样本：

```json
{
  "case_id": "backend_stream_reconnect_001",
  "fault": "client_disconnects_during_step_s2",
  "expected_behavior": [
    "client_reconnects_with_run_id",
    "api_returns_current_snapshot",
    "event_stream_continues_from_last_event_id",
    "final_answer_is_persisted"
  ]
}
```

成本归集样本：

```json
{
  "case_id": "backend_cost_attribution_001",
  "run_id": "run_release_001",
  "expected_cost_dimensions": [
    "tenant_ref",
    "agent_id",
    "run_id",
    "tool",
    "model_profile_version"
  ],
  "expected_behavior": [
    "model_tokens_are_attributed_to_model_profile",
    "tool_cost_is_attributed_to_tool_call_id",
    "run_total_cost_is_queryable_by_tenant_and_agent",
    "cost_budget_exceeded_stops_or_degrades_run"
  ]
}
```

写工具审批样本：

```json
{
  "case_id": "backend_write_tool_approval_001",
  "tool": "create_release_blocker",
  "approval_status": "not_approved",
  "expected_behavior": [
    "do_not_execute_write_tool",
    "emit_approval_required_event",
    "persist_pending_approval",
    "write_policy_decision_to_audit_log"
  ]
}
```

## 实践任务

1. 入门：画出 Agent 后端分层。

交付物：画出 API、Run、Runtime、Model Gateway、Tool Gateway、Context、State、Event、Trace 层。

自查标准：每层职责不能重复。

2. 初级：设计 Run API。

交付物：写出创建 run、查询 run、订阅事件、取消 run、提交审批的 API。

自查标准：创建接口返回 run_id，不等待最终答案。

3. 中级：设计数据库表。

交付物：设计 run、step、tool_call、approval、feedback 表的关键字段。

自查标准：每张表必须包含 tenant_ref、run_id 或可关联字段。

4. 高级：设计 Tool Gateway。

场景：`create_release_blocker` 是写工具。

交付物：说明 schema 校验、权限、审批、幂等、审计和错误分类。

自查标准：模型不能直接拿到真实凭证。

5. 生产化：设计 SSE 断线重连。

场景：用户在 step s2 期间刷新页面。

交付物：说明 snapshot、last_event_id、事件序号、最终回答落库和敏感数据处理。

自查标准：前端断线不影响后端 run。

参考答案要点：

- HTTP 请求不等于 Agent Run。
- 长任务应该由 Worker 执行，API 返回 run_id。
- SSE / WebSocket 是事件视图，不是权威状态。
- Tool Gateway 必须控制凭证、权限、幂等和审计。
- Memory、Context、Run State 要分开。
- 多租户隔离要覆盖数据库、向量库、对象存储、工具凭证和 trace。
- Spring AI / LangChain4j 可以复用模型、工具、memory、RAG 能力，但不能替代业务状态机和权限系统。

## 从入门到专业

- 入门：知道 Agent 后端不是一个 `/chat` 接口。
- 初级：能设计 run API 和流式事件。
- 中级：能设计 run / step 状态表、Tool Gateway 和 Context Service。
- 高级：能处理多租户、租约、outbox、幂等、恢复和成本归集。
- 专业：能把 Spring AI / LangChain4j 等框架能力纳入统一后端架构，而不是被框架牵着走。

完成任务 1 和 2，能理解后端分层；完成任务 3 和 4，能进入真实系统设计；完成任务 5，开始具备生产级用户体验和可靠性思维。

专业工程师不会问“用哪个框架能最快调模型”。他会问：“Run 状态在哪里？工具凭证在哪里？租户如何隔离？流式断线怎么恢复？框架能力如何被纳入统一治理？”

## 本章小结

AI Agent 后端架构解决的是“如何把 Agent 能力落到真实服务”的问题。模型调用只是其中一层，真正的后端还要管理 API、任务、状态、工具、上下文、记忆、事件、权限、观测、评估和发布。

本章建立了几个核心结论：

- HTTP 请求不是 Agent Run。
- 后端要拆分 API、Run、Runtime、Model Gateway、Tool Gateway、Context、State 和 Event。
- SSE / WebSocket 是事件视图，权威状态在后端。
- Memory、Context、RAG 和 Run State 要分清。
- 多租户隔离要贯穿数据库、向量库、工具、对象存储和 trace。
- Spring AI / LangChain4j 是能力组件，不是完整生产架构。
- 事务一致性要靠状态表、outbox、幂等和恢复策略。

下一章会进入可观测性与评估。第 19 章讲后端结构，第 20 章会把 trace、日志、指标、token、prompt 版本和 eval 数据集进一步展开，回答“系统出了问题时，如何知道发生了什么，以及如何证明修复有效”。

## Sources

以下来源按 2026-05-30 访问时理解；Spring AI 文档页面当前显示 1.1.7，本章按该页面公开能力边界理解。LangChain4j 也按当前官方文档能力边界理解。两者版本演进较快，因此正文不写死具体版本 API。

- [Spring AI Reference: Chat Client API](https://docs.spring.io/spring-ai/reference/api/chatclient.html)
- [Spring AI Reference: Advisors API](https://docs.spring.io/spring-ai/reference/api/advisors.html)
- [Spring AI Reference: Tool Calling](https://docs.spring.io/spring-ai/reference/api/tools.html)
- [Spring AI Reference: Chat Memory](https://docs.spring.io/spring-ai/reference/api/chat-memory.html)
- [Spring AI Reference: Observability](https://docs.spring.io/spring-ai/reference/observability/index.html)
- [LangChain4j Docs: Introduction](https://docs.langchain4j.dev/intro/)
- [LangChain4j Docs: AI Services](https://docs.langchain4j.dev/tutorials/ai-services/)
- [LangChain4j Docs: Tools](https://docs.langchain4j.dev/tutorials/tools/)
- [LangChain4j Docs: Chat Memory](https://docs.langchain4j.dev/tutorials/chat-memory/)
- [LangChain4j Docs: RAG](https://docs.langchain4j.dev/tutorials/rag/)

## 写作审查记录

### 章节架构师

- 本章目标：把 Harness、Runtime、Tool、Memory、Trace 等能力落到后端服务分层。
- 知识点地图：API Layer、Run Service、Runtime Engine、Model Gateway、Tool Gateway、Context / Memory Layer、State Store、Event Gateway、多租户隔离、Spring AI、LangChain4j、事务一致性和评估。
- 前后章节关系：承接第 18 章 Harness，为第 20 章可观测性与评估铺垫。

### 技术审稿人

- 发现问题：Spring AI 和 LangChain4j 版本演进快，不能把具体 API 细节写死或编造成稳定标准。
- 修订动作：使用官方文档确认 ChatClient、Advisors、Tool Calling、Chat Memory、Observability、AI Services、Tools、Memory、RAG 等能力边界；正文以架构接口和伪代码为主。
- 结论：章节没有编造具体类名或方法签名，框架能力表述保持在公开文档支持范围内。

### 工程审稿人

- 发现问题：如果只讲框架使用，无法支撑真实生产后端；初版 API、Run / Step、SSE、Tool Registry 和多租户隔离还缺少部分生产治理字段。
- 修订动作：补充任务 API、Run / Step 数据模型、幂等创建、事件序号和重连协议、Worker / Queue、SSE 事件、Model Gateway、Tool Gateway、Context / Memory、多租户强制机制、事务一致性、成本归集样本和写工具审批样本。
- 结论：章节能映射到真实 Java 后端系统，覆盖输入、处理、输出、状态、异常、权限、日志、评估和部署边界。

### 学习体验审稿人

- 发现问题：读者容易把 Agent 后端理解成同步 `/chat` 接口，或把框架能力等同于生产架构。
- 修订动作：沿用 kb-assistant 主线，从 Demo `/chat` 的局限进入任务 API、Worker、流式事件和多租户隔离，并用实践任务推动读者设计真实后端。
- 结论：章节能帮助读者从框架调用思维转向后端系统设计思维。

### 主编

- 最终调整：本章统一主线为“框架提供积木，后端架构决定生产边界”。
- 与全书衔接：第 18 章讲 Harness，本章讲后端结构，第 20 章将讲可观测性与评估。
- 后续章节提醒：第 20 章应避免重复后端分层，重点展开 trace schema、指标、日志、token、prompt 版本、eval 数据集和线上反馈分析。
