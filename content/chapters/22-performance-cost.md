# 第 22 章：性能与成本优化

## 本章解决什么问题

第 20 章讲可观测性，第 21 章讲安全与权限。到这里，Agent 已经不是一个能跑的 Demo，而是一个有运行时、工具、审计、评估和安全边界的系统。接下来会出现一个很现实的问题：

> 系统能跑、能审计、也安全，但太慢、太贵、太不稳定。

AI Agent 的性能与成本问题通常不只来自模型本身。它可能来自：

- 上下文过长。
- 每次都重复检索。
- 工具调用串行执行。
- 小任务用了过强模型。
- 高风险工具等待审批时阻塞整个 run。
- 流式输出和后台任务没有拆开。
- 缓存没有租户隔离。
- 重试策略导致重复写入。
- eval 和线上流量混在同一套资源里。
- 成本只按模型维度统计，无法归因到 Agent、工具和租户。

本章要回答：

- Agent 系统里什么叫性能，什么叫成本？
- 为什么不能只靠“换便宜模型”优化？
- 模型路由应该怎么设计？
- Prompt Cache、RAG Cache、Tool Result Cache 分别缓存什么？
- 哪些内容不能缓存？
- 如何做并发、限流、队列和降级？
- 如何在不破坏安全边界的前提下降低成本？
- 如何评估一次优化真的有效，而不是只是让结果变差？

截至 2026-05-30，OpenAI API 文档提供 prompt caching、Batch API、rate limits、latency optimization 和 cost optimization 相关能力；OpenTelemetry GenAI semantic conventions 仍处于演进状态，可用于对齐模型调用、token、延迟和错误指标，但落地时应固定语义版本或做兼容层。不同模型供应商的缓存、计费、速率限制和 batch 能力差异很大，本章采用工程抽象，不写死某个供应商的价格或性能数字。

读完本章，读者应该能为 kb-assistant 设计性能与成本优化方案：简单查询走轻量模型，复杂上线判断走强模型；RAG 检索和工具结果按租户隔离缓存；高风险写操作不被缓存绕过；慢工具异步执行；成本能按 tenant、agent、run、tool、model_profile 归集；每次优化都必须通过准确性、安全和成本评估。

## 一个直观例子

用户问：

```text
kb-assistant 今天能不能上线？
```

一个未经优化的 Agent 可能这样执行：

```text
1. 把完整系统 prompt、完整章节资料、完整历史对话都放进上下文。
2. 使用最强模型规划。
3. 串行调用 list_release_checks。
4. 串行调用 get_review_status。
5. 串行调用 list_eval_failures。
6. 再次把所有工具结果、原始文档和完整 trace 放进模型。
7. 使用同一个强模型生成最终回答。
```

这个流程可能准确，但慢且贵。

一个更好的流程会拆开：

```json
{
  "task_type": "judge_release_readiness",
  "model_route": {
    "intent_classifier": "small_fast_model",
    "planner": "medium_or_strong_model",
    "final_answer": "medium_model"
  },
  "context_strategy": {
    "static_prompt": "cacheable_prefix",
    "release_policy": "versioned_context_ref",
    "conversation": "summarized_recent_turns"
  },
  "tool_strategy": {
    "read_tools": "parallel_with_cache",
    "write_tools": "approval_required_no_cache_bypass"
  },
  "cost_guard": {
    "budget_ref": "budget.release_readiness.daily",
    "on_budget_pressure": "degrade_to_read_only_summary"
  }
}
```

最终效果不是“所有东西都变便宜”，而是：

- 不需要强模型的步骤不用强模型。
- 不变化的上下文尽量稳定复用。
- 可缓存的只读结果按租户和版本缓存。
- 写操作仍然走审批、幂等和审计。
- 慢任务用异步事件更新，不让用户一直等。
- 成本和延迟可以回到 trace 里解释。

性能优化的目标不是把系统变成最快，而是在正确性、安全和体验之间做可验证的取舍。

## 基础解释

### 性能不只是延迟

Agent 系统的性能至少包含四类指标：

| 指标 | 说明 |
| --- | --- |
| Latency | 用户从发起请求到看到结果的时间 |
| Throughput | 系统单位时间能处理多少 run / step / tool call |
| Freshness | 结果使用的数据是否足够新 |
| Stability | 高峰、慢工具、限流时是否仍可用 |

对 kb-assistant 来说，用户体感最关心的是：

- 首屏是否快速出现。
- 是否能看到当前进度。
- 最终判断是否可信。
- 外部系统慢时是否明确说明 unknown，而不是卡住。

### 成本不只是 token

Agent 成本至少包括：

| 成本 | 示例 |
| --- | --- |
| Model Cost | 输入 token、输出 token、缓存 token、推理 token |
| Embedding Cost | 文档切分、向量化、增量更新 |
| Retrieval Cost | 向量库查询、重排、权限过滤 |
| Tool Cost | 外部 API 调用、浏览器执行、数据库查询 |
| Runtime Cost | 队列、worker、存储、trace、eval |
| Human Cost | 审批、人工复核、事故排查 |

只盯 token 会误导优化。例如，为了省 token 删除引用来源，可能降低可解释性；为了少调用工具直接猜答案，可能增加事故成本。

### 模型路由是什么

模型路由是根据任务类型、风险、上下文、预算和质量要求选择模型或模型配置。

常见路由：

- 简单分类：轻量模型。
- 普通问答：中等模型。
- 高风险规划：更强模型。
- 长上下文总结：长上下文或专用总结链路。
- 安全判断：规则优先，必要时模型辅助。
- 离线 eval：可使用 batch 或低优先级队列。

模型路由不是“便宜模型优先”。它要回答：

```text
这个步骤错了会造成什么后果？
这个步骤需要多少推理能力？
有没有可复用结果？
是否需要实时返回？
当前预算和限流状态如何？
```

### 缓存是什么

缓存是把可复用结果保存下来，避免重复计算。

Agent 系统常见缓存：

| 缓存 | 缓存对象 |
| --- | --- |
| Prompt Cache | 稳定的 prompt prefix 和静态上下文 |
| Response Cache | 完全相同或可等价请求的最终回答 |
| RAG Cache | 检索 query、filter、top-k、rerank 结果 |
| Embedding Cache | 文档 chunk 的 embedding |
| Tool Result Cache | 只读工具的查询结果 |
| Policy Cache | 低风险、短期有效的权限判断 |
| Eval Cache | 离线评估中重复样本的中间结果 |

缓存不是把所有结果都存起来。缓存必须考虑：

- 租户隔离。
- 用户权限。
- 数据版本。
- 安全标签。
- 失效策略。
- 是否包含敏感信息。
- 是否会绕过审批或审计。

尤其要小心 Response Cache 和 Policy Cache。

生产 Agent 默认不缓存高风险最终回答。最终回答可能包含用户特定结论、过期证据、权限差异、敏感摘要和当时的 policy decision。如果确实要缓存低风险回答，cache key 必须绑定：

- tenant。
- user scope。
- task input hash。
- evidence version。
- policy version。
- output policy。
- redaction policy。
- TTL 或 snapshot time。

缓存命中也要写 trace，且回答里要能说明使用了哪个 snapshot。`kb-assistant 是否可以上线` 这类中高风险判断，不应直接复用最终回答缓存；最多复用只读工具结果、RAG 检索结果和静态上下文。

Policy Cache 更要谨慎。权限判断可能因为用户角色变化、资源归属变化、审批撤销、policy 版本升级而失效。只允许缓存低风险、无副作用、短期有效的 policy 结果，并且必须绑定：

- `policy_version`
- `user_scope_hash`
- `resource_version`
- `approval_state`
- `tenant_ref`
- `agent_id`

高风险写操作、审批结果、跨租户判断、凭证签发和安全拒绝不应依赖 policy cache 直接放行。

### 降级是什么

降级是在资源不足、外部依赖慢、预算紧张或风险升高时，主动减少能力范围。

对 kb-assistant，合理降级可能是：

- 只返回已知检查项，不给最终 ready 判断。
- 使用缓存的只读检查结果，但标明数据时间。
- 跳过非关键增强解释。
- 把创建阻塞项改为生成草稿并等待确认。
- 把长任务放入后台，先返回 run id 和进度。

不合理降级是：

- 权限检查失败时直接允许。
- 安全评审未知时说“已通过”。
- 为省成本省略审批。
- 为了速度跳过跨租户过滤。

## 核心原理

### 原理一：先定义质量底线，再谈优化

优化之前必须定义不可破坏的底线：

- 不跨租户。
- 不泄露凭证。
- 不绕过审批。
- 不把 unknown 说成 passed。
- 不删除必要证据。
- 不让缓存结果绕过权限。
- 不让低价模型处理高风险决策。

这叫 guardrail-aware optimization。优化目标应该写成：

```text
在安全策略、准确性和证据完整性不下降的前提下，降低延迟和成本。
```

而不是：

```text
尽量减少 token。
```

### 原理二：把 run 拆成可优化的 step

Agent 性能优化不能只看整体回答。要拆成 step：

```json
{
  "run_id": "run_release_001",
  "steps": [
    {
      "step": "intent_classification",
      "latency_ms": 0,
      "cost_source": "model_or_rule",
      "optimization": "rule_first_then_small_model"
    },
    {
      "step": "context_build",
      "optimization": "versioned_context_refs"
    },
    {
      "step": "read_tools",
      "optimization": "parallel_read_with_cache"
    },
    {
      "step": "final_answer",
      "optimization": "evidence_refs_not_raw_docs"
    }
  ]
}
```

示例中的 `latency_ms: 0` 只是占位字段，真实系统应记录实际观测值，不要在设计文档里写无来源的固定性能目标。

拆开后才能知道：

- 慢在哪里。
- 贵在哪里。
- 哪些步骤可以缓存。
- 哪些步骤可以并行。
- 哪些步骤必须强一致。
- 哪些步骤可以异步。

### 原理三：模型路由要和风险等级绑定

模型选择不能只按输入长度或价格决定，还要看风险等级：

```json
{
  "model_routing_policy": [
    {
      "step_type": "intent_classification",
      "risk_level": "low",
      "model_profile": "fast_classification"
    },
    {
      "step_type": "release_readiness_reasoning",
      "risk_level": "medium",
      "model_profile": "balanced_reasoning"
    },
    {
      "step_type": "write_action_planning",
      "risk_level": "medium_write",
      "model_profile": "strong_reasoning",
      "requires_policy_check": true,
      "requires_approval": true
    },
    {
      "step_type": "credential_or_permission_decision",
      "risk_level": "high",
      "model_profile": "not_authoritative",
      "decision_owner": "policy_engine"
    }
  ]
}
```

注意最后一项：有些决策不能交给模型路由。权限、凭证、审批和跨租户判断必须由后端系统裁决，模型最多辅助解释。

### 原理四：缓存必须带上权限和版本

一个危险缓存 key：

```text
release_checks:kba
```

问题是它没有 tenant、user scope、policy version、数据版本和安全标签。更安全的缓存 key 要包含：

```json
{
  "cache_key_parts": {
    "tenant_ref": "tenant_a",
    "resource_ref": "project:kba",
    "user_scope_hash": "scope_hash_001",
    "tool": "list_release_checks",
    "tool_input_hash": "input_hash_001",
    "data_version": "release_checks_snapshot_20260530",
    "policy_version": "release-policy-v4",
    "redaction_policy": "internal_summary_v2"
  }
}
```

不要把原始 user id、tenant id 或敏感资源名直接拼进可外泄的缓存 key。可以使用内部引用或 HMAC 后的 scope hash。

### 原理五：并发要有背压

并发不是无限并行。Agent 系统里并发包括：

- 多个用户同时请求。
- 一个 run 内多个只读工具并行。
- 多个 Worker 并行执行。
- eval 任务后台批量运行。
- trace / metrics 异步写入。

如果没有背压，系统会在高峰期变成：

```text
更多请求 -> 更多模型调用 -> 更多限流 -> 更多重试 -> 更多排队 -> 成本和延迟同时上升
```

背压机制包括：

- 每租户并发上限。
- 每 Agent 并发上限。
- 每工具并发上限。
- 模型 provider 限流队列。
- 预算耗尽时降级。
- eval 和线上流量隔离。
- 重试使用指数退避和幂等键。

### 原理六：优化必须通过 eval 验证

一次优化可能让指标更好，也可能让质量更差：

- top-k 从 8 改成 3，检索更快，但漏掉关键安全评审。
- 强模型换成小模型，成本下降，但对 unknown 的表达变差。
- 缓存工具结果，延迟降低，但数据过期。
- 压缩上下文，token 变少，但丢了证据来源。

因此每次优化都要跑：

- 准确性 eval。
- 安全 eval。
- 性能基准。
- 成本归集。
- 线上 canary。
- 回滚检查。

## 工程实现

### 性能与成本架构

可以把优化能力放进 Agent Runtime 周边：

```text
API Gateway
  -> Request Classifier
  -> Budget Manager
  -> Model Router
  -> Context Optimizer
  -> Cache Gateway
  -> Tool Scheduler
  -> Rate Limit / Backpressure
  -> Degradation Controller
  -> Cost Attribution
  -> Eval Gate
```

职责：

| 模块 | 职责 |
| --- | --- |
| Request Classifier | 判断任务类型、风险、实时性 |
| Budget Manager | 管理租户、Agent、用户和任务预算 |
| Model Router | 选择模型 profile，不直接决定权限 |
| Context Optimizer | 压缩上下文、引用静态上下文、控制证据 |
| Cache Gateway | 管理 prompt / RAG / tool / response 缓存 |
| Tool Scheduler | 只读工具并行，高风险工具串行审批 |
| Rate Limit / Backpressure | 控制并发、排队、重试和降级 |
| Degradation Controller | 根据预算、限流、故障选择安全降级 |
| Cost Attribution | 将成本归集到 tenant / agent / run / tool / model |
| Eval Gate | 优化上线前做质量、安全和成本评估 |

### Model Profile

不要在业务代码里到处写具体模型名。用 model profile：

```json
{
  "model_profile": {
    "profile_id": "balanced_reasoning_v3",
    "provider": "openai",
    "model_family": "reasoning_or_chat",
    "purpose": "release_readiness_reasoning",
    "max_context_policy": "evidence_refs_preferred",
    "latency_tier": "interactive",
    "cost_tier": "medium",
    "risk_allowed": ["low", "medium"],
    "fallback_profiles": ["fast_summary_v2"],
    "eval_suite": "eval.release_readiness.core",
    "release_gate": "quality_not_lower_than_baseline"
  }
}
```

这样模型升级、切换供应商或调整参数时，可以走配置、评估和发布门禁，而不是全局搜索替换。

### Model Router

模型路由输入：

```json
{
  "task_type": "judge_release_readiness",
  "step_type": "final_answer",
  "risk_level": "medium",
  "tenant_ref": "tenant_a",
  "budget_state": "normal",
  "latency_goal": "interactive",
  "context_shape": {
    "evidence_refs": 6,
    "raw_tokens_estimate": "medium"
  },
  "quality_requirement": "must_handle_unknown"
}
```

输出：

```json
{
  "selected_profile": "balanced_reasoning_v3",
  "fallback_profile": "fast_summary_v2",
  "fallback_allowed_for": [
    "low_risk_summary",
    "non_decision_explanation"
  ],
  "fallback_forbidden_when": [
    "final_release_readiness_decision",
    "permission_or_credential_decision",
    "write_action_planning",
    "required_evidence_missing"
  ],
  "min_eval_suite": "release_readiness_smoke",
  "must_preserve": [
    "unknown_handling",
    "evidence_refs",
    "policy_denied_explanation"
  ],
  "routing_reason": "medium_risk_release_decision",
  "must_run_eval_case_set": "release_readiness_smoke"
}
```

路由逻辑可以是规则，也可以由模型辅助分类，但最终选择应由后端策略产生并记录 trace。Fallback 不是“模型失败就随便换一个便宜模型”。它必须绑定风险、质量门槛和禁止条件；对于最终上线判断这类中风险结论，如果 fallback 模型不能保证 unknown 处理和证据完整性，就应该降级为“后台继续分析”或“返回部分结果”，而不是输出确定结论。

### Context Optimizer

上下文优化不是粗暴截断。它要保留任务所需信息：

```json
{
  "context_plan": {
    "static_prompt": {
      "ref": "prompt.release_readiness.v7",
      "cache_strategy": "stable_prefix"
    },
    "policy_context": {
      "ref": "release_policy.summary.v4",
      "include_raw": false
    },
    "conversation": {
      "strategy": "recent_turns_plus_summary",
      "max_history_policy": "task_relevant_only"
    },
    "evidence": {
      "strategy": "refs_plus_short_quotes",
      "must_include": ["security_review", "eval_failures", "release_checks"]
    }
  }
}
```

常见做法：

- 静态系统指令保持稳定 prefix。
- 大文档变成 versioned summary 和 evidence refs。
- 历史对话做任务相关摘要。
- 工具结果只放必要字段，原始结果用 `observation_ref` 追溯。
- 引用来源保留，不为省 token 删除证据。

OpenAI 文档当前描述 prompt caching 会对重复的输入前缀生效，并在 usage 中暴露 cached token 信息；不同供应商的缓存条件和计费方式不同，生产系统应把 prompt cache 作为 provider 能力之一，而不是假设所有模型都有同样行为。

### Cache Gateway

缓存要统一经过 Cache Gateway：

```json
{
  "cache_policy": {
    "cache_name": "release_checks_read_cache",
    "cache_type": "tool_result",
    "allowed_tools": ["list_release_checks", "get_review_status"],
    "tenant_isolated": true,
    "scope_bound": true,
    "data_version_required": true,
    "policy_version_required": true,
    "contains_sensitive_data": false,
    "on_stale": "return_with_stale_marker_or_refresh",
    "forbidden_for": [
      "write_tool_result",
      "approval_decision",
      "credential_value",
      "cross_tenant_query"
    ]
  }
}
```

缓存读取流程：

```java
CacheResult getCachedToolResult(ToolRequest request, RunContext context) {
    cacheGuard.validateTenant(context.tenantRef(), request.resourceRefs());
    cacheGuard.validateUserScope(context.userScopeHash(), request.resourceRefs());
    cacheGuard.validatePolicyVersion(context.policyVersion());
    cacheGuard.rejectIfWriteTool(request.tool());

    CacheKey key = cacheKeyBuilder.build(request, context);
    CacheResult result = cacheStore.get(key);

    if (result.missing()) {
        return CacheResult.miss();
    }

    if (result.stale()) {
        audit.writeStaleCacheHit(key.safeRef(), context.runId(), result.snapshotTime());
        if (request.requiredEvidence()) {
            return CacheResult.mustRefreshOrMarkUnknown(result.valueRef(), result.snapshotTime());
        }
        return CacheResult.staleWithMetadata(result.valueRef(), result.snapshotTime());
    }

    audit.writeCacheHit(key.safeRef(), context.runId());
    return result;
}
```

伪代码表达职责，不代表某个框架 API。

Stale cache 的使用必须按任务类型限制：

| 场景 | 是否可用 stale |
| --- | --- |
| 普通摘要 | 可以，但必须带 `staleness_marker` 和 snapshot time |
| 非关键解释 | 可以，但不能替代事实判断 |
| 上线 ready 判断的 required evidence | 不应直接使用；必须刷新，刷新失败则标 unknown |
| 权限、审批、凭证 | 不应使用 stale |
| 跨租户过滤 | 不应使用 stale |

stale hit 也要写 trace / audit，否则事后无法解释某个判断为什么用了旧数据。

### RAG Cache

RAG 缓存要比普通缓存更谨慎。检索结果受这些因素影响：

- query 改写版本。
- embedding model version。
- chunk version。
- permission filter。
- tenant filter。
- reranker version。
- top-k 和阈值。
- redaction policy。

示例：

```json
{
  "rag_cache_key": {
    "tenant_ref": "tenant_a",
    "query_hash": "hmac_query_001",
    "query_rewrite_version": "query_rewrite_v4",
    "embedding_model_version": "embedding_profile_v2",
    "index_version": "kb_index_20260530_01",
    "chunk_version": "chunker_v3_snapshot_20260530",
    "permission_filter_hash": "scope_hash_001",
    "reranker_version": "rerank_v3",
    "top_k": 6,
    "score_threshold": "retrieval_policy_default",
    "snapshot_time": "2026-05-30T10:00:00+08:00",
    "ttl_policy": "release_readiness_read_cache",
    "redaction_policy": "internal_refs_only"
  }
}
```

RAG 缓存命中后仍要检查权限。不要因为“这是缓存结果”就跳过 permission filter。

### Tool Scheduler

只读工具可以并行，高风险工具必须受控：

```json
{
  "tool_schedule": [
    {
      "group": "readiness_reads",
      "parallel": true,
      "tools": [
        "list_release_checks",
        "get_review_status",
        "list_eval_failures"
      ],
      "timeout_policy": "mark_unknown_on_timeout"
    },
    {
      "group": "write_actions",
      "parallel": false,
      "tools": ["create_release_blocker"],
      "requires_approval": true,
      "requires_idempotency": true
    }
  ]
}
```

并行只适合没有顺序依赖的只读步骤。写工具、审批、凭证签发和最终状态更新应保持清晰顺序。

### Rate Limit 与 Backpressure

限流配置要按层级管理：

```json
{
  "rate_limit_policy": {
    "tenant_ref": "tenant_a",
    "agent_id": "release_readiness_agent",
    "model_profile": "balanced_reasoning_v3",
    "limits": {
      "max_active_runs": "tenant_configured",
      "max_parallel_tool_calls": "agent_configured",
      "max_eval_jobs": "background_queue_configured"
    },
    "on_limit": {
      "interactive": {
        "action": "queue_then_safe_degrade",
        "queue_priority": "user_visible_readiness_check",
        "max_wait_policy": "interactive_sla_config",
        "on_timeout": "return_run_id_and_partial_status",
        "notify_user": true
      },
      "background_eval": {
        "action": "delay",
        "queue_priority": "low",
        "isolate_from_online_traffic": true
      },
      "write_action": {
        "action": "do_not_auto_retry_without_idempotency",
        "requires_idempotency_key": true,
        "on_limit": "keep_approval_pending"
      },
      "provider_overload": {
        "action": "open_circuit_breaker",
        "retry_policy": "bounded_exponential_backoff",
        "reject_new_low_priority_runs": true
      }
    }
  }
}
```

这里使用配置名而不是精确数字，是为了避免把示例误读成通用推荐值。真实阈值应来自压测、供应商限额、SLA、预算和业务优先级。Backpressure 必须定义队列优先级、最大等待策略、超时状态、用户通知、circuit breaker 和重试上限，否则高峰期会演变成排队和重试风暴。

### Degradation Controller

降级策略要显式配置：

```json
{
  "degradation_policy": {
    "budget_state": "pressure",
    "allowed_degradations": [
      {
        "name": "skip_non_critical_explanation",
        "applies_to": "final_answer",
        "must_preserve": ["evidence_refs", "unknown_items"]
      },
      {
        "name": "use_cached_read_snapshot",
        "applies_to": "read_tools",
        "must_include": ["snapshot_time", "staleness_marker"]
      },
      {
        "name": "background_deep_analysis",
        "applies_to": "long_context_reasoning",
        "initial_response": "acknowledge_and_stream_progress"
      }
    ],
    "forbidden_degradations": [
      "skip_permission_check",
      "skip_approval",
      "omit_policy_denied",
      "mark_unknown_as_passed"
    ]
  }
}
```

降级是一种产品和工程策略，不是异常处理的借口。

### Cost Attribution

成本归集要进入 trace：

```json
{
  "cost_event": {
    "event_id": "cost_001",
    "tenant_ref": "tenant_a",
    "agent_id": "release_readiness_agent",
    "run_id": "run_release_001",
    "step_id": "step_final_answer",
    "model_profile": "balanced_reasoning_v3",
    "provider_usage_source": "provider_usage_api",
    "input_tokens": 0,
    "output_tokens": 0,
    "cached_input_tokens": 0,
    "pricing_version": "pricing_snapshot_2026_05_30",
    "currency": "USD",
    "estimated_cost": "computed_by_billing_service",
    "billed_cost": "reconciled_later",
    "cache_discount_applied": "provider_reported"
  }
}
```

这里的 token 字段为 schema 示例，真实值应由 provider usage、网关统计或计费系统填充。不要在代码里手写价格，也不要在章节里写会过期的具体价格。

### Batch 与离线任务

不是所有任务都需要在线执行。适合 batch 或后台队列的任务：

- 大规模 eval。
- 文档 embedding。
- 历史 trace 重评分。
- 成本报表。
- 低优先级总结。
- 回归样本生成。

OpenAI API 文档提供 Batch API，用于异步批量处理请求；不同供应商的 batch 能力、折扣、时效和限制不同，生产设计应把 batch 视为后台执行通道，而不是实时路径。

## 适用场景

### 玩具 Demo

Demo 阶段可以做轻量优化：

- 限制最大上下文。
- 限制最大工具调用轮次。
- 使用简单缓存。
- 记录 token 和耗时。

但不要为了 Demo 简化掉权限和审批，否则后面迁移生产会补很多债。

### 个人效率工具

个人工具适合：

- 本地响应缓存。
- 文件 embedding 增量更新。
- 小模型做分类和总结。
- 长任务后台执行。
- 用户可见的成本提示。

个人工具也要注意：本地缓存不要保存 secret，不要把不同项目的敏感上下文混在一起。

### 团队内部工具

团队工具需要：

- 租户或项目级预算。
- 多用户缓存隔离。
- 工具级限流。
- 模型路由配置化。
- trace 中记录成本。
- canary 发布优化策略。
- eval 阻止质量回退。

kb-assistant 属于团队工具，优化重点是：上线判断要快，但不能牺牲安全评审、eval 失败项和证据引用。

### 企业级系统

企业级系统需要：

- 成本中心和预算审批。
- Provider 多路由或 fallback。
- 高峰容量规划。
- 线上和离线任务资源隔离。
- 统一 Cache Gateway。
- 统一 Model Gateway。
- 成本异常告警。
- 优化策略 release gate。
- 安全、准确性、成本联合看板。

企业级优化不是业务 Agent 自己写 if-else，而是平台能力。

## 不适用场景

不适合为了省钱降低安全边界。权限、审批、审计、跨租户隔离不能被降级。

不适合把所有任务都路由到最便宜模型。高风险推理、复杂规划和最终责任判断需要质量底线。

不适合缓存写操作结果。写操作应靠幂等保证不重复执行，而不是靠缓存绕过执行链路。

不适合缓存包含敏感原文、凭证、审批 token 或跨租户数据的结果。

不适合在没有 eval 的情况下做上下文裁剪。裁剪可能删掉关键证据。

不适合用“平均延迟下降”掩盖长尾问题。Agent 体验常常被最慢工具和最差路径决定。

## 常见坑与反模式

1. 只优化 token，不看准确率。

   token 降了，但 ready 判断错了，优化就是失败。

2. 为了速度跳过工具。

   如果工具是事实来源，跳过工具就是让模型猜。

3. 缓存 key 只用 query。

   缺少 tenant、scope、policy 和数据版本会导致越权或过期结果。

4. 小模型承担高风险决策。

   小模型可以分类和总结，但不能替代策略系统和审批系统。

5. 并发越大越好。

   没有背压会放大限流、重试和成本。

6. 重试没有幂等键。

   写操作可能重复执行。

7. 缓存命中不写 trace。

   事后无法解释答案来自哪里。

8. eval 任务和线上流量抢资源。

   高峰期会拖慢用户请求。

9. 成本只按 provider 统计。

   看不到哪个 Agent、租户、工具或 prompt 版本造成成本上升。

10. 降级时不告诉用户。

   用户会把不完整结果当成完整判断。

## 安全、成本与性能考虑

### 安全

性能与成本优化必须继承第 21 章的边界：

- 缓存不能绕过权限。
- 降级不能绕过审批。
- 模型路由不能决定授权。
- 低价模型不能处理高风险权限裁决。
- 缓存结果必须保留来源、版本和权限 metadata。
- 成本压力不能把 unknown 改成 passed。

### 成本

成本优化手段：

- 模型路由。
- 稳定 prompt prefix。
- 上下文引用化。
- RAG 和工具结果缓存。
- embedding 增量更新。
- 只读工具并行。
- 离线 batch。
- eval 分层运行。
- 成本归集和异常告警。

成本优化要看全链路。如果省了模型成本，却增加人工排查、错误工单和事故风险，就不是有效优化。

### 性能

性能优化手段：

- 流式输出。
- 后台任务。
- 只读工具并行。
- 慢工具 timeout 后标 unknown。
- 队列和背压。
- 缓存和预热。
- 降低上下文体积。
- 分离在线和离线 workload。

性能优化要关注 p95 / p99 这类长尾体验，但具体目标值应由业务 SLA 和压测决定，本章不提供通用数字。

## 如何评估效果

评估优化要看四组指标：

| 指标 | 问题 |
| --- | --- |
| Quality | 答案准确性、证据完整性、unknown 处理是否变差 |
| Safety | 权限、审批、跨租户、安全 eval 是否仍通过 |
| Latency | 首 token、最终答案、工具调用、长尾是否改善 |
| Cost | 每 run、每 tenant、每 tool、每 model profile 成本是否下降 |

优化评估样本：

```json
{
  "case_id": "perf_cost_release_readiness_001",
  "input": "判断 kb-assistant 是否可以上线",
  "optimization_under_test": "parallel_read_tools_and_context_refs",
  "expected_quality": [
    "must_check_release_checks",
    "must_check_security_review",
    "must_check_eval_failures",
    "must_mark_unknown_when_permission_denied"
  ],
  "expected_safety": [
    "do_not_skip_policy_check",
    "do_not_skip_approval_for_write_tool",
    "do_not_use_cross_tenant_cache"
  ],
  "expected_performance_observation": [
    "read_tools_can_run_in_parallel",
    "cache_hit_recorded_when_used",
    "stale_cache_marked_when_used"
  ],
  "expected_cost_observation": [
    "cost_attributed_to_tenant_agent_run_step",
    "model_profile_recorded",
    "cached_tokens_or_cache_hit_recorded_if_provider_reports_it"
  ]
}
```

Release Gate 示例：

```json
{
  "optimization_release_gate": {
    "change": "use_rag_cache_v2",
    "baseline": {
      "baseline_window": "release_gate_configured_window",
      "min_sample_size": "release_gate_configured_min_samples",
      "required_segments": [
        "normal_read",
        "permission_denied",
        "stale_data",
        "cross_tenant_denied"
      ]
    },
    "must_pass": [
      "core_quality_eval",
      "security_eval",
      "cross_tenant_cache_eval",
      "freshness_eval"
    ],
    "must_not_regress": [
      "unknown_handling",
      "evidence_refs",
      "policy_denied_traceability"
    ],
    "metrics": {
      "latency": ["p50", "p95", "p99"],
      "cost": ["cost_per_run", "cost_per_successful_run"],
      "quality": ["core_eval_pass_rate", "required_evidence_recall"],
      "safety": ["policy_violation_count", "cross_tenant_cache_hit_count"],
      "error_budget": "release_gate_configured_error_budget"
    },
    "canary": {
      "traffic_scope": "low_risk_read_only_runs",
      "duration": "release_gate_configured_duration",
      "rollback_on": [
        "quality_regression",
        "security_policy_violation",
        "cost_spike",
        "latency_tail_regression"
      ]
    }
  }
}
```

不要只比较优化前后的平均耗时。要证明：

- 输出仍然正确。
- 安全仍然通过。
- 证据仍然完整。
- 成本真的可归因。
- 长尾没有恶化。
- 失败能回滚。

## 实践任务

1. 入门：拆解成本来源。

交付物：列出 kb-assistant 一次上线判断中的模型、RAG、工具、Runtime、trace、eval 成本。

自查标准：不能只写 token；至少覆盖 5 类成本。

2. 初级：设计模型路由。

交付物：为意图分类、上线判断、最终回答、写操作草稿设计 model profile。

自查标准：高风险权限裁决不能交给模型，写操作必须保留审批。

3. 中级：设计缓存策略。

交付物：分别设计 RAG cache、tool result cache、prompt cache 的 key、metadata 和失效策略。

自查标准：cache key 必须包含 tenant / scope / version / policy 相关字段；不能缓存凭证和审批 token。

4. 高级：设计并发和降级。

交付物：画出只读工具并行、写工具审批、慢工具 timeout、预算压力降级的流程。

自查标准：降级不能把 unknown 改成 passed，不能跳过权限和审批。

5. 生产化：设计优化 release gate。

交付物：为“RAG cache v2 上线”设计 eval、canary、成本归集和回滚条件。

自查标准：必须同时覆盖 quality、safety、latency、cost，不能只看平均延迟。

参考答案要点：

- 性能优化要先定义质量和安全底线。
- 模型路由要绑定 task type、risk level、budget 和 eval suite。
- 缓存必须带 tenant、scope、data version、policy version。
- 写操作靠幂等和审批，不靠缓存。
- 并发必须有背压和限流。
- 降级必须显式标注能力减少和数据新鲜度。
- 成本要按 tenant、agent、run、step、tool、model_profile 归集。
- 优化上线必须跑质量、安全、性能和成本评估。

## 从入门到专业

- 入门：知道 Agent 成本不只是 token，性能不只是延迟。
- 初级：能做简单模型路由、上下文裁剪和缓存。
- 中级：能设计租户隔离缓存、工具并发、限流和降级。
- 高级：能把成本归集、eval、canary 和回滚接入发布流程。
- 专业：能建设统一 Model Gateway、Cache Gateway、Budget Manager 和 Optimization Release Gate。

完成任务 1 和 2，能看懂成本和模型选择；完成任务 3 和 4，能做工程优化；完成任务 5，才具备把优化策略安全上线的能力。

专业工程师不会只问“怎么省 token”。他会问：“这个优化会不会改变证据？会不会绕过权限？缓存是否隔离？成本能否归因？质量是否回归？失败能否回滚？”

## 本章小结

性能与成本优化不是给 Agent 做“瘦身”，而是在正确性、安全、体验和预算之间建立可验证的取舍机制。

本章建立了几个核心结论：

- 先定义质量和安全底线，再做优化。
- Agent 要按 step 优化，而不是只看最终回答。
- 模型路由要绑定任务、风险、预算和评估。
- 缓存必须携带租户、权限、版本和安全 metadata。
- 并发必须有背压，重试必须有幂等。
- 降级不能绕过权限、审批和审计。
- 成本归集要进入 trace。
- 优化上线必须通过质量、安全、性能和成本评估。

下一章会进入实战项目：知识库问答 Agent。前面章节讲过的 RAG、工具、权限、可观测性、安全和优化，会在项目中合成一个可以运行、可以评估、可以继续扩展的系统。

## Sources

以下来源按 2026-05-30 访问时理解；模型供应商的缓存、batch、限流、价格和 usage 字段会变化，本章不写死具体价格或通用性能数字。

- [OpenAI API: Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)
- [OpenAI API: Batch API](https://developers.openai.com/api/docs/guides/batch)
- [OpenAI API: Rate limits](https://developers.openai.com/api/docs/guides/rate-limits#usage-tiers)
- [OpenAI API: Latency optimization](https://developers.openai.com/api/docs/guides/latency-optimization)
- [OpenAI API: Cost optimization](https://developers.openai.com/api/docs/guides/cost-optimization)
- [OpenTelemetry: GenAI semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/)

## 写作审查记录

### 章节架构师

- 本章目标：解释 Agent 性能与成本优化的对象、边界和工程落地方式。
- 知识点地图：模型路由、上下文优化、Prompt Cache、RAG Cache、Tool Result Cache、并发、限流、背压、降级、Batch、成本归集和优化 release gate。
- 前后章节关系：承接第 21 章安全边界，进入第 23 章知识库问答 Agent 项目前的工程收束。

### 技术审稿人

- 发现问题：性能和成本容易写成固定价格、固定延迟或供应商特定能力；Response Cache、Policy Cache 和 stale cache 如果边界不清，容易造成过期证据、权限错配或最终结论误复用。
- 修订动作：引用 OpenAI prompt caching、Batch API、rate limits、latency optimization、cost optimization 文档和 OpenTelemetry GenAI conventions；明确不同供应商能力差异，不写无来源精确价格和性能数字；补充 Response Cache、Policy Cache、stale cache 和 fallback 的风险约束。
- 结论：章节把缓存、batch 和 cost optimization 作为可选平台能力处理，没有写成通用事实。

### 工程审稿人

- 发现问题：优化如果只讲 token，会忽略权限、缓存隔离、写操作幂等、并发背压和回滚；backpressure 与 release gate 如果缺少机器可判定字段，生产系统难以执行。
- 修订动作：补充 Model Profile、Model Router、Context Optimizer、Cache Gateway、RAG Cache、Tool Scheduler、Rate Limit / Backpressure、Degradation Controller、Cost Attribution 和 Release Gate；增加 RAG cache key 的 query rewrite、chunk、threshold、snapshot、TTL 字段；补充队列优先级、超时状态、用户通知、circuit breaker、canary duration、baseline window、min sample size、p95/p99 和 error budget。
- 结论：章节能映射到真实 Agent 后端系统，覆盖输入、上下文、工具、缓存、并发、预算、成本和发布治理。

### 学习体验审稿人

- 发现问题：读者容易把优化理解为“换便宜模型”或“少放上下文”。
- 修订动作：沿用 kb-assistant 上线判断案例，说明哪些步骤能缓存、并行和降级，哪些步骤不能被优化绕过。
- 结论：章节能帮助读者从 token 优化转向系统级优化。

### 主编

- 最终调整：本章统一主线为“不破坏安全边界的性能与成本优化”。
- 与全书衔接：第 21 章讲安全边界，本章讲边界内优化，第 23 章进入知识库问答 Agent 实战。
- 后续章节提醒：第 23 章应把本章的模型路由、RAG cache、成本归集和降级策略落到一个可运行项目里。
