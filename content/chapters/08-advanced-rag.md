# 第 8 章：RAG 进阶

## 本章解决什么问题

第 7 章讲了 RAG 的基础链路：文档入库、切分、索引、检索、上下文注入、引用和评估。那条链路能帮助你跑通一个最小知识库问答系统，但真实业务很快会遇到更难的问题：

- 用户问题表达很随意，和文档里的术语不一致。
- 一次检索召回不到关键片段，或者召回了很多相似但无用的片段。
- 文档里有表格、代码、FAQ、流程图和多级标题，简单按长度切分会破坏语义。
- 关键词检索能命中术语，向量检索能命中语义，但单独使用都不稳定。
- 检索结果里混有旧版本、重复片段、权限边界不同的材料。
- 模型回答看起来合理，但引用并不支持结论。

本章要回答：

- Chunk 策略为什么会决定 RAG 上限？
- Query Rewrite、Query Expansion、HyDE 分别解决什么问题？
- Hybrid Search、多路召回、Rerank 如何组合？
- 什么是父子文档检索、层级检索和上下文扩展？
- RAG 调优应该先看召回、排序、引用，还是模型生成？
- Java 后端如何把高级 RAG 做成可配置、可评估、可回滚的链路？
- 什么时候不要继续堆检索技巧，而应该修文档、修权限或换产品设计？

截至 2026-05，RAG 工程实践发展很快，不同搜索引擎、向量数据库、Embedding 模型、Rerank 模型和框架能力差异明显。本章只讲稳定的工程思路，不写死某个库的 API、默认参数、召回条数或性能数字。具体实现必须以当前官方文档和本地系统为准。

读完本章，读者应该能从“能检索到一些片段”推进到“能诊断 RAG 为什么答错，并有顺序地调优”。

## 一个直观例子

继续使用知识库问答助手。文档里有这样一段：

```text
标题：上线门槛
内容：知识库问答助手上线前必须完成权限过滤测试、安全评审、20 条常见问题评估样本和 5 条越权访问评估样本。若安全评审未通过，只允许内部测试组使用。
```

用户问：

```text
如果评审还没过，可以先给谁用？
```

一个基础 RAG 系统可能把查询直接拿去检索。关键词检索看到“评审”“谁用”，可能召回不到“安全评审未通过，只允许内部测试组使用”；向量检索可能召回“上线流程”“用户通知范围”等相似片段，但不一定是最精确的那段。

进阶 RAG 会做更多事情：

1. Query Rewrite：把问题改写成“安全评审未通过时，知识库问答助手允许开放范围是什么？”
2. 多路召回：同时用关键词、向量、标题字段、版本过滤召回候选片段。
3. Rerank：把真正能回答问题的片段排到前面。
4. 上下文扩展：命中“若安全评审未通过”这一句后，带上同一段的上线门槛上下文。
5. 引用校验：确认答案“只允许内部测试组使用”确实来自入选片段。

最终回答应该是：

```text
如果安全评审未通过，只允许内部测试组使用。依据是《上线门槛》片段中“若安全评审未通过，只允许内部测试组使用”。
```

这个例子说明：RAG 进阶不是让链路看起来更复杂，而是让系统在问题表达、文档结构、召回噪声和引用可信度都不完美时，仍能稳定找到正确依据。

## 基础解释

### Chunk 策略是什么

Chunk 策略决定原始文档如何被拆成可检索片段。它包括：

- 按什么边界切：标题、段落、句子、函数、表格行、FAQ。
- 每个片段保留多少上下文。
- 是否允许重叠。
- 是否保留父级标题、文档版本、权限标签。
- 是否为不同内容类型使用不同切分器。

Chunk 不是越小越好，也不是越大越好。它的目标是让检索片段既能命中问题，又能保留足够语义。

### Query Rewrite 是什么

Query Rewrite 是把用户原始问题改写成更适合检索的查询。

用户可能说：

```text
评审没过能先给谁？
```

系统可以改写成：

```text
安全评审未通过 知识库问答助手 开放范围 内部测试组
```

改写不是为了让模型回答，而是为了让检索系统更容易找到材料。改写后的查询要记录在 trace 中，因为它会影响召回结果。

### Hybrid Search 是什么

Hybrid Search 是把不同检索方式组合起来。最常见的是关键词检索和向量检索组合。

| 检索方式 | 擅长 | 不擅长 |
| --- | --- | --- |
| 关键词检索 | 错误码、接口名、专有名词、精确字段 | 用户换说法时可能漏召回 |
| 向量检索 | 语义相近、同义表达、自然语言问题 | 容易召回语义相似但事实不支持的片段 |
| 元数据过滤 | 租户、项目、版本、权限、时间范围 | 不能单独判断语义相关性 |

Hybrid Search 的目标是用不同方式互补，而不是盲目把所有结果都塞进上下文。

### Rerank 是什么

Retriever 负责“多找一些候选材料”，Reranker 负责“从候选材料里重新排序和筛选”。

一个常见模式是：

```text
多路召回 50 个候选片段
  -> 去重和权限校验
  -> Rerank 选择最相关的若干片段
  -> 按上下文预算注入模型
```

这里的数字只是演示链路，不是推荐值。实际候选数量和入选数量必须通过评估集决定。

## 核心原理

### 原理一：RAG 错误要拆链路定位

RAG 答错时，不要第一反应就调 Prompt。错误可能来自很多层：

| 层级 | 典型错误 | 修复方向 |
| --- | --- | --- |
| 文档 | 资料过期、冲突、缺失 | 文档治理、版本标记、内容修订 |
| 切分 | 关键条件被拆散 | 调整 chunk 边界、上下文扩展 |
| 索引 | 元数据缺失、索引未刷新 | 重建索引、补元数据、版本管理 |
| 查询 | 用户说法和文档术语不一致 | Query Rewrite、同义词、Query Expansion |
| 召回 | 关键片段没被找到 | 多路召回、Hybrid Search、过滤条件修正 |
| 排序 | 找到了但排得太靠后 | Rerank、业务权重、去重 |
| 注入 | 放进模型的材料太多或太少 | 上下文预算、片段裁剪、引用格式 |
| 生成 | 模型没有遵守材料 | 输出约束、引用校验、结构化输出 |

如果不拆链路，团队很容易在 Prompt、top-k 和模型之间来回试错，成本高且效果不可复现。

### 原理二：召回率和精确率要一起看

召回率关注“关键材料有没有被找到”。精确率关注“放进上下文的材料是否真的有用”。

只追求召回率，会把很多噪声放进模型；只追求精确率，可能漏掉关键证据。RAG 调优通常要先确保关键材料能被召回，再通过重排、去重、版本过滤和上下文预算提高精确率。

例如用户问“安全评审没过能不能上线”。如果系统没有召回“只允许内部测试组使用”这句，后面模型再强也很难答对。如果召回了十段相似流程，其中只有一段支持结论，就要靠重排和引用校验把正确片段凸显出来。

### 原理三：查询改写不能改掉用户意图

Query Rewrite 很有用，但也有风险。它可能把模糊问题改得过度确定，或者引入用户没有问的实体。

用户问：

```text
这次能不能先给一部分人用？
```

错误改写：

```text
安全评审未通过时是否可以开放给内部测试组
```

如果用户没有提“安全评审”，这个改写可能提前假设了原因。更稳妥的做法是生成多个查询：

```text
上线灰度 开放范围
内部测试组 使用范围
安全评审 未通过 开放范围
```

多查询可以提高召回，但每个查询都要进入 trace。否则答案错了时，无法知道是原问题错、改写错，还是检索错。

### 原理四：Rerank 不是魔法

Rerank 能改善排序，但不能凭空找回没召回的材料。如果关键片段没有进入候选集，Rerank 无法解决问题。

Rerank 也可能引入额外成本和延迟。高频、低风险、文档结构清晰的场景，不一定每次都需要重排。更复杂的企业问答、代码检索、法律合同、医疗或财务资料，则可能更需要精细排序和引用校验。

工程上常见策略是按需触发：

- 候选片段分数接近时触发。
- 问题属于高风险类型时触发。
- 多路召回结果冲突时触发。
- 用户要求引用或证据时触发。

### 原理五：上下文扩展要受预算和权限控制

命中一个小片段后，系统可能需要带上它的前后文、父标题、表格头或同一 FAQ 的问题部分。这叫上下文扩展。

但扩展不能无限制：

- 只能扩展用户有权限访问的材料。
- 只能扩展同版本、同文档或明确相关的材料。
- 要记录扩展原因。
- 要受 token 预算约束。
- 不能把被过滤材料通过“邻居扩展”绕进上下文。

上下文扩展是提升答案完整性的手段，也可能成为权限绕过和噪声膨胀的入口。

## 工程实现

### 高级 RAG 流水线

一个进阶 RAG 链路可以这样抽象：

```text
User Question
  -> Permission Scope
  -> Query Analysis
  -> Query Rewrite / Expansion
  -> Multi-Route Retrieval with metadata filters
  -> ACL Check as second defense
  -> Deduplicate
  -> Rerank
  -> Context Expansion
  -> Context Budgeting
  -> Generation
  -> Citation Validation
  -> RAG Trace
  -> Evaluation Feedback
```

这里的顺序不表示改写器可以自由访问全库。Query Rewrite / Expansion 只能使用用户原始输入、公共术语表、当前租户配置和用户可见范围内的元数据，不能读取或利用用户无权访问的文档内容、项目名、标题或标签来生成查询。每条召回路线都必须在索引查询阶段带上租户、项目、版本、数据分级和可见性过滤；后置 ACL Check 只是二次防线，不是主要权限控制。

这个链路不要求每个系统一次性做全。建议按问题逐步增加复杂度：先修文档和元数据，再修切分，再做查询改写，再做多路召回和重排。

### Chunk 策略进阶

不同内容类型应该使用不同切分策略：

| 内容类型 | 推荐边界 | 注意点 |
| --- | --- | --- |
| Markdown 文档 | 标题、段落、列表 | 保留父标题和路径 |
| FAQ | 一问一答 | 问题和答案不要拆开 |
| API 文档 | 接口、参数组、返回码 | 保留接口名、版本和权限说明 |
| 代码 | 类、函数、配置块 | 保留文件路径、语言、依赖关系 |
| 表格 | 表头 + 行组 | 每个片段要带表头，否则字段含义丢失 |
| 流程文档 | 阶段、条件、分支 | 条件和例外不能拆散 |

一个 chunk 记录可以增加这些字段：

```json
{
  "chunk_id": "release-checklist-003",
  "parent_id": "release-checklist",
  "chunk_type": "policy_rule",
  "heading_path": ["知识库问答助手", "上线门槛"],
  "content": "若安全评审未通过，只允许内部测试组使用。",
  "neighbor_chunk_ids": ["release-checklist-002", "release-checklist-004"],
  "version": "2026-05-20",
  "visibility": "team-a"
}
```

`neighbor_chunk_ids` 只能用于受控扩展，不能绕过权限过滤。

### 父子文档检索

父子文档检索是一种常见模式：检索时用较小片段提高命中率，注入时带上较大的父级上下文。

```text
检索单元：一句话或小段落
注入单元：包含标题、条件和相邻解释的父段落
```

例如检索命中：

```text
只允许内部测试组使用。
```

如果只把这句放进上下文，模型不知道前提条件。父级上下文应该补上：

```text
若安全评审未通过，只允许内部测试组使用。
```

父子检索能提高回答完整性，但要注意父级内容也必须通过权限和版本校验。

### Query Rewrite 与 Query Expansion

Query Rewrite 是改写查询；Query Expansion 是扩展查询。它们可以由规则、词典、模型或混合方式完成。

示例：

| 用户问题 | Rewrite | Expansion |
| --- | --- | --- |
| 评审没过能先给谁？ | 安全评审未通过时开放范围是什么 | 安全评审、内部测试组、灰度、开放范围 |
| 越权访问样本不够会影响上线吗？ | 上线前越权访问评估样本数量要求是什么 | 越权访问、评估样本、权限过滤、上线门槛 |
| 评估样本要多少？ | 上线前评估样本数量要求 | 常见问题样本、越权访问样本、测试集 |

改写结果要带上来源：

```json
{
  "original_query": "评审没过能先给谁？",
  "rewritten_queries": [
    "安全评审未通过时开放范围是什么",
    "上线安全评审失败 内部测试组 使用范围"
  ],
  "rewrite_reason": "补全省略主语和业务术语",
  "risk": "may_over_specify"
}
```

如果改写风险高，应该保留原始查询一起检索，避免模型或改写器把用户意图带偏。

### HyDE 的边界

HyDE 是一种查询增强思路：先让模型生成一个“假想答案”或“假想文档”，再用它去检索相似资料。它可能帮助处理短问题、模糊问题或术语不一致的问题。

但 HyDE 有明显边界：

- 假想答案不是事实，不能进入最终回答依据。
- 它可能引入错误实体或错误假设。
- 生成内容要记录在 trace 里。
- 高风险场景要谨慎使用，必要时只作为召回辅助。

可以把 HyDE 理解成“帮检索找路的草稿”，不是“帮模型生成结论的证据”。

### 多路召回

多路召回是同时从多个来源或多种策略召回候选材料。

常见召回路线：

- 关键词检索。
- 向量检索。
- 标题字段检索。
- 标签或元数据过滤。
- 最近版本优先。
- 用户常用项目优先。
- FAQ 精确匹配。
- 代码符号检索。

多路召回后要做统一候选池：

```text
route_keyword -> candidate_chunks
route_vector -> candidate_chunks
route_title -> candidate_chunks
route_recent -> candidate_chunks
  each route uses tenant/project/visibility/version filters
  -> merge
  -> deduplicate
  -> ACL check as second defense
  -> rerank
```

每个候选片段要记录来自哪条路线。这样评估时才能知道是关键词有用、向量有用，还是某条路线一直制造噪声。不要把无权片段送进 rerank，也不要把被过滤材料的标题、路径或正文写入普通 trace。

### Rerank 与融合排序

多路召回会带来多个分数：关键词分数、向量相似度、时间新鲜度、文档可信度、用户项目偏好等。工程上通常需要融合排序。权限不是排序信号，而是硬过滤条件；不满足权限的材料不能靠低分“降权”，必须在进入候选池前或二次校验时移除。

一个抽象排序信号可以是：

| 信号 | 含义 |
| --- | --- |
| lexical_score | 关键词匹配程度 |
| semantic_score | 语义相似程度 |
| freshness_score | 文档是否较新 |
| authority_score | 来源是否可信 |
| citation_score | 是否适合作为引用 |

权限不是排序信号，而是硬过滤条件。只有通过权限校验的候选材料才能进入排序和重排。不要把这些分数写成假精确概率。它们只是排序信号，最终权重需要用评估集和线上反馈调。

### Java 后端配置模型

高级 RAG 最怕散落在代码里到处写死。建议用配置描述策略：

```json
{
  "rag_policy_id": "kb-release-v3",
  "routes": ["keyword", "vector", "title"],
  "rewrite": {
    "enabled": true,
    "keep_original_query": true
  },
  "rerank": {
    "enabled": true,
    "trigger": "high_risk_or_low_confidence"
  },
  "context_expansion": {
    "enabled": true,
    "scope": "same_parent_only"
  },
  "filters": {
    "require_latest_approved_version": true,
    "enforce_acl_before_retrieval": true
  },
  "citation": {
    "required": true
  }
}
```

后端可以把它映射成一个策略对象：

```java
record RagPolicy(
    String policyId,
    List<String> routes,
    RewritePolicy rewrite,
    RerankPolicy rerank,
    ExpansionPolicy expansion,
    FilterPolicy filters,
    CitationPolicy citation
) {}
```

这样做的好处是：策略可以灰度、回滚、对比评估，而不是每次调参都改业务代码。

### RAG Trace 进阶

进阶 RAG trace 至少要记录：

- original_query。
- rewritten_queries。
- retrieval_routes。
- metadata_filter。
- index_version。
- candidate_chunk_ids。
- acl_filtered_count。
- deduplicated_chunk_ids。
- rerank_input_ids。
- selected_chunk_ids。
- expanded_chunk_ids。
- citation_validation_result。
- rag_policy_id。
- latency_by_stage。

注意，普通 trace 只应记录当前用户有权查看的候选、入选和扩展片段 ID。被 ACL 过滤掉的材料、不可见标题、不可见路径和可反推出敏感信息的标识，只能进入受控审计日志，并尽量使用 hash、内部 ID 或聚合计数。它们不能出现在模型输入、普通用户可见日志或前端调试信息里。

## 适用场景

### 玩具 Demo

Demo 阶段可以只做简单切分、关键词或向量检索、固定 top-k。目的是理解链路，不是追求复杂策略。

当 Demo 出现“明明文档里有，模型却答不到”时，可以先用本章方法定位是切分、查询还是排序问题。

### 个人效率工具

个人知识库适合逐步加入 Query Rewrite、标签过滤和简单混合检索。例如用户问“上次那本讲组织系统的书”，系统可以通过语义检索和笔记标签共同定位资料。

个人场景通常不需要复杂多租户权限，但要重视隐私、索引删除和本地资料同步。

### 团队内部工具

团队研发问答、客服知识库、运维手册很适合高级 RAG。

团队场景重点是：

- 术语不一致。
- 文档版本冲突。
- 多项目权限。
- 代码、日志、文档混合检索。
- 引用和复盘。

此时 Hybrid Search、多路召回、Rerank 和评估集通常有助于提升稳定性，但必须用业务评估集验证收益，并同时评估成本、延迟和权限风险。

### 企业级系统

企业级 RAG 要把高级策略纳入治理：

- RAG policy 版本。
- 索引版本。
- 数据分级和权限。
- 多语言检索。
- 合规审计。
- 灰度发布。
- 线上反馈回流。

企业级系统里，高级 RAG 不是模型团队的单点能力，而是搜索、数据治理、安全、后端平台和业务团队共同维护的链路。

## 不适用场景

不适合在文档质量很差时先堆高级检索。脏文档、冲突文档和过期文档会让更强的检索更快地召回错误材料。

不适合用 Query Rewrite 替代产品澄清。如果用户问题缺少关键条件，应该追问，而不是让改写器猜。

不适合把 Rerank 当成万能补丁。关键材料没被召回，Rerank 无法解决。

不适合在低风险、简单、命中率已经很高的场景过度复杂化。每增加一条召回路线、一个模型重排步骤，都会增加成本、延迟和排障难度。

不适合绕过权限做上下文扩展。命中片段周围的邻居内容也必须通过权限和版本校验。

## 常见坑与反模式

第一个坑是“调 top-k 治百病”。top-k 只是候选数量，不解决切分、查询、权限、排序和文档质量问题。

第二个坑是“只看向量相似度”。相似不等于支持结论，尤其在政策、法律、权限、版本类文档里。

第三个坑是“Query Rewrite 偷偷改问题”。改写链路如果没有 trace，答案错了很难复盘。

第四个坑是“多路召回不去重”。同一文档片段反复出现，会挤占上下文预算，让模型误以为重复内容更重要。

第五个坑是“重排后丢失来源”。Rerank 改变顺序，但不能丢 chunk_id、版本、source_uri 和权限结果。

第六个坑是“评估只看答案”。高级 RAG 必须评估查询、召回、排序、扩展、引用和生成。

第七个坑是“线上调策略不留版本”。没有 rag_policy_id 和 index_version，无法判断哪次发布导致效果变化。

## 安全、成本与性能考虑

安全方面，高级 RAG 增加了更多入口：Query Rewrite 可能引入错误实体，多路召回可能扩大候选范围，上下文扩展可能带入邻居敏感内容，Rerank 输入可能包含更多候选材料。每一层都要受权限和数据分级控制。

成本方面，多路召回、模型改写和 Rerank 都会增加成本。不要默认所有请求都走最贵链路。可以按任务风险、用户等级、候选置信度、缓存命中情况决定是否触发高级策略。

性能方面，高级 RAG 的延迟来自多个阶段。要记录 query rewrite、各路 retrieval、deduplicate、rerank、context expansion、model generation 的分段耗时。每个阶段还要有自己的 timeout 和总 deadline 预算，例如 rewrite 或 rerank 超时后回退到原始查询或基础排序，而不是拖垮整个请求。否则优化时只会盯着模型。

可靠性方面，任何高级策略都要可降级。Rewrite 失败时用原始查询；Rerank 超时时使用基础排序；某一路召回失败时保留其他路线；权限服务异常时高风险场景 fail closed。

治理方面，RAG policy、索引版本、Embedding 版本、切分版本、Rerank 模型版本都要能记录和回滚。评估集要覆盖版本变更前后的关键样本。

## 如何评估效果

高级 RAG 评估要按链路拆指标：

| 层级 | 评估问题 | 示例指标 |
| --- | --- | --- |
| Query Rewrite | 是否保留用户意图 | 改写准确率、错误改写率 |
| 召回 | 关键片段是否进入候选集 | recall@k、关键 chunk 命中率 |
| 多路召回 | 哪条路线贡献最大 | route contribution、route noise |
| 去重 | 是否减少重复上下文 | duplicate rate |
| Rerank | 关键片段是否排到前面 | MRR、nDCG、top-n 命中 |
| 上下文扩展 | 是否补足条件和例外 | supporting context coverage |
| 引用 | 答案是否被引用支持 | citation support rate |
| 端到端 | 用户答案是否正确 | answer correctness、human review pass rate |

评估样本可以长这样：

```json
{
  "case_id": "advanced_rag_001",
  "question": "评审没过能先给谁？",
  "user_permission": {
    "tenant_id": "tenant-a",
    "project_scope": ["project-a"]
  },
  "expected_rewrite_contains": ["安全评审", "开放范围"],
  "expected_candidate_chunks": ["release-checklist-003"],
  "expected_selected_chunks": ["release-checklist-003"],
  "expected_expanded_chunks": ["release-checklist-parent-001"],
  "forbidden_chunks": ["team-b-release-plan-002"],
  "expected_forbidden_handling": {
    "team-b-release-plan-002": "exclude_before_rerank"
  },
  "trace_visibility_rule": "user_visible_trace_only_contains_authorized_chunk_ids",
  "expected_answer": "只允许内部测试组使用",
  "expected_citation_ids": ["release-checklist-003"],
  "failure_category": null
}
```

当评估失败时，要记录失败分类：

- rewrite_error。
- missing_recall。
- bad_rerank。
- permission_filter_error。
- context_expansion_error。
- citation_mismatch。
- generation_error。
- stale_index。

调优顺序建议是：先保证文档和元数据正确，再保证关键材料能召回，再做排序和上下文压缩，最后再改 Prompt 或换模型。

## 实践任务

沿用第 7 章的练习材料，再增加几条文档：

```text
文档 D：灰度发布说明
权限：team-a
版本：2026-05-18
内容：安全评审未通过时，只能开放给内部测试组，不得通知所有用户。

文档 E：B 项目灰度计划
权限：team-b
版本：2026-05-25
内容：B 项目计划先开放给外部试点客户。

文档 F：旧版测试说明
权限：team-a
版本：2026-03-01
内容：上线前准备 10 条 FAQ 即可。
```

1. 最小任务：为“评审没过能先给谁？”设计 Query Rewrite。交付物包含原始问题、改写查询、扩展关键词、改写风险。自查标准是：改写不能引入 B 项目，也不能把“可以上线”当成已知事实。

2. 工程化任务：设计多路召回策略。交付物包含 keyword、vector、title 三条路线的输入、输出、去重规则和权限过滤位置。自查标准是：文档 E 不能进入 team-a 用户上下文。

3. 进阶任务：设计 Rerank 评估集。交付物包含 10 条样本，每条记录 expected_candidate_chunks、expected_selected_chunks、expected_citation_ids 和 failure_category。自查标准是：能区分 missing_recall 和 bad_rerank。

4. 生产化任务：设计 `RagPolicy` 配置。交付物包含 rewrite、routes、rerank、context_expansion、filters、citation、fallback_policy 和 trace_fields。自查标准是：策略可以灰度、回滚、评估，并且任何扩展内容都要经过权限校验。

参考答案要点：对“评审没过能先给谁？”的改写应保留原意，合理补全为“安全评审未通过时开放范围是什么”，不能引入 B 项目或外部试点客户。team-a 用户的候选材料可以包含文档 A 和 D，文档 E 必须被权限过滤，文档 F 应因旧版本降低优先级或丢弃。Rerank 失败和召回失败要分开标注：如果文档 D 从未进入候选集是 missing_recall；如果进入候选但没被选中才是 bad_rerank。

## 从入门到专业

- 入门：知道高级 RAG 是为了解决基础检索不稳定，不是为了堆复杂组件。
- 初级：能解释 chunk、rewrite、hybrid search、rerank、context expansion 的作用。
- 中级：能按错误链路定位 RAG 问题，并设计评估样本。
- 高级：能把多路召回、重排、权限、引用和 trace 做成可配置策略。
- 专业：能治理企业级 RAG 平台的策略版本、索引版本、灰度、回滚、评估和成本。

## 本章小结

RAG 进阶的核心不是“上更多模型”或“调更大的 top-k”，而是让检索链路从粗糙的单路召回，变成可诊断、可评估、可治理的知识检索系统。

Chunk 策略决定材料能否被正确找到；Query Rewrite 和 Query Expansion 解决用户表达和文档术语不一致；Hybrid Search 和多路召回提高候选覆盖；Rerank 和上下文扩展提高入选材料质量；引用校验和 trace 让结果可复盘。

下一章会进入 Agent 的记忆系统。RAG 解决的是“从外部知识源按需取资料”，记忆系统解决的是“跨会话保存和更新用户、任务、项目的状态”。两者都能给模型提供上下文，但生命周期、写入策略、隐私和治理方式完全不同。

## Sources

以下来源按 2026-05-29 访问时的论文页面理解；高级 RAG 术语和方法以后续论文、框架文档和项目依赖版本为准。

- [Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks](https://arxiv.org/abs/2005.11401)
- [Precise Zero-Shot Dense Retrieval without Relevance Labels](https://arxiv.org/abs/2212.10496)

## 写作审查记录

### 章节架构师

- 本章目标：在第 7 章基础上，把读者从最小 RAG 推进到可诊断、可调优的高级 RAG 链路。
- 知识点地图：Chunk 策略、父子文档检索、Query Rewrite、Query Expansion、HyDE、多路召回、Hybrid Search、Rerank、上下文扩展、RAG policy、trace 和评估。
- 前后章节关系：承接第 7 章 RAG 基础，为第 9 章记忆系统区分外部知识检索和长期状态管理。

### 技术审稿人

- 发现问题：高级 RAG 容易被写成技巧堆叠，或者把 HyDE、Rerank、Hybrid Search 写成必选能力。
- 修订动作：明确这些策略都是按问题触发的可选增强；强调 HyDE 不是事实来源，Rerank 不能找回未召回材料，Query Rewrite 不能改掉用户意图。
- 结论：概念边界清楚，没有写死具体框架 API、召回数量或性能数字。

### 工程审稿人

- 发现问题：如果只讲算法名，后端工程师不知道如何落地、灰度、回滚和排障。
- 修订动作：新增高级 RAG 流水线、RagPolicy 配置模型、RAG Trace 进阶字段、失败分类和调优顺序。
- 结论：章节能映射到真实 Java 后端和企业 RAG 平台治理。

### 学习体验审稿人

- 发现问题：初学者容易分不清基础 RAG 和进阶 RAG 的边界，也容易一上来就堆复杂组件。
- 修订动作：用“评审没过能先给谁”贯穿示例，逐步引入 rewrite、多路召回、rerank 和上下文扩展，并在实践任务中拆成四级练习。
- 结论：学习路径从直觉到工程调优比较清晰。

### 主编

- 最终调整：统一主线为“如何让 RAG 从能跑变成可诊断、可调优、可治理”。
- 与全书衔接：承接第 7 章 RAG 基础，转向第 9 章记忆系统。
- 后续章节提醒：第 9 章需要重点区分 RAG、对话历史、任务状态和长期记忆，避免读者把检索系统和记忆系统混为一谈。
