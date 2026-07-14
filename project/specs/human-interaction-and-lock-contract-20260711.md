# TCIS v3 人机交互与锁定合同

状态：active  
日期：2026-07-11

## 1. 目标

TCIS 的人机分工不是“AI 做建议，人类做全部修补”，也不是“AI 猜完意图后只让人最终批准”。正确分工是：

- AI 完成研究、整理、发散、写作、比较、修订、验证、状态和交接；
- 人类在改变意义、目标、品位、品牌、风险、预算、制作路径或发布后果的正式产物上持续做选择和建议；
- AI 根据人类反馈完成下一版，再由人锁定或重开；
- 非决策性的 hash、source manifest、日志和机器验证不制造人工盖章表演。

## 2. 必须进入交互循环的产物

以下均是 `decision-bearing artifacts`：

1. Project Charter / Client Brief；
2. 主诊断；
3. Communications Strategy；
4. Creative Brief；
5. Creative Routes；
6. Core Creative Concept；
7. 条件性的 Campaign/Creative Platform；
8. TVC synopsis / film expression；
9. Script / Agency Board；
10. Agency Visual Direction / Previz；
11. Director shortlist 与 pitch 方式；
12. Director treatment / award；
13. PPM 关键执行项；
14. 实际拍摄/生成 selects；
15. Offline lock；
16. Final masters / release。

以下通常自动生成并由系统验证，不需要逐项人工批准：

- 文件 hash；
- source manifest 的机械字段；
- event log；
- dependency graph；
- schema validation；
- attempt metadata；
- technical checksum；
- 已锁决策的镜像索引。

但一旦技术记录暴露出需人承担后果的分歧，例如来源可信度不足、权利不明、生成身份偏移、成本变化或 master 技术妥协，TCIS 必须把该分歧升级为 Decision Packet。

## 3. 统一循环

```text
DISCOVER
  AI 回收状态、资料和反馈，独立研究与发散

INTERNAL_REVIEW
  专业 owner + 必要 challenger 淘汰不成立方案

PROPOSE
  主线程提交紧凑 Decision Packet 和明确推荐

HUMAN_INPUT
  用户选择、建议、全部否定、请求新方向或重开上游

REVISE
  AI 完成修订、影响分析和必要再验证

CONFIRM
  主线程展示最终候选及与上一版差异

LOCK / REVISE / REOPEN / STOP
  用户或相应 named approver 明确裁决
```

用户第一次选择不自动等于锁定。只有修订结果已经展示，且用户明确确认，产物才进入 `LOCKED`。

## 4. Decision Packet 最小 schema

```yaml
packet_id: DP-<stage>-<sequence>
artifact_id: <stable-id>
artifact_version: <semver-or-revision>
stage: <P0-P14>
decision_owner: <named-human-role>
reviewers:
  - <role>
decision_question: <one primary question>
brief_trace:
  - <locked upstream item>
options:
  - id: A
    proposition: <what this option means>
    proof_or_preview: <visible evidence>
    strengths: []
    risks: []
    downstream_effects: []
recommendation:
  option_id: <A|B|C|none>
  rationale: <professional judgment>
known_facts: []
assumptions: []
unknowns: []
hard_blocks: []
allowed_responses:
  - SELECT
  - ADVISE
  - NONE
  - REVISE
  - REOPEN
  - STOP
```

Packet 对用户展示时不必输出 YAML，但必须保留等价信息。

## 5. 呈现规则

### 5.1 一次只问一个主要问题

同一条消息可以展示必要上下文，但不得把 strategy、concept、visual、director 和 budget 五个不同决策压成一张总表要求用户一次完成。

### 5.2 只展示成熟选择

- 默认 2-3 个，只有真实需要时到 4 个；
- 每个选项都必须是团队愿意继续完成的方案；
- 不放 sacrificial route；
- 不把原始候选池、agent 数量或搜索日志当价值证明；
- 一条真正明显领先的方案允许只推荐该方案，但仍给用户 `none/reopen`。

### 5.3 必须给推荐

TCIS 不能把选择劳动原样转给用户。主线程必须说明推荐哪一项、为什么、牺牲什么、哪个未知仍可能推翻它。

### 5.4 预览必须匹配决策

| 决策 | 应展示 | 不足以展示 |
|---|---|---|
| Strategy | 目标链、受众、障碍、品牌角色、proof、取舍 | 空洞战略口号 |
| Creative Route | premise、human tension、product role、film engine、rough key actions | 只有 moodboard |
| Synopsis | 开场、变化、结尾、时长、情感、品牌意义 | 主题和视觉形容词 |
| Script | 可朗读 exact copy、动作、声音、supers、claim trace | 只有大纲 |
| Visual Direction | 实际 keyframes/references 及每张用途、硬/软约束 | 大量无解释参考图 |
| Generated Asset | 实际图像/视频、连续性和缺陷观察 | prompt 或“工具成功” |
| Offline | 可播放 cut、timing、copy、claim、品牌/产品表现 | edit description |

## 6. 用户输入语义

用户可以自然语言交流，不需要记命令。主线程将输入映射为：

| 用户意图 | 系统动作 |
|---|---|
| “选 A，但人物不要那么精英” | 记录 `SELECT A + ADVICE`，AI 修订后等待确认 |
| “A 和 B 各有一半我喜欢” | 先判断是否能在同一因果机制下合并；若冲突，提交 conflict packet，不自动折中 |
| “都不对” | `NONE`，保留淘汰理由，返回当前阶段重新探索 |
| “问题本身不对” | `REOPEN`，做影响分析并回到相应上游 |
| “先往下做看看” | 只能建立明确的 `PROVISIONAL` 探索分支，不得把当前产物记为 LOCKED |
| “就这样” | 主线程复述要锁的版本和关键含义；用户确认后才 LOCK |
| “停止” | 停止当前 loop，保留可恢复状态 |

## 7. 反馈处理

### 7.1 不自动平均冲突意见

当多人反馈冲突，主线程输出：

- 冲突的原始要求；
- 各自决策身份；
- 哪些可以兼容，哪些会破坏同一概念；
- TCIS 推荐的裁决；
- 需要哪位 named decision owner 做选择。

### 7.2 区分方向反馈与逐字代工

用户可以给非常具体的修改意见，TCIS 应执行。但当反馈会破坏已锁 strategy、concept、claim 或制作范围时，主线程必须指出影响并要求 `REOPEN` 或明确接受后果，不能静默拼接。

### 7.3 保留被拒理由

拒绝记录不是为了阻止未来变化，而是避免同一失败在下一轮换皮回来。每条 rejected route 记录：

- 被拒的核心机制；
- 理由；
- 哪种上游变化会允许复活；
- 不得只记录色彩、人物或场景表面。

## 8. Lock 合同

```yaml
lock_id: LOCK-<artifact-id>-<version>
artifact_hash: <sha256>
decision_owner: <named-human-or-authorised-role>
professional_signoffs:
  strategy: <pass|n/a|pending>
  creative: <pass|n/a|pending>
  claims_legal: <cleared|not-cleared|n/a>
  production: <feasible|not-assessed|blocked>
human_decision: <selected meaning and advice>
rejected_options: []
decision_basis: []
residual_risks: []
locked_at: <timestamp>
reopen_conditions: []
downstream_dependencies: []
```

这些 signoff 不得互相推导。`client_approved=true` 不能自动产生 `claims_legal=cleared` 或 `production=feasible`。

## 9. Reopen 规则

允许重开的根因：

- 商业目标、KPI 或优先级变化；
- 受众、市场或渠道任务变化；
- 新证据推翻主诊断；
- 产品事实、proof、claim 或品牌定位变化；
- 预算/时间使原方案不可执行；
- 新法律、权利、安全或声誉风险；
- 下游连续失败构成上游假设错误的证据；
- 用户明确改变意图。

重开步骤：

1. 指定被重开的 artifact；
2. 说明触发证据；
3. 计算受影响下游，不默认全清；
4. 将受影响项标记 `STALE`，而非删除；
5. 保留仍有效的证据、素材和批准；
6. 重走相关 Decision Packet；
7. 锁定新版本并记录替代关系。

普通脚本文字调整不得自动重开整个 strategy。反之，改变 product role、核心承诺或故事因果不能伪装成“copy edit”。

## 10. Stop 与硬阻塞

只有缺少不可替代的外部条件才进入 `STOP`：

- 客户未提供只有其掌握的产品/商业事实；
- 客户或法律负责人无法批准 claim；
- 人才、音乐、肖像、素材或场地权利无法取得；
- 真实预算、供应商报价、booking、保险或拍摄许可未获得；
- 当前 Codex 没有完成必要视频生成/发布的能力；
- 用户没有决定具有不可逆商业后果的选项。

工具失败、agent 失败、第一轮想法不强、需要更多研究或需要修订都不是硬阻塞。

## 11. Codex 对话示例

### 11.1 Creative Route Packet

```text
当前要决定：这支片用哪一种核心说服机制。

A 真实证明：让产品在一个高压使用情境中直接改变结果。
B 身份反转：让受众先误判人物，再由产品揭示真实选择。
C 大众娱乐：用一个可复述的表演规则建立品牌名声。

推荐 B。它最能同时保留产品因果、人物情感和品牌独占性；
风险是 casting 与结尾必须避免把受众标签化。

你可以：选 A/B/C；给方向建议；说“都不对”；或要求重开 brief。
```

### 11.2 Revised Confirmation

```text
已按你的建议把 B 从“精英身份反转”改为“普通人被低估”。
核心机制不变；改变的是人物社会信号、场景和结尾语气。
产品仍然是揭示真实能力的原因，不是片尾贴标。

请确认：LOCK B-v3，还是继续修订/重开？
```

## 12. 验收 fixtures

| ID | 输入 | 必须结果 |
|---|---|---|
| HI-01 | AI 未经用户反馈直接锁 Creative Brief | 阻断 |
| HI-02 | 用户第一次选 A | 进入 REVISE/CONFIRM，不直接 LOCK |
| HI-03 | 用户说所有路线都不对 | 返回当前阶段重新探索，不强迫选择 |
| HI-04 | 两名 stakeholder 冲突 | conflict packet + named owner，不平均 |
| HI-05 | 用户沉默 | 保持 PROPOSED，不推进 |
| HI-06 | 用户说“先做图看看” | 建 provisional branch，产物仍未锁 |
| HI-07 | 技术 hash 更新 | 自动验证，不请求审美批准 |
| HI-08 | 实际生成图与 prompt 不符 | 资产失败，不记录为 approved |
| HI-09 | 客户批准 script 但 claim 无 proof | claims_legal 仍 blocked |
| HI-10 | 修改一句 VO 改变核心承诺 | 识别为上游影响，不当 copy edit |
| HI-11 | 普通语气微调 | 本阶段 revise，不重开 strategy |
| HI-12 | 用户改变目标受众 | REOPEN strategy 及受影响后代 |

通过标准：所有 decision-bearing artifacts 都有命名决策者、可见候选/推荐、用户输入、AI 修订、最终确认和局部重开能力；非决策技术产物不产生 approval theater。
