# TCIS V3-Only Public Repository Release

Status: RELEASE_CANDIDATE
Date: 2026-07-14
Owner: Creative Lead main thread

## Objective

Publish the current TCIS V3 product under the GitHub-safe repository slug
`TVC-Creative-Intelligence-System`, make it public, and remove prior TCIS product and
architecture releases from the public tree and reachable Git history.

## Release controls

- Keep the existing GitHub repository private until cleanup and history replacement pass.
- Preserve the pre-public Git history in a verified local-only Git bundle.
- Preserve live local client state separately and exclude `tasks/current/` from Git and
  `MANIFEST.sha256`.
- Remove prior TCIS architecture, research, verification, migration, and task-history
  artifacts from the managed tree.
- Retain independent Runtime schema, receipt, and artifact-revision identifiers without
  pretending they are TCIS product releases.
- Require full tests, Runtime surfaces, manifest verification, remote-ref audit, anonymous
  public metadata access, and a fresh public clone before completion.

## Candidate evidence

- Managed public files: 170.
- Full Node suite: 121/121 PASS.
- Runtime surfaces: 5/5 PASS.
- Executable fixtures: 73/73 PASS.
- Synthetic projects: 9/9 PASS.
- Standalone verifier: PASS.
- Superseded TCIS release files in candidate public tree: 0.
- Live client task files in candidate public tree and manifest: 0.

Final GitHub name, visibility, clean-history ref audit, and anonymous-clone evidence remain
required before this record can become COMPLETE.
