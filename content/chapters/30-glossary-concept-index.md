# 第 30 章：术语表与概念索引

## 本章解决什么问题

前 29 章已经覆盖了从 AI 基础到 Agent 工程化落地的主线。读完整本书后，读者通常会遇到一个新问题：

> 概念太多，如何把它们放回正确位置？

AI Agent 领域的术语很容易互相混淆：

- Prompt 和 Context。
- RAG 和 Memory。
- Function Calling 和 Tool Use。
- Tool 和 MCP。
- Workflow 和 Agent。
- Trace 和 Log。
- Eval 和 Test。
- Guardrail 和 Policy。
- Skill、Plugin、Capability Package。
- Computer Use、Browser Tool、Code Execution。

如果术语不清，后面的工程设计会跟着乱：

- 把 RAG 当向量库。
- 把 MCP 当权限系统。
- 把 Prompt 当安全边界。
- 把 Tool Calling 当普通 RPC。
- 把 Multi-Agent 当万能架构。
- 把 Eval 当人工主观体验。

本章不是百科词典，而是一本面向工程实践的术语表。每个术语都尽量回答：

- 它是什么？
- 它不是什么？
- 它在 Agent 系统中属于哪一层？
- 它常见于哪些章节？
- 工程落地时要注意什么？

读完本章，读者应该能把整本书的概念重新组织成一张工程地图，并在团队沟通、方案设计、代码命名和评审中使用更准确的语言。

## 一个直观例子

假设团队开会讨论 `kb-assistant`：

```text
我们给 Agent 加个记忆吧。
```

这句话听起来没问题，但工程上很危险。这里的“记忆”可能指：

- 当前对话历史。
- 用户偏好。
- 文档知识库。
- 工具执行结果。
- Agent Run 状态。
- 历史失败样本。
- 已批准的业务事实。

如果不区分，系统可能被设计成：

```text
把所有东西塞进一个 memory 表，再让模型自己用。
```

更专业的拆法是：

```text
对话历史 -> short-term context
文档知识 -> RAG index
用户偏好 -> long-term memory
工具结果 -> observation / trace
任务状态 -> AgentRun / AgentStep
失败样本 -> eval dataset
已批准事实 -> verified fact store
```

术语表的价值就在这里：它不是为了显得专业，而是为了让工程边界变清楚。

## 基础解释

### 如何阅读这份术语表

本章按能力层组织术语：

1. AI 与模型基础。
2. Prompt 与上下文。
3. RAG、知识库与记忆。
4. Tool、MCP、Skill 与互操作。
5. Agent 架构。
6. 工程化与生产治理。
7. 安全、成本与评估。
8. 职业能力与作品集。

每个术语尽量用同一套格式：

| 字段 | 含义 |
| --- | --- |
| 简要定义 | 一句话说明它是什么 |
| 不要混淆 | 它不等于什么 |
| 工程位置 | 它通常出现在系统哪一层 |
| 相关章节 | 本书中主要出现在哪里 |

### 一张总图

可以先用这张图定位：

```text
AI / ML / DL / LLM
  -> Prompt / Context / Structured Output
  -> RAG / Memory
  -> Tool / MCP / Skill
  -> Agent Planning / Runtime / Multi-Agent
  -> Harness / Backend / Observability / Security / Cost
  -> Projects / Skill Model / Career Path
```

越往下，越接近工程落地；越往上，越接近模型基础。

### 术语不是绝对边界

很多术语在不同框架、论文、产品和公司里会有不同叫法。

例如：

- `Tool` 在某些 SDK 中叫 function tool。
- `Agent Run` 在不同平台可能叫 task、session、thread、workflow run。
- `Memory` 可能指对话历史，也可能指长期用户偏好。
- `Guardrail` 有时指输入输出检查，有时指更广义的安全策略。

本章采用的是本书的工程语义，不声称是所有平台的统一标准。

## 核心原理

### 原理一：先定位层级，再解释术语

同一个词放在不同层级，含义会变。

例如 `Context`：

| 层级 | Context 的含义 |
| --- | --- |
| 模型调用 | 发送给模型的消息和输入 |
| RAG | 检索后注入的证据片段 |
| Agent Runtime | 当前 run 的任务状态、工具结果和历史 |
| 安全治理 | 带 trust label、权限和数据分类的上下文包 |

所以解释术语时，先问：

```text
这是模型层、应用层、运行时层，还是治理层？
```

### 原理二：术语要能落到数据结构

如果一个概念无法落到数据结构，工程团队就很难实现和评审。

例如 `Agent Run` 不是一句“Agent 执行了一次任务”，而应该能落成：

```json
{
  "run_id": "run_001",
  "agent_id": "kb_assistant",
  "tenant_ref": "tenant_a",
  "user_ref": "user_pseudo_123",
  "status": "running",
  "trace_id": "trace_001",
  "created_at": "2026-05-30T10:00:00+08:00"
}
```

术语清楚，字段才清楚；字段清楚，系统才可观测、可恢复、可审计。

### 原理三：术语要能说明“不是什么”

只说“是什么”不够。

例如：

- RAG 是检索增强生成，不是“向量数据库”。
- MCP 是上下文和工具接入协议，不是权限系统。
- Prompt 是输入组织方式，不是安全边界。
- Eval 是可重复的评估，不是主观试用。
- Agent 是运行系统，不只是一个模型。

很多生产事故来自把“相邻概念”当成同一个东西。

### 原理四：术语要和责任边界绑定

工程术语最终要服务于责任边界。

例如：

| 术语 | 责任边界 |
| --- | --- |
| Tool Gateway | 后端负责 schema、policy、credential、audit |
| Context Builder | 后端负责选择、过滤、脱敏和打包上下文 |
| Eval Harness | 平台负责样本、执行、评分和回归报告 |
| Approval Service | 人类审批和执行完整性之间的边界 |
| Trace Store | 复盘和审计的边界 |

如果术语不能回答“谁负责”，它在生产系统里就还不够清楚。

## 工程实现

### 反向索引

如果你不是按术语查，而是按章节或能力查，可以先看这两张反向索引。

按章节索引：

| 章节 | 重点术语 |
| --- | --- |
| 第 1-3 章 | AI、Machine Learning、Deep Learning、LLM、Token、Embedding、Transformer、Multimodal Model |
| 第 4-6 章 | Prompt、System Message、Context Engineering、Context Package、Structured Output、JSON Schema、Unknown |
| 第 7-9 章 | RAG、Chunk、Vector Store、Hybrid Search、Rerank、Citation、Memory、Verified Fact |
| 第 10-13 章 | Function Calling、Tool、Tool Schema、Tool Registry、MCP、MCP Resource、MCP Tool、Skill、Plugin |
| 第 14-17 章 | Agent、Agent Run、Agent Step、Plan、Agent Runtime、Stop Condition、Handoff、Multi-Agent、Supervisor |
| 第 18-22 章 | Agent Harness、Model Gateway、Policy Engine、Approval Service、Trace、Eval、Guardrail、Cost Attribution |
| 第 23-26 章 | Citation Checker、Freshness、Agentic Workflow、Computer Use、Patch Record、Review Agent |
| 第 27-29 章 | Agent Engineer、Capability Matrix、Portfolio、Agent Platform、A2A、Agent Infra |

按能力索引：

| 能力方向 | 重点术语 |
| --- | --- |
| 模型调用 | LLM、Token、Model Gateway、Structured Output、JSON Schema |
| 上下文工程 | Prompt、Context Package、Context Snapshot、Trust Label、Data Classification |
| 知识治理 | RAG、Chunk、Vector Store、Citation、Freshness、Verified Fact |
| 记忆系统 | Memory、Short-term Memory、Long-term Memory、Conversation State、Verified Fact |
| 工具系统 | Function Calling、Tool、Tool Schema、Tool Registry、Tool Gateway、Observation |
| 协议与能力包 | MCP、MCP Resource、MCP Tool、MCP Prompt、Skill、Plugin、A2A |
| 运行时 | Agent、Agent Run、Agent Step、Plan、Stop Condition、Handoff、Agentic Workflow |
| 生产治理 | Agent Harness、Policy Engine、Approval Service、Credential Broker、Sandbox、Release Gate |
| 可观测性与评估 | Trace、Span、Log、Audit Log、Metric、Eval、Eval Case、Trace Grading、Feedback Loop |
| 安全与成本 | Prompt Injection、Tool Injection、Excessive Agency、Guardrail、Cost Attribution |

### AI 与模型基础

| 术语 | 简要定义 | 不要混淆 | 工程位置 | 相关章节 |
| --- | --- | --- | --- | --- |
| AI | 让机器完成需要智能的任务的总称 | 不等于大模型 | 总体技术领域 | 第 1 章 |
| Machine Learning | 通过数据学习模式的方法 | 不等于所有 AI | 模型训练和预测 | 第 1 章 |
| Deep Learning | 使用多层神经网络的机器学习方法 | 不等于 LLM 本身 | 模型架构基础 | 第 1 章 |
| LLM | 以语言建模为核心的大模型 | 不等于 Agent | Model Gateway | 第 1-3 章 |
| Generative AI | 生成文本、图像、音频、代码等内容的 AI | 不只包含聊天 | 模型能力层 | 第 1-3 章 |
| Token | 模型处理文本的基本单位 | 不等于一个汉字或一个单词 | 计费、上下文、截断 | 第 2 章 |
| Embedding | 把文本或对象映射到向量空间 | 不等于原文语义本身 | RAG、检索、相似度 | 第 2、7 章 |
| Transformer | 主流 LLM 的核心架构之一 | 不等于所有深度学习 | 模型原理 | 第 2 章 |
| Attention | 模型在上下文中分配关注权重的机制 | 不等于人类注意力 | 模型原理 | 第 2 章 |
| Multimodal Model | 能处理多种输入或输出类型的模型 | 不等于自动可靠理解世界 | 多模态 Agent | 第 3、29 章 |

### Prompt 与上下文

| 术语 | 简要定义 | 不要混淆 | 工程位置 | 相关章节 |
| --- | --- | --- | --- | --- |
| Prompt | 给模型的任务、角色、约束和输入 | 不等于安全边界 | Model input | 第 4 章 |
| System Message | 定义模型行为边界的高优先级指令 | 不等于后端强制策略 | Prompt layer | 第 4 章 |
| Developer Instruction | 开发者对模型行为的工程约束 | 不等于用户输入 | Prompt layer | 第 4 章 |
| User Message | 用户请求和补充信息 | 不一定可信 | Input layer | 第 4 章 |
| Few-shot | 给模型少量示例帮助对齐输出 | 不等于训练模型 | Prompt examples | 第 4 章 |
| Context Engineering | 组织模型可见上下文的工程方法 | 不只是写提示词 | Context Builder | 第 5 章 |
| Context Package | 一次模型调用前组装的上下文包 | 不等于原始数据库记录 | Runtime / Model Gateway | 第 5 章 |
| Context Snapshot | 某次运行使用的上下文快照 | 不等于实时最新数据 | Trace / Replay | 第 5 章 |
| Structured Output | 模型输出可被程序解析的结构 | 不保证业务正确 | Schema Validator | 第 6 章 |
| JSON Schema | 描述 JSON 结构的 schema | 不等于业务规则全部 | Validator / Contract | 第 6 章 |
| Unknown | 系统承认无法确定的状态 | 不等于失败 | Output policy | 第 6、23 章 |

### RAG、知识库与记忆

| 术语 | 简要定义 | 不要混淆 | 工程位置 | 相关章节 |
| --- | --- | --- | --- | --- |
| RAG | 检索外部证据增强生成 | 不等于向量库 | Knowledge pipeline | 第 7-8 章 |
| Document Loader | 加载和解析文档的组件 | 不等于安全解析 | Ingestion | 第 7、23 章 |
| Chunk | 文档切分后的片段 | 不等于自然段 | Index / Retrieval | 第 7-8 章 |
| Vector Store | 存储向量和 metadata 的系统 | 不等于知识库全部 | Retrieval infra | 第 7-8 章 |
| Hybrid Search | 结合关键词和向量检索 | 不保证排序正确 | Retriever | 第 8 章 |
| Rerank | 对召回结果重新排序 | 不等于重新生成答案 | Retrieval pipeline | 第 8 章 |
| Query Rewrite | 改写用户问题以提升检索效果 | 不应改变用户意图 | Retriever | 第 8 章 |
| Citation | 答案引用的证据来源 | 不等于答案被充分支持 | Answer / Checker | 第 7、23、25 章 |
| Citation Checker | 检查引用是否支持答案的组件 | 不只是检查 ref 是否存在 | Eval / Output guard | 第 23、25 章 |
| Freshness | 证据是否足够新 | 不等于访问时间 | Retrieval / Policy | 第 8、23、25 章 |
| Memory | 被显式选择、治理、可更新，并可被 Agent 在后续任务中利用的信息资产 | Trace、Log、Eval Case、RAG Corpus 默认不等于 Memory | Memory Store | 第 9 章 |
| Short-term Memory | 当前任务或对话内状态 | 不等于长期偏好 | Runtime context | 第 9、16 章 |
| Long-term Memory | 跨会话保留的用户或任务信息 | 不应无限保存 | Memory Store | 第 9 章 |
| Verified Fact | 被用户或系统确认过的事实 | 不等于模型生成内容 | Fact Store | 第 9、23 章 |

### Tool、MCP、Skill 与互操作

| 术语 | 简要定义 | 不要混淆 | 工程位置 | 相关章节 |
| --- | --- | --- | --- | --- |
| Function Calling | 模型按 schema 生成函数调用参数 | 不等于模型直接执行函数 | Model / Tool Gateway | 第 10 章 |
| Tool | Agent 可调用的外部能力 | 不等于任意后端 API | Tool Gateway | 第 11 章 |
| Tool Schema | 模型可见的工具输入描述 | 不等于完整后端 DTO | Tool Registry | 第 10-11 章 |
| Tool Registry | 工具元数据和治理配置 | 不只是工具列表 | Platform | 第 11、19 章 |
| Tool Gateway | 工具调用的后端执行边界 | 不等于模型 SDK | Backend | 第 11、19、28 章 |
| Observation | 工具执行后回填给 Agent 的结果 | 不等于完整原始响应 | Runtime | 第 14-16 章 |
| MCP | 模型上下文协议，用于连接工具、资源和 Prompt | 不等于权限治理系统 | Integration protocol | 第 12 章 |
| MCP Resource | MCP 暴露的可读资源 | 不等于 Tool | MCP Server | 第 12 章 |
| MCP Tool | MCP 暴露的可调用动作 | 不自动安全 | MCP Server / Tool Gateway | 第 12 章 |
| MCP Prompt | MCP 暴露的提示模板 | 不等于内部 prompt registry 全部 | MCP Server | 第 12 章 |
| Skill | Prompt、工具、流程和示例组成的能力包 | 不是所有平台统一标准 | Capability package | 第 13 章 |
| Plugin | 可安装扩展能力 | 不等于 Skill 或 MCP | Extension layer | 第 13 章 |
| Computer Use | 让模型通过屏幕和动作操作 UI 的能力 | 不等于普通浏览器 API | High-risk tool | 第 29 章 |
| A2A | Agent 间任务、消息和能力互操作的协议方向 | 不等于共享内存、互信或自动授权 | Agent interoperability | 第 29 章 |

### Agent 架构

| 术语 | 简要定义 | 不要混淆 | 工程位置 | 相关章节 |
| --- | --- | --- | --- | --- |
| Chatbot | 以对话响应为主的系统 | 不等于 Agent | Application | 第 14 章 |
| Tool-using Assistant | 能调用工具的助手 | 不一定有完整 Runtime | Application | 第 14 章 |
| Agent | 至少围绕目标、上下文、工具、运行状态、决策循环和停止条件完成任务的系统 | 不只是模型，也不只是一次工具调用 | Runtime / Product | 第 14-16 章 |
| Agent Run | 一次 Agent 任务执行实例 | 不等于一次模型调用 | Runtime | 第 16、19 章 |
| Agent Step | Run 中的一个可追踪步骤 | 不等于自然语言步骤 | Runtime | 第 16 章 |
| Plan | 执行前或执行中的候选步骤安排 | 不等于最终执行事实 | Planning | 第 15 章 |
| ReAct | 推理和行动交替的 Agent 思路 | 不应记录完整隐式思考链 | Planning pattern | 第 15 章 |
| Reflection | 基于反馈进行修正的机制 | 不等于模型自我证明正确 | Planning / Eval | 第 15 章 |
| Agent Runtime | 管理 run、step、状态、工具和停止条件的运行时 | 不等于模型 SDK | Runtime | 第 16 章 |
| Stop Condition | Agent 停止或暂停的条件 | 不等于成功 | Runtime | 第 15-16 章 |
| Handoff | 把任务控制权转给另一个 Agent | 不等于普通工具调用 | Multi-Agent | 第 17 章 |
| Multi-Agent | 多个 Agent 协作完成任务 | 不一定优于单 Agent | Orchestration | 第 17 章 |
| Supervisor | 负责分配、汇总和治理 Worker 的 Agent | 不应成为万能黑箱 | Multi-Agent | 第 17 章 |
| Worker Agent | 专职处理某类子任务的 Agent | 不应拥有不必要权限 | Multi-Agent | 第 17 章 |
| Agentic Workflow | 固定边界内允许模型动态判断的工作流 | 不等于完全自治 Agent | Workflow Runtime | 第 24、29 章 |

### 工程化与生产治理

| 术语 | 简要定义 | 不要混淆 | 工程位置 | 相关章节 |
| --- | --- | --- | --- | --- |
| Agent Harness | 围绕 Agent 的上下文、工具、策略、评估和运行护栏 | 不只是测试脚本 | Platform | 第 18 章 |
| Model Gateway | 模型调用统一入口 | 不等于 provider SDK | Backend infra | 第 19、28 章 |
| Context Builder | 选择、过滤、脱敏和组装上下文的组件 | 不等于 prompt 字符串拼接 | Backend | 第 5、18、19 章 |
| Policy Engine | 后端执行权限、风险和动作策略的组件 | 不等于 prompt 规则 | Security / Runtime | 第 18、21 章 |
| Approval Service | 管理高风险动作人工确认的服务 | 不等于前端确认弹窗 | Workflow / Security | 第 16、21、24 章 |
| Credential Broker | 按范围签发短期凭证的组件 | 不等于把 secret 给模型 | Security infra | 第 21 章 |
| Sandbox | 隔离执行环境 | 不等于绝对安全 | Runtime / Tool | 第 21、26、29 章 |
| Idempotency Key | 防止重复执行副作用动作的键 | 不等于 request id | Runtime / Tool | 第 16、24 章 |
| Compensation | 对已发生副作用的补偿动作 | 不等于完全回滚 | Workflow | 第 16、24 章 |
| Release Gate | 发布前的评估和策略门禁 | 不等于 CI 通过 | EvalOps | 第 18、20、22 章 |
| Cost Attribution | 按 tenant、agent、run、tool、model 归集成本 | 不只是 token 统计 | FinOps | 第 20、22 章 |

### 可观测性、评估与安全

| 术语 | 简要定义 | 不要混淆 | 工程位置 | 相关章节 |
| --- | --- | --- | --- | --- |
| Trace | 一次任务的可追踪执行链路 | 不等于普通日志 | Observability | 第 20 章 |
| Span | Trace 中的一个操作片段 | 不等于业务步骤全部 | Observability | 第 20 章 |
| Log | 离散日志记录 | 不等于可回放 trace | Observability | 第 20 章 |
| Audit Log | 面向合规和责任追踪的不可随意修改记录 | 不等于 debug log | Security / Compliance | 第 20-21 章 |
| Metric | 可聚合指标 | 不等于单次运行详情 | Observability | 第 20 章 |
| Eval | 可重复执行的效果评估 | 不等于人工试用 | Eval Harness | 第 20 章 |
| Eval Case | 一个评估样本和期望行为 | 不等于测试描述文字 | Eval Dataset | 第 20 章 |
| Trace Grading | 基于 trace 判断过程是否符合预期 | 不只看最终答案 | EvalOps | 第 20 章 |
| Feedback Loop | 从用户反馈进入样本、修复和发布的闭环 | 不等于收集点赞 | Product / Eval | 第 20 章 |
| Prompt Injection | 恶意内容诱导模型违背原指令 | 不只来自用户输入 | Security | 第 21 章 |
| Tool Injection | 工具结果中夹带恶意指令 | 不等于工具调用失败 | Security | 第 21 章 |
| Excessive Agency | 给 Agent 过多自主权或权限 | 不等于高能力 | Security | 第 21 章 |
| Guardrail | 对输入、工具、输出或流程的检查 | 不等于完整权限系统 | Runtime / SDK / Policy | 第 21 章 |
| Trust Label | 上下文可信度标签 | 不应只给模型看 | Context / Policy | 第 21 章 |
| Data Classification | 数据敏感级别 | 不等于权限本身 | Security / Governance | 第 21 章 |

关于 OpenTelemetry：本章引用 GenAI semantic conventions 只是为了帮助读者理解 trace、span、metric 这类观测概念。截至 2026-05-30，该页面标注为 `Status: Development`，因此本章不把其中字段当成稳定标准。真实落地时应固定语义版本，或者在平台内部做兼容层。

### 职业能力与作品集

| 术语 | 简要定义 | 不要混淆 | 工程位置 | 相关章节 |
| --- | --- | --- | --- | --- |
| Agent Engineer | 能把模型、上下文、工具、运行时和治理组合成系统的工程师 | 不只是 Prompt 工程师 | 职业能力 | 第 27 章 |
| AI Application Backend | 为 AI 应用提供 API、状态、权限和评估的后端 | 不等于普通 CRUD | Backend | 第 19、28 章 |
| Agent Platform Engineer | 建设可复用 Agent Runtime、Tool、Eval、安全和成本平台的人 | 不等于只做业务 Agent | Platform | 第 27-29 章 |
| Portfolio | 展示可运行 Agent 工程能力的作品集 | 不等于截图和演示视频 | Career | 第 27-28 章 |
| Capability Matrix | 用证据描述能力等级的矩阵 | 不等于自我打分 | Learning / Review | 第 27 章 |
| Failure Case | 可复现的失败样本 | 不等于 bug 描述 | Eval / Portfolio | 第 20、27 章 |

### 易混淆概念对照表

| 容易混淆 | 正确区分 |
| --- | --- |
| Prompt vs Context | Prompt 是指令和表达；Context 是被选择、过滤和组织后给模型看的完整输入环境 |
| RAG vs Memory | RAG 通常检索外部知识；Memory 通常保存跨任务或跨会话状态 |
| Tool vs MCP | Tool 是能力；MCP 是暴露和接入工具、资源、Prompt 的协议方式 |
| Function Calling vs Tool Use | Function Calling 偏模型输出工具调用参数；Tool Use 包含工具治理、执行、回填和审计 |
| Agent vs Workflow | Workflow 强调预定义流程；Agent 强调目标、状态、工具和动态决策 |
| Agentic Workflow vs Autonomous Agent | 前者有明确边界和状态机；后者开放性更强、治理难度更高 |
| Trace vs Log | Trace 能串起一次任务的因果链；Log 是离散记录 |
| Eval vs Test | Test 更偏确定程序行为；Eval 更偏模型和 Agent 行为的可重复判断 |
| Guardrail vs Policy | Guardrail 是检查点；Policy 是后端强制执行的策略体系 |
| Citation exists vs Claim supported | 引用存在不代表答案主张被引用内容支持 |
| Cost vs Token | token 是成本来源之一；成本还包括检索、工具、sandbox、trace 和 eval |

更严谨地说，Guardrail 可以出现在输入、输出、工具调用前、工具调用后、handoff 前后和最终回答前；Policy 则应产生可审计、可复现、可由后端强制执行的 `policy_decision`。如果一个“安全规则”只能写在 Prompt 里，不能落到后端判定和审计记录里，它就不应该被当成生产级 Policy。

### 官方术语 vs 本书术语

不同 SDK、平台和论文会使用不同命名。本书为了讲清工程边界，会使用一些抽象术语。读官方文档时，可以这样对照：

| 本书术语 | 在不同平台中可能对应的叫法 | 使用提醒 |
| --- | --- | --- |
| Agent Run | run、thread run、session、task、workflow execution | 不要假设字段一致，重点看生命周期和状态机 |
| Agent Step | step、span、event、node execution、tool call | step 是业务执行单元，span 是观测单元，二者可能一对多或多对一 |
| Tool Gateway | function executor、tool runtime、action handler、connector backend | 本书强调后端 policy、credential、audit，不只是调用适配 |
| Model Gateway | model client、provider adapter、LLM service | 本书强调 model profile、usage、fallback、cost 和敏感数据策略 |
| Eval Harness | eval runner、dataset evaluator、experiment、trace grader | 本书强调样本、执行、评分、回归和发布门禁闭环 |
| Context Builder | prompt builder、context assembler、retrieval context service | 本书强调权限过滤、trust label、脱敏和上下文快照 |
| Approval Service | human-in-the-loop、confirmation、interrupt、approval workflow | 本书强调审批对象、输入 hash、重新校验和审计 |
| Guardrail | input guardrail、output guardrail、tool guard、moderation check | 具体 SDK 的 guardrail 触发位置不同，不能默认覆盖全链路 |

这张表不是官方映射，只是帮助读者把本书语言和外部文档对齐。

### 术语卡片模板

团队可以把重要概念做成术语卡片：

```json
{
  "concept_card": {
    "term": "Tool Gateway",
    "definition": "统一接收、校验、授权、执行和审计工具调用的后端边界",
    "not": ["模型 SDK", "普通 RPC 代理"],
    "layer": "backend_infra",
    "related_chapters": ["11", "19", "21", "28"],
    "required_fields": [
      "tool_name",
      "tool_version",
      "policy_decision_id",
      "approval_id",
      "idempotency_key",
      "trace_span_id"
    ],
    "review_questions": [
      "模型是否能看到不该看的凭证？",
      "写工具是否有审批和幂等？",
      "工具结果是否脱敏？"
    ]
  }
}
```

这类卡片可以放进团队 wiki，也可以作为代码评审中的术语基准。

## 适用场景

### 学习复盘

读完一个章节后，可以回到本章检查：

- 这一章新增了哪些术语？
- 这些术语属于哪一层？
- 有没有和旧概念混淆？
- 是否能落到数据结构？
- 是否知道它不适用的情况？

### 团队方案设计

做 Agent 方案评审时，可以用本章统一语言：

- 这是 RAG，还是 Memory？
- 这是 Tool，还是 MCP Resource？
- 这是 Guardrail，还是后端 Policy？
- 这是普通 Workflow，还是 Agentic Workflow？
- 这是 Log，还是 Trace？

术语统一后，方案评审会少很多无效争论。

### 代码命名

术语可以直接影响代码命名。

例如：

| 不清楚命名 | 更清楚命名 |
| --- | --- |
| `MemoryService` | `ConversationStateService` / `LongTermPreferenceService` |
| `AIService` | `ModelGateway` / `AgentRuntimeService` |
| `ToolService` | `ToolRegistry` / `ToolGateway` |
| `LogService` | `TraceService` / `AuditLogService` |
| `CheckService` | `EvalRunner` / `PolicyEngine` |

命名不是小事，它会影响团队对系统边界的理解。

## 不适用场景

### 不适合作为官方标准替代

本章是本书的工程术语表，不是 OpenAI、Anthropic、MCP、A2A、Spring AI、LangChain4j 或 OpenTelemetry 的官方术语标准。

当你实现具体协议、SDK 或框架时，必须回到对应官方文档。

### 不适合机械套用

不同团队可能有不同命名习惯。重要的不是每个词完全一致，而是同一团队内部要一致，并且能映射到清楚的数据结构和责任边界。

### 不适合忽略上下文

同一个术语在不同上下文里可能含义不同。不要脱离章节和系统层级孤立解释。

例如 `Run` 在 Agent Runtime、CI/CD、Eval Experiment 中都可能出现，但业务含义不同。

## 常见坑与反模式

1. 用一个词装所有东西。

   例如把上下文、记忆、知识库、工具结果都叫 memory。

2. 用产品名代替架构概念。

   例如用某个框架名代替 Agent Runtime 或 Tool Gateway。

3. 把协议当治理系统。

   MCP、A2A 提供互操作方式，不自动提供权限、审批和审计。

4. 把示例字段当标准字段。

   本书很多 JSON 是工程示例，不是官方 schema。

5. 把模型输出当事实。

   需要 citation、verification、approval 或 eval 的场景，不能只信自然语言答案。

6. 把 eval 只理解成打分。

   Eval 还要进入发布门禁、回归分析和失败样本闭环。

7. 把安全写在 Prompt 里。

   Prompt 可以提示模型，但安全边界必须在后端强制执行。

8. 只学英文术语，不理解工程责任。

   能说出词不等于能设计系统。

## 安全、成本与性能考虑

### 安全

术语不清会直接带来安全风险。

例如：

- 把 `trust label` 当成给模型看的文本，可能被恶意上下文诱导忽略。
- 把 `approval` 当成前端按钮，可能导致审批内容被篡改。
- 把 `tool schema` 当成后端 DTO，可能暴露内部字段。
- 把 `MCP server` 当成可信工具源，可能引入供应链风险。

安全术语必须落到后端可执行策略，而不是只停留在文档描述。

### 成本

成本相关术语也要清楚：

- token usage。
- provider billed cost。
- estimated cost。
- cached token。
- embedding cost。
- rerank cost。
- sandbox runtime cost。
- trace storage cost。
- eval replay cost。

如果团队只说“这个 Agent 很贵”，但不区分成本来源，就无法优化。

### 性能

性能术语要区分：

- first token latency。
- final answer latency。
- retrieval latency。
- tool latency。
- approval wait time。
- queue time。
- replay time。

Agent 性能不是一个延迟数字，而是一条链路的多段耗时。

## 如何评估效果

### 术语掌握评估

可以用这张表自测：

| 能力 | 合格表现 |
| --- | --- |
| 能解释 | 能用自己的话说明术语是什么 |
| 能区分 | 能说出它不等于什么 |
| 能定位 | 能说出它在系统哪一层 |
| 能建模 | 能给出最小数据结构 |
| 能评审 | 能指出常见误用 |
| 能落地 | 能把术语映射到代码、表、接口或流程 |

### 术语评审清单

评审一个 Agent 方案时，可以问：

- 文档里所有核心术语是否定义过？
- 同一个词是否在不同地方表示不同含义？
- 是否把协议、框架、产品名和架构概念混在一起？
- 是否能从术语追到数据结构？
- 是否能从术语追到责任人？
- 是否能从术语追到评估样本？

### 最小验收标准

一个团队的 Agent 术语体系至少应该做到：

```json
{
  "glossary_acceptance": {
    "core_terms_defined": true,
    "ambiguous_terms_resolved": true,
    "data_model_links": true,
    "owner_links": true,
    "related_chapters_or_docs": true,
    "review_questions": true
  }
}
```

## 实践任务

1. 入门：整理个人术语表。

交付物：从本章选 30 个术语，写出一句话定义和“不要混淆”。

自查标准：不能复制原文，必须能用自己的项目例子解释。

2. 初级：做概念分层图。

交付物：把 30 个术语按模型层、上下文层、工具层、运行时层、治理层分类。

自查标准：每个术语只能放在一个主层级，但可以标注相关层级。

3. 中级：为项目做术语卡片。

交付物：为 `kb-assistant` 写 10 张 `concept_card`。

自查标准：每张卡片必须包含 definition、not、required_fields、review_questions。

4. 高级：清理代码命名。

交付物：检查一个项目中 `AIService`、`MemoryService`、`ToolService`、`LogService` 这类模糊命名，并给出重命名建议。

自查标准：重命名必须反映责任边界，而不是只换一个更酷的词。

5. 专业：设计团队术语治理流程。

交付物：写一份团队规范，说明新增 Agent 术语时如何定义、评审、关联代码和更新文档。

自查标准：术语必须能关联 owner、数据模型、评估样本和章节或官方来源。

参考答案要点：

- 术语不是装饰，它决定系统边界。
- 每个关键术语都要说明“是什么”和“不是什么”。
- 工程术语要能落到字段、接口、状态和责任人。
- 团队内部一致性比追逐所有平台叫法更重要。
- 涉及官方协议和 SDK 时，必须回到官方文档。

## 从入门到专业

- 入门：能读懂 AI Agent 常见术语。
- 初级：能区分相邻概念，例如 RAG / Memory、Tool / MCP、Trace / Log。
- 中级：能把术语映射到数据模型和服务边界。
- 高级：能在方案评审中发现术语混乱导致的架构风险。
- 专业：能建立团队级术语体系，让文档、代码、评估和审计语言一致。

术语能力看起来很基础，但越到复杂系统越重要。很多高级问题，表面是架构问题，底层其实是概念边界不清。

## 本章小结

本章把前 29 章中的核心术语重新整理成工程索引。

几个最重要的结论是：

- 术语要按系统层级理解。
- 术语要能说明“不是什么”。
- 术语要能落到数据结构和责任边界。
- 协议、框架、产品名和架构概念不能混用。
- 团队术语一致性会直接影响代码命名、方案评审、安全治理和故障复盘。

如果说前面的章节是在搭建一座 Agent 工程大楼，本章就是给每个房间贴上清楚的门牌。门牌贴对了，后续扩建、维护和协作才不会迷路。

下一章如果继续扩写，建议进入架构模板：把知识库 Agent、工作流 Agent、研究 Agent、Coding Agent 和 Agent Platform 的常用架构图、数据模型、接口清单整理成可复用模板。

## Sources

以下来源按 2026-05-30 访问时理解；本章是本书的工程术语索引，不替代任何官方协议、SDK 或框架文档。OpenTelemetry GenAI semantic conventions 当前页面标注为 `Status: Development`，本章只引用其概念方向，不采用其字段作为稳定标准。RAG、JSON Schema、Spring AI、LangChain4j 等具体框架或 API 术语未在本章逐项重复引用，具体实现以对应章节的 Sources 和官方文档为准。

- [OpenAI API: Agents](https://developers.openai.com/api/docs/guides/agents)
- [OpenAI API: Computer use](https://developers.openai.com/api/docs/guides/tools-computer-use)
- [Anthropic: Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)
- [Model Context Protocol Specification 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25)
- [A2A Protocol Specification](https://a2a-protocol.org/latest/specification/)
- [OpenTelemetry Semantic conventions for generative AI systems](https://opentelemetry.io/docs/specs/semconv/gen-ai/)

## 写作审查记录

### 章节架构师

- 本章目标：在全书主体内容之后，为核心概念建立统一索引，帮助读者把术语归位到工程层级。
- 知识点地图：模型基础、Prompt / Context、RAG / Memory、Tool / MCP / Skill、Agent Runtime、工程治理、观测评估、安全成本和职业能力。
- 前后章节关系：承接第 29 章未来趋势，作为附录型章节，为后续架构模板、评估样本库和脚手架章节提供统一语言。

### 技术审稿人

- 发现问题：术语表容易把本书工程抽象误写成官方标准，也容易把 MCP、A2A、OpenTelemetry 等规范字段泛化；Memory、Agent、Guardrail / Policy 等核心术语边界需要更严。
- 修订动作：明确本章采用本书工程语义；补充官方术语与本书术语对照；收紧 Memory、A2A、Agent、Guardrail / Policy 定义；说明 OpenTelemetry GenAI semantic conventions 当前为 Development 状态；涉及官方协议和观测语义时只做概念级引用，并在 Sources 标注访问日期。
- 结论：章节可以作为本书索引使用，但不会替代官方文档。

### 工程审稿人

- 发现问题：单纯解释术语不足以指导工程落地；读者还需要从章节和能力反查术语。
- 修订动作：每类术语都增加“不是什么”“工程位置”和“相关章节”；补充按章节和按能力的反向索引、术语卡片模板、命名对照表、评审清单和验收标准。
- 结论：章节能帮助团队把术语落到字段、接口、状态、责任人和评审问题。

### 学习体验审稿人

- 发现问题：初学者容易被大量英文术语压住，经验工程师又需要快速索引。
- 修订动作：按学习路径分层组织术语，并加入章节 / 能力反向索引、易混淆概念对照表、实践任务和从入门到专业的能力推进。
- 结论：章节既能做复习入口，也能做团队沟通参考。

### 主编

- 最终调整：本章定位为附录型章节，不继续扩写新技术点，而是统一全书语言。
- 与全书衔接：第 1-29 章负责展开能力，本章负责索引和归位。
- 后续章节提醒：下一章适合写架构模板，避免继续堆叠抽象概念。
