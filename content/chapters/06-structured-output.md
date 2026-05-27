# 第 6 章：结构化输出与可靠性

## 本章解决什么问题

第 4 章讲 Prompt Engineering，解决“让模型做什么”。第 5 章讲 Context Engineering，解决“模型看什么”。本章讲结构化输出，解决“模型生成的结果如何稳定进入程序”。

很多 AI 应用的 Demo 看起来很顺：用户问一句，模型回一段自然语言，页面展示出来。但真实后端系统不能只消费“看起来不错”的文字。系统需要字段、类型、状态、错误码、证据引用、人工确认标记和可审计日志。否则模型输出越自然，后端越难判断它能不能被执行。

例如会议纪要助手输出：

```text
本次会议确定下周五上线，张三负责压测，李四负责权限问题。
```

这段话读起来像结论，但程序很难安全地把它写入任务系统：

- “确定下周五上线”是否有原文证据？
- 张三是否真的负责压测，还是模型根据上下文猜的？
- 李四是负责人，还是只是提供接口文档？
- 截止时间是日期、自然语言，还是空值？
- 哪些字段缺失后必须人工确认？
- 写入任务系统前是否需要审批？

结构化输出要解决的不是“输出 JSON 好看一点”，而是把模型回答变成可解析、可校验、可追踪、可降级、可回放的结果对象。

本章要回答：

- 为什么自然语言输出不适合直接进入后端系统？
- JSON、JSON Schema、Structured Outputs、Function Calling、Tool Calling 有什么区别？
- “模型输出 JSON”为什么不等于“业务结果可靠”？
- 如何设计输出 Schema，让模型生成字段、后端计算字段、人工确认字段分清楚？
- 如何做解析校验、Schema 校验、引用校验、业务校验和安全校验？
- 输出格式错误、字段缺失、证据不匹配、置信度不足时应该如何重试、修复、降级或交给人工？
- OpenAI、Spring AI、LangChain4j、MCP、Claude Code 中，结构化输出分别落在哪些工程位置？
- 如何评估结构化输出的可靠性？

本章重点不是让读者记住各框架 API，而是理解它们分别落在输出约束、工具参数、工具结果、后端校验和自动化消费的哪些位置。

截至 2026-05，主流模型和框架都在增强原生结构化输出能力，但不同供应商、模型和 SDK 对 JSON Schema、strict mode、tool calling、top-level array、递归类型、多态类型等支持并不完全一致。本章不把某个能力写成所有模型通用事实。涉及具体 API、配置项和支持范围时，应以当前官方文档为准。

读完本章，读者应该能够为一个 Agent 任务设计输出契约，并把模型结果接入真实后端流程，而不是停留在“让模型输出一段 JSON”。

## 一个直观例子

继续使用会议纪要助手。用户上传会议记录，希望系统提取行动项，并在人工确认后写入任务系统。

原始会议片段：

```text
张三：上线时间先按下周五准备，但压测报告还没出来。
李四：权限问题需要有人跟进，我这边可以提供接口文档。
王五：如果压测不过，下周五不能发版。
```

一个常见坏 Prompt 会要求：

```text
请总结会议内容，并输出 JSON。
```

模型可能输出：

```json
{
  "summary": "会议确定下周五上线。",
  "tasks": [
    {"owner": "张三", "task": "完成压测报告", "due": "下周五"},
    {"owner": "李四", "task": "跟进权限问题", "due": "尽快"}
  ]
}
```

这个 JSON 格式正确，但业务含义不可靠：

- 会议没有“确定下周五上线”，只是“先按下周五准备”。
- 没有明确说张三负责压测报告。
- 李四说能提供接口文档，不等于负责权限问题。
- “尽快”不能直接进入任务系统作为截止时间。
- 没有任何证据引用。
- 没有标记哪些字段需要人工确认。

更可靠的输出契约应该先定义结果对象：

```json
{
  "summary": "团队讨论了下周五上线准备、压测报告和权限问题，但上线仍取决于压测结果。",
  "action_items": [
    {
      "task": "确认压测报告状态",
      "assignee": null,
      "due_date": null,
      "source_quote": "压测报告还没出来。",
      "confidence": "medium",
      "needs_human_review": true,
      "review_reason": "会议未明确负责人和截止时间"
    },
    {
      "task": "跟进权限问题并对接接口文档",
      "assignee": null,
      "due_date": null,
      "source_quote": "权限问题需要有人跟进，我这边可以提供接口文档。",
      "confidence": "medium",
      "needs_human_review": true,
      "review_reason": "会议未明确权限问题负责人"
    }
  ],
  "can_write_to_task_system": false
}
```

这个结果仍然需要后端校验，但它至少具备几个工程属性：

- 字段稳定，程序能解析。
- 缺失信息使用 `null`，而不是让模型猜。
- 每个行动项都有证据。
- 不确定性进入结构化字段。
- 是否能自动写入任务系统由字段显式表达。

再看第 5 章的研发排障助手。这个例子只用于承接上一章，暂时只关注字段如何表达证据和下一步动作；工具调用细节会放到后续章节继续展开。用户问：

```text
这个接口为什么最近开始返回 403？是不是权限改动导致的？
```

如果模型只输出：

```text
看起来很可能是权限配置变更导致的，可以检查 SecurityConfig。
```

后端系统无法判断这个结果是否能进入工单、是否能触发下一步工具调用、是否需要人工确认。更好的输出是：

```json
{
  "likely_cause": "role_mapping_changed",
  "confidence": "medium",
  "evidence": [
    {
      "type": "code",
      "source": "SecurityConfig.java",
      "claim": "finance_viewer 角色映射最近发生变更"
    },
    {
      "type": "log",
      "source": "masked_403_logs",
      "claim": "403 样本集中出现在 finance_viewer 角色"
    }
  ],
  "unverified_items": [
    "尚未读取网关策略变更记录"
  ],
  "next_action": {
    "type": "tool_call",
    "tool": "gateway_policy.diff",
    "reason": "确认网关侧是否也修改了权限策略"
  },
  "needs_human_review": true
}
```

这个对象可以进入后端流程：如果 `confidence` 不足或 `unverified_items` 非空，就不自动生成确定结论；如果 `next_action.type` 是 `tool_call`，系统可以判断工具是否允许、参数是否完整、是否需要审批。

结构化输出的核心价值在这里：它把“模型说了什么”变成“系统能判断下一步做什么”。

## 基础解释

### 自然语言输出

自然语言输出适合人读，但不适合程序直接执行。它的优点是灵活、表达丰富、适合解释；缺点是边界模糊、字段不稳定、很难自动校验。

例如：

```text
这个问题可能和权限配置有关，建议先检查最近的角色映射变更。
```

人能理解，但程序不知道：

- 原因字段是什么？
- “可能”对应什么置信度？
- 下一步动作是什么？
- 是否需要调用工具？
- 是否允许自动创建工单？
- 依据来自哪个上下文片段？

因此，生产系统通常会把自然语言解释作为一个字段，而不是把整段自然语言当成最终结果。

### 结构化输出

结构化输出是按照预定义结构生成的模型结果。它可以是 JSON、对象、表格、XML 或其他机器可解析格式。本书主要讨论 JSON，因为它最常见，也最容易映射到后端 DTO、数据库字段和 API 响应。

一个结构化输出对象通常包含：

- 业务字段：例如 `summary`、`action_items`、`category`、`likely_cause`。
- 证据字段：例如 `source_quote`、`citation_id`、`evidence`。
- 状态字段：例如 `confidence`、`needs_human_review`、`review_reason`。
- 控制字段：例如 `next_action`、`can_execute`、`retryable`。
- 错误字段：例如 `error_code`、`missing_fields`、`validation_errors`。

结构化输出不是为了让模型“像后端一样可靠”，而是为了让后端更容易判断模型结果是否能继续流转。

### JSON 与 JSON Schema

JSON 是数据格式。JSON Schema 是描述 JSON 结构和约束的规范。两者不是一回事。

JSON 示例：

```json
{
  "category": "permission_issue",
  "confidence": "medium"
}
```

JSON Schema 示例：

```json
{
  "type": "object",
  "properties": {
    "category": {
      "type": "string",
      "enum": ["permission_issue", "data_issue", "network_issue", "unknown"]
    },
    "confidence": {
      "type": "string",
      "enum": ["low", "medium", "high"]
    }
  },
  "required": ["category", "confidence"],
  "additionalProperties": false
}
```

JSON Schema 可以约束字段名、类型、枚举、必填字段、嵌套结构和是否允许额外字段。它能解决“形状是否符合契约”的问题，但不能保证“内容是否真实”。

例如下面结果符合 Schema，但事实可能仍然错误：

```json
{
  "category": "permission_issue",
  "confidence": "high"
}
```

如果上下文里没有权限配置和日志证据，`confidence: high` 只是模型生成的字符串，不是业务真实概率。

### JSON Mode、Structured Outputs 与 Tool Calling

不同模型供应商使用的术语不同，但工程上可以这样区分：

| 能力 | 解决的问题 | 典型边界 |
| --- | --- | --- |
| JSON Mode | 尽量保证输出是合法 JSON | 不一定保证符合你的业务 Schema |
| JSON Schema | 描述和校验 JSON 结构 | 它是规范，不是模型生成机制 |
| Structured Outputs | 供应商原生约束模型按 Schema 生成 | 仍需业务校验、事实校验、安全校验 |
| Function Calling / Tool Calling | 让模型选择工具并生成结构化入参 | 工具是否执行、参数是否合法由后端决定 |
| Tool Result Schema | 让工具返回值具备稳定结构 | MCP 有显式 `outputSchema`；其他平台通常需要应用侧自定义和校验 |

OpenAI 官方 Structured Outputs 支持通过 JSON Schema 约束模型输出；Function Calling 的 strict mode 也基于 structured outputs，并对参数 schema 有要求，例如对象需要设置 `additionalProperties: false`，属性需要标为 required。Spring AI 文档也提醒，prompt-based structured output converter 是 best effort，模型不保证一定按要求输出，仍要做验证机制。

因此，本章一直强调：结构化输出是可靠性的基础，不是可靠性的全部。

### 输出契约与业务契约

输出契约描述模型返回对象的格式。业务契约描述系统能否执行下一步动作。

例如会议纪要助手的输出契约可以要求：

```json
{
  "task": "string",
  "assignee": "string or null",
  "due_date": "ISO date or null",
  "source_quote": "string",
  "needs_human_review": "boolean"
}
```

但业务契约还要判断：

- `assignee` 是否是系统中真实用户？
- `due_date` 是否是合法工作日？
- `source_quote` 是否真的来自会议记录？
- `needs_human_review` 为 false 时，是否满足自动写入条件？
- 当前用户是否有权限创建任务？

不要把业务契约全部交给模型。模型可以给出候选结构，后端必须拥有最终解释权和执行权。

## 核心原理

### 原理一：格式正确不等于结果正确

结构化输出首先解决解析问题：程序能不能把模型输出变成对象。但真实系统关心的不只是能不能解析，还包括字段是否准确、证据是否匹配、业务规则是否通过。

可以把校验分成五层：

| 层级 | 解决的问题 | 示例 |
| --- | --- | --- |
| 解析校验 | 是不是合法 JSON | JSON 是否缺少引号或括号 |
| Schema 校验 | 是否符合字段、类型、枚举 | `confidence` 是否只能是 low/medium/high |
| 引用校验 | 证据是否存在 | `source_quote` 是否来自会议原文 |
| 业务校验 | 是否符合业务规则 | assignee 是否是有效员工 |
| 安全校验 | 是否允许继续执行 | 当前用户是否能创建任务 |

很多线上问题发生在第二层之后。JSON 能解析，Schema 也通过，但引用是假的、负责人是猜的、业务权限不满足，最后错误数据被写进系统。

### 原理二：Schema 约束形状，不约束事实

Schema 可以规定 `due_date` 是字符串，甚至要求它符合日期格式，但它不知道这个日期是不是会议里真的出现过。

例如：

```json
{
  "due_date": "2026-06-05",
  "source_quote": "上线时间先按下周五准备"
}
```

如果会议记录没有明确“截止日期是 2026-06-05”，后端不能只因为字段格式正确就自动创建任务。它还要检查：

- 日期是否从原文可推导？
- 原文中的“下周五”是否有会议日期上下文？
- 这是准备目标还是确定截止日期？
- 是否需要人工确认？

这就是结构化输出和上下文证据必须绑定的原因。

### 原理三：字段设计决定可靠性上限

很多结构化输出不稳定，不是模型太差，而是字段设计本身不适合模型生成。

坏字段：

```json
{
  "is_problem_solved": true
}
```

这个字段过于概括。模型可能根据语气判断“解决了”，但真实系统需要知道解决标准。

更好的字段：

```json
{
  "diagnosis_status": "needs_more_evidence",
  "verified_evidence_count": 2,
  "unverified_items": ["gateway policy diff"],
  "can_close_ticket": false
}
```

字段设计要遵守几个原则：

- 能枚举就不要自由文本。
- 不确定要显式表达，不要让模型猜。
- 高风险结论要带证据。
- 可执行动作要拆成候选动作和后端批准状态。
- 后端能计算的字段不要让模型生成。

### 原理四：失败也是输出契约的一部分

生产系统不能只定义成功结构，还要定义失败结构。

例如模型无法提取行动项时，不应该自由输出：

```text
抱歉，我不太确定。
```

而应该输出：

```json
{
  "status": "insufficient_information",
  "action_items": [],
  "missing_information": [
    "没有明确负责人",
    "没有明确截止时间"
  ],
  "needs_human_review": true
}
```

这样后端可以进入人工确认流程，而不是把失败当成正常空结果。

失败结构至少应覆盖：

- 输入不足。
- 上下文缺失。
- 引用不匹配。
- Schema 无法满足。
- 安全拒绝。
- 需要人工确认。
- 需要调用工具补证据。

### 原理五：重试不是万能修复

模型输出格式错了，可以重试。但重试也会带来成本、延迟和新错误。

常见错误做法是：

```text
上一次 JSON 格式错了，请修复。
{bad_output}
```

如果直接把坏输出塞回上下文，模型可能保留错误事实，只是修正格式。更好的做法是区分错误类型：

- 只是 JSON 语法错误：可以用解析器或小模型做格式修复。
- 缺少必填字段：重新生成时只提供原始上下文和 Schema，不把坏结论当事实。
- 引用不存在：要求模型重新基于证据生成，或降级为人工确认。
- 业务校验失败：不要让模型“改到通过”，应由后端返回明确失败原因。
- 安全校验失败：直接阻断，不应继续让模型尝试绕过。

重试策略必须有上限，并记录每次失败原因。否则系统会出现“越修越像真的错误结果”。

## 工程实现

### 一个结构化输出处理流水线

下面是一个不绑定框架的抽象流水线：

```text
ContextPackage
  -> 选择输出契约
  -> 组装 Prompt / Schema / Tool Definition
  -> 调用模型
  -> 解析输出
  -> Schema 校验
  -> 引用校验
  -> 业务校验
  -> 安全校验
  -> 决定：自动执行 / 重试 / 降级 / 人工确认 / 拒绝
  -> 记录 OutputSnapshot
  -> 更新任务状态
```

第 5 章的 `ContextPackage` 解决输入侧。本章可以引入对应的输出侧对象：

```json
{
  "StructuredOutputRequest": {
    "request_id": "req_001",
    "task_type": "meeting_action_item_extraction",
    "schema_version": "meeting-actions-v3",
    "context_package_id": "ctx_pkg_001",
    "retry_policy": {
      "max_attempts": 2,
      "retry_on": ["parse_error", "schema_error"],
      "do_not_retry_on": ["permission_denied", "safety_violation"]
    }
  }
}
```

```json
{
  "OutputValidationResult": {
    "request_id": "req_001",
    "parse_valid": true,
    "schema_valid": true,
    "citation_valid": false,
    "business_valid": false,
    "safety_valid": true,
    "errors": [
      {
        "code": "CITATION_NOT_FOUND",
        "field": "action_items[0].source_quote",
        "message": "source_quote does not appear in transcript"
      }
    ],
    "decision": "needs_human_review"
  }
}
```

```json
{
  "OutputSnapshot": {
    "request_id": "req_001",
    "trace_id": "tr_abc",
    "tenant_id": "t_001",
    "user_id_hash": "sha256:...",
    "schema_version": "meeting-actions-v3",
    "prompt_version": "meeting-extract-v8",
    "context_package_id": "ctx_pkg_001",
    "context_policy_version": "ctx-meeting-v4",
    "output_mode": "json_schema",
    "model": "selected-by-runtime",
    "attempt": 1,
    "retry_count": 0,
    "validation_result": "citation_failed",
    "decision": "needs_human_review",
    "decision_reason": "source_quote does not match transcript",
    "validator_errors": ["CITATION_NOT_FOUND"],
    "tool_call_ids": [],
    "token_usage": {
      "input_tokens": 6200,
      "output_tokens": 900
    },
    "latency_ms": {
      "model": 1800,
      "validation": 120
    },
    "stored_output": "redacted_ref",
    "redaction_policy": "pii-redaction-v2",
    "retention_days": 30,
    "created_at": "2026-05-28T10:30:00+08:00"
  }
}
```

关键点是：模型输出、校验结果、执行决策要分开。不要让模型直接决定是否写数据库。

日志不要只记录最终 JSON。至少要记录输入引用、上下文版本、Prompt 版本、Schema 版本、输出模式、校验结果、决策原因、重试次数、成本和耗时。敏感正文应脱敏或只保存引用，避免为了排障制造新的数据泄漏面。

### 最小闭环先掌握什么

在进入框架细节前，先掌握一个最小闭环：

| 步骤 | 要做的事 | 会议纪要例子 |
| --- | --- | --- |
| 输出契约 | 定义字段、类型、枚举、失败状态 | `action_items`、`source_quote`、`needs_human_review` |
| 解析 | 把模型输出转成对象 | JSON parse 成 DTO |
| Schema 校验 | 检查字段和类型 | `confidence` 只能是 low/medium/high |
| 引用校验 | 检查证据是否真实存在 | `source_quote` 必须来自会议原文 |
| 业务门禁 | 判断是否允许执行 | 负责人和截止时间缺失时不能写任务系统 |
| 人工确认 | 高风险或证据不足时进入人工流程 | 让用户确认负责人和日期 |

后面的 Spring AI、LangChain4j、OpenAI、MCP、Claude Code 小节只是不同技术栈中的落点速览。不要先被 API 名称带偏，先把这个闭环跑通。

### 结构化输出请求状态机

真实后端需要状态机，而不是只在内存里 try-catch。

| 状态 | 触发条件 | 下一步 |
| --- | --- | --- |
| `created` | 收到请求，已选择 Schema | 调用模型 |
| `model_called` | 模型请求已发出 | 等待输出或超时 |
| `parse_failed` | JSON 解析失败 | 可重试或进入人工确认 |
| `schema_failed` | Schema 校验失败 | 可重试；超过上限进入人工确认 |
| `validation_failed` | 引用、业务或安全校验失败 | 业务失败可人工确认；安全失败拒绝 |
| `retry_pending` | 满足重试条件且未超过上限 | 重新生成或格式修复 |
| `human_review` | 需要人工确认 | 等待人工覆盖或驳回 |
| `auto_executed` | 所有门禁通过且已执行 | 终态 |
| `rejected` | 安全失败、权限失败或人工驳回 | 终态 |
| `dead_letter` | 系统异常超过重试上限 | 人工排障 |

每个状态变更都要记录 `request_id`、`attempt`、`schema_version`、`decision_reason` 和操作者。自动写入任务系统、调用工具、发送通知这类副作用动作必须幂等：重复回调或重复提交时，应根据业务幂等键识别已经执行过的动作，而不是再次执行。

### 输出 Schema 设计流程

设计输出 Schema 可以按七步走：

1. 定义下游消费者。

   谁会消费这个输出？前端页面、任务系统、工单系统、审批流、评估系统，还是另一个 Agent？

2. 定义允许动作。

   这个输出只是展示，还是会触发工具调用、写数据库、发通知、关闭工单？

3. 区分字段来源。

   哪些字段由模型生成，哪些由后端填充，哪些来自工具，哪些由人工确认？

4. 设计最小字段集。

   不要为了“完整”加入太多字段。字段越多，稳定性和校验成本越高。

5. 设计失败状态。

   明确 `status`、`missing_information`、`needs_human_review`、`review_reason`。

6. 设计证据绑定。

   需要自动执行或高风险结论时，必须有 `source_quote`、`citation_id`、`evidence` 或可回放引用。

7. 设计版本和迁移。

   Schema 变更会影响前端、后端、评估集和历史数据。必须有 `schema_version`。

### 字段分类

不是所有字段都应该由模型生成。

| 字段类型 | 推荐来源 | 示例 |
| --- | --- | --- |
| 模型生成字段 | 需要语义理解的分类、摘要、候选结论 | `summary`、`likely_cause`、`action_item.task` |
| 后端计算字段 | 权限、用户 ID、系统状态、是否可执行 | `can_write_to_task_system`、`tenant_id` |
| 工具返回字段 | 实时查询结果、代码 diff、日志统计 | `total_hits`、`commit_id` |
| 人工确认字段 | 高风险判断、缺失信息补充 | `approved_by`、`confirmed_due_date` |
| 校验派生字段 | 校验后产生的状态 | `citation_valid`、`business_valid` |

一个常见反模式是让模型输出：

```json
{
  "can_refund": true
}
```

退款权限应该由后端根据用户、订单状态、支付状态和政策计算，而不是模型生成。模型最多可以输出：

```json
{
  "refund_intent_detected": true,
  "reason_summary": "用户要求取消订单并退款",
  "needs_policy_check": true
}
```

### 会议纪要助手 Schema 示例

下面是一个简化 JSON Schema。它不是完整规范手册，只展示 Agent 工程常用设计。

```json
{
  "type": "object",
  "properties": {
    "schema_version": {
      "type": "string",
      "enum": ["meeting-actions-v1"]
    },
    "summary": {
      "type": "string"
    },
    "action_items": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "task": {"type": "string"},
          "assignee": {"type": ["string", "null"]},
          "due_date": {
            "type": ["string", "null"],
            "description": "Use ISO-8601 date when explicit or safely derivable; otherwise null."
          },
          "source_quote": {"type": "string"},
          "confidence": {
            "type": "string",
            "enum": ["low", "medium", "high"]
          },
          "needs_human_review": {"type": "boolean"},
          "review_reason": {"type": ["string", "null"]}
        },
        "required": [
          "task",
          "assignee",
          "due_date",
          "source_quote",
          "confidence",
          "needs_human_review",
          "review_reason"
        ],
        "additionalProperties": false
      }
    },
    "global_risks": {
      "type": "array",
      "items": {"type": "string"}
    }
  },
  "required": ["schema_version", "summary", "action_items", "global_risks"],
  "additionalProperties": false
}
```

几个设计点：

- 使用 `schema_version`，方便后续迁移。
- `assignee` 和 `due_date` 允许 `null`，避免模型猜测。
- `confidence` 用枚举，不用自由数字。
- `source_quote` 必填，便于引用校验。
- `needs_human_review` 和 `review_reason` 让失败进入流程。
- `additionalProperties: false` 防止模型生成未知字段。

### 研发排障助手 Schema 示例

研发排障输出更接近诊断对象：

```json
{
  "type": "object",
  "properties": {
    "schema_version": {"type": "string", "enum": ["debug-diagnosis-v1"]},
    "diagnosis_status": {
      "type": "string",
      "enum": ["likely_cause_found", "needs_more_evidence", "no_issue_found", "blocked"]
    },
    "likely_cause": {
      "type": ["string", "null"],
      "enum": [
        "role_mapping_changed",
        "gateway_policy_changed",
        "token_expired",
        "request_malformed",
        "unknown",
        null
      ]
    },
    "confidence": {"type": "string", "enum": ["low", "medium", "high"]},
    "evidence": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "source_type": {"type": "string", "enum": ["code", "log", "config", "tool_result"]},
          "source_id": {"type": "string"},
          "claim": {"type": "string"}
        },
        "required": ["source_type", "source_id", "claim"],
        "additionalProperties": false
      }
    },
    "unverified_items": {
      "type": "array",
      "items": {"type": "string"}
    },
    "next_action": {
      "type": "object",
      "properties": {
        "type": {"type": "string", "enum": ["none", "ask_user", "tool_call", "human_review"]},
        "tool": {"type": ["string", "null"]},
        "reason": {"type": "string"}
      },
      "required": ["type", "tool", "reason"],
      "additionalProperties": false
    }
  },
  "required": [
    "schema_version",
    "diagnosis_status",
    "likely_cause",
    "confidence",
    "evidence",
    "unverified_items",
    "next_action"
  ],
  "additionalProperties": false
}
```

这个 Schema 允许模型表达“不足以判断”。对于排障场景，这比强迫模型给确定原因更可靠。

### 校验链路

一个生产级校验链路可以这样设计：

```text
raw_model_output
  -> parseJson()
  -> validateSchema()
  -> validateCitations()
  -> validateBusinessRules()
  -> validateSafetyRules()
  -> decideNextStep()
```

伪代码：

```java
// 伪代码：说明职责，不代表某个框架 API
OutputValidationResult validate(ModelOutput output, ContextPackage context) {
    ParsedJson parsed = parser.parse(output.rawText());
    if (!parsed.valid()) {
        return OutputValidationResult.parseError(parsed.error());
    }

    SchemaResult schema = schemaValidator.validate(parsed.value(), "debug-diagnosis-v1");
    if (!schema.valid()) {
        return OutputValidationResult.schemaError(schema.errors());
    }

    CitationResult citations = citationValidator.check(parsed.value(), context.segments());
    BusinessResult business = businessValidator.check(parsed.value());
    SafetyResult safety = safetyValidator.check(parsed.value());

    return decisionEngine.decide(schema, citations, business, safety);
}
```

引用校验很关键。例如 `source_quote` 必须出现在会议原文或可追溯片段中；`source_id` 必须是本次 `ContextPackage` 中真实注入过的片段；`claim` 不能引用用户无权限查看的材料。

### 修复与重试策略

不同错误需要不同处理：

| 错误类型 | 例子 | 处理动作 |
| --- | --- | --- |
| 解析错误 | JSON 少了括号 | 可以格式修复或一次重试 |
| Schema 错误 | enum 值不合法 | 重新生成，强调合法枚举 |
| 字段缺失 | 少了 `source_quote` | 重试时提供 Schema 和原始上下文 |
| 引用失败 | 引用了不存在的日志 | 不自动修复事实，要求重新基于证据生成 |
| 业务失败 | assignee 不是系统用户 | 后端标记人工确认或要求用户选择 |
| 安全失败 | 输出敏感字段 | 阻断，记录安全事件，不继续重试 |
| 置信度不足 | `confidence=low` | 降级为人工确认或追加工具调用 |

重试 Prompt 不应该把错误输出当成事实。一个更安全的重试输入是：

```text
上一次输出未通过校验。

错误：
- action_items[0].source_quote 不存在于会议原文。

请只基于原始会议记录重新生成。
如果没有证据，请将对应字段设为 null 或 needs_human_review=true。
不要沿用上一次输出中的事实结论。
```

重试上限通常应该很低。格式类问题可以重试；事实、权限、安全类问题应该优先降级或人工确认。

### 系统异常与业务异常分层

输出校验失败只是异常的一类。生产系统还要区分模型服务、工具、存储和审批链路的故障。

| 异常类别 | 例子 | 处理动作 |
| --- | --- | --- |
| 模型输出错误 | parse error、schema error、citation error | 按错误类型修复、重试、人工确认 |
| 模型服务错误 | 超时、限流、供应商 5xx | 指数退避重试；超过上限降级或排队 |
| 工具错误 | MCP server 异常、工具超时、工具返回 `isError` | 注入结构化错误或进入工具重试；高风险工具失败不自动绕过 |
| 存储错误 | 输出快照写入失败、任务系统写入失败 | 不确认执行成功；进入重试队列或死信队列 |
| 审批错误 | 人工确认服务不可用、审批超时 | 保持 `human_review` 状态，不自动执行 |
| 部分成功 | 草稿创建成功但通知失败 | 记录补偿任务，避免重复创建业务对象 |

系统异常和业务异常不要混在一个 `retry=true` 里。模型服务限流可以重试；安全校验失败不能重试；任务系统写入失败要关注幂等和补偿；审批系统不可用要保持待确认状态。

### 自动写入的安全门禁

结构化输出进入业务系统前，要设置安全门禁。以会议纪要写入任务系统为例，自动写入必须同时满足：

- JSON 解析通过。
- Schema 校验通过。
- 每个行动项都有 `source_quote`。
- `assignee` 是系统中真实成员。
- `due_date` 是合法日期，且来源可追溯。
- `needs_human_review=false`。
- 当前用户有创建任务权限。
- 任务系统没有重复任务。
- 高风险关键词未触发人工确认策略。

否则只能生成草稿或进入人工确认。

这个门禁应该由后端实现，而不是让模型输出 `can_write_to_task_system=true` 后就直接执行。模型可以提供候选判断，但最终执行权属于业务系统。

### 部署与版本治理

结构化输出一旦被前端、后端、任务系统、评估系统或脚本消费，就变成接口契约。Schema 变更需要按发布管理处理。

上线时要考虑：

- Schema 兼容性：新增字段优先设计为向后兼容；删除字段、改类型、改枚举属于高风险变更。
- 双版本并行：新旧消费者同时存在时，后端要能按 `schema_version` 路由校验和解析。
- consumer 升级顺序：先让消费者兼容新旧版本，再让模型开始输出新版本。
- 灰度开关：按租户、用户、任务类型或流量比例启用新 Schema。
- 回滚条件：parse error、schema error、citation error、人工确认率、成本或延迟异常时回滚。
- 历史快照迁移：旧 `OutputSnapshot` 不要强行改写，可通过迁移视图或适配层读取。
- CI 回归门禁：Schema、Prompt、模型、上下文策略变更前跑固定评估集。
- 降级路径：新结构失败时可以回退到草稿、人工确认或旧 Schema，而不是继续自动执行。

不要只把 Schema 当成 Prompt 附件。它是跨系统契约，必须能评审、灰度、监控和回滚。

### Java / Spring AI 中的工程位置

Spring AI 提供 `StructuredOutputConverter` 抽象，以及 `BeanOutputConverter`、`MapOutputConverter`、`ListOutputConverter` 等实现，用于把模型输出转成 Java 类型。官方文档也说明，converter 会在调用前提供格式说明，在调用后把文本转换成目标类型；同时提醒这是 best effort，需要额外验证机制。

Spring AI 还支持 native structured output：当模型支持原生结构化输出时，可以通过相关 advisor 参数使用模型的 JSON Schema 能力，而不是只靠 Prompt 中的格式说明。具体支持模型和配置项会变化，应以当前官方文档为准。

工程落点可以这样设计：

```text
ChatClient / ChatModel
  -> StructuredOutputConverter 或 native structured output
  -> DTO 反序列化
  -> Bean Validation / 自定义 Validator
  -> CitationValidator
  -> BusinessRuleValidator
  -> DecisionEngine
```

不要把 `entity(MyDto.class)` 或 converter 成功当成最终可靠。它只说明“模型输出能转成 Java 对象”，不说明这个对象能安全写入业务系统。

### Java / LangChain4j 中的工程位置

LangChain4j 官方文档说明，它支持在低层 `ChatModel` API 和高层 AI Service API 中使用 JSON Schema 功能；当 AI Service 方法返回 POJO、模型支持 JSON Schema 且配置启用时，可以基于返回类型生成响应格式。文档也提到，如果模型不支持或未启用 JSON Schema，AI Service 会回退到 prompt-based 格式指令。fallback 还可能因为返回类型不支持、streaming mode、递归或多态支持不足而发生，生产日志要记录实际输出模式。

这给 Java 后端一个清晰边界：

- AI Service 返回类型适合表达输出 DTO。
- JSON Schema 能力适合约束形状。
- 业务校验仍要在服务层完成。
- 如果发生 fallback，可靠性可能下降，必须在日志中记录输出模式。

一个合理分层是：

```text
AiService.extractActionItems(...)
  -> MeetingActionResult DTO
  -> MeetingActionValidator
  -> TaskDraftService
  -> HumanReviewWorkflow
```

不要把 AI Service 接口设计得像普通确定性服务。它的返回值需要经过校验和决策后才能进入业务流程。

### OpenAI API 中的工程位置

OpenAI Structured Outputs 可以通过 JSON Schema 约束模型输出。在 Responses API 中，可以使用 `text.format` 的 `json_schema` 等形式；Function Calling 的 strict mode 也要求函数参数可靠匹配 schema。官方 Function Calling 文档建议 strict mode，并说明 strict mode 对 schema 有要求，例如对象的 `additionalProperties` 和 required 字段。

使用 OpenAI Structured Outputs 时要先处理安全拒绝、响应截断、不完整状态和供应商错误，再解析业务对象。`strict: true` 下的 schema 需要符合 OpenAI 支持的 JSON Schema 子集；对象通常要设置 `additionalProperties: false`，字段通常需要 required，可选值可以用 `null` 表达。不同 API 和 SDK 对 strict 的默认行为可能不同，工程实现要以当前官方文档和实际响应为准。

工程上要区分：

- Structured Outputs：用于让模型直接生成结构化回答。
- Function Calling：用于让模型生成工具调用参数。
- Tool Result：工具执行后返回给模型或系统的结构化结果。

例如：

```text
用户问题 -> 模型输出 next_action.tool_call -> 后端校验工具名和参数 -> 工具执行 -> 工具结果进入下一轮上下文 -> 模型输出诊断结果
```

模型生成 tool call 参数不代表工具必须执行。后端仍然要做权限、参数、预算、审批和幂等校验。

### MCP 中的结构化结果

MCP tool definition 包含 `inputSchema`，也可以包含可选的 `outputSchema`。在 MCP 2025-06-18 及之后的规范中，工具可以在结果的 `structuredContent` 字段返回结构化 JSON；如果提供了 output schema，server 应提供符合 schema 的结构化结果，client 应验证。为了兼容旧客户端，返回 `structuredContent` 时也应在 `content` 的 TextContent 中返回序列化 JSON。

这对 Agent 工程很重要：

- `inputSchema` 约束工具入参。
- `outputSchema` 约束工具出参。
- `structuredContent` 让工具结果更容易被模型和客户端处理。
- `isError: true` 表示工具执行错误，不应被当成协议错误或普通成功结果。

设计 MCP 工具时，应避免只返回自然语言：

```json
{
  "content": [
    {"type": "text", "text": "Found 128 errors"}
  ]
}
```

更好的工具结果是：

```json
{
  "content": [
    {
      "type": "text",
      "text": "{\"total_hits\":128,\"top_error_code\":\"AUTH_ROLE_DENIED\",\"samples_ref\":\"log://query/abc123\"}"
    }
  ],
  "structuredContent": {
    "total_hits": 128,
    "top_error_code": "AUTH_ROLE_DENIED",
    "time_range": "2026-05-26T10:00:00+08:00/2026-05-26T11:00:00+08:00",
    "samples_ref": "log://query/abc123"
  }
}
```

结构化工具结果要和权限、脱敏、大小限制和审计一起设计。

### Claude Code 中的结构化输出实践

Claude Code 场景里，结构化输出常用于自动化和团队流程，而不只是 API 返回。

截至 2026-05，Claude Code 官方 CLI 文档支持 print mode 的 `--output-format json` 和 `--output-format stream-json`，适合脚本消费会话或流事件；还提供 `--json-schema`，用于在 print mode 下得到匹配 JSON Schema 的验证输出。要区分两层：`--output-format` 是传输和事件格式，`--json-schema` 才是最终任务结果的结构约束。

hooks 文档也说明 hooks 可以通过 stdout 返回结构化 JSON。常见字段包括用于阻塞的 `decision: "block"`、用于权限请求的 `permissionDecision: "allow" | "deny" | "ask"`，以及在部分事件中添加上下文的 `additionalContext`。具体字段随 hook 事件不同而不同，应以当前官方文档为准。

可落地实践包括：

- 子 Agent 审查输出使用固定结构：`findings`、`severity`、`file`、`line`、`must_fix`。
- 计划输出使用固定结构：`tasks`、`files`、`verification`、`risk`。
- hooks 输出使用 JSON 控制 block、approve、additionalContext 等行为。
- CI 脚本调用 Claude Code 时使用 `--output-format json` 或 `stream-json` 解析会话事件；需要最终业务对象时使用 `--json-schema` 约束结果。
- `CLAUDE.md` 或项目规则中只定义输出格式和验收标准，不把安全边界只交给自然语言约束。

一个代码审查子 Agent 的输出契约可以是：

```json
{
  "schema_version": "code-review-v1",
  "status": "completed",
  "findings": [
    {
      "severity": "high",
      "file": "src/main/java/.../PaymentService.java",
      "line": 128,
      "title": "Missing authorization check",
      "evidence": "method updates payment status without checking tenant scope",
      "must_fix": true
    }
  ],
  "errors": [],
  "blocking": true,
  "exit_code_policy": "block_on_high_or_parse_error",
  "summary": "Found one high-risk authorization issue.",
  "needs_human_review": true
}
```

不要只要求“请认真审查代码”。如果输出要进入脚本、CI、任务系统或多 Agent 协作，就要有结构化契约和失败处理。脚本应按 `status`、`errors`、`blocking`、`findings[].severity` 等字段判断结果，而不是解析自然语言中的“通过”“失败”。

### 生产踩坑记录：JSON 通过了，任务系统脏了

下面是一个生产系统中常见故障模式的抽象，不指向某一家具体公司。

某团队做会议纪要 Agent，目标是自动生成任务草稿。第一版只要求模型“输出 JSON”，后端能解析就写入任务系统。上线后出现几个问题：

- 模型把“可以提供接口文档”的人当成任务负责人。
- “下周五准备上线”被写成确定截止日期。
- 会议没有明确负责人的事项，被模型补上了最可能的人。
- 后端只校验 JSON 格式，没有校验 source_quote 和 assignee。
- 人工发现错误后，日志里只有最终 JSON，没有原始证据和校验结果。

修复后，团队做了四件事：

- Schema 中允许 `assignee=null` 和 `due_date=null`。
- 每个行动项必须有 `source_quote`。
- 写入任务系统前校验负责人、日期和引用。
- 不能自动确认的任务进入人工确认队列。

事故的根因不是“模型不会写 JSON”，而是团队把“JSON 可解析”误当成“业务可执行”。

## 适用场景

同一个“会议纪要写入任务系统”用例，在不同成熟度下差异很大：

| 维度 | 玩具 Demo | 个人效率工具 | 团队内部工具 | 企业级系统 |
| --- | --- | --- | --- | --- |
| Schema | 简单 JSON 示例 | 本地可编辑结构 | 版本化 DTO / API 契约 | 多版本 Schema、兼容和迁移 |
| 状态 | 无状态或内存变量 | 本地草稿状态 | 任务状态机、人工确认状态 | 可审计状态机、幂等和补偿 |
| 权限 | 默认单用户 | 个人授权 | 用户、项目、系统权限 | 租户、角色、字段级权限 |
| 日志 | 打印输入输出 | 保存本地记录 | OutputSnapshot 和校验日志 | 脱敏快照、保留周期、审计回放 |
| 人工确认 | 手动看一眼 | 用户编辑后写入 | 队列化审核 | 审批流、SLA、人工覆盖记录 |
| 评估 | 人工试几条 | 个人样例集 | CI 回归评估 | 发布门禁、线上抽样、告警 |
| 部署 | 本地脚本 | 个人机器或云函数 | 服务化和灰度 | 多环境、灰度、回滚、迁移 |
| 成本控制 | 不关注 | 限制重试 | 请求级预算 | 租户预算、限流、成本告警 |

### 玩具 Demo

玩具 Demo 可以让模型输出简单 JSON，例如：

```json
{
  "sentiment": "positive",
  "summary": "用户喜欢这个功能"
}
```

这适合理解结构化输出的基本流程，但它通常不包含版本、证据、校验、失败状态和人工确认。Demo 中“能解析”不等于生产中“能使用”。

### 个人效率工具

个人工具可以用结构化输出提升自动化程度。例如：

- 把读书笔记整理成卡片。
- 把邮件整理成待办。
- 把代码审查结果整理成清单。
- 把日程文本转换成日历草稿。

个人场景可以容忍更多人工修正，但仍建议：

- 保留原文证据。
- 不自动执行高风险动作。
- 结构化输出失败时保留自然语言解释。
- 让用户能编辑结果后再写入系统。

### 团队内部工具

团队工具开始需要统一契约。一个研发排障助手输出的 `diagnosis_status`、`evidence`、`next_action`，可能会被前端、工单系统、日志平台和评估系统同时使用。

团队内部工具需要：

- Schema 版本管理。
- DTO 和 API 契约评审。
- 输出校验日志。
- 人工确认队列。
- 重试和降级策略。
- 评估集回归。

结构化输出一旦被多个系统消费，就不再是 Prompt 细节，而是系统接口。

### 企业级系统

企业级系统对结构化输出的要求更高：

- 多租户隔离。
- 合规审计。
- 字段级脱敏。
- 高风险动作审批。
- SLA 和降级策略。
- Schema 灰度和回滚。
- 输出快照和上下文快照关联。
- 人工覆盖记录。

例如客服退款 Agent 可以让模型识别退款意图和总结原因，但退款资格、金额、通道、审批和执行必须由后端确定。结构化输出只能进入决策链路，不能绕过决策链路。

## 不适用场景

以下场景不应该依赖模型结构化输出做最终决策：

- 金额计算、税费计算、库存扣减。
- 权限判断、风控拦截、合规判定。
- 支付、退款、转账、发版、删除数据等高风险动作。
- 没有足够上下文证据，却要求模型给确定字段。
- 需要强一致事务的系统状态变更。
- 对字段准确率要求极高，但没有人工确认或后端验证。
- 业务规则已经明确，可以用确定性代码实现。

判断标准：如果错误字段会直接造成资金、安全、权限、合规或数据一致性问题，就不能只靠模型输出。模型可以生成候选，后端必须验证和执行。

## 常见坑与反模式

1. 只写“请输出 JSON”。

没有 Schema、没有字段解释、没有失败结构，模型很容易生成看似合理但不可控的 JSON。

2. 把 JSON Mode 当成 Schema 校验。

JSON Mode 通常解决合法 JSON，不等于符合业务字段契约。

3. Schema 太宽。

大量自由字符串、可选字段、任意对象，会让结构化输出失去约束价值。

4. Schema 太复杂。

字段过多、嵌套太深、多态复杂，会降低模型稳定性，也增加校验和迁移成本。

5. 让模型生成后端应计算的字段。

例如 `can_refund`、`has_permission`、`is_duplicate` 应由系统判断。

6. `confidence` 被当成真实概率。

模型输出的置信度是自我表达，不是经过校准的统计概率。它只能作为弱信号。

7. 引用不校验。

模型可能生成不存在的 `source_quote`、文件名、日志 ID 或文档标题。

8. 自动修复后跳过业务校验。

修好 JSON 语法，不代表事实和业务规则正确。

9. 重试污染上下文。

把错误输出直接放回上下文，可能让模型继续沿用错误事实。

10. Claude Code 输出给脚本解析，但没有稳定契约。

脚本依赖自然语言中的“通过”“失败”“建议”，一旦模型措辞变化，自动化就会出错。脚本需要 JSON 契约和退出条件。

## 安全、成本与性能考虑

### 安全

结构化输出的安全重点是：不要让模型生成可以绕过后端控制的字段。

关键措施：

- 高风险动作使用后端权限和人工确认。
- 敏感字段默认不输出，必要时输出脱敏引用。
- 输出字段最小化，避免泄漏上下文中不必要的信息。
- `source_quote`、`evidence`、`citation_id` 要按用户权限过滤。
- 安全校验失败时阻断，不进入自动修复循环。
- 输出快照要脱敏存储。
- 多租户系统中，输出不得包含其他租户的引用 ID 或资源路径。

结构化输出不是安全边界。Schema 可以限制形状，但不能替代权限系统、审计系统和业务规则。

### 成本

结构化输出会增加成本：

- Schema 和格式说明会占用输入 token。
- 复杂结构会增加输出 token。
- 校验失败会触发重试。
- 引用校验和业务校验需要额外查询。
- 人工确认会增加运营成本。

成本控制方法：

- 保持 Schema 最小化。
- 拆分任务，不让一个输出对象承担所有职责。
- 对低风险场景使用简单结构，对高风险场景使用完整校验链。
- 只对可修复错误重试。
- 记录 parse error、schema error、citation error 的比例，定位高成本来源。

### 性能

性能问题主要来自三个环节：

- 模型生成复杂 JSON 较慢。
- 失败重试增加端到端延迟。
- 后端校验需要查询用户、权限、文档、日志或业务系统。

优化方法：

- 把实时业务校验并行化。
- 对稳定 Schema 做本地缓存。
- 对大数组设置数量上限。
- 对长任务使用异步处理和人工确认队列。
- 流式场景中避免把半截 JSON 当成最终结果消费。

不要为了减少一次校验而牺牲业务可靠性。结构化输出的性能目标是可控延迟，而不是跳过验证。

## 如何评估效果

结构化输出的评估要分层：

| 指标 | 含义 |
| --- | --- |
| Parse Success Rate | 输出能否被解析为 JSON |
| Schema Valid Rate | 是否符合 Schema |
| Field Accuracy | 字段值是否正确 |
| Citation Accuracy | 引用是否真实存在且匹配 |
| Business Rule Pass Rate | 是否通过业务规则 |
| Safety Pass Rate | 是否不泄漏、不越权、不触发危险动作 |
| Retry Rate | 是否频繁需要修复或重试 |
| Human Review Rate | 是否过多进入人工确认 |
| Auto Execute Accuracy | 自动执行结果是否正确 |

一个评估样例：

```json
{
  "case_id": "meeting-actions-001",
  "input": "张三：上线时间先按下周五准备，但压测报告还没出来。李四：权限问题需要有人跟进，我这边可以提供接口文档。",
  "expected": {
    "action_items": [
      {
        "task_contains": "压测报告",
        "assignee": null,
        "due_date": null,
        "needs_human_review": true
      },
      {
        "task_contains": "权限问题",
        "assignee": null,
        "due_date": null,
        "needs_human_review": true
      }
    ],
    "must_not_claim": [
      "张三负责压测报告",
      "李四负责权限问题",
      "下周五确定上线"
    ]
  }
}
```

评分示例：

| 检查项 | 结果 | 说明 |
| --- | --- | --- |
| Parse Success | 通过 | JSON 可解析 |
| Schema Valid | 通过 | 字段和枚举合法 |
| Field Accuracy | 部分通过 | 提取了任务，但错误填写负责人 |
| Citation Accuracy | 未通过 | `source_quote` 不支持负责人结论 |
| Business Rule | 未通过 | 不应自动写入任务系统 |

这类评估能帮助团队定位问题：是 Schema 太宽、Prompt 不清晰、上下文缺证据、引用校验缺失，还是业务门禁没拦住。

生产系统还应做三类评估：

1. 离线回放：使用历史上下文快照和输出快照复现问题。
2. CI 回归：Schema、Prompt、上下文策略、模型版本变更时跑固定评估集。
3. 线上抽样：检查真实输出的字段准确率、引用准确率、人工覆盖率和自动执行结果。

评估结果要进入发布流程。阈值应由业务风险决定，例如高风险自动执行场景可以要求关键评估集零安全失败、引用准确率达到发布门槛、自动执行准确率低于阈值时禁止上线。线上如果出现 parse error、schema error、重试率、人工确认率、成本或延迟异常，应触发告警、降级或回滚，而不是继续让模型自动修复。

## 实践任务

统一练习输入：

```text
张三：上线时间先按下周五准备，但压测报告还没出来。
李四：权限问题需要有人跟进，我这边可以提供接口文档。
王五：如果压测不过，下周五不能发版。
```

建议按任务 1、3、4 的顺序完成；任务 2 连接第 5 章研发排障助手，任务 5 是 Agent 工程扩展。

1. 入门：为会议纪要助手设计 JSON Schema。

交付物：一个包含 `summary`、`action_items`、`source_quote`、`confidence`、`needs_human_review` 的 Schema。

自查标准：缺失负责人和截止日期时允许 `null`；不能让模型猜；每个行动项必须有证据。

2. 初级：为研发排障助手设计 `OutputValidationResult`。

交付物：包含 parse、schema、citation、business、safety 五类校验结果的 JSON 对象。

自查标准：能表达“格式正确但引用失败”“引用正确但业务不可执行”“安全失败必须阻断”。

3. 中级：给一个坏 JSON 输出设计修复流程。

交付物：错误分类表和重试 Prompt。

自查标准：格式错误可以修复；事实错误和安全错误不能靠自动修复绕过校验。

4. 高级：设计任务系统写入门禁。

交付物：自动写入所需条件清单和失败降级路径。

自查标准：负责人、截止日期、证据、权限、重复任务、人工确认状态都被检查。

5. 专业：为 Claude Code 子 Agent 审查输出设计结构化格式。

交付物：一个包含 `findings`、`severity`、`file`、`line`、`evidence`、`must_fix`、`summary` 的 JSON 契约。

自查标准：脚本能解析结果；空发现和高风险发现都有明确表示；输出不依赖自然语言关键词判断成功或失败。

## 从入门到专业

- 入门：知道结构化输出是让模型结果能被程序解析，不只是“输出 JSON”。
- 初级：能设计简单 JSON 字段，并做解析和 Schema 校验。
- 中级：能加入引用、置信度、人工确认和失败状态。
- 高级：能设计校验链路、重试策略、业务门禁、日志快照和评估集。
- 专业：能在 Agent 平台中治理 Schema 版本、模型版本、Prompt 版本、上下文版本和自动执行风险。

专业工程师不会问“模型能不能输出这个字段”。他会问：“这个字段应该由谁生成？谁校验？错了会怎样？能不能回放？能不能安全地进入下一步系统？”

## 本章小结

结构化输出是 Agent 从“能回答”走向“能进入系统”的关键一步。

本章建立了几个核心结论：

- 自然语言适合人读，不适合后端直接执行。
- JSON 能解析不等于业务结果可靠。
- JSON Schema 约束形状，不保证事实真实性。
- 结构化输出要和上下文证据绑定。
- 模型生成字段、后端计算字段、工具返回字段、人工确认字段必须分清。
- 解析校验、Schema 校验、引用校验、业务校验、安全校验缺一不可。
- 自动修复和重试要有边界，不能绕过业务和安全规则。
- OpenAI、Spring AI、LangChain4j、MCP、Claude Code 都提供了不同层面的结构化输出能力，但后端仍然必须负责最终校验和执行。

第二部分到这里完成了一个闭环：Prompt 定义任务，Context 提供材料，Structured Output 让结果可消费。下一部分会进入 RAG 与记忆系统，解决模型不知道的知识如何被检索、组织和长期管理。

这里也要明确和第 7 章的连接：RAG 会把检索片段、chunk、文档来源和重排结果放进 Context；本章中的 `source_quote`、`citation_id`、`source_id`、`evidence` 则负责把最终回答绑定回这些检索证据。第 7 章会展开文档加载、切分、Embedding、召回和来源可信度；本章先保证这些证据进入输出后能被程序校验和追踪。

## 写作审查记录

### 章节架构师

本章承接第 4 章 Prompt Engineering 和第 5 章 Context Engineering，定位为“模型结果如何稳定进入程序”的工程章节。知识点覆盖 JSON、JSON Schema、Structured Outputs、Tool Calling、输出校验、自动修复、重试、人工确认、安全、成本、性能和评估。

### 技术审稿人

审稿指出 MCP 工具结果示例缺少必需的 `content`，JSON Schema 与 Structured Outputs 容易混淆，OpenAI Structured Outputs 缺少 refusal / 截断 / schema 子集边界，Claude Code CLI 输出格式与最终任务 JSON Schema 需要区分，LangChain4j fallback 条件需要补充。正文已修订能力对照表、MCP 示例、OpenAI API 边界、Claude Code `--json-schema` 与 hooks 字段说明，并补充 LangChain4j fallback 风险。

### 工程审稿人

审稿指出本章缺少部署版本治理、后端状态机、生产异常分类、可执行日志 schema、四层场景工程差异、Claude Code 自动化 envelope 和发布门禁。正文已新增结构化输出请求状态机、系统异常与业务异常分层、部署与版本治理、扩展 `OutputSnapshot`、场景对比表、Claude Code 自动化输出 envelope 和评估发布门禁。

### 学习体验审稿人

审稿指出工程实现部分信息密度较高，RAG 过渡偏概括，实践任务缺少难度分层，研发排障例子对初学者略早。正文已新增“最小闭环先掌握什么”过渡表、RAG 证据字段衔接说明、统一练习输入和入门到专业任务分层，并在研发排障例子前标注其作用边界。

### 主编

主编检查后保留会议纪要助手作为主线例子，研发排障助手作为第 5 章衔接例子；保留 OpenAI、Spring AI、LangChain4j、MCP、Claude Code 的框架映射，但强调具体 API 以官方文档为准。本章不展开 RAG 检索和 Agent 工具生命周期，只为第 7 章的证据引用、来源追踪和输出校验建立基础。
