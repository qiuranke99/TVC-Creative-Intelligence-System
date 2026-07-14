# TCIS v3 广告方法与 Agent 能力架构

状态：active  
日期：2026-07-11

## 1. 基本裁决

TCIS 不把 4A 口号、广告书摘要、创意装置清单或搜索算法拼成一条万能流程。方法必须以“当前创作问题”为入口，并且说明不用它的条件。

方法库分五类：

1. `Research/Immersion`：找到真实材料和正确问题；
2. `Strategy/Brief`：形成传播选择和可燃 brief；
3. `Creative Development`：由文案/美术搭档产生、孵化和发展 idea；
4. `Creative Judgment`：由 CD、Strategy、Client 和 Claims 各自判断；
5. `Production Craft`：把已批准创意转成可执行影片。

质量多样性、候选去重、lineage、状态、schema 和 validator 属于后台治理，不属于以上任一创意方法。

## 2. 方法卡统一合同

```yaml
method_id: <stable-id>
name: <human-readable-name>
method_type: <research|strategy|creative|judgment|production>
source_class: <published-method|agency-framework|practice-principle|tcis-inference>
problem_solved: <one professional problem>
use_when: []
do_not_use_when: []
required_inputs: []
human_actions: []
ai_support: []
visible_output: <artifact>
failure_modes: []
counterexample: <when it produces a worse answer>
evidence_sources: []
owner_capabilities: []
```

`source_class` 不能省略。Ogilvy Big ideaL 与 TBWA Disruption 可以标为公开方法；DDB Emotional Advantage 是定位/过滤器；BBDO The Work 是质量哲学；奖项案例是案例证据，不能伪装成通用方法。

## 3. 核心方法卡目录

### M-R01 Firsthand Immersion

- 解决：只有二手摘要、对人的理解扁平；
- 用于：产品、受众和文化理解不足；
- 不用于：已有可靠 firsthand research 且任务只是窄执行；
- 动作：实际使用产品、观察情境、收集原话、感官细节、摩擦、仪式、规避行为；
- 产物：field observations 与待验证张力；
- 误用：把网页摘录标成 firsthand evidence。

### M-R02 Truth Triangulation

- 解决：把有趣观察直接叫 insight；
- 动作：并列观测行为、产品/品牌 proof、文化/品类条件和竞争解释；
- 产物：事实、解释、反证和未知分层；
- 误用：用一句“人们都想……”的心理学句式替代证据。

### M-R03 Convention Wall

- 解决：同质化和无意识复制品类广告；
- 动作：列产品承诺、角色、叙事、视觉、声音、媒体和 endline 惯例；指出哪个惯例真正妨碍增长；
- 产物：可挑战/应保留的 convention map；
- 误用：为了不同而反常识，或破坏有价值的 distinctive asset。

### M-S01 Problem Reframing

- 解决：把销量症状、客户假设或媒介需求当传播问题；
- 动作：区分 business、marketing、behaviour、communications 与 execution problem；
- 产物：传播可改变的单一问题和不能由广告解决的边界；
- 误用：无休止“为什么”而拒绝行动。

### M-S02 Objective Chain

- 解决：目标混杂；
- 动作：business outcome -> desired behaviour -> perception/feeling -> communications task -> observable KPI；
- 产物：有因果假设和 falsifier 的目标链；
- 误用：把传播结果直接等同销售因果。

### M-S03 Audience-in-Situation

- 解决：只用人口标签；
- 动作：定义谁在何时、何地、因何触发、以什么替代方案行动、有什么障碍和语言；
- 产物：可创作的具体情境；
- 误用：制造虚构 persona 装饰 brief。

### M-S04 Sharp Creative Brief

- 解决：brief 字段齐全但没有创作张力；
- 动作：明确要改变什么、谁、当前反应、期望反应、品牌 proof、必须项和完全开放项；让 CD 挑战、creative pair 复述；
- 产物：一页 brief + evidence appendix；
- 误用：预写创意答案、塞满 claims、让客户逐字写 agency 内部语言。

### M-C01 James Webb Young Cycle

- 解决：第一反应和品牌资料内循环；
- 动作：收集 specific/general material -> 咀嚼关系 -> 离开 -> 接受浮现 -> 现实塑形；
- 产物：新关系和可发展的 premise；
- 误用：把孵化做成固定分钟数或流水线。

### M-C02 Pair Ping-Pong

- 解决：文字和画面串行、多人会议锚定；
- 动作：Copywriter/Agency AD 可先各自思考，再用未完成的语言、画面、行为、节奏互相改写；
- 产物：共同拥有的 rough concepts；
- 误用：把文案降为 slogan 供应商，把 AD 降为 moodboard 供应商。

### M-C03 Product Inherent Drama / Demonstration

- 解决：产品只在片尾露出；
- 动作：找产品构造、使用、结果、限制、感官或真实 proof 中已有的戏剧；把 proof 变成行为或可见事件；
- 产物：product-caused film engine；
- 误用：所有品类都做理性 demo，或制造未经证明的效果。

### M-C04 Tension and Story

- 解决：策略正确但没人愿意看；
- 动作：定义人物想要什么、受到什么阻碍、付出什么情感代价，品牌如何改变局面；先确定结尾，再展开场景；
- 产物：premise、turn、ending；
- 误用：把 tension 等同争吵、灾难或强行反转。

### M-C05 Dramatisation Devices

可选择的装置包括：exaggeration、reversal、juxtaposition、metaphor、analogy、transformation、personification、ritual、testimonial、problem-solution、slice of life、character、humour、spectacle、music/performance、participation、media-as-idea。

这不是覆盖清单。只有装置能放大已锁 problem、human meaning 和 brand/product role 时才使用。每条 route 必须先说明因果机制，不能只报装置名称。

### M-C06 Feldwick Effect Hypothesis

- 解决：所有广告都被还原为“传达一条信息”；
- 动作：选择主要作用假设：sales argument、emotional seduction、salience/fame、social relationship、mental reframing、entertainment/performance；
- 产物：本片为何可能起效的明确假设；
- 误用：强制生成六条路线或把模型当效果证明。

### M-C07 Rough Route Wall

- 解决：精美制作掩盖弱 idea；
- 每条只允许：一句核心 idea、human tension、product role、三个关键动作/画面、情绪前后、结尾、为什么只能是该品牌；
- 产物：低保真 route；
- 误用：把 rough 当低质量成片或过早讨论镜头参数。

### M-C08 Incubation Pass

- 解决：会议压力和连续生成造成表面发散；
- 动作：让 surviving routes 至少离开工作台一次，回来后检验记忆、简化、品牌归属和新偏航；
- 产物：保留、重写或淘汰判断；
- 误用：没有任何前期劳动地等待灵感。

### M-C09 Film Engine Test

- 解决：路线只有主题/风格，不是影片；
- 动作：回答第一状态、变化事件、产品因果、观众情绪变化、结尾余味、15/30/60 秒成立方式；
- 产物：synopsis/rough script；
- 误用：过早锁死导演的镜头和表演解释。

### M-J01 CD Cut

- 解决：多人平均分和妥协路线；
- 动作：CD 每轮给出 idea 诊断、杀/留/发展、简化方向和品牌/产品问题；
- 产物：明确去留与下一轮 brief；
- 误用：CD 只给个人偏好，或把所有建议拼成一条路线。

### M-J02 On-Brief Strategy Challenge

- 解决：idea 很吸引但解决错问题；
- 动作：Strategy 检查 route 对 audience、desired change、brand role、proof 和 sacrifice 的追溯；
- 产物：on-brief / off-brief / productive deviation；
- 误用：Planner 变成创意警察或规定执行。

### M-J03 Brand Replaceability

- 解决：通用品类创意；
- 动作：替换竞争品牌，检查因果、资产、语气和结尾是否仍完整；
- 产物：brand linkage diagnosis；
- 误用：强迫所有广告都高频露出 logo。

### M-J04 Claim / Net Impression Challenge

- 解决：只检查 exact copy，忽略画面和整体暗示；
- 动作：提取 express/implied objective claims，映射 proof、限定和消费者合理理解；
- 产物：claim matrix 与 blocked items；
- 误用：AI 自称 legal clearance。

### M-J05 Client Emotional Sell

- 解决：只用理性表格“交作业”，客户无法相信路线；
- 动作：理解客户风险和决策语言，呈现 2-3 条成熟路线和明确推荐，展示体验而非搜索日志；
- 产物：Decision Packet；
- 误用：操纵客户情绪或隐瞒风险。

### M-P01 Director Interpretation

- 解决：agency concept 如何成为导演愿景；
- 动作：treatment 发展表演、casting、世界、镜头、声音、节奏、方法与执行 alternative；
- 产物：director treatment + departures；
- 误用：未经批准重写品牌策略或盗用未获选 treatment。

### M-P02 PPM Confirmation

- 解决：高成本执行前的共同确认；
- 动作：逐项确认 final script、shooting board、cast、location、art、wardrobe、tech、schedule、rights、safety、post 和 contingency；
- 产物：PPM book + minutes + owners；
- 误用：在 PPM 重新脑暴核心 concept。

### M-P03 Actual Media Selection

- 解决：工具成功或 prompt 漂亮却素材失败；
- 动作：检查 actual pixels/frames/audio、identity、product、copy、continuity、artifact、rights 和 brief fit；
- 产物：selected attempt 与 rejection evidence；
- 误用：以文件存在或 API success 作为资产 PASS。

## 4. 代理公司框架的边界

| Framework | 分类 | 可以做 | 不可以做 |
|---|---|---|---|
| Ogilvy Big ideaL | Published method | 长期品牌最佳自我与文化张力、平台方向 | 不能自动产出 TVC script 或媒介计划 |
| TBWA Disruption | Published method | challenge convention、define vision、create leap | 不适合每个功能证明或已有强平台的新片 |
| McCann Truth | Research/brand philosophy | 组织 mixed-method immersion 与 truth hypothesis | `tell it well` 不是公开创意步骤 |
| DDB Emotional Advantage | Current positioning/filter | 检查具体情感变化与文化连接 | 情感强不等于 product/brand causality |
| Leo HumanKind | Philosophy/evaluation | 行为、参与、文化作用型创意 critique | 不能强迫普通 product TVC 变社会行动 |
| BBH Zag | Practice principle | strategy sacrifice、focused brief、anti-consensus CD direction | 不同不等于正确 |
| BBDO The Work | Quality philosophy | 保持作品质量中心 | 不是可重建的 BBDO Works 全流程 |
| W+K Fail Harder | Culture principle | 保护可逆失败、好奇和冒险 | 不能替代标准、客户信任和商业责任 |

## 5. Agent 能力包合同

```yaml
capability_id: <stable-id>
display_role: <real professional role>
purpose: <one sentence>
stage_entry: []
stage_exit: []
owns: []
may_advise: []
must_not_decide: []
required_context: []
knowledge_modules: []
method_cards: []
tools: []
skills: []
input_schema: <ref>
output_schema: <ref>
handoff_to: []
authority: <owner|advisor|challenger|operator>
failure_modes: []
counterexamples: []
fixtures: []
ablation_claim: <unique value lost if removed>
```

每个 agent 的运行 prompt 只能是这一能力包的薄入口。知识、方法、schemas 和 fixtures 必须是可独立维护的模块，不能全部复制进角色设定。

## 6. v3 Capability portfolio

### 6.1 必须实现的核心能力

| ID | 关键知识 | 主要方法 | 工具 | 独特验收 |
|---|---|---|---|---|
| `creative_lead` | 项目合同、状态、角色边界 | unresolved-problem routing、conflict synthesis、decision loop | files、agents、tools、validators | 不越权创作/批准；可从文件恢复并形成一个正确 next move |
| `account_project_lead` | client/agency 流程、范围、批准 | brief alignment、decision ownership、change control | state、timeline、budget ledger | 不把邮件/沉默当批准；能隔离冲突反馈 |
| `strategy_planning_lead` | planning、research、effectiveness、brief | M-R/M-S/M-J02 | browser、data/source tools | 能区分观察、insight、strategy 和 idea；不预写执行 |
| `research_insight_lead` | research design、sources、culture/category | immersion、triangulation、counter-evidence | browser、files、data tools | 不把二手摘要冒充 firsthand；来源与推断分离 |
| `brand_strategist` | positioning、architecture、distinctive assets | brand confession、replaceability、platform applicability | brand files、reference search | 不把 purpose 口号当 idea；识别已有平台 |
| `creative_director` | advertising ideas、creative review、presentation | CD Cut、film engine、client sell | review tools、image inspection | 不用平均分；给明确诊断和推荐 |
| `copywriter` | concepts、script、dialogue、VO、tone | pair creation、tension/story、copy craft | text/timing/read-aloud checks | 文字和画面互补；exact copy 可追溯 |
| `agency_art_director` | advertising concept、visual communication、boards、brand assets | pair creation、rough routes、show/say | image search/gen、boards | 与 copy 共同拥有 idea；不冒充 production designer |
| `agency_producer` | production pitch、budget、schedule、usage、approval | feasibility shadow、pitch/award、change control | estimates、vendor/rights ledgers | script-ready 才 pitch；不拥有 idea |
| `claims_rights_challenger` | advertising claims、rights、AI/synthetic risk | net-impression、rights trace | source/evidence validators | 发现 express/implied claim；不伪造 legal approval |
| `commercial_director` | commercials、performance、film form、treatment | director interpretation、shooting development | treatment/previz tools | award 前后权责正确；不越过 agency/client |
| `production_company_producer` | bid、crew、safety、insurance、delivery | production planning、PPM、change orders | schedule/budget/contracts | 与 agency producer 分离 |
| `director_of_photography` | camera、lighting、lenses、movement、exposure | visual tests、coverage feasibility | camera/previs/test tools | craft authority 完整但不改 proposition |
| `production_designer` | set/world/props/material/colour/art dept | design breakdown、build feasibility | reference/board/budget tools | award 后进入；与 agency AD 分离 |
| `editor` | structure、rhythm、coverage、picture lock | animatic/offline/edit diagnosis | timeline/media tools | 与 post supervisor/QC 分离 |
| `post_producer` | post workflow、vendors、versions、delivery | post plan、approval ladder、QC orchestration | timeline/QC/manifest | 不自剪自批 |
| `ai_generation_supervisor` | model limits、references、continuity、identity/rights | prompt compilation、attempt binding、actual inspection | native imagegen/media tools | prompt 不改 concept；actual media 才可选 |

### 6.2 条件能力

- `media_asset_strategist`：多平台、多资产、cutdown/channel job 时启用；
- `visual_development_lead`：concept 后，animation/world/AI 视觉体系复杂时启用；
- `animation_director`、`vfx_supervisor`、`motion_designer`、`sound_designer`、`music_supervisor`：按 production mode；
- `casting_lead`、`location_scout`、`wardrobe_hmu`：由 director/prodco 在 preproduction 调用；
- `reference_research_service`：为指定 owner 提供证据，不是投票角色；
- `qa_red_team`：在 G2/G4/G6/G8/G9/G10 做独立 challenge；
- `memory_librarian`：项目完成后、明确授权时才运行。

## 7. 旧角色迁移

| 旧 ID | v3 处理 | 原因 |
|---|---|---|
| `studio_pm` | 迁为 `account_project_lead` 或保留内部 alias | 用真实客户/项目责任定义 |
| `studio_synthesizer` | 删除独立角色，能力并入 `creative_lead` | 无独特专业 owner |
| `brand_strategist` | 重建 | 保留真实上游角色 |
| `creative_director` | 重建 | 保留 agency idea owner |
| `senior_copywriter` | 重建为 `copywriter` | 保留 idea/script owner |
| `art_director` | 不直接迁移；拆为 agency AD 与 production designer | 旧定义混合两种职业 |
| `advertising_director` + `film_director` | 合并 `commercial_director` | 避免双导演权 |
| `visual_director` | 条件迁为 visual development 或并入 agency AD | 避免与 CD/AD/director/PD/DP 重叠 |
| `video_strategy_director` | 条件迁为 media/asset strategist | 单支 TVC 不常驻 |
| `advertising_producer` | 拆 agency producer / prodco producer | 两方权责不同 |
| `editor_post_supervisor` | 拆 editor / post producer | craft 与流程/QC 不应自批 |
| `prompt_handoff_specialist` | 迁 `ai_generation_supervisor`，后置 | 只编译已锁意图 |
| `reference_scout` | 迁 research service | 无创意投票权 |
| `location_scout` | 保留条件服务，后置 | preproduction 才正式进入 |
| `qa_red_team` | 保留门级机制 | 独立反证有价值 |
| `memory_librarian` | 保留但移出主生产链 | 不干扰创作 |

兼容 alias 只能用于迁移，不得继续决定显示角色、owner 或路由时序。

## 8. Tool 与 Skill 配置原则

### Tools

- Strategy/Research：browser、source capture、document/data parsing；
- Creative：image search、native imagegen、rough boards、timing/read-aloud；
- Production：breakdown、schedule、budget、rights、shot/continuity、media inspection；
- Post：timeline、subtitle/copy comparison、technical QC、version manifest；
- Reliability：state、hash、dependency、event log、recovery。

工具的返回值只证明操作发生，不证明职业判断正确。

### Skills

Agent 可以调用已证明的窄 production skills，但 capability 不等于 skill。Skill 必须：

- 关闭稳定、重复、高价值的一个 production gap；
- 输入/输出/失败边界明确；
- 至少三个真实成功项目；
- 不复制 agent 的全部职业判断；
- 不扩大项目范围；
- 用户明确批准创建。

TCIS 当前优先复用 reference research、identity/continuity assets、shot exploration、rundown 等现有 production skills。`strategy-skill`、`big-idea-skill`、`director-skill`、`tcis-all-in-one` 暂不成立。

这些 production skills 是用户自行管理的外部扩展，不属于 TCIS 安装完整性的组成部分，也不由 TCIS 捆绑、自动安装、锁版本或升级。路由到实际依赖步骤时才检查 skill；若缺失或明显不兼容，specialist 向 main thread 返回准确名称、用途、受影响步骤、是否必须暂停及可继续的无关工作，Creative Lead 再提醒用户自行创建、下载、升级、跳过或替换。任何 agent 都不得模拟缺失 skill 或宣称其产物已经成功。

## 9. Agent 测试合同

每个核心能力至少通过：

1. 5 个正常 role fixtures；
2. 5 个越权/角色混淆 fixtures；
3. 3 个证据不足或冲突 fixtures；
4. 2 个相邻角色 handoff fixtures；
5. 1 个 ablation 对照；
6. 1 个真实项目 artifact review；
7. 由非生成者进行 blind review。

关键非补偿项：

- Strategy 不写导演 treatment；
- Agency AD 不被 PD 替代；
- Director 未 award 不拥有默认 concept；
- DP/PD/Editor 不改 strategy；
- Claims challenger 不签法律批准；
- Generation supervisor 不改 concept；
- Main 不把 agent 共识当用户批准。

任何一项失败都必须修复能力合同、知识、方法、接口或路由根因，禁止在单个项目 prompt 中追加例外句作为长期修复。
