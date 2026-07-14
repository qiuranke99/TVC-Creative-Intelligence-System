# TCIS v3 Runtime Runbook

## 1. 在 Codex 中使用

把 `D:\TCIS-Codex` 作为 Codex 项目文件夹打开。直接用自然语言启动：

```text
启动 TCIS v3。读取当前项目文件，恢复状态，完成当前阶段全部前置工作，只把成熟决策包和一个明确推荐给我。
```

用户不需要记命令、填写 D0 或提供 API。main thread 应从 canonical files 恢复，调用当前阶段的 owner/advisor/challenger，完成研究、发散、比较、修订和检查，再提交 1-4 个成熟选项。

用户可直接回复：

```text
选择 A，但产品 proof 必须更早出现。
全部不选，继续发散。
重开 creative brief，因为目标受众变了。
确认锁定这个修订版。
停止，不进入真实制作。
```

第一次选择只能进入 AI revision；只有用户看到修订版并确认其 exact hash 后才能锁定。沉默不批准，`NONE` 与 `REOPEN` 始终有效。

`LOCKED` 没有通用状态捷径：直接 create/transition、单独追加 LOCK feedback、lock record 或 LOCK decision 都会失败。编排层必须调用 `commitLock`，一次性写入 confirmation feedback、lock record、decision 和 artifact status。

## 2. CLI 角色

CLI 是 Codex 编排的确定性底座，也可用于诊断和自动测试：

```text
init, status, next, propose, feedback, confirm-lock, reopen,
register-claim, register-right, request-attempt, inspect-attempt,
select-attempt, validate, run-fixtures, demo
```

查看帮助：

```powershell
node D:\TCIS-Codex\bin\tcis.mjs --help
node D:\TCIS-Codex\bin\tcis.mjs help propose
```

初始化项目：

```json
{
  "project_id": "PRJ-DEMO-001",
  "title": "Demo TVC",
  "scope_mode": "single_tvc",
  "production_mode": "live_action"
}
```

```powershell
node D:\TCIS-Codex\bin\tcis.mjs init `
  --project D:\TCIS-Projects\PRJ-DEMO-001 `
  --input D:\TCIS-Projects\init.json
```

读取与路由：

```powershell
node D:\TCIS-Codex\bin\tcis.mjs status --project D:\TCIS-Projects\PRJ-DEMO-001
node D:\TCIS-Codex\bin\tcis.mjs next --project D:\TCIS-Projects\PRJ-DEMO-001
```

所有写命令必须带 project revision；artifact 写命令还必须带 version/hash：

```powershell
node D:\TCIS-Codex\bin\tcis.mjs propose `
  --project D:\TCIS-Projects\PRJ-DEMO-001 `
  --input D:\TCIS-Projects\proposal.json `
  --expected-revision 2 `
  --expected-version 1 `
  --expected-hash <64-hex-artifact-hash>
```

CLI 只输出稳定 JSON。typed error 写到 stderr 并返回非零 exit code。

## 3. 图片与视频

Codex native imagegen 由 main thread 直接调用，不需要用户 API。Runtime 只登记 request、reference、actual output path/hash、inspection 和 selection。

- prompt/tool success 不是 media success；
- selected media 必须是项目内真实文件并通过字节 hash 与结构检查；
- MP4 必须通过 ISO-BMFF box、track、handler、sample-description 与非空 media-data 检查；这仍是本地结构验证，不冒充逐帧专业 QC；
- AI take 必须绑定 generation attempt；
- 用户选择实际图像/视频，不选择不可见的调用状态；
- 当前 Codex 没有原生视频生成能力时，登记外部生产依赖，不虚构视频。

## 4. 恢复与并发

新 Codex 线程只需打开同一项目目录。Runtime 从 `project.json`、immutable revision、interaction/event/attempt/decision ledgers 和 artifact files 恢复，不依赖聊天摘要。

- stale revision 返回 CAS conflict；
- 同一 revision 只允许一个 writer；
- proposal、feedback+revision、lock+decision 是原子 interaction commit；
- WAL 在 artifact 内容发布前建立；中断恢复只得到完整旧状态或完整新状态，并清理未提交的事务内容；
- reopen 只使受影响后代 `STALE`。

项目配置关闭 ambient Codex memories，避免 prior-client 内容进入新项目。跨项目可复用知识只能通过显式、受治理的 repository capability/knowledge surface 进入，不能从聊天记忆自动晋升。

## 5. 验证

```powershell
cd D:\TCIS-Codex
npm test
npm run validate
npm run fixtures
npm run demo
npm run manifest
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\verify_tcis_package.ps1
```

`validate` 执行 store、workflow、router、capability parity 和 fixture registry 五个检查。`fixtures` 执行 73 个 non-compensable bounded checks（13 contract、55 scenario、5 structural）。`demo` 执行 9 个异构 synthetic routes，并明确哪些内容不能被推导为商业证明。

## 6. 不可自动宣称

以下状态必须由真实外部证据关闭：客户批准、legal/claims clearance、rights acquisition、vendor bid、预算准确性、真实拍摄、最终 master、外部盲审和商业结果。当前本地 PASS 不替代这些证据。
