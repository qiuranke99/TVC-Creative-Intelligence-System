# TCIS v3 Development And Testing Contract

## Acceptance Loop

```text
implement root contract
-> run focused tests
-> run full suite
-> execute CLI validation/fixtures/demo
-> independent Red Team
-> repair root cause
-> repeat full suite
-> rebuild manifest
-> standalone package verification
```

No average score compensates for a FATAL failure. Any silent lock, role-authority bypass, unsupported claim promotion, cross-project contamination, fake media success, partial semantic commit or generated-agent drift is NO-GO.

## Test Surfaces

| Surface | Evidence |
|---|---|
| L0 static/contracts | JSON parse, shared schema/JS rejection corpus, `x-tcis-*` semantic invariants, config, markers, required files, zero dependencies |
| State | revision/artifact CAS, project lock, WAL-before-content publication, atomic commits, hash chains, rollback/recovery, tamper detection |
| Workflow | proposal/revision/confirmation/lock, conflict, silence, none/reopen, signoffs |
| Router | scope/production branches, professional timing, STOP conditions |
| Capabilities | 17 core + 13 conditional, 29 generated TOMLs, deterministic parity and tamper tests |
| Fixtures | exact 73, 55 FATAL, 0 skipped/unmapped, 10 adversarial probes |
| Media | contained real file, actual bytes/hash, image/container structural validation, MP4 box/track/sample-description checks, independent selection |
| CLI | stable JSON/errors, unsafe input rejection, real filesystem selection-to-lock E2E |
| Synthetic E2E | 9 recovered projects across all scope and production modes |

## Commands

```powershell
npm test
npm run test:unit
npm run test:e2e
npm run validate
npm run fixtures
npm run demo
```

`tools/preflight.mjs` fails before tests if a required test file is absent, fixture count/uniqueness drifts, a fixture is skipped/unmapped, specialist count differs from 29, a runtime dependency is added, or ambient Codex memory is re-enabled.

## Honest Boundary

L0-L3 can pass locally. L4 real dogfood, L5 independent blind professional review and L6 real production/commercial evidence cannot be synthesized by unit tests or same-model agents. They remain separate acceptance programs.

The local safety proof covers TCIS-controlled writers. Node on Windows does not expose an `openat`/directory-handle API that can prove kernel-level containment against an adversarial same-machine process continuously replacing junctions; Runtime therefore combines canonical-path checks, handle-based reads, identity rechecks, atomic create/link publication and project locking, and states the stronger OS-adversary guarantee as out of scope.

Draft 2020-12 schemas are structural handoff contracts. Dynamic comparisons such as `from != to`, clip end within parent timeline, per-type signoff uniqueness and stage-dependent signoff gates use documented `x-tcis-*` keywords in the local schema validator and are always rechecked by canonical JS before persistence. A third-party validator that ignores extension keywords is not an authorization surface.
