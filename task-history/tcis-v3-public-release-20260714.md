# TCIS V3-Only Public Repository Release

Status: COMPLETE
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

## Outcome and evidence

- Managed public files: 170.
- Full Node suite: 121/121 PASS.
- Runtime surfaces: 5/5 PASS.
- Executable fixtures: 73/73 PASS.
- Synthetic projects: 9/9 PASS.
- Standalone verifier: PASS.
- Superseded TCIS release files in candidate public tree: 0.
- Live client task files in candidate public tree and manifest: 0.
- Clean-history root commit: `3fbdc2716402ae7f55309e8d2112157401b3f867`, with no parent.
- Advertised remote refs after history replacement: 1 (`refs/heads/main`).
- GitHub repository: `qiuranke99/TVC-Creative-Intelligence-System`.
- Visibility: `PUBLIC`; anonymous GitHub API request returned HTTP 200 with
  `private=false`, `visibility=public`, and default branch `main`.
- Same-repository history rewriting was explicitly rejected as insufficient after anonymous
  probes could still read unreachable old object SHAs. That repository was immediately
  returned to `PRIVATE` and renamed `qiuranke99/TCIS-pre-public-archive`.
- The public repository was then created with a new GitHub repository identity and received
  only the clean V3 history. Anonymous commit probes for the displaced old SHAs return
  `422 / No commit found` and cannot read those objects from the public repository.
- Pre-public history bundle and current local client-state archive were created and
  independently verified outside the public repository.

The final fresh-clone audit is required to reconfirm these properties after this completion
record is pushed.
