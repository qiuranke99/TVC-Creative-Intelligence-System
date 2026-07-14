# Local project-state boundary

The public repository contains the TCIS V3 system, not live client projects.

Local deployments may create `tasks/current/ACTIVE.md` and scoped task files under
`tasks/current/`. That directory is intentionally Git-ignored and excluded from
`MANIFEST.sha256` so client names, briefs, decisions, claims, rights, paths, and production
state cannot enter the public package by default.

Project operators remain responsible for an appropriate private backup and access-control
policy for local client state.
