# AI Agent 开发：从大模型原理到工程化落地

## 写作定位

这本书不是按 AI 术语做百科式罗列，而是按 AI Agent 能力的生长路径组织：

> 模型如何工作 -> 如何和模型沟通 -> 如何给模型知识 -> 如何让模型调用工具 -> 如何让模型完成任务 -> 如何让 Agent 工程化、产品化、系统化。

核心目标是帮助 Java 后端工程师、AI Agent 开发者和希望系统学习 AI 的技术人，建立一套从基础认知到工程落地的完整知识体系。

## 章节写法

除导读和全书大纲外，每一章默认使用统一结构：本章解决什么问题、一个直观例子、基础解释、核心原理、工程实现、适用场景、不适用场景、常见坑与反模式、安全成本与性能考虑、如何评估效果、实践任务、从入门到专业、本章小结和写作审查记录。

这个固定结构背后仍然遵循三层写作逻辑：先讲清楚这是什么和为什么需要它，再讲怎么在真实项目里使用它，最后讲常见坑、设计权衡、安全、成本、性能和评估问题。这样既能作为系统学习资料，也能逐步沉淀成个人 AI Agent 知识库。

所有章节都要贯穿一组工程检查维度：输入是什么，处理过程是什么，输出给谁消费，状态保存在哪里，异常如何恢复，权限在哪里执行，日志和 trace 如何复盘，如何评估效果，如何部署、灰度和回滚。后续第 18-22 章会集中展开可靠性工程、后端架构、可观测性、安全和成本，但这些维度从第 1 章开始就应该进入读者的设计习惯。

涉及 OpenAI API、Spring AI、LangChain4j、MCP、Claude Code、模型版本、价格、上下文长度、命令和配置的章节，必须标注文档版本或访问日期。目录中的技术栈名称只表示学习主题，不表示固定推荐或长期稳定能力。

前 9 章可以理解为一条主线项目逐步扩展：

| 阶段 | 章节 | 阶段产出 |
| --- | --- | --- |
| 建立技术地图 | 第 1-3 章 | 知道模型是什么、为什么会失败、如何按任务选型 |
| 稳定一次模型调用 | 第 4-6 章 | 能把会议纪要助手做成可测试、可校验、可人工确认的后端流程 |
| 给模型外部知识和长期状态 | 第 7-9 章 | 能把知识库问答、RAG 索引和用户记忆纳入权限、评估和治理 |

## 第一部分：AI 与大模型基础

这一部分解决一个核心问题：我们到底在和什么东西打交道？

### 第 1 章：AI、机器学习、深度学习与大模型的关系

- AI 领域整体地图
- 传统 AI、机器学习、深度学习、生成式 AI 的区别
- 为什么 LLM 成为 Agent 的核心大脑
- AI Agent 在整个 AI 技术体系中的位置

### 第 2 章：LLM 的基本原理

- Token、Embedding、Transformer、Attention
- 预训练、微调、指令微调、对齐
- 为什么模型是在“生成”而不是“检索”
- 幻觉、上下文窗口、概率输出的本质
- LLM 的能力边界与失败模式

### 第 3 章：主流模型与能力边界

- Chat 模型、推理模型、多模态模型
- OpenAI、Claude、Gemini、Qwen、DeepSeek 等模型差异
- 如何选择模型：效果、成本、延迟、上下文、工具调用能力
- 大模型 API 的基本调用方式
- 私有化模型与云端模型的取舍

## 第二部分：和模型沟通：Prompt 与上下文工程

这一部分解决一个核心问题：如何让模型稳定听懂你？

### 第 4 章：Prompt Engineering 基础

- System、User、Assistant 消息的区别
- 角色设定、任务描述、约束条件、输出格式
- Zero-shot、Few-shot、推理提示与 CoT 边界
- 常见坏 Prompt 与改写方法
- Prompt 在 Agent 系统中的位置

### 第 5 章：Context Engineering 上下文工程

- Prompt 不只是提示词，而是上下文组织
- 对话历史、任务状态、工具结果、RAG 片段和长期记忆如何进入上下文
- 用户画像、权限、系统规则和业务对象如何分层
- 长上下文管理、滑窗、摘要压缩、按需检索
- ContextPackage、上下文快照、日志、评估和回滚

### 第 6 章：结构化输出与可靠性

- 为什么自然语言输出不适合直接进入程序
- JSON、JSON Schema 与结构化输出
- 输出校验、自动修复、重试策略
- 格式稳定性与业务稳定性的关系
- Schema 版本、引用校验、业务门禁和可执行日志

## 第三部分：给模型知识：RAG 与记忆系统

这一部分解决一个核心问题：模型不知道的东西，怎么让它知道？

### 第 7 章：RAG 基础

- 为什么需要 RAG
- 文档加载、清洗、切分、索引和入库
- 关键词检索、向量检索、混合检索的边界
- 检索、重排、上下文注入、引用和校验的完整流程
- 权限过滤、RAG Trace 和最小后端架构

### 第 8 章：RAG 进阶

- Chunk 策略：大小、重叠、语义边界
- Hybrid Search：关键词检索 + 向量检索
- Query Rewrite、Query Expansion、多路召回、Rerank
- 父子文档检索、上下文扩展和 RAG Policy
- 引用来源与可解释性
- 如何评估 RAG 效果：召回、排序、引用、权限和端到端正确性

### 第 9 章：Agent 的记忆系统

- 短期记忆、长期记忆与任务状态的边界
- 长期记忆：用户偏好、已确认事实、项目约定
- 语义记忆、情节记忆、结构化记忆
- 记忆写入、更新、召回、删除和冲突处理
- 隐私、权限、审计、评估和生产治理

## 第四部分：让模型行动：Function Call、Tool Use 与 MCP

这一部分解决一个核心问题：模型如何从“会说”变成“会做”？

### 第 10 章：Function Calling

- Function Call 的本质
- Tool Schema 如何设计
- 参数生成、参数校验、工具结果回填
- Java 后端如何封装工具接口
- Function Call 的常见失败模式与修复策略

### 第 11 章：Tool Use 工具调用系统

- 搜索工具
- 数据库工具
- 文件工具
- 浏览器工具
- 代码执行工具
- 工具权限、安全边界和审计
- 工具调用链路的日志与追踪

### 第 12 章：MCP：模型上下文协议

- MCP 解决什么问题
- MCP Server 与 MCP Client 架构
- Resources、Tools、Prompts 的概念
- MCP 与 Function Call 的关系
- 如何把企业内部系统接入 Agent
- MCP 在企业 Agent 平台中的价值

### 第 13 章：Skill、插件与能力包

- Skill 不是所有 AI 领域的统一标准，而是一种能力封装模式
- Prompt + Tool + Workflow + Examples 如何组合成 Skill
- Skill 与插件、MCP、Function Call 的区别
- 如何沉淀可复用的专业任务能力
- Skill 在个人知识库和企业 Agent 平台中的作用

## 第五部分：Agent 核心架构

这一部分是整本书的核心：从“调用模型”进入“构建 Agent”。

### 第 14 章：什么是 AI Agent

- Agent 与 Chatbot 的区别
- Agent 的四要素：目标、记忆、工具、规划
- 单轮问答、多轮任务、自治执行的区别
- 一个 Agent 系统的最小架构
- Agent 能力成熟度模型

### 第 15 章：Agent Planning 任务规划

- ReAct
- Plan-and-Execute
- Reflection
- Self-Correction
- 任务拆解、执行、观察、调整
- 规划能力的边界与失控风险

### 第 16 章：Agent Runtime 运行时

- Agent Loop
- 状态机
- Step、Thought、Action、Observation
- 中断、恢复、重试、超时
- Human-in-the-loop 人类确认
- 长任务执行与任务状态持久化

### 第 17 章：Multi-Agent 多智能体

- 多角色协作
- Supervisor / Worker 模式
- Debate / Review / Critic 模式
- 多 Agent 的成本、混乱与控制问题
- 什么时候不该使用 Multi-Agent
- 企业场景中的多 Agent 编排

## 第六部分：工程化与生产落地

这一部分对应后端工程师的优势：把 Agent 从 Demo 变成稳定系统。

### 第 18 章：Agent Harness Engineering：从 Demo 到生产的可靠性工程

- Harness Engineering 解决什么问题
- 上下文、工具、权限、状态和执行环境如何形成工程护栏
- 评估、可观测性、错误恢复和成本控制如何进入 Agent 运行闭环
- Harness 与 Prompt Engineering、Context Engineering、Agent Runtime 的区别
- 如何把 Agent 从能跑的 Demo 推进到可治理的生产系统

### 第 19 章：AI Agent 后端架构

- API 层、模型层、工具层、记忆层、任务层
- 同步任务、异步任务、长任务
- SSE / WebSocket 流式响应
- Java、Spring AI、LangChain4j 的工程实践
- 多租户、会话隔离与任务隔离

### 第 20 章：可观测性与评估

- 日志、Trace、Token 统计
- Prompt 版本管理
- 工具调用链路追踪
- Agent 评测集
- 成本、延迟、成功率、人工接管率
- 从“感觉好用”到“可量化评估”

### 第 21 章：安全与权限

- Prompt Injection
- Tool Injection
- 数据泄露
- 权限隔离
- 沙箱执行
- 企业内部 Agent 的审批与审计机制
- 安全策略如何进入 Agent Runtime

### 第 22 章：性能与成本优化

- 模型选择与模型路由
- Prompt Cache
- RAG Cache
- 并发控制
- 降级策略
- 小模型与大模型协作
- 如何用工程手段降低 Token 成本与响应延迟

## 第七部分：实战项目

这一部分让知识体系落到作品集和真实经验。

### 第 23 章：项目一：知识库问答 Agent

- 文档上传
- 文档切分与向量化
- RAG 问答
- 引用来源
- 效果评估
- 从 Demo 到可用知识库助手

### 第 24 章：项目二：企业工作流 Agent

- Function Call
- MCP 接入
- 数据库查询
- 审批流
- Human-in-the-loop
- 权限、审计与异常处理

### 第 25 章：项目三：研究型 Agent

- 搜索
- 网页阅读
- 多轮规划
- 资料整理
- 报告生成
- 引用管理与事实核查

### 第 26 章：项目四：代码开发 Agent

- 代码阅读
- 文件编辑
- 测试执行
- Debug
- Review 与提交
- 从辅助编程到工程协作

## 第八部分：学习路线与职业发展

这一部分回应个人成长目标：如何真正转向 AI Agent 开发。

### 第 27 章：AI Agent 工程师能力模型

- 模型理解能力
- Prompt / Context 设计能力
- RAG 能力
- Tool / MCP 集成能力
- 后端工程能力
- 产品理解能力
- 评估、安全与成本意识

### 第 28 章：Java 工程师如何转 AI Agent

- Java 工程师的优势在哪里
- 哪些 AI 能力需要补齐
- Spring AI、LangChain4j、MCP、RAG 的学习顺序
- 如何把现有项目改造成 Agent 项目
- 简历如何从“业务开发”转向“AI Agent 工程能力”

### 第 29 章：未来趋势

- Agentic Workflow
- Computer Use
- 多模态 Agent
- Personal Agent
- 企业内部 Agent 平台
- Agent Infra 与 AI Infra 的交叉
- AI Agent 开发者未来的能力边界

## 关键词归位

- LLM 原理：第一部分
- Prompt：第二部分
- RAG：第三部分
- Function Call：第四部分
- MCP：第四部分
- Skill：第四部分
- Agent：第五部分
- 工程化落地：第六、七部分
- 学习路线与职业发展：第八部分
