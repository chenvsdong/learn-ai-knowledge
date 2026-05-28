# 第 9 章：Agent 的记忆系统

## 本章解决什么问题

第 7、8 章讲 RAG，解决“模型如何从外部知识源按需检索资料”。本章讲 Memory，解决另一个问题：Agent 如何在多轮、多天、多任务中记住已经确认的信息、用户偏好、项目状态和历史经验。

很多初学者会把 Memory 理解成“把聊天记录一直塞进上下文”。这会很快出问题：

- 对话越来越长，成本和延迟越来越高。
- 旧结论和新事实冲突，模型分不清哪个更可信。
- 用户临时说的话被当成永久偏好。
- Prompt Injection 或错误总结被写入长期记忆。
- 用户无法查看、修改、删除被系统记住的信息。
- 不同租户、项目、用户之间的记忆边界混乱。

本章要回答：

- Agent Memory 和 RAG、Context、History、State 有什么区别？
- 短期记忆、长期记忆、语义记忆、情节记忆、结构化记忆分别是什么？
- 什么信息应该被记住，什么信息不应该被记住？
- 记忆如何写入、更新、召回、失效和删除？
- Java 后端如何设计 Memory Store、Memory Policy 和审计日志？
- 记忆系统如何处理隐私、权限、冲突、污染和评估？
- 什么时候不要做长期记忆？

截至 2026-05，Agent Memory 没有一个跨供应商、跨框架统一的工程标准。不同框架会用 chat memory、conversation memory、vector memory、profile memory、knowledge graph 等不同名称；这不否认各平台有自己的 memory 抽象，而是提醒读者不要把某个平台的命名当成通用标准。本章采用工程抽象来讲，不写死某个 SDK 的 API、存储引擎或算法参数。具体实现要以当前框架文档和本地系统设计为准。

读完本章，读者应该能设计一个最小可落地的 Agent 记忆系统：知道哪些信息进入会话状态，哪些信息进入长期记忆，写入前如何确认，召回时如何过滤，删除时如何真正失效。

## 一个直观例子

继续使用知识库问答助手。用户第一次使用时说：

```text
以后回答我时，尽量用中文，要点式，不要太长。
```

几天后，用户问：

```text
帮我看一下知识库问答助手上线前还缺什么。
```

如果系统没有记忆，模型每次都要重新问用户输出偏好。如果系统把全部聊天记录都塞进上下文，成本会越来越高，而且会把很多无关内容带进来。

一个合理的记忆系统会把用户偏好存成结构化记忆：

```json
{
  "memory_id": "mem_user_pref_001",
  "scope": "user",
  "subject": "u_123",
  "type": "response_preference",
  "content": {
    "language": "zh-CN",
    "style": "bullet_points",
    "length": "concise"
  },
  "source": "user_explicit_preference",
  "confidence": "high",
  "created_at": "2026-05-20T10:00:00+08:00",
  "expires_at": null,
  "user_editable": true
}
```

下次回答时，系统不用把历史对话全部塞给模型，只需要把这条偏好作为上下文的一部分：

```text
[user_preference]
language: zh-CN
style: bullet_points
length: concise
[/user_preference]
```

但另一个例子就不能随便写入长期记忆。用户在某次上线风险分析中说：

```text
我感觉这次上线最大风险是权限过滤没测完。
```

这只是一个假设，不是已确认事实。它可以进入当前任务状态或分析日志，但不应该被写成长期记忆：

```json
{
  "claim": "这次上线最大风险是权限过滤没测完",
  "should_write_long_term_memory": false,
  "reason": "用户猜测，尚未被会议记录、检查清单或任务状态验证"
}
```

记忆系统的关键不是“记得越多越好”，而是“只记住经过授权、确认、有边界、可更新、可删除的信息”。

## 基础解释

### Memory 是什么

在 Agent 系统里，Memory 是系统为后续任务保存和召回的信息。它可以来自用户明确偏好、已完成任务、确认过的事实或人工标注。工具结果、项目状态和对话摘要只能作为候选来源，必须经过确认、策略判断、冲突检查和作用域绑定，不能直接变成长期记忆。

Memory 不是模型内部参数。它通常保存在外部存储里，例如数据库、缓存、向量索引、文档库、图数据库或专门的 memory store。模型在一次请求中能使用记忆，是因为后端把相关记忆召回并注入到上下文里。

### Memory、History、State、RAG 的区别

这几个概念必须分清：

| 概念 | 核心含义 | 生命周期 | 示例 |
| --- | --- | --- | --- |
| History | 原始对话历史 | 会话内或短期 | 最近 10 轮聊天 |
| State | 当前任务真实状态 | 任务生命周期 | 已确认负责人、当前步骤、审批状态 |
| Memory | 为未来任务保存的信息 | 跨会话或长期 | 用户偏好、项目常用约定 |
| RAG | 从外部知识源检索资料 | 按请求召回 | 知识库文档、上线清单 |
| Context | 本次模型调用可见材料 | 单次请求 | 当前问题 + 状态 + 记忆 + RAG 片段 |

关系可以这样理解：

```text
History、State、Memory、RAG 都可能成为 Context 的来源。
但它们不是同一件事。
```

如果把 History 当 Memory，会把大量临时聊天内容长期保存；如果把 State 当 Memory，会让任务状态更新不一致；如果把 RAG 当 Memory，会把外部知识检索和用户长期偏好混在一起。

### 短期记忆和长期记忆

短期记忆通常服务于当前会话或当前任务。它可以包括最近对话、会话摘要、当前任务计划和临时假设。工具结果更准确地说属于当前 step observation 或任务状态，只是在某些框架里会被放进短期上下文容器；它不应该替代 Agent Runtime 里的 observation / state 记录。

长期记忆服务于未来会话或未来任务。它可以包括用户偏好、项目约定、稳定事实、常用工作流、已确认的长期目标。

判断一条信息能否进入长期记忆，可以问：

1. 它是否经过确认？
2. 它是否对未来任务有持续价值？
3. 它是否有明确作用域？
4. 用户是否有权让系统保存它？
5. 它是否能被查看、更新、删除？

如果答案不清楚，就不要自动写入长期记忆。

### 语义记忆、情节记忆、结构化记忆

常见记忆类型有三类：

| 类型 | 含义 | 示例 |
| --- | --- | --- |
| 语义记忆 | 稳定事实或概念 | “用户偏好中文要点式回答” |
| 情节记忆 | 发生过的事件 | “2026-05-20 用户完成一次上线风险评审” |
| 结构化记忆 | 可被程序直接使用的字段 | `language=zh-CN`、`project=project-a` |

它们不是互斥的。同一件事可以有事件记录，也可以抽取出结构化字段。例如一次对话里用户说“以后都用中文短一点”，原始事件是情节记忆，抽取出的偏好是结构化记忆。

## 核心原理

### 原理一：记忆写入比记忆召回更危险

召回错了，通常只影响一次回答；写入错了，可能污染未来很多次回答。

常见错误写入包括：

- 把用户猜测写成事实。
- 把一次性要求写成长期偏好。
- 把模型总结写成用户真实意图。
- 把恶意文档内容写成项目规则。
- 把过期任务状态写成稳定记忆。

所以记忆系统要先设计写入策略，再设计召回策略。没有写入治理的长期记忆，比没有记忆更危险。

### 原理二：记忆必须有作用域

每条记忆都应该回答“对谁有效、在哪些场景有效”。

常见作用域：

- user：某个用户的个人偏好。
- session：某次会话内的临时信息。
- task：某个任务或工单内的信息。
- project：某个项目的约定。
- team：某个团队共享规则。
- tenant：某个租户内的企业规则。

例如：

```json
{
  "scope": "project",
  "subject": "project-a",
  "type": "release_policy",
  "content": "安全评审未通过时，只允许内部测试组使用。"
}
```

这条记忆不能被 project-b 用户自动使用，也不能跨租户召回。

### 原理三：记忆不是永久真相

记忆会过期、冲突、被撤销或被用户修改。系统必须支持：

- expires_at：过期时间。
- valid_from / valid_to：有效区间。
- confidence：可信度。
- source：来源。
- status：active、deprecated、deleted、pending_review。
- version：版本。

例如用户原来喜欢“回答简短”，后来明确说“这次开始给我详细解释”。系统要能更新偏好，而不是把两条冲突偏好同时塞给模型。

### 原理四：召回记忆也要权限过滤

记忆可能包含个人偏好、项目事实、客户信息、工单摘要和历史决策。它和 RAG 文档一样需要权限控制。

召回记忆时至少要检查：

- 当前用户能否读取这条记忆。
- 当前任务是否需要这条记忆。
- 这条记忆是否过期。
- 这条记忆是否被用户删除或撤销。
- 这条记忆是否属于当前租户、项目或团队。

不要为了“个性化”把用户所有记忆都放进上下文。

### 原理五：记忆要可解释

用户和工程团队都应该能回答：

- 系统记住了我什么？
- 这条记忆从哪里来的？
- 为什么这次被使用？
- 我能不能修改或删除？
- 删除后是否还会被模型看到？

如果记忆不可解释，用户会失去信任，工程团队也无法排查错误。

## 工程实现

### Memory 系统架构

一个可落地的 Memory 系统可以拆成：

```text
Memory Candidate Extractor
  -> Memory Write Policy
  -> Human / User Confirmation
  -> Memory Store
  -> Memory Retriever
  -> Memory Filter
  -> Context Injector
  -> Memory Audit Log
  -> Memory Evaluation
```

对应职责：

| 模块 | 责任 |
| --- | --- |
| Candidate Extractor | 从对话、工具结果、任务状态中提取候选记忆 |
| Write Policy | 判断是否允许写入、写到哪里、是否需要确认 |
| Confirmation | 用户或人工审核确认高风险记忆 |
| Memory Store | 保存结构化、文本或向量化记忆 |
| Retriever | 按任务召回可能相关的记忆 |
| Filter | 做权限、过期、冲突、作用域过滤 |
| Context Injector | 把入选记忆注入本次模型上下文 |
| Audit Log | 记录写入、更新、召回、删除 |
| Evaluation | 检查记忆是否有用、是否污染、是否越权 |

不要一开始就做复杂平台，但从第一天就要分清“候选提取”和“正式写入”。模型可以提出候选记忆，后端策略决定能不能保存。

### Memory 数据模型

一个抽象记忆对象可以这样设计：

```json
{
  "memory_id": "mem_001",
  "scope": "user",
  "subject_id": "u_123",
  "tenant_id": "tenant-a",
  "project_id": null,
  "team_id": null,
  "owner_user_id": "u_123",
  "resource_scope": ["user:u_123"],
  "data_classification": "personal_low_sensitive",
  "type": "response_preference",
  "content": {
    "language": "zh-CN",
    "style": "bullet_points",
    "length": "concise"
  },
  "source_type": "user_message",
  "source_ref": "conversation:c_456:message:m_789",
  "confidence": "high",
  "status": "active",
  "visibility": "private",
  "recallable": true,
  "consent_ref": "user_settings:memory_enabled:v1",
  "retention_policy": "until_user_deletes",
  "legal_hold": false,
  "created_at": "2026-05-20T10:00:00+08:00",
  "updated_at": "2026-05-20T10:00:00+08:00",
  "expires_at": null,
  "user_editable": true,
  "delete_policy": "hard_delete_on_user_request"
}
```

关键字段不是固定标准，但表达了几个必要能力：作用域、租户和资源边界、来源、可信度、状态、权限、数据分级、同意记录、留存策略、可召回性、时间、可编辑性和删除策略。真实后端不能只靠 `scope: user` 这类自然语言标签做过滤，必须有可执行的 `tenant_id`、`project_id`、`team_id`、`owner_user_id` 或 `resource_scope` 字段。

### Memory 控制面

只在后端保存记忆还不够。用户和管理员需要一个最小控制面，否则“可查看、可修改、可删除”只是口号。

一个可落地的 Memory 控制面至少应该支持：

| 能力 | 面向谁 | 说明 |
| --- | --- | --- |
| 列出记忆 | 用户、管理员 | 用户能看到自己的个人记忆；管理员只能按授权范围查看团队或项目记忆 |
| 搜索和过滤 | 用户、管理员 | 按类型、作用域、来源、状态、创建时间过滤 |
| 编辑记忆 | 用户、授权管理员 | 只允许编辑 `user_editable=true` 或团队规则授权范围内的记忆 |
| 禁用记忆 | 用户、管理员 | 设置 `recallable=false`，立即阻止进入上下文 |
| 删除请求 | 用户、管理员 | 创建删除作业，返回 deletion_request_id 和状态 |
| 导出记忆 | 用户、合规管理员 | 支持用户数据导出和合规审计，导出内容要脱敏和留痕 |
| 同意状态 | 用户 | 查看、开启、关闭或撤回 memory consent |
| 删除状态查询 | 用户、管理员 | 查询删除作业是否覆盖主库、向量索引、缓存、摘要和评估快照 |

权限也要分清。普通用户只能管理自己的个人记忆；团队管理员可以管理团队规则和项目记忆，但不能查看个人私密记忆；审计管理员可以查看受控审计记录，但不应该让这些记录重新进入模型上下文。控制面本身的每次读取、修改、导出和删除都要写审计日志。

### 写入策略

记忆写入可以分级：

| 类型 | 是否自动写入 | 示例 |
| --- | --- | --- |
| 明确用户偏好 | 低敏、用户显式表达、可查看可删除时可以自动或轻确认 | “以后用中文回答我” |
| 任务中确认事实 | 可写入任务或项目范围 | “本次上线先只给内部测试组” |
| 模型推断 | 不应直接写入 | “用户可能喜欢短回答” |
| 用户猜测 | 不应写入长期记忆 | “我感觉是权限问题” |
| 敏感信息 | 默认不写入或需强确认 | 密钥、身份证、客户隐私 |
| 外部文档内容 | 不写入用户记忆 | 应留在 RAG 知识库 |

写入前要做：

1. 分类：这是什么类型的信息？
2. 作用域判断：属于用户、任务、项目还是团队？
3. 风险判断：是否敏感、是否可能污染未来回答？
4. 冲突检查：是否与已有记忆冲突？
5. 确认策略：自动、用户确认、人工审核或拒绝。

### 更新与冲突处理

记忆更新不能简单追加。

如果用户说：

```text
以后回答我不用太短，重要内容可以展开。
```

系统不应该同时保留“回答简短”和“可以展开”两条 active 偏好。更好的做法是：

```json
{
  "old_memory_id": "mem_user_pref_001",
  "new_memory_id": "mem_user_pref_002",
  "operation": "supersede",
  "reason": "user_updated_preference",
  "old_status": "deprecated",
  "new_status": "active"
}
```

冲突处理要根据类型设计：

- 用户偏好：最新明确表达通常覆盖旧偏好。
- 项目规则：以当前版本和审批状态为准。
- 任务状态：以后端状态机为准，不以模型总结为准。
- 历史事件：通常追加，但要能标注更正。

### 召回和注入

记忆召回不是“查出所有记忆”。

一次请求可以按下面顺序处理：

```text
用户请求
  -> 识别任务类型
  -> 确定 memory scope
  -> 检索候选记忆
  -> 权限、状态、过期过滤
  -> 冲突消解
  -> 按上下文预算选择
  -> 注入模型上下文
```

注入格式要明确边界：

```text
[memory]
memory_id: mem_user_pref_002
scope: user
type: response_preference
content: 用户偏好中文、要点式回答，重要内容可以展开。
source: user_explicit_preference
[/memory]
```

模型应知道这是“历史偏好”，不是系统最高优先级规则。如果当前用户明确要求本次用英文回答，本次请求的显式要求通常应覆盖长期偏好。

### Java 后端伪代码

下面是一个不绑定具体框架的伪代码：

```java
class MemoryService {
    List<MemoryCandidate> extractCandidates(ConversationTurn turn) {
        return candidateExtractor.extract(turn);
    }

    WriteDecision decideWrite(MemoryCandidate candidate, RequestContext context) {
        return writePolicy.evaluate(candidate, context);
    }

    void writeMemory(MemoryCandidate candidate, WriteDecision decision) {
        if (decision.requiresConfirmation()) {
            confirmationService.request(candidate, decision);
            return;
        }
        if (decision.allowed()) {
            ConflictResult conflict = conflictResolver.resolve(candidate, decision);
            if (conflict.blockedByDeletedMemory()) {
                auditLog.recordRejected(candidate, "previously_deleted");
                return;
            }
            memoryStore.upsert(
                conflict.toMemoryRecord(candidate),
                decision.idempotencyKey()
            );
        }
    }

    List<MemoryRecord> recall(RequestContext context, String userInput) {
        MemoryQuery query = memoryPlanner.plan(context, userInput);
        List<MemoryRecord> candidates = memoryStore.search(query);
        return memoryFilter.filter(candidates, context);
    }
}
```

重点是：提取候选、写入决策、冲突处理、正式保存、召回过滤要分开。不要让模型一句“请记住”直接写数据库，也不要让模型自己决定召回哪些隐私记忆。写入还要有幂等键，避免重试时重复保存；已经被用户删除或废弃的记忆，不能被旧候选重新写回。

### Memory Trace

Memory trace 至少记录：

- trace_id。
- memory_policy_id。
- candidate_memory_ids。
- write_decision。
- confirmation_status。
- recalled_memory_ids。
- filtered_memory_reason。
- injected_memory_ids。
- updated_memory_ids。
- deleted_memory_ids。
- user_visible_memory_snapshot_ref。

被过滤或删除的记忆不能重新进入模型上下文。删除要覆盖结构化表、向量索引、缓存、摘要、导出的评估样本和可回放快照。确实因审计或合规要求无法硬删除的记录，必须脱敏、隔离访问，并标记为不可召回。审计日志也要遵守权限和留存策略。

### 删除与失效作业

Memory 删除不是把一行记录标记为 deleted 就结束。一个可审计的删除流程可以这样设计：

```text
deletion_requested
  -> mark_non_recallable
  -> remove_from_primary_store
  -> remove_from_vector_index
  -> invalidate_cache_and_summaries
  -> update_eval_and_replay_snapshots
  -> verify_not_recallable
  -> deletion_completed
```

如果法律、审计或合规要求保留部分记录，系统也要把它们和可召回记忆隔离：保留审计摘要或脱敏记录，但设置 `recallable=false`，不允许进入普通检索、上下文注入、评估样本或用户可见推荐。

删除作业应有独立状态、重试和告警：

- 删除请求要记录 request_id、操作者、范围、原因和截止时间。
- 向量索引、缓存、摘要和快照删除失败时要重试，并阻止相关记忆继续召回。
- 备份中的数据要按留存策略到期清除；如果无法立即物理删除，要记录隔离策略和到期时间。
- 删除完成后要能生成证明：这条记忆当前不会被召回、不会进入模型上下文，也不会出现在普通调试日志里。

## 适用场景

### 玩具 Demo

Demo 可以从“记住用户输出偏好”开始。例如用户说“以后用中文要点式回答”，系统保存一条结构化偏好，下次自动注入。

这个阶段不要急着做自动长期记忆。先把查看、更新、删除做出来，比“记住更多”更重要。

### 个人效率工具

个人助手适合记住：

- 语言和输出风格偏好。
- 常用项目或学习目标。
- 日程和任务习惯。
- 用户明确保存的笔记。

个人场景权限简单，但隐私和可删除性很重要。用户应该能看到系统记住了什么。

### 团队内部工具

团队工具可以记住项目约定、团队流程、任务偏好和历史决策。

但团队记忆必须有作用域和审核：

- 哪些是团队共享记忆？
- 谁可以写入？
- 谁可以修改或废弃？
- 是否需要审批？
- 是否和 RAG 文档冲突？

团队记忆不能变成“大家聊天里的传闻集合”。

### 企业级系统

企业级 Memory 要像数据产品一样治理：

- 多租户隔离。
- 数据分级。
- 用户可见和可删除。
- 合规留存。
- 审计追踪。
- 版本和冲突处理。
- 写入审批。
- 安全扫描。

企业级系统里，Memory 不只是体验增强功能，也可能成为敏感数据资产。

## 不适用场景

不适合记住所有对话。原始聊天记录不是长期记忆。

不适合把模型推断写成事实。模型觉得“用户可能喜欢某种风格”，不等于用户确认。

不适合保存敏感信息，除非业务确实需要、用户明确授权，并且有加密、访问控制和删除机制。

不适合用 Memory 替代数据库状态。订单状态、审批状态、权限状态、支付状态应该由业务系统维护。

不适合把 RAG 文档复制进 Memory。外部知识应该留在知识库和索引里，由 RAG 按权限召回。

不适合在没有查看、修改、删除能力时上线长期记忆。用户无法控制的记忆系统很难建立信任。

## 常见坑与反模式

第一个坑是“全量历史就是记忆”。这会导致成本膨胀、过期信息污染和隐私风险。

第二个坑是“自动总结后直接长期保存”。摘要可能遗漏条件、误解用户、固化错误。

第三个坑是“没有作用域”。个人偏好被团队共享，项目规则被跨租户使用，都会造成严重问题。

第四个坑是“只会新增不会更新”。记忆会越来越多，互相冲突，模型不知道该信哪条。

第五个坑是“删除只是隐藏”。如果向量索引、缓存、摘要和备份里仍能召回，用户删除就没有真正生效。

第六个坑是“把敏感数据当个性化”。个性化不能成为收集隐私的借口。

第七个坑是“记忆不可观测”。系统用了哪条记忆、为什么用、从哪里来，都查不到。

## 安全、成本与性能考虑

安全方面，Memory 最大风险是长期污染和隐私泄露。Prompt Injection、错误工具结果、用户猜测和恶意文档内容都可能被写成未来上下文。写入前要分类、过滤和确认。

权限方面，每条记忆都要有作用域和可见性。召回时按用户、租户、项目、团队和任务过滤。不能因为记忆“以前保存过”，就默认当前请求可见。

隐私方面，用户应能通过 Memory 控制面查看、修改、禁用、导出和删除个人记忆，也应能撤回记忆同意。敏感信息默认不保存；必须保存时要加密、最小化、设置留存期，并记录访问审计。

成本方面，记忆召回也会消耗检索、排序和上下文 token。长期记忆越多，越需要分类、索引、过期和压缩策略。

性能方面，记忆召回应有预算和缓存。高频偏好可以结构化读取，复杂语义记忆可以按需检索。不要每次请求都检索全量记忆。

可靠性方面，记忆服务不可用时要降级。缺少用户偏好时可以用默认输出风格；缺少任务状态时不能编造状态；权限服务不可用时高风险记忆召回应 fail closed。

治理方面，Memory Policy、Schema、存储版本、删除策略和审计规则都要能版本化、灰度和回滚。

## 如何评估效果

Memory 评估要看两个方向：记得是否有用，以及是否不该记的没有记。

| 层级 | 指标 | 问题 |
| --- | --- | --- |
| 写入 | 正确写入率 | 应该保存的信息是否保存 |
| 写入 | 错误写入率 | 猜测、敏感、临时信息是否被误保存 |
| 更新 | 冲突解决率 | 新偏好是否正确覆盖旧偏好 |
| 召回 | 相关记忆召回率 | 当前任务需要的记忆是否被找到 |
| 过滤 | 权限过滤正确率 | 不可见记忆是否被排除 |
| 注入 | 上下文精确率 | 注入的记忆是否真的有用 |
| 删除 | 删除生效率 | 删除后是否不再被召回 |
| 体验 | 用户可控性 | 用户能否查看、编辑、删除 |

评估样本可以长这样：

```json
{
  "case_id": "memory_pref_001",
  "user_permission": {
    "user_id": "u_123",
    "tenant_id": "tenant-a",
    "project_scope": ["project-a"]
  },
  "conversation": [
    "用户：以后回答我用中文，要点式。",
    "用户：这次请用英文写给海外团队。"
  ],
  "expected_memory_write": [
    {
      "type": "response_preference",
      "scope": "user",
      "content": {"language": "zh-CN", "style": "bullet_points"}
    }
  ],
  "expected_runtime_behavior": "本次请求使用英文，因为当前显式要求覆盖长期偏好",
  "forbidden_memory_write": [
    "把本次英文要求写成永久偏好"
  ],
  "expected_filtered_memories": [
    {
      "memory_id": "project-b-private-rule",
      "reason": "permission_denied"
    }
  ],
  "expected_deleted_memory_behavior": "deleted_memories_must_not_be_recalled_or_rewritten_by_old_candidates",
  "failure_category": null
}
```

常见评估集要覆盖：

- 明确偏好写入。
- 临时要求不写入长期记忆。
- 用户猜测不写入事实。
- 新偏好覆盖旧偏好。
- 项目记忆不能跨项目召回。
- 删除后不能再召回。
- 敏感信息默认拒绝写入。
- Prompt Injection 不能污染记忆。

如果记忆导致回答错误，要区分是写入错、更新错、召回错、权限错、注入错，还是模型没有正确使用记忆。

## 实践任务

下面是一组练习对话：

```text
对话 A：
用户：以后回答我用中文，要点式，不要太长。

对话 B：
用户：我感觉这次上线最大风险是权限过滤没测完。

对话 C：
用户：知识库问答助手上线前，如果安全评审没过，只给内部测试组。
系统：这条规则是否已经通过团队确认？
用户：是，团队会议已确认。

对话 D：
用户：这次给海外团队看的版本请用英文。

对话 E：
用户：删除你记住的“回答不要太长”这个偏好。
```

1. 最小任务：判断每段对话是否应该写入长期记忆。交付物包含 `should_write`、`scope`、`type`、`reason`。自查标准是：对话 B 不应写成事实，对话 D 不应覆盖长期语言偏好。

2. 工程化任务：设计 Memory 数据结构。交付物包含 memory_id、scope、subject_id、type、content、source_ref、confidence、status、expires_at、user_editable、delete_policy。自查标准是：能支持更新、删除和审计。

3. 进阶任务：设计写入策略表。交付物覆盖用户偏好、任务事实、项目规则、模型推断、敏感信息、外部文档内容。自查标准是：每类都有自动写入、确认、拒绝或人工审核策略。

4. 生产化任务：设计 Memory Trace 和评估集。交付物包含 candidate_memory_ids、write_decision、recalled_memory_ids、filtered_memory_reason、injected_memory_ids、deleted_memory_ids，以及 8 条评估样本。自查标准是：能验证删除生效、权限过滤和 Prompt Injection 防护。

参考答案要点：对话 A 可以写入用户级响应偏好，且应可查看、可编辑、可删除。对话 B 是猜测，不能写成长期事实。对话 C 只有在确认来源和作用域后，才可能写成项目或团队范围规则，不能默认写成所有用户记忆。对话 D 是本次请求的临时要求，不应覆盖长期语言偏好。对话 E 应触发删除或禁用作业，并验证相关结构化表、向量索引、缓存和摘要不再召回这条偏好。

## 从入门到专业

- 入门：知道 Memory 不是全量聊天历史，而是经过治理的可召回信息。
- 初级：能区分 History、State、Memory、RAG 和 Context。
- 中级：能设计 Memory 数据模型、写入策略、召回过滤和删除机制。
- 高级：能处理冲突、过期、权限、隐私、污染和评估。
- 专业：能把 Memory 做成多租户、可审计、可治理、可回滚的 Agent 平台能力。

## 本章小结

Agent Memory 解决的是跨会话、跨任务保存有价值信息的问题。它和 RAG 都能给模型提供上下文，但 RAG 面向外部知识检索，Memory 面向用户、任务、项目的长期状态和偏好。

好的记忆系统不是“记得越多越好”，而是写入有策略、召回有过滤、更新有版本、删除能生效、用户可控制、系统可审计。记忆写入比召回更危险，长期污染会让 Agent 越用越不可靠。

下一部分会进入让模型行动：Function Calling、Tool Use 和 MCP。前面几章解决了模型如何理解任务、看见材料、获取知识和保存状态；接下来要解决模型如何安全地调用外部能力。

换句话说，前三部分主要解决 Agent 的“认知输入”：任务怎么表达、材料怎么组织、知识怎么检索、状态怎么记住。第四部分开始进入“受控行动”：模型可以提出调用工具的意图，但工具是否存在、参数是否合法、用户是否有权限、结果如何回填、失败如何处理，都必须由后端系统和运行时治理。

## Sources

- [OpenAI API: Conversation state](https://platform.openai.com/docs/guides/conversation-state)
- [Anthropic Claude Code: Manage Claude's memory](https://docs.anthropic.com/en/docs/claude-code/memory)
- [LangChain Docs: Long-term memory](https://docs.langchain.com/oss/python/deepagents/long-term-memory)

## 写作审查记录

### 章节架构师

- 本章目标：区分 Memory、History、State、RAG 和 Context，建立可落地的 Agent 记忆系统方法。
- 知识点地图：短期记忆、长期记忆、语义记忆、情节记忆、结构化记忆、写入策略、更新冲突、召回过滤、删除、隐私、权限、评估和治理。
- 前后章节关系：承接第 7/8 章 RAG，衔接第 10 章 Function Calling 和后续 Agent Runtime。

### 技术审稿人

- 发现问题：Memory 容易被误写成全量聊天历史或模型内部参数，也容易和 RAG、State 混淆。
- 修订动作：明确 Memory 是外部存储中的可召回信息；通过表格区分 History、State、Memory、RAG 和 Context；强调模型推断和用户猜测不能直接写入长期记忆。
- 结论：概念边界清楚，没有绑定具体框架 API。

### 工程审稿人

- 发现问题：只讲“记住用户偏好”会停留在产品体验层，缺少后端写入、更新、召回、删除和审计链路。
- 修订动作：补充 Memory 系统架构、数据模型、写入策略、冲突处理、Java 伪代码、Memory Trace 和降级策略。
- 结论：章节能映射到真实 Java 后端和企业 Agent 平台。

### 学习体验审稿人

- 发现问题：初学者容易把“记住更多”当作能力提升，忽略污染、隐私和删除。
- 修订动作：用用户偏好、上线风险猜测、项目规则三个例子建立直觉，并用实践任务训练写入判断。
- 结论：章节由浅入深，能帮助读者建立“少而准、可控、可删”的记忆观。

### 主编

- 最终调整：统一主线为“记忆是一种受治理的长期状态，不是聊天记录堆叠”。
- 与全书衔接：完成“给模型知识：RAG 与记忆系统”这一部分，转向“让模型行动”的工具调用章节。
- 后续章节提醒：第 10 章 Function Calling 需要强调工具调用不是记忆写入，工具结果只有经过确认和策略判断后才可能进入 Memory。
