# TCIS Runtime Project Template

Use the CLI to materialize a project from this contract. Do not copy a prior
project directory because its IDs, evidence, decisions, rights and attempts are
project-scoped.

```powershell
node D:\TCIS-Codex\bin\tcis.mjs init `
  --root D:\TCIS-Projects\example `
  --id example `
  --title "Example TVC" `
  --scope single_tvc `
  --production live_action
```

The Runtime owns state files and the append-only event log. Creative content is
stored as versioned artifacts. A new Codex thread recovers from the project
directory, not from chat history.

`project.template.json` documents the public project fields. Values in angle
brackets are placeholders and are not a valid initialized project.

