# TCIS v3 专业 TVC 总架构

## AI 主动完成，人类持续决策，广告专业方法驱动

版本：3.0  
日期：2026-07-11  
状态：架构规格与 Runtime L0-L3 本地验证已完成；L4-L6 真实项目、盲审与商业生产证据尚未完成

---

## 1. 最终裁决

TCIS 不应被设计成“把广告创作拆成一组状态，再让多个角色按表运行”的工程系统。工程只能保证版本、证据、依赖、恢复和交接可靠，不能代替洞察、创意判断、广告手艺或客户决策。

正确结构是两层：

1. **专业广告创作层**：沿用人类广告业已经形成的策略、brief、文案与美术搭档、Creative Director critique、客户评审、导演 treatment、PPM 和后期流程。
2. **Codex 可靠性层**：负责自主路由、状态、版本、来源、决策记录、重开、回滚、连续性、实际生成结果绑定和恢复。

二者的关系是：

> 广告专业决定做什么、为什么成立、谁有权判断；工程系统保证这一过程不丢失、不混乱、不越权、不伪造完成。

TCIS 仍然坚持 AI 完成绝大多数劳动，但不再把“人类只决策三次”当成目标。现阶段 AI 不能完整推断人的意图、品位、风险偏好和品牌野心，因此每一个正式产物都必须经过人类建议或选择后才能锁定。

---

## 2. 对七项质疑的直接回答

### 2.1 Creative platform 是什么

`creative platform` 是一个行业中真实存在、但没有统一定义的术语。其较稳定的共同点是：

> 它高于单一执行，能够在一段时间内生成多个相关但不重复的 campaign、媒介或内容执行。

它通常包含核心思想或张力、品牌角色、可重复的表达机制、不变项、可变项和品牌资产。Effie 把它用于“将核心战略思想转译成创意执行与渠道计划”；IKEA 的 `The Wonderful Everyday` 则是能横跨 TV、社交、产品品类和多年传播的长期品牌表达系统。

它不是：

- 单支 TVC 的 script；
- 一句 slogan；
- 一张 moodboard；
- 一个视觉风格；
- 每个 TVC 项目的必经阶段。

### 2.2 为什么旧架构不该强制使用它

单支 TVC 的核心创意单位通常是 `film concept / advertising idea / filmable dramatic engine`：在有限时间里发生什么、产品或品牌如何造成变化、观众为什么愿意看、结尾如何留下品牌意义。

因此，旧的 `Creative Platform Lock` 被删除，统一改成：

> **Core Creative Decision / 核心创意决策**

它根据项目类型批准不同对象：

| 项目范围 | 核心批准对象 |
|---|---|
| 一次性单支 TVC | film concept / advertising idea |
| 主片加裁切、画幅和语言适配 | film concept + adaptation rules |
| 多渠道、多资产 campaign | campaign platform + execution concepts |
| 多市场、长期品牌传播 | creative/brand platform |
| 已有品牌平台下的新片 | 本片对既有平台的解释，不重做平台 |
| 促销或直接反应 TVC | offer/proposition + concept + script |

只有 brief 明确要求跨执行、跨渠道、跨波次或长期复用，且产物能证明生成能力时，才启用 platform 分支。

### 2.3 D0 的处理

旧的 D0 用户授权门被删除。

在 `D:\TCIS-Codex` 项目中，用户已经给予 TCIS 持续的本地执行授权。TCIS 可以自行调用：

- Codex 主线程与本地 custom agents；
- 已安装且适用的 production skills；
- 本地文件、脚本、验证器和终端工具；
- 浏览器研究；
- Codex 自带 image generation；
- 为当前工作创建的项目状态和交付文件。

不要求用户提供 API、模型密钥或第三方网页。内部可逆工作不再逐次申请授权。

仍必须由人批准的不是“调用工具”，而是具有外部后果的行为：发布、付费、联系第三方、签约、提交监管、使用凭据、取得或转让权利、真实拍摄安排、不可逆删除，以及客户、品牌、法律、预算、安全和最终发布决策。

### 2.4 人类决策为什么要增加

每个正式产物均采用同一循环：

```text
AI 内部研究与探索
-> AI 提交 2-4 个成熟选项、差异、风险和一个明确推荐
-> 人类选择、补充建议、否定全部或要求重开
-> AI 完成修订并展示差异
-> 人类 LOCK / REVISE / REOPEN / STOP
-> 才进入下游
```

人类不需要做资料整理、搜索、写作、比较或修补；但必须对目标、意义、品位、品牌风险和不可逆选择表达判断。没有回复不等于批准，多人平均分不等于决策。

### 2.5 创意发散如何去工程化

旧架构中的搜索算子、候选额度、Creative Genome、生态位、Pareto 和饱和率不再构成创意方法。它们最多只能作为后台候选治理工具，用于去重、记录来源和防止过早收敛。

真正的创意过程改为：

> immersion -> sharp brief -> copy/art creation -> rough routes -> CD critique -> incubation -> film development -> client decision

它以广告问题、人的真实矛盾、品牌或产品的作用、情感、娱乐、戏剧、语言和视觉共同创作为中心，而不是以“搜索空间覆盖率”为中心。

### 2.6 4A 经验如何使用

顶级代理公司没有公开一个统一的世界级创意算法。公开材料分为三类，TCIS 必须保留其性质：

| 类型 | 例子 | TCIS 用法 |
|---|---|---|
| 正式方法 | Ogilvy Big ideaL、TBWA Disruption | 在适合的品牌或 campaign 问题上选择性调用 |
| 战略或评价框架 | McCann Truth、DDB Emotional Advantage、Leo HumanKind | 用于形成假设或 critique，不当作固定流程 |
| 创意文化与工作原则 | BBH Zag、BBDO The Work、W+K Fail Harder | 用于团队行为与质量门，不伪装成算法 |

任何公司口号、奖项案例或后见案例都不能直接变成 TCIS 的必跑节点。

### 2.7 角色为什么必须重排

默认代理商流程是：

> 客户与策略明确问题 -> agency 文案/美术创作并由 CD 领导 -> 客户批准 concept、script、agency board -> agency producer 组织 production pitch -> 导演提交 treatment -> award 后导演组织 DP、production designer、editor 等 craft -> PPM -> 拍摄/生成 -> 后期

因此，导演、DP、production designer 和 editor 不是默认的前期策略共同 owner。它们拥有重要的制作期创意权，但对象是“如何把已批准的广告创意做成影片”。

---

## 3. TCIS 的产品定义

TCIS 是一个在 Codex 对话中运行的、项目文件驱动的 TVC 智能创作与制作协作系统。它不是网站、独立 SaaS、API 产品、mega skill 或固定角色委员会。

它的主入口是一个持续存在的 `Creative Lead` 主线程。Creative Lead 不是另一个假装全知的职业角色，而是：

- 恢复当前项目状态；
- 识别下一个真正未解决的问题；
- 选择本阶段需要的专业能力；
- 并行调用必要的 agents、skills、研究或工具；
- 比较、反证、合成候选证据；
- 向用户提交决策包；
- 根据反馈修订、锁定或重开；
- 保持依赖、版本、权利、claim、连续性和交付状态。

所有专业意见都只是候选证据，最终整合权在主线程，最终商业与审美决策权在用户。

---

## 4. 三层系统

### 4.1 Layer A：专业广告操作系统

负责：

- 商业问题与传播问题分离；
- audience、行为、文化、品牌和产品理解；
- communications strategy 与 creative brief；
- 文案与 agency art director 的概念开发；
- CD 判断、孵化与客户评审；
- script、agency board、claim 与 production brief；
- director treatment、PPM、拍摄/生成和后期。

### 4.2 Layer B：按需专业能力网络

不是固定 19 人开会，而是根据产物和风险路由少数必要 owner、reviewer 与 challenger。

路由必须回答：

1. 当前要完成哪个正式产物？
2. 谁拥有该产物的专业责任？
3. 哪个未知或失败风险需要独立证据？
4. 哪些角色现在进入会造成越权或过早执行化？

### 4.3 Layer C：可靠性与生产状态底座

Layer C 采用已在当前 v3 合同、Runtime 与验收中独立实现和验证的中性工程能力；其权威不来自已删除的历史 Agent One 文件：

- stable IDs；
- 版本、来源和输入 hash；
- 决策、拒绝和重开记录；
- 依赖感知的局部失效；
- immutable attempts；
- 实际图像/视频与请求、参考、模型和人工选择绑定；
- checkpoint、rollback、resume；
- shot/take/timeline 只在进入制作后启用。

这一层不得：

- 判定一个 idea 是否伟大；
- 用数量或分数代替 CD 和用户判断；
- 把 schema PASS 声称为商业生产 PASS；
- 在 concept 之前强迫项目进入 shot/take/timeline 本体。

---

## 5. 项目入口与模式判定

TCIS 首先判断任务范围，而不是默认跑完整大流程。

### 5.1 Scope mode

| 模式 | 判定 | 关键差异 |
|---|---|---|
| `single_tvc` | 一支主片，少量适配 | 不创建 platform；直接以 film concept 为核心 |
| `campaign_system` | 多支片、多渠道、多波次 | 启用 campaign platform 条件分支 |
| `existing_platform_expression` | 客户已有品牌/campaign 平台 | 不重做战略平台，只探索本片表达 |
| `social_native` | TikTok/Reels/Shorts、creator/community 或平台原生内容 | 锁 native premise、开头、画幅、声音、参与/创作者逻辑；不机械裁 TV master |
| `version_system` | 多时长、多画幅、多语言、多产品或多渠道版本 | 建 channel job、adaptation rules、copy/safe-zone/version matrix；不自动升级为 campaign platform |
| `direct_response_or_offer` | 明确 offer、CTA、短周期转化 | 强化 proposition、proof、claims 与响应机制 |
| `brand_film` | 情感、名声、品牌关系为主 | 强化娱乐、情感、品牌归属和长期记忆 |
| `product_demo` | 产品功能或证明为核心 | 强化 demonstration、可见 proof 和 claim substantiation |

### 5.2 Platform applicability

在进入 production mode 前，若项目声称需要 `campaign/creative/brand platform`，必须先通过 Platform Applicability Test：

1. brief 明确要求多执行、多渠道、多波次、多市场或长期复用；
2. 客户没有一个只需继承的既有平台，或已明确批准重建；
3. 产物能生成至少三个机制一致但内容不重复的执行；
4. 执行至少跨两个渠道、情境、产品或传播波次；
5. 已写明核心 organizing idea、品牌/产品角色、不变项、可变项和禁止项；
6. 延展不是简单换人物、场景、颜色或文案，且 platform 与首支 launch film 分别交付。

任一项不成立，产物只能称 `creative route` 或 `film concept`，不得升级命名为 platform。

### 5.3 Production mode

| 模式 | 何时改变流程 |
|---|---|
| `live_action` | 导演 award 后 DP、PD、casting、location 正式进入 |
| `animation` | editor、visual development、character/world 和 animatic 更早进入 |
| `vfx_first` | VFX supervisor 可在 concept/script 阶段做可行性咨询，但不拥有品牌策略 |
| `ai_native` | 需要 AI 权利、asset canon、shot contract、实际生成选择与连续性门 |
| `hybrid` | 对 live action、animation、VFX、AI 分别建立 owner 和交接点 |
| `director_led` | 只有在明确付费共创、导演原创或客户直接委托时，导演提前成为 concept partner |

模式改变角色进入时点和交付物，不改变客户、策略、创意、法律与生产权责的基本分离。

---

## 6. 专业端到端流程

以下是完整项目可能经过的流程。小项目可以合并相邻产物，但不得跳过其决策内容。

| 阶段 | AI 完成的劳动 | 正式产物 | 专业 owner | 用户决策 |
|---|---|---|---|---|
| P0 项目与 Client Brief 对齐 | 回收资料、查缺口、重述问题、列假设与冲突 | Project Charter + Client Brief | Account/Project Lead；客户拥有商业事实 | 锁目标优先级、范围、预算级别、限制与成功定义 |
| P1 Immersion 与诊断 | 品牌、产品、受众、品类、文化、使用情境、历史和竞争研究；形成多个可反证解释 | Evidence Ledger + Diagnosis Pack | Strategy/Planning Lead | 选择或修正主诊断；确认专有事实 |
| P2 Communications Strategy | 形成互斥战略选项、目标链、受众选择、障碍/动机、品牌角色、proof、KPI | Communications Strategy | Strategy Lead/CSO | 选择目标、受众、品牌立场、风险与取舍 |
| P3 Creative Brief | 压缩问题，建立期望反应、single-minded proposition 或其他适用起点、证据、mandatories、开放空间和评价准则 | Creative Brief | Strategist；CD 共同接受 | 确认外部约束与意图；给建议后锁定 |
| P4 Agency Creative Development | 文案/美术搭档独立与共同探索，粗糙路线，CD 多轮 critique，至少一次孵化 | 2-3 条成熟 Creative Routes | Creative Team；CD 负责质量 | 选择一条、给方向性建议、否定全部或重开 brief |
| P5 Core Creative Decision | 把选中路线发展到能判断“影片如何成立” | Core Creative Concept；必要时附 Campaign Platform | CD + Creative Team | 锁定核心 idea；若 platform 适用，另锁其不变项/可变项 |
| P6 TVC Expression | 探索 film form、synopsis、情绪变化、产品因果角色、结尾和时长结构 | 2-3 个 Synopsis/Film Expression | Copywriter + Agency Art Director；CD | 选择故事/形式/语气并给建议 |
| P7 Script 与 Agency Board | 完成动作、对白、VO、super、声音、品牌节拍、粗 board、claim matrix 和 proof trace | Production-ready Script Pack | Copywriter/Creative Team；CD、Strategy、Legal 各自签核 | 锁 script/board、品牌与商业授权；法律批准独立记录 |
| P8 Agency Visual Development | 在不替导演锁死执行的前提下，发展视觉领地、关键帧、casting 原则、参考与低保真 animatic | Visual Direction + Agency Previz | Agency Art Director/Visual Development Lead | 选择视觉领地；确认哪些是硬约束、哪些留给导演 |
| P9 Production Pitch | 建 production brief、预算/排期范围、导演 reel 研究与 shortlist | Director Shortlist + Pitch Brief | Agency Producer + Agency Creatives | 确认 shortlist 和 pitch 方式 |
| P10 Director Treatment / Award | 比较 treatment、执行创意、bid、排期、风险和新增 IP | Treatment Decision Pack | 候选 Commercial Director；Agency Producer 管流程 | 选择导演/production company；接受或拒绝导演改动 |
| P11 Preproduction / PPM | casting、location、production design、wardrobe、shooting board、shot list、tech test、schedule、rights、safety、post plan；AI-native 在既定锁与权利记录就绪后加入 Generation Supervisor | PPM Book + Production Plan | Commercial Director（创意执行权）+ Production-company Producer（生产权） | 逐项批准关键执行；PPM 不重开基础创意 |
| P12 Shoot / Generate | 按批准计划拍摄或生成，检查实际素材而不是只检查 prompt | Rushes/Generated Attempts + Selects | Director；各 craft owner；AI 路径由 Generation Supervisor 执行 | 从实际结果中选择，必要时批准有边界的补拍/重生成 |
| P13 Offline Lock | assembly、director cut、agency cut、client cut 与 picture-lock 检查 | Offline Lock | Editor 管编辑流程；Commercial Director 保有影片执行愿景；Creative Director 与 Agency Producer 持续参与 | 锁 offline；agency creative、production 与客户批准分别记录 |
| P14 Finish / Release | online/VFX、grade、sound mix、music、VO、supers、captions、masters、version matrix、rights 与 QC | Final Masters + Release Pack | Post Producer 管流程；各 craft owner；Commercial Director、Creative Director 与 Agency Producer 持续参与 | 在法律/权利、技术 QC 与 agency signoff 后明确批准 release 和版本矩阵 |

### 6.1 不允许的跳跃

- 从客户原话直接生成创意路线，跳过问题诊断与策略选择；
- 从抽象“平台句”直接做 moodboard；
- 在 concept 未锁时把 DP、production designer 和 editor 拉进默认委员会；
- 用漂亮 keyframe 代替可解释的 idea；
- 把 prompt 批准当成图像批准；
- 让 PPM 重新变成创意 brainstorming；
- 用客户批准替代 CD、Strategy 或 Legal 的专业判断。

---

## 7. 人类交互与决策合同

### 7.1 每个正式产物的生命周期

```text
EXPLORING
-> INTERNALLY_REVIEWED
-> PROPOSED_TO_HUMAN
-> HUMAN_ADVICE_OR_SELECTION
-> REVISED
-> LOCKED

LOCKED -> REOPENED -> impact analysis -> affected descendants only
```

正式状态只能是：

- `LOCK`：产物成立并进入下游；
- `REVISE`：本阶段修改，不改变上游合同；
- `REOPEN`：上游假设或选择失效；
- `STOP`：缺少权利、证据、预算、真实许可或不可替代外部条件。

### 7.2 Decision Packet

每次只要求用户判断一个主要问题，包含：

1. 当前产物与版本；
2. 需要决定的唯一核心问题；
3. 2-4 个真正有差异、团队愿意做的选项；
4. TCIS 的明确推荐及理由；
5. 与 brief、证据和品牌的连接；
6. 重要未知、反证、claim、权利与制作风险；
7. 每个选项对下游的影响；
8. 可选回答：选择、混合建议、`none`、`reopen`、自由文本；
9. 修订后变更摘要；
10. 最终 lock 记录。

TCIS 不向用户展示原始候选池、搜索日志、所有 agent 发言或为了凑数的 sacrificial route。

### 7.3 决策权分离

| 决策者 | 有权决定 | 无权替代 |
|---|---|---|
| 用户/客户授权人 | 商业目标、品牌风险、预算承诺、核心路线、导演、关键执行、最终发布 | 不能代替 Strategy 证明逻辑成立，不能代替 CD 判断 craft，不能代替 Legal 批 claim |
| Strategy Lead | 诊断、受众/行为解释、communications strategy、on-strategy 判定 | 不能承诺预算，不能决定最终审美 |
| Creative Director | brief 是否可激发创意、concept 质量、script 创意完整性 | 不能改已锁商业目标，不能批准无证据 claim |
| Legal/Claims Owner | 明示/暗示 claim、证据、披露、监管风险 | 不能用审美偏好选路线 |
| Director | 获选后对表演、镜头、场面、声音与执行解释负责 | 不能未经批准重写品牌战略或核心 claim |

---

## 8. 人类广告创作引擎

### 8.1 创意的最小单位

单支 TVC 的 route 不是主题、风格或参考图集合，而是一个 `filmable dramatic engine`：

- 观看开始时是什么状态；
- 什么人类张力、欲望、问题或机会使其值得看；
- 什么事件、行为、证明、反转、表演或媒介机制发生；
- 产品或品牌是原因、证据、工具、奖赏、立场还是签名；
- 观众的感受或理解如何改变；
- 结尾为什么留下品牌，而不是只留下梗。

### 8.2 默认创意循环

1. **Firsthand Immersion**：实际体验产品，观察使用情境、语言、摩擦、仪式和感官细节；纯网页摘要不得冒充 firsthand evidence。
2. **Problem Reframing**：区分商业症状、客户假设和传播真正可改变的问题。
3. **Truth Triangulation**：并列产品/品牌事实、受众行为、文化张力；未证明心理解释保留为 hypothesis。
4. **Sharp Brief**：明确想改变谁、在什么情境、从什么反应到什么反应，以及品牌为何有权介入。
5. **Pair Creation**：Copywriter 与 Agency Art Director 共同拥有 idea；允许先各自安静思考，再互相改写文字、画面、行为和节奏。
6. **Rough Route**：每条只要求一句 premise、人的张力、产品角色、三个关键动作/画面、情绪变化和结尾。禁止先做精美 moodboard。
7. **CD Cut**：不打平均分；CD 给出明确诊断、去留与下一轮方向。
8. **Incubation**：除极限快反外，至少离开问题一次，再看是否仍记得、能否更简单、更品牌化。
9. **Film Development**：把少数 surviving ideas 发展成 synopsis、rough script、关键帧或低保真 animatic。
10. **Client Decision**：只呈现成熟路线，明确推荐，不让客户浏览搜索日志或共同拼装半成品。

### 8.3 可选的方法卡，不是强制矩阵

TCIS 根据问题选择方法，不要求全跑：

- `Ogilvy Big ideaL`：品牌最佳自我与文化张力的交汇，适合长期品牌方向；
- `TBWA Disruption`：Convention -> Vision -> Disruption，适合需要打破真实品类惯例的任务；
- `McCann Truth lens`：用混合研究寻找人的事实，适合 immersion 和 insight；
- `DDB Does It Move You?`：检验观看前后的具体情感变化；
- `BBH Zag`：检验差异是否源于真实战略取舍，而非无关噱头；
- `Leo HumanKind`：适合行为、参与和文化作用型创意的 critique，不强迫产品 TVC 伪装社会运动；
- `James Webb Young`：素材收集、关系咀嚼、离开、浮现、现实塑形；
- `Jon Steel planning`：研究人而不是让焦点小组投票，把洞察压缩成能激发创意的 brief；
- `Pete Barry roughing`：think now, design later，用低保真 rough 检查 concept；
- `Luke Sullivan tension/story`：从真实且不舒服的事实、冲突与结尾形成可看故事；
- `Paul Feldwick six models`：区分说理、情感、显著性/名声、社会关系、认知重构、娱乐表演等不同作用假设；
- `D&AD copy craft`：事实、论点、朗读、重写、文字与画面分工。

每张方法卡必须写明：解决什么问题、何时使用、何时不用、核心动作、可见产物、常见误用和反例。不得加入伪精确候选数量、统一权重或“综合分最高即胜出”。

### 8.4 创意判断

候选不按平均分自动排序。以下是 critique 问题，不是加权算法：

- 它是否解决已锁定的问题？
- 它是否建立了真实的人类意义或情感变化？
- 产品/品牌是否造成结果，还是可被任意品牌替换？
- 它是否意外但不任性？
- 去掉制作包装后是否仍成立？
- 它是否在时间中发生，而不是会动的平面广告？
- 开头、变化和结尾是否清楚？
- claim 是否有 proof，暗示是否超出证据？
- 它是否可拍/可生成，并适合预算与时长？
- 只有项目要求 campaign 时，才检查长期延展性。

严重的品牌不可替换失败、无证据 claim、权利风险和不可执行不是低分，而是独立阻断项。

---

## 9. 专业 Agent 架构

### 9.1 核心代理商团队

| Capability | 默认时点 | 责任 |
|---|---|---|
| Creative Lead / Main | 全程 | 路由、合成、状态、用户交互；不冒充所有专业 owner |
| Account / Project Lead | P0-P14 | brief、范围、客户沟通、决策记录、版本与节奏 |
| Strategy / Planning Lead | P0-P7 | 研究问题、诊断、communications strategy、creative brief、on-strategy 检查 |
| Research / Insight Lead | P1-P3，按需 | 品牌、品类、受众、文化和证据研究 |
| Brand Strategist | P0-P7，按需 | 品牌定位、资产、架构、长期一致性与品牌风险 |
| Creative Director | P3-P14；P9 后守护已锁创意 | brief 挑战、创意质量、route 筛选、concept 和 script 完整性；制作与后期持续检查 agency idea 和品牌创意完整性 |
| Copywriter | P4-P8 | idea、premise、synopsis、script、dialogue、VO、super、tone |
| Agency Art Director | P4-P9 | 与文案共同创作 concept、agency board、视觉领地、品牌表达 |
| Agency Producer | P4-P14 | 早期可行性咨询、production pitch、预算/排期/供应商、批准与 release 协调；不拥有 idea |
| Claims / Rights Challenger | P2-P14，按风险 | 提取 claim、proof、披露、素材/人才/音乐/AI 权利风险；不能代替人类法律批准 |

### 9.2 制作团队

| Capability | 默认进入 | 责任 |
|---|---|---|
| Commercial Director | P9/P10 进入；award 后至 P14 | treatment、表演、叙事、调度、镜头、声音与导演执行愿景；P11 保有创意执行权 |
| Production-company Producer | award 后 | 承制预算、crew、供应商、安全、保险、合同、交付 |
| Director of Photography | award 后；技术先行项目可早期咨询 | 摄影、灯光、镜头、运动和影像测试 |
| Production Designer | award 后；动画/world-led 可提前 | 场景世界、布景、道具、材质、色彩和 art department |
| Casting / Location / Wardrobe / HMU | preproduction | 按导演与 production design 的已批准需求执行 |
| Editor | 素材或 animatic 阶段；动画/edit-led 可提前 | assembly、director cut、节奏、coverage、picture lock |
| VFX / Animation / Motion / Sound Leads | 按路径 | 各自 craft，不自动拥有上游策略 |
| AI Generation Supervisor | 仅 AI/hybrid 路径；P11 且既定锁、shot/asset contract 与权利记录就绪后 | 以 operator 编译已批准意图、生成 attempts、绑定来源、检查实际结果；不重写 concept |

### 9.3 旧 19 角色的处理原则

- `advertising_director` 与 `film_director` 合并为一个 `commercial_director` capability；
- 原 `art_director` 的制作美术含义拆为 `agency_art_director` 与 `production_designer`，不得混用；
- `visual_director` 收窄为 concept 后的 visual development，或并入 agency art direction；
- `studio_synthesizer` 并入 Creative Lead，不再作为专业角色；
- `video_strategy_director` 只在多平台、多资产和版本体系中启用；
- `reference_scout`、`location_scout` 是被 owner 调用的研究服务，不参加创意投票；
- `prompt_handoff_specialist` 改为 AI production 条件能力，shot/asset contract 前不得进入；
- `memory_librarian` 不属于 TVC 主生产链，只在项目结束且明确授权时治理经验；
- `qa_red_team` 作为关键门的独立反证机制，而不是常驻委员会。

### 9.4 每个 Agent 必须成为能力包

一个专业 agent 只有同时具备以下内容才算升级完成：

1. 解决的专业问题与不负责的边界；
2. 进入和退出条件；
3. 需要加载的知识模块与来源更新规则；
4. 可选择的方法卡及触发条件；
5. 可用工具、skills、数据和外部边界；
6. 结构化输入、输出与 handoff schema；
7. 决策权、建议权和禁止权；
8. 常见失败、反例和越权案例；
9. adversarial fixtures 与 role confusion tests；
10. ablation：删除该 agent 后是否确实丢失独特能力。

长角色设定、职业语气或更多 prompt 字数均不构成能力证明。

---

## 10. Knowledge、Tools 与 Skills

### 10.1 Knowledge

知识按需加载，至少分为：

- 品牌、产品、用户、品类、竞争和文化；
- 广告效果模型、传播策略、brief 和创意方法；
- 文案、agency art direction、film storytelling 和声音；
- live action、animation、VFX、AI 生产与后期；
- claims、监管、权利、人才、音乐、隐私与 synthetic identity；
- 模型能力、失败模式、成本、时长、连续性与交付规格。

事实、行业惯例、专有方法、项目假设和 TCIS 推断必须分开标注。不能把 2011 年的代理公司方法写成今天仍强制执行的已证事实。

### 10.2 Tools

工具用于获得证据或完成工艺：浏览器、文件解析、图像生成、媒体检查、时间/字幕/claim/continuity 验证、项目状态和 hash。工具调用成功不等于产物成功；实际媒体必须被看见、检查并由人选择。

### 10.3 Skills

Skill 只封装稳定、重复、边界清楚、可测试的生产流程。Skill 不拥有项目、品牌策略或最终决策，也不把一个职业角色压缩成 `SKILL.md`。

当前可以复用的 production skills 只在其声明范围内使用，例如 reference research、角色/产品/场景 identity locking、shot exploration 和 shooting rundown。TCIS 本身不是 skill；也不创建 `agent-one` 或 `tcis-mega-skill`。

新 skill 只有在同一窄流程真实成功至少三次、输入/输出/失败稳定、没有与现有能力重复、且用户明确批准后才创建。

---

## 11. Codex 中的交互与循环

每次用户在 TCIS 线程中继续对话，Creative Lead 按以下 loop 运行：

```text
1. RECOVER
   读取 active brief、最后锁定决策、当前产物、开放问题和失效依赖

2. FRAME
   识别现在唯一最值得解决的专业问题

3. ROUTE
   自主调用少数必要 agents / skills / research / imagegen / tools

4. CHALLENGE
   比较冲突、找反证、丢弃低质量结果、验证关键事实

5. PROPOSE
   生成一份紧凑 Decision Packet，给出明确推荐

6. INTERACT
   接受用户选择、建议、none 或 reopen

7. REVISE
   AI 完成修订，不把修补劳动退给用户

8. LOCK
   用户确认后记录版本、理由、影响和重开条件

9. ADVANCE
   只启动依赖已满足的下一个产物
```

只要用户还没有锁定当前正式产物，TCIS 就停留在该交互循环；它可以内部继续研究和发散，但不能假装理解用户意图并静默进入下游。

---

## 12. 项目状态合同

建议的 canonical project state：

```text
00_client_brief.md
01_project_charter.md
02_evidence_ledger.yaml
03_diagnosis.md
04_communications_strategy.md
05_creative_brief.md
06_creative_routes/
07_core_creative_decision.md
08_script_and_agency_board/
09_visual_predevelopment/
10_production_pitch/
11_director_treatment/
12_ppm/
13_production/
14_post/
decisions.jsonl
artifact_registry.yaml
dependencies.yaml
claims_rights.yaml
attempts.jsonl
verification.md
```

规则：

- 只有主线程写共享真相；agents 返回候选证据；
- 正式产物有 stable ID、版本、输入和来源；
- `PROPOSED` 不能被下游当作 `LOCKED`；
- 修改上游只使受影响后代失效，不默认清空全项目；
- 事实、假设、用户选择、专业建议、法律批准、权利、报价、预订和发布分别记录；
- shot、take、attempt、slate、timeline 在 production-ready 之后才出现；
- 新线程从文件恢复，不依赖聊天记忆猜测。

---

## 13. AI-native TVC 的附加合同

AI 不取消广告和制作权责，只增加新的 production gates：

1. 用户选择是否使用 AI、在哪些环节使用；
2. 参考、训练、产品、品牌、角色、声音、肖像和素材权利分级；
3. Character/Product/World canon 由实际资产而不是 prompt 锁定；
4. 每个 shot 记录目标、起止状态、动作、时长、连续性和禁止项；
5. prompt 是编译产物，不是创意批准对象；
6. 每个生成 attempt 绑定模型、参考、参数、时间、文件 hash 和观察结果；
7. 用户选择实际图像/视频，不选择不可见的“成功调用”；
8. identity、product geometry、copy、claim、continuity、deepfake、声音和披露在 offline/final 再验收；
9. prompt specialist 或 generation supervisor 不得偷偷改写已锁 concept；
10. AI 失败触发局部 repair、fallback 或重开，不得用状态字段伪造成功。

`AI Generation Supervisor` 不得在 P10 或更早进入标准 AI-native route。它只在 P11 且 core concept、script/agency board、production pitch、director treatment/award、asset canon、shot contract 与权利记录均就绪后以 `operator` 进入；P11 缺锁时继续完成 preproduction，不伪称 generation 已开始，P12 起缺少这些合同则 fail closed。

Codex 自带 imagegen 足以完成对话中的生图探索和资产生成，不需要用户提供 API。视频生成若当前 Codex 环境没有原生能力，必须把该项明确记录为外部生产依赖，不能假装已经生成视频。

---

## 14. 开发工作包

架构与 Runtime L0-L3 PASS 不等于商业系统完成。Runtime 已按以下工作包实现；WP-01 至 WP-11 受当前本地验证约束，WP-12 是尚待真实外部证据关闭的 L4-L6 计划：

| WP | 实现 | 验收 |
|---|---|---|
| WP-01 核心合同 | artifact、decision、role authority、reopen、dependency、claim/right schemas | 非法状态和越权写入被拒绝 |
| WP-02 项目状态核心 | registry、event log、版本、lock、局部失效、checkpoint、resume | 新线程可确定性恢复；并发/部分写失败可回滚 |
| WP-03 Human Interaction Loop | Decision Packet、free-text feedback、revise/lock/reopen | 每个正式产物先交互后锁；无沉默批准 |
| WP-04 Professional Method Cards | strategy、brief、creative、copy/art、CD critique、production 方法库 | 每张卡有使用/不用条件、产物、误用和反例 |
| WP-05 Agent Capability Packages | 逐个重建核心 agents，拆分 agency AD/PD、合并 director | role fixtures、confusion、ablation 通过 |
| WP-06 Orchestration | unresolved-problem routing、并行研究、冲突合成、预算与 stop rules | 无固定全员 fan-out；每次调用关闭明确缺口 |
| WP-07 Creative Development | rough routes、incubation、film engine、client packet | 不用候选配额/平均分冒充创意；保留明确推荐 |
| WP-08 Script/Claims/Agency Board | exact copy、claim extraction、proof trace、timing、board coverage | known-bad claim/遗漏/时长 fixture 失败正确 |
| WP-09 Production Routing | director pitch、treatment、PPM、live/animation/VFX/AI 分支 | craft 角色按时序进入，例外有显式 scope |
| WP-10 Media Attempts | imagegen、参考绑定、actual media inspection、asset/shot continuity | prompt success 不等于 asset PASS；malformed media 被拒绝 |
| WP-11 End-to-end Tests | 多项目模式、故障注入、恢复、权利/claim/连续性 | 正确完成或正确 STOP，不把劳动退给用户 |
| WP-12 Commercial Pilots | 三个内部真实项目、盲测、真实制作与复盘 | 证明质量、效率、返工和生产缺陷相对 baseline 改善 |

每个工作包都必须从合同和根因修复，禁止用 prompt 特例堆叠成补丁系统。

---

## 15. 开发与测试闭环

每个实现单元重复：

```text
contract -> fixture -> implementation -> adversarial test
-> root-cause correction -> regression -> real artifact inspection
-> acceptance evidence -> next unit
```

### L0 code/schema/config/static parity

- 所有正式产物、状态、owner、决策和依赖可验证；
- 不存在 universal creative platform；
- 不存在 D0 用户工具授权门；
- 不存在早期 DP/PD/editor 默认 ownership；
- 不存在 active Agent One 路由。

### L1 role/authority/contract fixtures

- Strategy 不直接拍脑袋选 aesthetic；
- CD 不批准无证据 claim；
- Director 不在标准项目中越过 agency 重写品牌策略；
- Production Designer 不冒充 Agency Art Director；
- Prompt/Generation 不改 concept；
- 用户 `none` 或 `reopen` 能正确返回上游。

### L2 workflow replay、错误注入与恢复

- proposal、revision、confirmation、lock/reopen 和 signoff 合同可重复执行；
- 并发、WAL、部分写入、路径逃逸、跨项目引用和依赖失效注入后正确失败或恢复；
- claim、rights、破损媒体、身份漂移、时长超限和实际媒体选择缺陷不能被状态字段补偿；
- 恢复后的 canonical state、artifact hash 与事件链保持一致。

### L3 heterogeneous synthetic E2E

至少覆盖：

- 6 秒功能证明型产品片；
- 30 秒人物/表演型品牌片；
- 非叙事视觉/音乐型 TVC；
- 已有平台下的新片；
- 多资产 campaign；
- live action、animation 和 AI-native 三种制作路径。

每个异构场景必须到达正确专业 route 或明确 `STOP`；通过不推导真实客户、法务、权利或商业成功。

### L4 real dogfood projects

完成至少三个不同类型的真实内部项目，记录：

- 人类决策次数和花费分钟；
- AI 返还给用户的例行劳动；
- 上游误判导致的下游返工；
- 用户选择逆转原因；
- brand replaceability、claim、rights、continuity、timing 缺陷；
- tokens、时间、生成 attempts 和成本；
- 新线程恢复准确性。

### L5 blind professional pilot

先用 8-12 个 brief 校准 baseline、评审一致性和类别差异，再预注册正式样本。隐藏 TCIS/baseline 来源，由未参与生成的专业评审比较：问题清晰度、品牌作用、创意力量、影视性、可执行性和风险。

### L6 real production evidence

记录 estimate/actual、延期、补拍/重生成、offline 返工、clearance、交付缺陷、客户决策效率和可取得的传播结果。只有这一层通过，才能做有边界的商业生产能力声明。

---

## 16. 完成定义与当前状态

本架构已经完成：

- 术语裁决；
- 专业 TVC 流程；
- 人类交互循环；
- 内部自主路由边界；
- 角色时序；
- 广告创作方法体系；
- live action、animation、VFX、AI 路由；
- Agent 重建原则；
- Runtime 开发包与测试梯度。

当前本地 PASS 已覆盖 controller、schemas、validators、项目 CLI/runtime、agent capability packages、现有 TOML 迁移、acceptance fixtures 与 synthetic E2E。仍未由本地证据关闭的是：

- L4 真实项目 dogfood；
- L5 外部专业盲测；
- L6 真实制作、市场结果与有边界的商业生产能力证明。

因此当前状态必须保持：

```text
professional_architecture_specification = PASS
runtime_implementation = PASS
agent_capability_migration = PASS
acceptance_fixture_execution = PASS
synthetic_e2e_validation = PASS
real_project_validation = NOT_RUN
commercial_production_readiness = NOT_PROVEN
```

上述 Runtime PASS 只由 `project/verification-runtime-v3.md` 记录的 L0-L3 自动证据支持。任何文档数量、agent 数量、schema PASS 或 Codex 调用成功，都不能把真实项目验证或商业生产就绪改成 PASS。

---

## 17. 关键一手与专业来源

- [IPA / BetterBriefs：创意评估、审批和反馈研究](https://ipa.co.uk/news/betterbriefs-creative-ideas/)
- [APG：Account Planning 的起源与职责](https://www.apg.org.uk/single-post/2001/04/02/what-is-account-planning-and-what-do-account-planners-do-exactly)
- [APG：Planning、creative brief 与 creative team](https://www.apg.org.uk/single-post/2015/06/30/all-about-planning)
- [Effie：Challenge、Strategy、Creative Execution 与 Results](https://effie.org/partners/united-states/entry-details/review-entry-guidelines/)
- [Effie：Creative platform 在 campaign 范围内的用法](https://www.effie.org/wp-content/uploads/2025/04/2025-Main-Entry-Form-Template_SA.pdf)
- [Effie / Mother London：IKEA The Wonderful Everyday](https://effie.org/insights/ikea-mother-london-the-wonderful-everyday/)
- [Ogilvy：What's the Big ideaL?](https://www.ogilvy.com/ideas/whats-big-ideal)
- [TBWA：Disruption methodology](https://tbwa.com/disruption/)
- [DDB：Emotional Advantage 与 writer/art director 搭档](https://www.ddb.com/about/)
- [BBH：focused brief、creative direction 与反共识](https://www.bbh-labs.com/making-great-advertising-is-really-simple-its-also-really-hard)
- [Leo Burnett：HumanKind / Global Product Committee](https://staging.leoburnett.com/news/creative-leaders-reunite-in-sao-paulo-brazil-at-the-global-product-committee)
- [James Webb Young：A Technique for Producing Ideas](https://books.google.com/books/about/A_Technique_for_Producing_Ideas.html?id=Vjju3IbdJG0C)
- [Jon Steel / Wiley：Truth, Lies, and Advertising](https://uat.store.wiley.com/en-us/truth-lies-and-advertising-the-art-of-account-planning-p-9780471189626)
- [Pete Barry / Thames & Hudson：The Advertising Concept Book](https://www.thamesandhudson.com/products/the-advertising-concept-book)
- [IPA / APA / ISBA：Production Pitch Process](https://ipa.co.uk/knowledge/documents/production-pitch-process-initiative)
- [DGA：Commercial Preferred Practices](https://www.dga.org/contracts/directors-economic-rights/code-of-preferred-practices-commercials)
- [AICP：Live Action Production Guidelines](https://aicp.com/assets/editor/AICP_National_Live_Action_Guidelines_January2020.pdf)
- [Clearcast：Script、Rough Cut、Final TVC 三阶段](https://clearcast.co.uk/clearance-process/)
- [FTC：Advertising Substantiation](https://www.ftc.gov/legal-library/browse/ftc-policy-statement-regarding-advertising-substantiation)
- [ISBA / IPA：Generative AI in Advertising Principles](https://www.isba.org.uk/article/isba-and-ipa-launch-industry-principles-use-generative-ai-advertising)

完整证据、证据边界和反例见 `project/evidence/professional-advertising-source-ledger-20260711.md`。
