import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createPeerRuntime, runCli } from '../src/cli.mjs';
import { validateStoreBehavior } from '../src/tcis/runtime-validation.mjs';
import * as storeModule from '../src/tcis/store.mjs';
import { REQUIRED_TESTS, runPreflight } from '../tools/preflight.mjs';

test('validate runs create, load, mutate, integrity, and tamper behavior probes', async () => {
  const receipt = await runCli(['validate']);
  const checks = receipt.result.checks;
  assert.equal(checks.length, 5);
  assert.ok(checks.every((check) => check.passed), JSON.stringify(checks));

  const storeCheck = checks.find((check) => check.name === 'store');
  assert.equal(storeCheck.result.kind, 'tcis.store-runtime-validation.v2');
  const behavior = storeCheck.result.checks.find((check) => check.name === 'behavior').result;
  assert.deepEqual(
    behavior.checks.map((check) => check.name),
    ['create_project', 'load_snapshot', 'mutate_and_reload', 'verify_integrity', 'detect_tampering', 'cleanup'],
  );
  assert.ok(behavior.checks.every((check) => check.passed), JSON.stringify(behavior));
});

test('behavior validation removes its isolated temporary workspace', async (context) => {
  const parent = await mkdtemp(path.join(tmpdir(), 'tcis-runtime-validation-parent-'));
  context.after(() => rm(parent, { recursive: true, force: true }));

  const result = await validateStoreBehavior(storeModule, { temporaryRoot: parent });

  assert.equal(result.passed, true, JSON.stringify(result));
  assert.deepEqual(await readdir(parent), []);
});

test('validate fails when an injected store self-reports valid but create behavior is broken', async () => {
  class BrokenProjectStore extends storeModule.ProjectStore {
    async createProject(_root, spec) {
      return {
        project: {
          ...spec,
          revision: 0,
          state_hash: 'a'.repeat(64),
          manifest_hash: 'b'.repeat(64),
        },
        events: [{ type: 'PROJECT_CREATED' }],
        claims: [],
      };
    }
  }

  const runtime = await createPeerRuntime({
    moduleOverrides: {
      store: {
        ...storeModule,
        ProjectStore: BrokenProjectStore,
        default: BrokenProjectStore,
      },
    },
  });

  await assert.rejects(
    runCli(['validate'], { runtime }),
    (error) => {
      assert.equal(error.code, 'TCIS_VALIDATION_FAILED');
      const storeCheck = error.details.receipt.checks.find((check) => check.name === 'store');
      assert.equal(storeCheck.result.checks.find((check) => check.name === 'interface').passed, true);
      const behavior = storeCheck.result.checks.find((check) => check.name === 'behavior');
      assert.equal(behavior.passed, false);
      assert.equal(behavior.result.checks.some((check) => check.name === 'load_snapshot' && check.passed === false), true);
      assert.equal(behavior.result.checks.at(-1).name, 'cleanup');
      assert.equal(behavior.result.checks.at(-1).passed, true);
      return true;
    },
  );
});

test('preflight rejects empty and non-test required test surfaces', async (context) => {
  const root = await createPreflightFixture(context);
  const target = path.join(root, 'tests', 'runtime-validation.test.mjs');

  assert.equal((await runPreflight({ root })).passed, true);

  await writeFile(target, '', 'utf8');
  const emptyReceipt = await runPreflight({ root });
  assert.equal(emptyReceipt.passed, false);
  assert.deepEqual(emptyReceipt.checks.non_empty_required_test_files.empty, ['runtime-validation.test.mjs']);

  await writeFile(target, "import test from 'node:test';\nexport const placeholder = test;\n", 'utf8');
  const nonTestReceipt = await runPreflight({ root });
  assert.equal(nonTestReceipt.passed, false);
  assert.deepEqual(nonTestReceipt.checks.executable_required_test_surfaces.non_test, ['runtime-validation.test.mjs']);
});

async function createPreflightFixture(context) {
  const root = await mkdtemp(path.join(tmpdir(), 'tcis-preflight-fixture-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  await Promise.all([
    mkdir(path.join(root, 'tests'), { recursive: true }),
    mkdir(path.join(root, 'fixtures', 'acceptance'), { recursive: true }),
    mkdir(path.join(root, '.codex', 'agents'), { recursive: true }),
  ]);

  const testSource = "import test from 'node:test';\ntest('fixture', () => {});\n";
  await Promise.all(REQUIRED_TESTS.map((name) => writeFile(path.join(root, 'tests', name), testSource, 'utf8')));
  await Promise.all(Array.from({ length: 29 }, (_, index) => (
    writeFile(path.join(root, '.codex', 'agents', `agent-${index}.toml`), '', 'utf8')
  )));
  await Promise.all([
    writeFile(
      path.join(root, 'fixtures', 'acceptance', 'registry.json'),
      JSON.stringify(Array.from({ length: 73 }, (_, index) => ({ id: `FIXTURE-${index}` }))),
      'utf8',
    ),
    writeFile(path.join(root, 'package.json'), JSON.stringify({ dependencies: {} }), 'utf8'),
    writeFile(
      path.join(root, '.codex', 'config.toml'),
      'generate_memories = false\nuse_memories = false\n[features]\nmemories = false\n',
      'utf8',
    ),
  ]);
  return root;
}
