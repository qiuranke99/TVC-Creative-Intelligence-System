# TVC Creative Intelligence System

TCIS V3 is a Codex-native operating system for professional TVC strategy, creative
development, production routing, decision governance, media verification, and recoverable
project state.

## Current verified status

The public V3 snapshot was reaccepted on `2026-07-14` with `121/121` Node tests,
`5/5` Runtime surfaces, `73/73` executable fixtures, `9/9` heterogeneous synthetic
projects, and the manifest-bound standalone verifier.

```text
professional_architecture_specification = PASS
runtime_implementation = PASS
agent_capability_migration = PASS
acceptance_fixture_execution = PASS
synthetic_e2e_validation = PASS
real_project_validation = NOT_RUN
commercial_production_readiness = NOT_PROVEN
```

These states are deliberately separate. Local architecture, Runtime, fixture, and
synthetic-project evidence does not prove real-project performance, independent blind
professional review, legal or rights clearance, physical production feasibility, or
commercial effectiveness.

## Operating model

TCIS V3 uses **AI-active execution + continuous human decision authority + professional
advertising methods**. AI owns research, exploration, drafting, comparison, revision,
synthesis, continuity, verification, state, and handoff labor. Every decision-bearing
artifact follows:

```text
AI proposals -> human selection/advice -> AI revision -> human lock/reopen
```

The default professional route is:

```text
Client Brief
-> Immersion/Diagnosis
-> Communications Strategy
-> Creative Brief
-> Agency Copy/Art Creative Development
-> Core Creative Decision
-> TVC Synopsis/Film Expression
-> Script/Agency Board/Claims
-> Agency Visual Predevelopment
-> Production Pitch
-> Director Treatment/Award
-> PPM
-> Shoot or Generate
-> Offline
-> Finish/Release
```

## Key boundaries

- No D0 form or user-provided API is required for reversible local work.
- External communication, publication, purchases, account use, rights, claims/legal
  clearance, bookings, material budget or schedule changes, safety decisions, and final
  release still require explicit human authority.
- `creative platform` is conditional. A one-off TVC normally locks a film concept or
  advertising idea; a platform must prove a genuine multi-execution need.
- Copywriter and Agency Art Director are the default upstream creative pair. Commercial
  Director, DP, Production Designer, Editor, and other production craft roles enter when
  the active production mode requires them.
- Candidate counts, scores, schemas, prompt success, and agent quantity do not establish
  creative quality. Actual media must be inspected and selected.
- Public source contains the TCIS V3 system, not live client-operational state.
  `tasks/current/` is intentionally local-only and Git-ignored.
- V3-only applies to the TCIS product and architecture release line. Internal schema,
  receipt, and artifact-revision identifiers keep their own independent versions;
  mechanically renumbering those identifiers would falsify their data-contract history.

## Recommended reading order

1. [V3 professional TVC architecture](./TCIS-v3-专业TVC总架构.md)
2. [Active system brief](./project/00_brief.md)
3. [Current decisions](./project/decisions.md)
4. [Stage, role, and decision matrix](./project/specs/professional-tvc-stage-role-decision-matrix-20260711.md)
5. [Human interaction and lock contract](./project/specs/human-interaction-and-lock-contract-20260711.md)
6. [Advertising method and capability architecture](./project/specs/advertising-method-and-agent-capability-architecture-v3-20260711.md)
7. [Professional evidence ledger](./project/evidence/professional-advertising-source-ledger-20260711.md)
8. [Professional architecture synthesis](./project/evidence/subagent-synthesis-professional-rebuild-20260711.md)
9. [V3 non-compensable acceptance fixtures](./project/specs/tcis-v3-acceptance-fixtures-20260711.md)
10. [V3 architecture verification](./project/verification-v3.md)
11. [Runtime architecture](./docs/RUNTIME-ARCHITECTURE.md)
12. [Runtime runbook](./docs/RUNTIME-RUNBOOK.md)
13. [Testing contract](./docs/TESTING.md)
14. [Runtime implementation verification](./project/verification-runtime-v3.md)
15. [Package verification](./PACKAGE-VERIFICATION.md)

## Repository structure

```text
TVC-Creative-Intelligence-System
├── README.md
├── AGENTS.md
├── TCIS-v3-专业TVC总架构.md
├── PACKAGE-VERIFICATION.md
├── MANIFEST.sha256
├── package.json
├── bin/tcis.mjs
├── src/tcis
├── schemas/tcis
├── capabilities                 # 30 canonical capability packages
├── .codex/agents                # 29 generated read-only specialists
├── fixtures
├── tests
├── tools
├── docs
├── project
│   ├── 00_brief.md
│   ├── decisions.md
│   ├── deliverables
│   ├── specs
│   ├── evidence
│   ├── verification-v3.md
│   └── verification-runtime-v3.md
└── tasks
    └── README.md                # public/local project-state boundary
```

## Verify locally

Requires Node.js 24 or later. The Runtime has zero production dependencies.

```powershell
git clone https://github.com/qiuranke99/TVC-Creative-Intelligence-System.git
cd TVC-Creative-Intelligence-System
npm test
npm run validate
npm run fixtures
npm run demo
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools/verify_tcis_package.ps1
```

`MANIFEST.sha256` records every managed package file by relative path, byte count, and
SHA-256. Git metadata, dependencies, caches, logs, generated runtime output, and local
client task state are excluded by contract.
