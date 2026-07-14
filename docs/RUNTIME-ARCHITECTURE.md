# TCIS v3 Runtime Architecture

状态：Runtime 与 L0-L3 本地验证已完成。本文描述代码合同，不声明真实客户、法务、权利、供应商、拍摄、盲审或商业结果。

## 1. 产品边界

TCIS 在 Codex 对话内运行，不提供独立网页，也不要求用户提供 API。Node Runtime 负责确定性状态、约束、恢复和命令；Codex main thread 负责专业编排、调用 agents/tools/skills/native imagegen、查看实际媒体并向用户提交决策包。

Runtime 不负责模拟创意质量、客户批准、法律签核、权利取得或外部生产。工具返回成功也不等于广告产物成功。

## 2. 单一真相

```text
用户最新明确指令
-> 当前项目 canonical files
-> 已锁 decision / lock records
-> capability registry
-> v3 architecture and contracts
-> evidence / old conversations
```

每个项目独立保存 stable project ID、revision、artifact versions/hashes、dependencies、decision packets、feedback、locks、claims、rights、attempts、shots、takes、timelines 和 events。任何记录都必须带 `project_id`，跨项目引用直接失败。项目级 Codex ambient memories 已关闭，聊天摘要与自动记忆不能成为项目真相。

## 3. 三层实现

### Professional layer

- P0-P14 广告与制作时序；
- conditional campaign platform；
- scope mode 与 production mode 分支；
- agency 与 production-company 角色权责；
- user decision owner 与专业 signoff 分离。

### Orchestration layer

- `router.mjs`：根据当前阶段、模式、缺口与 block 路由 owner/advisor/challenger；
- `workflow.mjs`：创建 proposal/confirmation packet，处理 feedback、revision、lock/reopen；
- capability registry：一个 canonical package 生成 project-scoped Codex specialist TOML；
- Creative Lead：main-thread package，不伪装成另一个 specialist agent。

### Reliability layer

- `contracts.mjs`：canonical JS contract；
- `schemas/tcis/*.json`：机器交接 schema；draft 2020-12 负责结构，`x-tcis-*` 语义关键字与 canonical JS 共同约束动态跨字段不变量；
- `store.mjs` / `project-state.mjs`：CAS、WAL、atomic rename、hash、event chain、恢复和局部失效；
- `media-verification.mjs`：项目内实际文件、字节 hash、图像/容器结构检查和独立选择记录；MP4 需闭合 box、track/handler/sample-description 与非空 media data；
- `fixture-runner.mjs`：73 个 non-compensable fixture 的 fail-closed runner；
- `cli.mjs`：稳定 JSON 命令面，不内置外部 API。

## 4. 人类决策循环

```text
AI creates mature options
-> PROPOSAL packet
-> named human SELECT / ADVISE / NONE / REOPEN / STOP
-> AI produces a changed REVISED artifact with a new hash
-> CONFIRMATION packet binds that exact hash
-> named human LOCK / REVISE / REOPEN / STOP
-> independent stage signoffs are checked
-> lock record is persisted
```

硬约束：

- `PROPOSED -> LOCKED` 非法；
- public create/transition/append API 均不能写入 `LOCKED`，只有 `commitLock()` 能原子提交 confirmation feedback、lock record、decision 与状态；
- proposal packet 不能提供 `LOCK`；
- confirmation 必须绑定 prior feedback 与 revised artifact hash；
- 沉默不改变状态；
- 客户选择不推导 claims/legal、rights、production、technical QC 或 release approval；
- `NONE` 与 `REOPEN` 永远可用。

## 5. 生产状态

`shot/take/timeline` 只在 P11 production-ready 之后出现。

- shot：目标、起止状态、动作、时长、连续性、禁止项与来源；
- take：shot、实际媒体 path/hash、类型、attempt、检查与选择；
- timeline：版本、fps、总时长、tracks、clip intervals、shot/take 来源；
- AI take 必须引用 generation attempt；
- selected attempt/take 必须绑定项目内真实文件、实际 hash、结构检查和独立选择；
- prompt 或工具成功不能成为 selected media。
- campaign platform 的多执行证明以 `STRUCTURED_PROTOTYPE` 明示，并随 artifact 持久化和恢复重验；它不等于已制作 execution 或商业效果证据。

## 6. 状态安全

- 所有写入使用 expected project revision；artifact 写入同时使用 expected version/hash；
- 项目锁保证同一 revision 只有一个 writer 提交；
- WAL 在 artifact 内容发布前建立，记录 revision 与内容发布；崩溃恢复只能得到完整旧状态或完整新状态，并回滚本事务创建但未提交的内容；
- canonical state 与 artifact/media paths 必须保持在项目 root 内；absolute、UNC、`..`、symlink/junction escape 被拒绝；
- dependency 是 project/version scoped DAG；reopen 只使传递后代失效；
- validator 返回 immutable snapshot，持久化再次验证，避免 validate-use mutation。

路径保证覆盖 TCIS 受控写入者：实际读文件使用打开的 handle、canonical containment 与 file identity 复核；新 artifact 通过事务 staging 和原子 hard-link 发布。纯 Node/Windows 不提供可证明抵御同机恶意进程持续替换 junction 的内核级 `openat` 隔离，因此不作该强保证。

## 7. Codex 交互

用户可以直接说：

```text
为这个项目启动 TCIS v3，先完成当前阶段全部前置工作，只把成熟决策包给我。
```

之后用自然语言选择、建议、全部否定、重开或停止。main thread 应先从项目文件恢复，再报告当前事实、未决问题、capability route 与一个 next move；不会要求用户重复已保存信息。

native imagegen 由 Codex 调用，Node Runtime 只登记 request/result/inspection/selection。当前 Codex 没有原生视频生成能力时，视频生成必须登记为外部生产依赖，不得虚构结果。

## 8. 证明边界

| 层级 | 可证明内容 | 不可推导内容 |
|---|---|---|
| L0 | code/schema/config/static parity | 工作流正确或创意质量 |
| L1 | role/authority/contract fixtures | 完整项目可恢复运行 |
| L2 | workflow replay、错误注入、恢复 | 真实专业产物质量 |
| L3 | heterogeneous synthetic E2E | 客户、法律、权利或商业成功 |
| L4 | real dogfood projects | 外部独立质量 |
| L5 | blind professional pilot | 真实制作与市场结果 |
| L6 | real production evidence | 无条件商业安全承诺 |

只有 L0-L3 可以由当前本地开发直接关闭。L4-L6 必须保留为真实外部证据缺口。
