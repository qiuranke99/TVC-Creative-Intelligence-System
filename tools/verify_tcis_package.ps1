param(
    [switch]$SkipManifest
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$rootPrefix = $root + [System.IO.Path]::DirectorySeparatorChar
$failures = [System.Collections.Generic.List[string]]::new()
$checks = [System.Collections.Generic.List[object]]::new()

function Add-Check {
    param(
        [string]$Name,
        [bool]$Passed,
        [string]$Detail = ''
    )

    $checks.Add([pscustomobject]@{
        check = $Name
        result = if ($Passed) { 'PASS' } else { 'FAIL' }
        detail = $Detail
    })
    if (-not $Passed) {
        $failures.Add("${Name}: ${Detail}")
    }
}

function Get-RelativePathNormalized {
    param([string]$Path)
    $fullPath = [System.IO.Path]::GetFullPath($Path)
    if (-not $fullPath.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Path is outside package root: $fullPath"
    }
    $fullPath.Substring($rootPrefix.Length).Replace('\', '/')
}

function Get-Sha256Hex {
    param([Parameter(Mandatory)][string]$Path)

    $stream = [System.IO.File]::OpenRead($Path)
    $algorithm = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = $algorithm.ComputeHash($stream)
        ([System.BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant()
    }
    finally {
        $algorithm.Dispose()
        $stream.Dispose()
    }
}

$manifestExcludedDirectories = @('.git', 'node_modules', '.tcis-tmp', 'coverage', 'tmp')
$manifestExcludedFiles = @('MANIFEST.sha256', '.DS_Store', 'Thumbs.db', 'Desktop.ini')

function Test-ManifestManagedPath {
    param([Parameter(Mandatory)][string]$RelativePath)

    $normalized = $RelativePath.Replace('\', '/')
    if ($normalized -eq 'tasks/current' -or $normalized.StartsWith('tasks/current/', [System.StringComparison]::OrdinalIgnoreCase)) {
        return $false
    }
    $segments = @($normalized.Split('/'))
    if ($segments.Count -eq 0) {
        return $false
    }
    if ($manifestExcludedFiles -contains $segments[-1]) {
        return $false
    }
    if ($segments[-1].EndsWith('.log', [System.StringComparison]::OrdinalIgnoreCase)) {
        return $false
    }
    for ($index = 0; $index -lt ($segments.Count - 1); $index++) {
        if ($manifestExcludedDirectories -contains $segments[$index]) {
            return $false
        }
    }
    return $true
}

function ConvertTo-ContainedManifestPath {
    param([string]$RelativePath)

    if ([string]::IsNullOrWhiteSpace($RelativePath)) {
        throw 'path is empty'
    }
    if ($RelativePath.Contains('\')) {
        throw 'backslash separators are not allowed'
    }
    if ([System.IO.Path]::IsPathRooted($RelativePath) -or $RelativePath.Contains(':')) {
        throw 'path must be relative'
    }
    if ($RelativePath -match '[\x00-\x1f]') {
        throw 'control characters are not allowed'
    }

    $segments = @($RelativePath.Split('/'))
    if ($segments.Count -eq 0) {
        throw 'path has no segments'
    }
    foreach ($segment in $segments) {
        if ([string]::IsNullOrEmpty($segment) -or $segment -eq '.' -or $segment -eq '..') {
            throw 'path contains an empty, current-directory, or parent-directory segment'
        }
        if ($segment.EndsWith('.') -or $segment.EndsWith(' ')) {
            throw 'path segment has a trailing dot or space'
        }
    }

    $fullPath = [System.IO.Path]::GetFullPath((Join-Path $root $RelativePath))
    if (-not $fullPath.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'path escapes the package root'
    }
    $normalized = Get-RelativePathNormalized $fullPath
    if ($normalized -cne $RelativePath) {
        throw "path is not normalized as '$normalized'"
    }
    $normalized
}

$rootArchitectureCandidates = @(Get-ChildItem -LiteralPath $root -File | Where-Object { $_.Name -like 'TCIS-v3-*.md' })
Add-Check 'root_v3_architecture_count' ($rootArchitectureCandidates.Count -eq 1) "count=$($rootArchitectureCandidates.Count)"
$rootArchitecture = if ($rootArchitectureCandidates.Count -eq 1) { $rootArchitectureCandidates[0].FullName } else { $null }
$rootArchitectureRelative = if ($rootArchitecture) { Get-RelativePathNormalized $rootArchitecture } else { $null }

$required = @(
    'README.md',
    'AGENTS.md',
    'PACKAGE-VERIFICATION.md',
    'package.json',
    '.codex/config.toml',
    'bin/tcis.mjs',
    'src/cli.mjs',
    'src/tcis/contracts.mjs',
    'src/tcis/store.mjs',
    'src/tcis/project-state.mjs',
    'src/tcis/workflow.mjs',
    'src/tcis/router.mjs',
    'src/tcis/fixture-runner.mjs',
    'src/tcis/media-verification.mjs',
    'capabilities/registry.json',
    'capabilities/generated-manifest.json',
    'fixtures/acceptance/registry.json',
    'fixtures/scenarios/synthetic-projects.json',
    'docs/RUNTIME-ARCHITECTURE.md',
    'docs/RUNTIME-RUNBOOK.md',
    'docs/TESTING.md',
    'project/00_brief.md',
    'project/decisions.md',
    'project/deliverables/tcis-v3-professional-tvc-architecture-20260711.md',
    'project/specs/professional-tvc-stage-role-decision-matrix-20260711.md',
    'project/specs/human-interaction-and-lock-contract-20260711.md',
    'project/specs/advertising-method-and-agent-capability-architecture-v3-20260711.md',
    'project/specs/tcis-v3-acceptance-fixtures-20260711.md',
    'project/evidence/professional-advertising-source-ledger-20260711.md',
    'project/evidence/subagent-synthesis-professional-rebuild-20260711.md',
    'project/verification-v3.md',
    'project/verification-runtime-v3.md'
)
if ($rootArchitectureRelative) {
    $required += $rootArchitectureRelative
}

$missing = @($required | Where-Object { -not (Test-Path -LiteralPath (Join-Path $root $_) -PathType Leaf) })
Add-Check 'required_files' ($missing.Count -eq 0) ($missing -join ', ')

$textExtensions = @('.md', '.yaml', '.yml', '.json', '.jsonl', '.toml', '.ps1', '.csv', '.mjs')
$textFiles = @(Get-ChildItem -LiteralPath $root -Recurse -File | Where-Object {
    $relative = Get-RelativePathNormalized $_.FullName
    (Test-ManifestManagedPath $relative) -and ($textExtensions -contains $_.Extension.ToLowerInvariant() -or $_.Name -eq '.gitignore' -or $_.Name -eq '.gitattributes')
})
$utf8Errors = [System.Collections.Generic.List[string]]::new()
$conflictErrors = [System.Collections.Generic.List[string]]::new()
$strictUtf8 = [System.Text.UTF8Encoding]::new($false, $true)

foreach ($file in $textFiles) {
    try {
        $bytes = [System.IO.File]::ReadAllBytes($file.FullName)
        $content = $strictUtf8.GetString($bytes)
        if ($content -match '(?m)^(<<<<<<<|=======|>>>>>>>|[*][*][*] (Add|Update|Delete) File:)') {
            $conflictErrors.Add((Get-RelativePathNormalized $file.FullName))
        }
    }
    catch {
        $utf8Errors.Add("$(Get-RelativePathNormalized $file.FullName): $($_.Exception.Message)")
    }
}

Add-Check 'strict_utf8' ($utf8Errors.Count -eq 0) ($utf8Errors -join '; ')
Add-Check 'merge_conflict_markers' ($conflictErrors.Count -eq 0) ($conflictErrors -join ', ')

$activeMarkdown = @(
    'README.md',
    'AGENTS.md',
    'PACKAGE-VERIFICATION.md',
    'docs/RUNTIME-ARCHITECTURE.md',
    'docs/RUNTIME-RUNBOOK.md',
    'docs/TESTING.md',
    'project/00_brief.md',
    'project/decisions.md',
    'project/deliverables/tcis-v3-professional-tvc-architecture-20260711.md',
    'project/specs/professional-tvc-stage-role-decision-matrix-20260711.md',
    'project/specs/human-interaction-and-lock-contract-20260711.md',
    'project/specs/advertising-method-and-agent-capability-architecture-v3-20260711.md',
    'project/specs/tcis-v3-acceptance-fixtures-20260711.md',
    'project/evidence/professional-advertising-source-ledger-20260711.md',
    'project/evidence/subagent-synthesis-professional-rebuild-20260711.md',
    'project/verification-v3.md',
    'project/verification-runtime-v3.md'
)
if ($rootArchitectureRelative) {
    $activeMarkdown += $rootArchitectureRelative
}

$brokenLinks = [System.Collections.Generic.List[string]]::new()
foreach ($relative in $activeMarkdown) {
    $filePath = Join-Path $root $relative
    if (-not (Test-Path -LiteralPath $filePath -PathType Leaf)) {
        continue
    }

    $content = Get-Content -LiteralPath $filePath -Raw -Encoding UTF8
    foreach ($match in [regex]::Matches($content, '\[[^\]]+\]\(([^)]+)\)')) {
        $target = $match.Groups[1].Value.Trim().Trim('<', '>')
        if ($target -match '^(https?://|mailto:|#)') {
            continue
        }
        $target = ($target -split '#', 2)[0]
        if ([string]::IsNullOrWhiteSpace($target)) {
            continue
        }
        $resolved = [System.IO.Path]::GetFullPath((Join-Path (Split-Path $filePath -Parent) $target))
        if (-not $resolved.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $resolved)) {
            $brokenLinks.Add("${relative} -> ${target}")
        }
    }
}
Add-Check 'local_markdown_links' ($brokenLinks.Count -eq 0) ($brokenLinks -join '; ')

$canonicalArchitecture = Join-Path $root 'project/deliverables/tcis-v3-professional-tvc-architecture-20260711.md'
if ($rootArchitecture -and (Test-Path -LiteralPath $rootArchitecture) -and (Test-Path -LiteralPath $canonicalArchitecture)) {
    $rootHash = Get-Sha256Hex -Path $rootArchitecture
    $canonicalHash = Get-Sha256Hex -Path $canonicalArchitecture
    Add-Check 'root_canonical_architecture_match' ($rootHash -eq $canonicalHash) "root=$rootHash canonical=$canonicalHash"
}

$readme = Get-Content -LiteralPath (Join-Path $root 'README.md') -Raw -Encoding UTF8
$agents = Get-Content -LiteralPath (Join-Path $root 'AGENTS.md') -Raw -Encoding UTF8
$brief = Get-Content -LiteralPath (Join-Path $root 'project/00_brief.md') -Raw -Encoding UTF8
$decisions = Get-Content -LiteralPath (Join-Path $root 'project/decisions.md') -Raw -Encoding UTF8
$codexConfig = Get-Content -LiteralPath (Join-Path $root '.codex/config.toml') -Raw -Encoding UTF8
$architecture = if ($rootArchitecture) { Get-Content -LiteralPath $rootArchitecture -Raw -Encoding UTF8 } else { '' }
$roleMatrix = Get-Content -LiteralPath (Join-Path $root 'project/specs/professional-tvc-stage-role-decision-matrix-20260711.md') -Raw -Encoding UTF8
$fixtures = Get-Content -LiteralPath (Join-Path $root 'project/specs/tcis-v3-acceptance-fixtures-20260711.md') -Raw -Encoding UTF8
Add-Check 'readme_points_to_v3' ($readme -match 'TCIS-v3-.+\.md') ''
Add-Check 'current_status_is_bounded' (
    $readme -match 'professional_architecture_specification = PASS' -and
    $readme -match 'runtime_implementation = PASS' -and
    $readme -match 'agent_capability_migration = PASS' -and
    $readme -match 'acceptance_fixture_execution = PASS' -and
    $readme -match 'synthetic_e2e_validation = PASS' -and
    $readme -match 'real_project_validation = NOT_RUN' -and
    $readme -match 'commercial_production_readiness = NOT_PROVEN'
) ''
Add-Check 'no_d0_or_user_api_requirement' (
    $agents -match 'No D0 form and no user-provided API are required' -and
    $brief -match 'does not provide an API and does not complete a D0 permission form'
) ''
Add-Check 'ambient_memories_disabled' (
    $codexConfig -match 'generate_memories\s*=\s*false' -and
    $codexConfig -match 'use_memories\s*=\s*false' -and
    $codexConfig -match '(?s)\[features\].*?memories\s*=\s*false'
) ''
Add-Check 'human_decision_loop_declared' (
    $agents -match 'AI proposals -> human advice/selection -> AI revision -> human lock/reopen' -and
    $brief -match 'AI proposals -> human selection/advice -> AI revision -> human lock/reopen'
) ''
Add-Check 'public_v3_only_decision_boundary' (
    $decisions -match 'Public repository is a V3-only product surface' -and
    $decisions -match 'live `tasks/current/` client state remains local-only'
) ''
Add-Check 'required_scope_modes_declared' (
    $architecture -match '`single_tvc`' -and
    $architecture -match '`campaign_system`' -and
    $architecture -match '`social_native`' -and
    $architecture -match '`version_system`' -and
    $architecture -match '`live_action`' -and
    $architecture -match '`animation`' -and
    $architecture -match '`ai_native`'
) ''
Add-Check 'creative_platform_is_conditional' (
    $architecture -match 'Platform applicability' -and
    $architecture -match 'Platform Applicability Test' -and
    $architecture -notmatch 'mature mechanism-distinct platforms'
) ''
Add-Check 'professional_role_separation' (
    $roleMatrix -match 'Agency Art Director.{1,80}Production Designer' -and
    $roleMatrix -match 'Agency Producer.{1,80}Production-company Producer' -and
    $roleMatrix -match 'Creative Director.{1,80}Commercial Director' -and
    $roleMatrix -match 'Editor.{1,80}Post Producer'
) ''
$scriptPosition = $roleMatrix.IndexOf('P7 Script / Agency Board')
$treatmentPosition = $roleMatrix.IndexOf('P10 Director Treatment / Award')
Add-Check 'script_precedes_director_treatment' ($scriptPosition -ge 0 -and $treatmentPosition -gt $scriptPosition) "script=$scriptPosition treatment=$treatmentPosition"
$fixtureIds = @([regex]::Matches($fixtures, '(?m)^\| (TM|AU|HI|CR|RO|MR|ST)-[0-9]{2} \|') | ForEach-Object { $_.Value.Trim() } | Select-Object -Unique)
Add-Check 'noncompensable_fixture_coverage' ($fixtureIds.Count -ge 60) "fixture_count=$($fixtureIds.Count)"

$fixtureRegistry = Get-Content -LiteralPath (Join-Path $root 'fixtures/acceptance/registry.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$fixtureRegistryIds = @($fixtureRegistry | ForEach-Object { if ($_.id) { $_.id } elseif ($_.fixture_id) { $_.fixture_id } else { $_.fixtureId } })
$fixtureSkipped = @($fixtureRegistry | Where-Object { $_.skipped -eq $true -or $_.unmapped -eq $true })
Add-Check 'executable_fixture_registry' (
    $fixtureRegistry.Count -eq 73 -and
    (@($fixtureRegistryIds | Sort-Object -Unique).Count -eq 73) -and
    $fixtureSkipped.Count -eq 0
) "count=$($fixtureRegistry.Count) unique=$(@($fixtureRegistryIds | Sort-Object -Unique).Count) skipped_or_unmapped=$($fixtureSkipped.Count)"

$capabilityRegistry = Get-Content -LiteralPath (Join-Path $root 'capabilities/registry.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$coreCount = @($capabilityRegistry.capabilities | Where-Object { $_.portfolio -eq 'core' }).Count
$conditionalCount = @($capabilityRegistry.capabilities | Where-Object { $_.portfolio -eq 'conditional' }).Count
$agentCount = @(Get-ChildItem -LiteralPath (Join-Path $root '.codex/agents') -File -Filter '*.toml').Count
Add-Check 'capability_and_agent_counts' (
    $capabilityRegistry.capabilities.Count -eq 30 -and
    $coreCount -eq 17 -and
    $conditionalCount -eq 13 -and
    $agentCount -eq 29
) "capabilities=$($capabilityRegistry.capabilities.Count) core=$coreCount conditional=$conditionalCount agents=$agentCount"

$packageJson = Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$dependencyCount = if ($packageJson.dependencies) { @($packageJson.dependencies.PSObject.Properties).Count } else { 0 }
$testFiles = @(Get-ChildItem -LiteralPath (Join-Path $root 'tests') -File -Filter '*.test.mjs')
Add-Check 'runtime_test_surface' (
    $dependencyCount -eq 0 -and
    $testFiles.Count -ge 11 -and
    $packageJson.scripts.test -match 'preflight' -and
    $packageJson.scripts.validate -and
    $packageJson.scripts.fixtures -and
    $packageJson.scripts.demo
) "dependencies=$dependencyCount test_files=$($testFiles.Count)"

$legacyReleasePaths = @(Get-ChildItem -LiteralPath $root -Recurse -File | ForEach-Object {
    $relative = Get-RelativePathNormalized $_.FullName
    if ((Test-ManifestManagedPath $relative) -and $relative -match '(?i)(^|/)(TCIS-v[12][^/]*|[^/]*(verification|source-ledger|subagent-synthesis|architecture)[-_]v[12][^/]*)$') {
        $relative
    }
})
Add-Check 'public_tree_has_no_legacy_tcis_release_files' ($legacyReleasePaths.Count -eq 0) ($legacyReleasePaths -join ', ')

if (-not $SkipManifest) {
    $manifestPath = Join-Path $root 'MANIFEST.sha256'
    $manifestErrors = [System.Collections.Generic.List[string]]::new()
    $entries = [System.Collections.Generic.Dictionary[string, object]]::new([System.StringComparer]::OrdinalIgnoreCase)

    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        $manifestErrors.Add('MANIFEST.sha256 missing')
    }
    else {
        foreach ($line in Get-Content -LiteralPath $manifestPath -Encoding UTF8) {
            if ([string]::IsNullOrWhiteSpace($line)) { continue }
            if ($line -notmatch '^([0-9a-f]{64})  ([0-9]+)  (.+)$') {
                $manifestErrors.Add("invalid line: $line")
                continue
            }
            $entryHash = $matches[1]
            $entrySize = [int64]$matches[2]
            $entryPath = $matches[3]
            try {
                $relative = ConvertTo-ContainedManifestPath $entryPath
            }
            catch {
                $manifestErrors.Add("invalid manifest path '$entryPath': $($_.Exception.Message)")
                continue
            }
            if ($entries.ContainsKey($relative)) {
                $manifestErrors.Add("duplicate manifest path: $relative")
                continue
            }
            $entries.Add($relative, [pscustomobject]@{ hash = $entryHash; size = $entrySize })
        }

        $actualFiles = @(Get-ChildItem -LiteralPath $root -Recurse -File | Where-Object {
            $relative = Get-RelativePathNormalized $_.FullName
            Test-ManifestManagedPath $relative
        })
        $actualPaths = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
        foreach ($file in $actualFiles) {
            $relative = Get-RelativePathNormalized $file.FullName
            if (-not $actualPaths.Add($relative)) {
                $manifestErrors.Add("multiple package files normalize to: $relative")
                continue
            }
            if (-not $entries.ContainsKey($relative)) {
                $manifestErrors.Add("missing entry: $relative")
                continue
            }
            $actualHash = Get-Sha256Hex -Path $file.FullName
            if ($entries[$relative].hash -ne $actualHash) {
                $manifestErrors.Add("hash mismatch: $relative")
            }
            if ($entries[$relative].size -ne $file.Length) {
                $manifestErrors.Add("size mismatch: $relative")
            }
        }

        foreach ($relative in $entries.Keys) {
            if (-not $actualPaths.Contains($relative)) {
                $manifestErrors.Add("unexpected entry: $relative")
            }
        }
        if ($entries.Count -ne $actualPaths.Count) {
            $manifestErrors.Add("entry count mismatch: manifest=$($entries.Count) package=$($actualPaths.Count)")
        }
    }
    Add-Check 'manifest_integrity' ($manifestErrors.Count -eq 0) ($manifestErrors -join '; ')
}

$summary = [pscustomobject]@{
    package_root = $root
    verdict = if ($failures.Count -eq 0) { 'PASS' } else { 'FAIL' }
    checks = $checks
    failures = $failures
}

$summary | ConvertTo-Json -Depth 6
if ($failures.Count -gt 0) {
    exit 1
}
