#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REQUIRED_TESTS = Object.freeze([
  'capabilities.test.mjs', 'cli.test.mjs', 'contracts.test.mjs', 'e2e.test.mjs', 'fixtures.test.mjs',
  'media.test.mjs', 'runtime-validation.test.mjs', 'schema-parity.test.mjs', 'state.test.mjs',
  'static.test.mjs', 'workflow.test.mjs',
]);

export async function runPreflight({ root = defaultRoot } = {}) {
  const testDirectory = path.join(root, 'tests');
  const actualTests = new Set((await readdir(testDirectory)).filter((name) => name.endsWith('.test.mjs')));
  const missingTests = REQUIRED_TESTS.filter((name) => !actualTests.has(name));
  const presentTests = REQUIRED_TESTS.filter((name) => actualTests.has(name));
  const testSources = await Promise.all(presentTests.map(async (name) => [name, await readFile(path.join(testDirectory, name), 'utf8')]));
  const emptyTests = testSources.filter(([, source]) => source.trim().length === 0).map(([name]) => name);
  const nonTestSurfaces = testSources
    .filter(([, source]) => source.trim().length > 0 && !hasExecutableNodeTest(source))
    .map(([name]) => name);

  const registry = JSON.parse(await readFile(path.join(root, 'fixtures', 'acceptance', 'registry.json'), 'utf8'));
  const fixtureIds = registry.map((fixture) => fixture.id ?? fixture.fixture_id ?? fixture.fixtureId);
  const agentFiles = (await readdir(path.join(root, '.codex', 'agents'))).filter((name) => name.endsWith('.toml'));
  const packageDocument = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const codexConfig = await readFile(path.join(root, '.codex', 'config.toml'), 'utf8');
  const checks = {
    required_test_files: { passed: missingTests.length === 0, missing: missingTests },
    non_empty_required_test_files: { passed: emptyTests.length === 0, empty: emptyTests },
    executable_required_test_surfaces: { passed: nonTestSurfaces.length === 0, non_test: nonTestSurfaces },
    exact_fixture_count: { passed: registry.length === 73, actual: registry.length, expected: 73 },
    unique_fixture_ids: { passed: new Set(fixtureIds).size === 73, actual: new Set(fixtureIds).size, expected: 73 },
    no_fixture_skip_or_unmapped: { passed: registry.every((fixture) => fixture.skipped !== true && fixture.unmapped !== true) },
    specialist_agent_count: { passed: agentFiles.length === 29, actual: agentFiles.length, expected: 29 },
    zero_runtime_dependencies: { passed: Object.keys(packageDocument.dependencies ?? {}).length === 0, actual: Object.keys(packageDocument.dependencies ?? {}) },
    ambient_memories_disabled: {
      passed: /generate_memories\s*=\s*false/.test(codexConfig)
        && /use_memories\s*=\s*false/.test(codexConfig)
        && /\[features\][\s\S]*?memories\s*=\s*false/.test(codexConfig),
    },
  };
  return {
    kind: 'tcis.test-preflight.v2',
    passed: Object.values(checks).every((check) => check.passed),
    checks,
  };
}

function hasExecutableNodeTest(source) {
  const bindings = importedNodeTestBindings(source);
  return bindings.some((binding) => {
    const escaped = binding.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|\\n)\\s*${escaped}(?:\\.only)?\\s*\\(`, 'm').test(source);
  });
}

function importedNodeTestBindings(source) {
  const bindings = [];
  for (const match of source.matchAll(/import\s+([^;]+?)\s+from\s+['"]node:test['"]/g)) {
    const clause = match[1].trim();
    const defaultBinding = clause.match(/^([A-Za-z_$][\w$]*)(?:\s*,|$)/)?.[1];
    if (defaultBinding) bindings.push(defaultBinding);
    const namedBlock = clause.match(/\{([^}]+)\}/)?.[1];
    if (!namedBlock) continue;
    for (const entry of namedBlock.split(',')) {
      const named = entry.trim().match(/^test(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
      if (named) bindings.push(named[1] ?? 'test');
    }
  }
  return bindings;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const receipt = await runPreflight();
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
  if (!receipt.passed) process.exitCode = 1;
}
