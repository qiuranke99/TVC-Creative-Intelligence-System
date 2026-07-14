# TCIS V3 User-Managed Skill Fallback

Status: COMPLETE
Date: 2026-07-14
Owner: Creative Lead main thread

## Objective

Make the public TCIS package treat production skills as user-managed external extensions
and fail visibly when a routed step needs a missing or incompatible skill.

## Outcome

- Preserved the complete 30-capability / 29-specialist-agent architecture without
  bundling production skills.
- Added one shared Runtime rule to the capability registry and regenerated all 29
  specialist Agent configurations from that canonical source.
- Required TCIS to identify the exact missing skill, its purpose, the affected step,
  whether that step must pause, and which independent work can continue.
- Left create, download, upgrade, skip, or replace decisions with the user.
- Prohibited automatic installation, silent imitation, silent replacement, and false
  success claims for missing-skill output.
- Added public onboarding, architecture, decision, and regression-test coverage.

## Verification

- Full Node suite: 122/122 PASS.
- Capability projection: 30 packages / 29 specialist TOMLs / 91 generated artifacts PASS.
- Runtime surfaces: 5/5 PASS.
- Executable fixtures: 73/73 PASS.
- Synthetic projects: 9/9 PASS.
- Manifest-bound standalone package verifier: PASS.

These results remain bounded L0-L3 evidence and do not establish real-project or
commercial production readiness.
