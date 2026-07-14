import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  loadFixtures,
  runAllFixtures,
  runFixture,
  validateFixtureRegistry,
} from '../src/tcis/fixture-runner.mjs';

const CATEGORY_COUNTS = Object.freeze({ TM: 8, AU: 6, HI: 12, CR: 12, RO: 15, MR: 10, ST: 10 });
const CATEGORY_NAMES = Object.freeze({
  TM: '术语与项目分型',
  AU: '本地自主与外部边界',
  HI: '人类交互与锁定',
  CR: 'Strategy、Brief 与创意方法',
  RO: '角色与制作时序',
  MR: 'Claims、权利、AI 与实际媒体',
  ST: 'Post、状态与记忆',
});
const EXACT_IDS = Object.freeze(
  Object.entries(CATEGORY_COUNTS).flatMap(([category, count]) =>
    Array.from({ length: count }, (_, index) => `${category}-${String(index + 1).padStart(2, '0')}`),
  ),
);
const EXECUTABLE_CHECK_TYPES = new Set(['contract', 'structural', 'scenario']);
const REQUIRED_ADVERSARIAL_PROBES = new Set([
  'duplicate-platform-executions',
  'first-selection-cannot-confirm-lock',
  'artifact-owner-contract',
  'claim-right-type-separation',
  'right-claim-type-separation',
  'selected-take-requires-media-inspection',
  'ai-take-requires-bound-attempt',
  'canonical-state-hash-derivation',
  'cross-project-artifact-isolation',
  'contained-project-relative-path',
]);

test('registry preserves the exact canonical 73 IDs and category coverage', () => {
  const fixtures = loadFixtures();
  const validation = validateFixtureRegistry(fixtures);
  const ids = fixtures.map((fixture) => fixture.id);

  assert.equal(fixtures.length, 73);
  assert.equal(new Set(ids).size, 73);
  assert.deepEqual(ids, EXACT_IDS);
  assert.deepEqual(validation.categoryCounts, CATEGORY_COUNTS);
  assert.equal(validation.executableCount, 73);
  assert.equal(validation.skippedCount, 0);
  assert.equal(validation.unmappedCount, 0);
});

test('registry exactly preserves every markdown fixture source field', () => {
  const fixtures = loadFixtures();
  const sourceFixtures = parseSourceFixtures();

  assert.equal(sourceFixtures.length, 73);
  assert.deepEqual(sourceFixtures.map((fixture) => fixture.id), EXACT_IDS);
  assert.deepEqual(
    fixtures.map(({ id, category, categoryName, severity, input, expectedBehavior }) => ({
      id,
      category,
      categoryName,
      severity,
      input,
      expectedBehavior,
    })),
    sourceFixtures,
  );
  assert.ok(fixtures.every((fixture) => fixture.inputVersion === '2026-07-11'));
  assert.ok(fixtures.every((fixture) => EXECUTABLE_CHECK_TYPES.has(fixture.check.type)));
});

test('registry validation fails closed on count, IDs, skips, mappings, and vague contract rejects', () => {
  const fixtures = loadFixtures();

  assert.throws(() => validateFixtureRegistry(fixtures.slice(0, -1)), { code: 'FIXTURE_COUNT_MISMATCH' });

  const duplicate = structuredClone(fixtures);
  duplicate[1].id = duplicate[0].id;
  assert.throws(() => validateFixtureRegistry(duplicate), { code: 'DUPLICATE_FIXTURE_ID' });

  const skipped = structuredClone(fixtures);
  skipped[0].skip = true;
  assert.throws(() => validateFixtureRegistry(skipped), { code: 'NON_EXECUTABLE_FIXTURE' });

  const unmapped = structuredClone(fixtures);
  unmapped[0].check.operation = 'notAContract';
  assert.throws(() => validateFixtureRegistry(unmapped), { code: 'UNMAPPED_CONTRACT_OPERATION' });

  const vagueReject = structuredClone(fixtures);
  delete vagueReject[0].check.expectedError;
  assert.throws(() => validateFixtureRegistry(vagueReject), { code: 'EXPECTED_ERROR_REQUIRED' });
});

test('every FATAL fixture and adversarial probe maps to an invoked executable check', () => {
  const fixtures = loadFixtures();
  const fatalFixtures = fixtures.filter((fixture) => fixture.severity === 'FATAL');
  assert.ok(fatalFixtures.length > 0);
  assert.ok(fatalFixtures.every((fixture) => EXECUTABLE_CHECK_TYPES.has(fixture.check.type)));

  const suite = runAllFixtures(fixtures);
  for (const receipt of suite.receipts.filter((candidate) => candidate.severity === 'FATAL')) {
    assert.equal(receipt.actual.invoked, true, receipt.fixtureId);
    assert.equal(receipt.skipped, false, receipt.fixtureId);
    assert.equal(receipt.unmapped, false, receipt.fixtureId);
    assert.equal(receipt.status, 'PASS', receipt.fixtureId);
  }

  const probes = suite.receipts.flatMap((receipt) => receipt.probes);
  assert.deepEqual(new Set(probes.map((probe) => probe.name)), REQUIRED_ADVERSARIAL_PROBES);
  assert.ok(probes.every((probe) => probe.actual.invoked === true));
  assert.ok(probes.every((probe) => probe.passed === true));
});

test('expected-pass and expected-reject semantics are actually invoked', () => {
  const fixtures = loadFixtures();
  const expectedPass = fixtures.filter((fixture) => fixture.expectedOutcome === 'pass');
  const expectedReject = fixtures.filter((fixture) => fixture.expectedOutcome === 'reject');

  assert.ok(expectedPass.length > 0);
  assert.ok(expectedReject.length > 0);
  assert.ok(fixtures.filter((fixture) => fixture.severity === 'PASS PATH').every((fixture) => fixture.expectedOutcome === 'pass'));

  for (const fixture of fixtures) {
    const receipt = runFixture(fixture);
    assert.equal(receipt.actual.invoked, true, fixture.id);
    assert.equal(receipt.actual.outcome, fixture.expectedOutcome, fixture.id);
    assert.equal(receipt.passed, true, fixture.id);
  }

  const inverted = structuredClone(fixtures.find((fixture) => fixture.id === 'TM-01'));
  inverted.expectedOutcome = 'pass';
  const mismatch = runFixture(inverted);
  assert.equal(mismatch.actual.outcome, 'reject');
  assert.equal(mismatch.passed, false);
  assert.deepEqual(mismatch.diff.outcome, { expected: 'pass', actual: 'reject' });
});

test('all fixtures produce deterministic structured receipts with honest validation boundaries', () => {
  const first = runAllFixtures();
  const second = runAllFixtures();

  assert.deepEqual(second, first);
  assert.equal(first.status, 'PASS');
  assert.deepEqual(first.summary, {
    fixtureCount: 73,
    passed: 73,
    failed: 0,
    skipped: 0,
    unmapped: 0,
    failedFixtureIds: [],
  });
  assert.match(first.receiptDigest, /^[0-9a-f]{64}$/);
  assert.equal(first.realWorldValidation, 'NOT_RUN');
  assert.equal(first.commercialValidation, 'NOT_RUN');
  assert.equal(first.commercialProductionReadiness, 'NOT_PROVEN');
  assert.equal(first.receipts.length, 73);
  assert.ok(first.receipts.every((receipt) => receipt.receiptVersion === 'tcis.fixture-receipt.v1'));
  assert.ok(first.receipts.every((receipt) => receipt.commercialValidation === 'NOT_RUN'));
  assert.ok(first.receipts.every((receipt) => receipt.commercialProductionReadiness === 'NOT_PROVEN'));
});

function parseSourceFixtures() {
  const source = readFileSync(
    new URL('../project/specs/tcis-v3-acceptance-fixtures-20260711.md', import.meta.url),
    'utf8',
  );
  const fixtures = [];
  let category = null;

  for (const line of source.split(/\r?\n/)) {
    const heading = line.match(/^## \d+\. (.+)$/);
    if (heading) {
      category = Object.entries(CATEGORY_NAMES).find(([, name]) => name === heading[1])?.[0] ?? null;
      continue;
    }
    const columns = line.split('|').map((value) => value.trim());
    if (columns.length !== 6 || !/^[A-Z]{2}-\d{2}$/.test(columns[1])) continue;
    const id = columns[1];
    assert.ok(category, `Missing source category for ${id}`);
    fixtures.push({
      id,
      category,
      categoryName: CATEGORY_NAMES[category],
      input: columns[2],
      expectedBehavior: columns[3],
      severity: columns[4],
    });
  }
  return fixtures;
}
