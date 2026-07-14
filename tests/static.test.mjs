import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { PRODUCTION_MODES, SCOPE_MODES } from '../src/tcis/contracts.mjs';

const root = path.resolve(import.meta.dirname, '..');

test('every checked-in JSON schema parses and declares draft 2020-12', async () => {
  const schemaDirectory = path.join(root, 'schemas', 'tcis');
  const names = (await readdir(schemaDirectory)).filter((name) => name.endsWith('.json'));
  assert.ok(names.length >= 9, `expected at least 9 schemas, found ${names.length}`);
  for (const name of names) {
    const schema = JSON.parse(await readFile(path.join(schemaDirectory, name), 'utf8'));
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema', name);
    const objectRoot = schema.type === 'object' || (Array.isArray(schema.oneOf) && schema.oneOf.every((branch) => branch.type === 'object'));
    assert.equal(objectRoot, true, `${name} must describe object records`);
  }
});

test('synthetic scenarios cover every scope and production mode', async () => {
  const document = JSON.parse(await readFile(path.join(root, 'fixtures', 'scenarios', 'synthetic-projects.json'), 'utf8'));
  const ids = document.scenarios.map((scenario) => scenario.id);
  assert.equal(new Set(ids).size, ids.length, 'scenario IDs must be unique');
  assert.deepEqual(new Set(document.scenarios.map((scenario) => scenario.scope_mode)), new Set(SCOPE_MODES));
  assert.deepEqual(new Set(document.scenarios.map((scenario) => scenario.production_mode)), new Set(PRODUCTION_MODES));
  for (const scenario of document.scenarios) {
    assert.ok(scenario.proves.length > 0, scenario.id);
    assert.ok(scenario.does_not_prove.length > 0, scenario.id);
  }
});

test('repository text contains no patch or merge markers', async () => {
  const extensions = new Set(['.md', '.json', '.jsonl', '.mjs', '.toml', '.ps1', '.csv', '.yaml', '.yml', '.gitignore']);
  const files = await walk(root);
  for (const file of files) {
    if (path.basename(file) !== '.gitignore' && !extensions.has(path.extname(file))) continue;
    const content = await readFile(file, 'utf8');
    assert.doesNotMatch(content, /^(?:\*\*\* (?:Add|Update|Delete) File:|<<<<<<<|=======|>>>>>>>)/m, path.relative(root, file));
  }
});

test('public package contains no superseded TCIS release files or release claims', async () => {
  const files = await walk(root);
  const legacyPaths = files
    .map((file) => path.relative(root, file).split(path.sep).join('/'))
    .filter((relative) => /(^|\/)(TCIS-v[12][^/]*|[^/]*(?:verification|source-ledger|subagent-synthesis|architecture)[-_]v[12][^/]*)$/i.test(relative));
  assert.deepEqual(legacyPaths, []);

  for (const file of files) {
    if (!['.md', '.json'].includes(path.extname(file))) continue;
    const content = await readFile(file, 'utf8');
    assert.doesNotMatch(content, /\bTCIS\s+v[12]\b|\[SUPERSEDED\s+v[12]\]|(?:^|[^_])architecture_specification\s*=\s*PASS/im, path.relative(root, file));
  }
});

test('public contracts explain user-managed skills and fail visibly when one is missing', async () => {
  const [agents, readme, decisions, architecture] = await Promise.all([
    readFile(path.join(root, 'AGENTS.md'), 'utf8'),
    readFile(path.join(root, 'README.md'), 'utf8'),
    readFile(path.join(root, 'project', 'decisions.md'), 'utf8'),
    readFile(path.join(root, 'TCIS-v3-专业TVC总架构.md'), 'utf8'),
  ]);

  assert.match(agents, /Production skills are user-managed external extensions/);
  assert.match(agents, /exact\s+skill name, why it is needed, the affected step/);
  assert.match(agents, /Pause only\s+the dependent step/);
  assert.match(readme, /main-thread Creative Lead plus 29 generated\s+specialist Agents/);
  assert.match(readme, /create, download, upgrade, skip, or replace/);
  assert.match(readme, /does not silently imitate a missing skill/);
  assert.match(decisions, /Production skills are user-managed external extensions/);
  assert.match(architecture, /不随 TCIS 捆绑、自动安装、锁版本或升级/);
  assert.match(architecture, /不模拟缺失 skill/);
});

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.tcis-tmp' || entry.name === '.git' || entry.name === 'tmp') continue;
    if (directory === path.join(root, 'tasks') && entry.name === 'current') continue;
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(candidate));
    if (entry.isFile()) files.push(candidate);
  }
  return files;
}
