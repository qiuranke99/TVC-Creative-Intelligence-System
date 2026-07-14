import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

import * as contracts from './contracts.mjs';
import * as projectState from './project-state.mjs';
import * as router from './router.mjs';
import { sha256, stableStringify } from './utils.mjs';
import * as workflow from './workflow.mjs';

const DEFAULT_REGISTRY_URL = new URL('../../fixtures/acceptance/registry.json', import.meta.url);
const DEFAULT_SCENARIOS_URL = new URL('../../fixtures/scenarios/synthetic-projects.json', import.meta.url);
const RECEIPT_VERSION = 'tcis.fixture-receipt.v1';
const SUITE_RECEIPT_VERSION = 'tcis.fixture-suite-receipt.v1';

const CATEGORY_DEFINITIONS = Object.freeze({
  TM: Object.freeze({ name: '术语与项目分型', count: 8 }),
  AU: Object.freeze({ name: '本地自主与外部边界', count: 6 }),
  HI: Object.freeze({ name: '人类交互与锁定', count: 12 }),
  CR: Object.freeze({ name: 'Strategy、Brief 与创意方法', count: 12 }),
  RO: Object.freeze({ name: '角色与制作时序', count: 15 }),
  MR: Object.freeze({ name: 'Claims、权利、AI 与实际媒体', count: 10 }),
  ST: Object.freeze({ name: 'Post、状态与记忆', count: 10 }),
});

const CANONICAL_IDS = Object.freeze(
  Object.entries(CATEGORY_DEFINITIONS).flatMap(([category, definition]) =>
    Array.from({ length: definition.count }, (_, index) => `${category}-${String(index + 1).padStart(2, '0')}`),
  ),
);

const ALLOWED_SEVERITIES = new Set(['FATAL', 'HIGH', 'MEDIUM', 'PASS PATH']);
const ALLOWED_OUTCOMES = new Set(['pass', 'reject']);
const ALLOWED_CHECK_TYPES = new Set(['contract', 'structural', 'scenario']);
const ASSERTION_OPERATORS = new Set([
  'all-present',
  'all-true',
  'allowed-value',
  'count-at-most',
  'disjoint',
  'distinct',
  'equals',
  'exact-set',
  'implication',
  'subset',
  'unique-count-at-least',
]);
const STRUCTURAL_OPERATIONS = new Set(['artifact-owner', 'stages-in-order']);
const MODULES = Object.freeze({ contracts, 'project-state': projectState, router, workflow });

const EXTERNAL_OR_REAL_WORLD_FIXTURES = new Set([
  'AU-03',
  'AU-04',
  'AU-06',
  'CR-10',
  'RO-05',
  'RO-15',
  'MR-01',
  'MR-02',
  'MR-03',
  'MR-04',
  'MR-05',
  'MR-06',
  'MR-07',
  'MR-08',
  'MR-09',
  'MR-10',
  'ST-01',
  'ST-02',
  'ST-07',
  'ST-10',
]);

export function loadFixtures(registryPath = DEFAULT_REGISTRY_URL) {
  const fixtures = JSON.parse(readFileSync(registryPath, 'utf8'));
  validateFixtureRegistry(fixtures);
  return structuredClone(fixtures);
}

export function validateFixtureRegistry(fixtures) {
  if (!Array.isArray(fixtures)) {
    throw registryError('FIXTURE_REGISTRY_ARRAY_REQUIRED', 'The acceptance fixture registry must be an array.');
  }
  if (fixtures.length !== CANONICAL_IDS.length) {
    throw registryError(
      'FIXTURE_COUNT_MISMATCH',
      `The acceptance fixture registry must contain exactly ${CANONICAL_IDS.length} fixtures.`,
      { expected: CANONICAL_IDS.length, actual: fixtures.length },
    );
  }

  const ids = fixtures.map((fixture, index) => validateFixtureRecord(fixture, index));
  const uniqueIds = new Set(ids);
  if (uniqueIds.size !== ids.length) {
    throw registryError('DUPLICATE_FIXTURE_ID', 'Every acceptance fixture ID must be unique.');
  }

  const missing = CANONICAL_IDS.filter((id) => !uniqueIds.has(id));
  const extra = ids.filter((id) => !CANONICAL_IDS.includes(id));
  if (missing.length > 0 || extra.length > 0) {
    throw registryError('FIXTURE_ID_SET_MISMATCH', 'The registry must contain the exact canonical 73 fixture IDs.', {
      missing,
      extra,
    });
  }

  const categoryCounts = Object.fromEntries(Object.keys(CATEGORY_DEFINITIONS).map((category) => [category, 0]));
  const severityCounts = {};
  const checkTypeCounts = {};
  let probeCount = 0;
  for (const fixture of fixtures) {
    categoryCounts[fixture.category] += 1;
    severityCounts[fixture.severity] = (severityCounts[fixture.severity] ?? 0) + 1;
    checkTypeCounts[fixture.check.type] = (checkTypeCounts[fixture.check.type] ?? 0) + 1;
    probeCount += fixture.check.probes?.length ?? 0;
  }
  for (const [category, definition] of Object.entries(CATEGORY_DEFINITIONS)) {
    if (categoryCounts[category] !== definition.count) {
      throw registryError('FIXTURE_CATEGORY_COUNT_MISMATCH', `Category ${category} must contain ${definition.count} fixtures.`, {
        category,
        expected: definition.count,
        actual: categoryCounts[category],
      });
    }
  }

  return Object.freeze({
    valid: true,
    fixtureCount: fixtures.length,
    uniqueIdCount: uniqueIds.size,
    executableCount: fixtures.length,
    unmappedCount: 0,
    skippedCount: 0,
    probeCount,
    categoryCounts: Object.freeze(categoryCounts),
    severityCounts: Object.freeze(severityCounts),
    checkTypeCounts: Object.freeze(checkTypeCounts),
  });
}

export function runFixture(fixtureOrId, fixtures = undefined) {
  const fixture = resolveFixture(fixtureOrId, fixtures);
  validateFixtureRecord(fixture, 0);

  let actual;
  try {
    actual = executeCheck(fixture.check);
  } catch (error) {
    actual = executionFailure(error);
  }
  const primaryMatch = matchExpectation(fixture.expectedOutcome, fixture.check, actual);

  const probes = (fixture.check.probes ?? []).map((probe, index) => {
    let probeActual;
    try {
      probeActual = executeCheck(probe);
    } catch (error) {
      probeActual = executionFailure(error);
    }
    const match = matchExpectation(probe.expectedOutcome, probe, probeActual);
    return Object.freeze({
      probeIndex: index,
      name: probe.name,
      route: checkRoute(probe),
      expected: expectedReceipt(probe.expectedOutcome, probe),
      actual: probeActual,
      passed: match.passed,
      diff: match.diff,
    });
  });

  const passed = primaryMatch.passed && probes.every((probe) => probe.passed);
  const receipt = {
    receiptVersion: RECEIPT_VERSION,
    fixtureId: fixture.id,
    inputVersion: fixture.inputVersion,
    category: Object.freeze({ code: fixture.category, name: fixture.categoryName }),
    severity: fixture.severity,
    verificationScope: 'BOUNDED_EXECUTABLE_CHECK',
    realWorldValidation: EXTERNAL_OR_REAL_WORLD_FIXTURES.has(fixture.id) ? 'NOT_RUN' : 'NOT_APPLICABLE',
    commercialValidation: 'NOT_RUN',
    commercialProductionReadiness: 'NOT_PROVEN',
    route: checkRoute(fixture.check),
    expected: Object.freeze({
      behavior: fixture.expectedBehavior,
      ...expectedReceipt(fixture.expectedOutcome, fixture.check),
    }),
    actual,
    probes: Object.freeze(probes),
    decisionPackets: Object.freeze(decisionPacketEvidence(fixture.check)),
    artifacts: Object.freeze(artifactEvidence(fixture.check)),
    stateChanges: Object.freeze(stateChangeEvidence(fixture.check, actual)),
    skipped: false,
    unmapped: false,
    passed,
    status: passed ? 'PASS' : 'FAIL',
    diff: primaryMatch.diff,
    regression: passed ? 'PASS' : 'FAIL',
  };
  return Object.freeze(receipt);
}

export function runAllFixtures(fixtures = loadFixtures()) {
  const registry = validateFixtureRegistry(fixtures);
  const receipts = fixtures.map((fixture) => runFixture(fixture));
  const failedFixtureIds = receipts.filter((receipt) => !receipt.passed).map((receipt) => receipt.fixtureId);
  const skipped = receipts.filter((receipt) => receipt.skipped).length;
  const unmapped = receipts.filter((receipt) => receipt.unmapped).length;
  const passed = receipts.length - failedFixtureIds.length;
  const status = failedFixtureIds.length === 0 && skipped === 0 && unmapped === 0 ? 'PASS' : 'FAIL';

  const summary = {
    fixtureCount: receipts.length,
    passed,
    failed: failedFixtureIds.length,
    skipped,
    unmapped,
    failedFixtureIds,
  };
  return Object.freeze({
    receiptVersion: SUITE_RECEIPT_VERSION,
    status,
    verificationScope: 'BOUNDED_EXECUTABLE_FIXTURE_SUITE',
    runtimeImplementation: status === 'PASS' ? 'FIXTURE_SUITE_PASS' : 'FIXTURE_SUITE_FAIL',
    realWorldValidation: 'NOT_RUN',
    commercialValidation: 'NOT_RUN',
    commercialProductionReadiness: 'NOT_PROVEN',
    registry,
    summary: Object.freeze(summary),
    receipts: Object.freeze(receipts),
    receiptDigest: sha256(stableStringify(receipts)),
  });
}

export function runDemo(scenariosPath = DEFAULT_SCENARIOS_URL) {
  if (typeof scenariosPath !== 'string' && !(scenariosPath instanceof URL)) scenariosPath = DEFAULT_SCENARIOS_URL;
  const document = JSON.parse(readFileSync(scenariosPath, 'utf8'));
  const receipts = document.scenarios.map((scenario) => {
    const project = demoProject(scenario);
    const artifacts = demoLockedPrerequisites(project, scenario.start_stage);
    const route = router.routeCapabilities({ project, artifacts });
    const expectedPlatform = scenario.platform_action === 'TEST_NEW_PLATFORM'
      ? 'CREATE'
      : scenario.platform_action === 'INHERIT_EXISTING_PLATFORM' ? 'INHERIT' : 'NOT_APPLICABLE';
    const checks = {
      owner: route.owner_capability === scenario.expected_primary_capability,
      disposition: route.disposition === scenario.expected_disposition,
      platform: route.scope_branch.platform === expectedPlatform,
      hard_block: scenario.expected_hard_block
        ? route.hard_blocks.some((block) => block.code === scenario.expected_hard_block)
        : route.hard_blocks.length === 0,
    };
    return {
      scenario_id: scenario.id,
      passed: Object.values(checks).every(Boolean),
      checks,
      route: {
        owner_capability: route.owner_capability,
        disposition: route.disposition,
        platform: route.scope_branch.platform,
        hard_blocks: route.hard_blocks.map((block) => block.code),
      },
      proves: scenario.proves,
      does_not_prove: scenario.does_not_prove,
    };
  });
  const passed = receipts.every((receipt) => receipt.passed);
  const summary = { scenario_count: receipts.length, passed: receipts.filter((receipt) => receipt.passed).length, failed: receipts.filter((receipt) => !receipt.passed).length };
  return {
    receiptVersion: 'tcis.synthetic-demo-receipt.v1',
    status: passed ? 'PASS' : 'FAIL',
    passed,
    summary,
    receipts,
    realWorldValidation: 'NOT_RUN',
    commercialProductionReadiness: 'NOT_PROVEN',
    receiptDigest: sha256(stableStringify({ summary, receipts })),
  };
}

export const demo = runDemo;

function demoProject(scenario) {
  return {
    schema_version: contracts.SCHEMA_VERSION,
    project_id: scenario.id,
    title: scenario.title,
    scope_mode: scenario.scope_mode,
    production_mode: scenario.production_mode,
    current_stage: scenario.start_stage,
    status: 'ACTIVE',
    revision: 0,
    active_artifact_id: null,
    created_at: '2026-07-11T00:00:00.000Z',
    updated_at: '2026-07-11T00:00:00.000Z',
  };
}

function demoLockedPrerequisites(project, startStage) {
  const startIndex = contracts.STAGES.indexOf(startStage);
  return contracts.STAGES.slice(0, startIndex).map((stage, index) => {
    const type = contracts.STAGE_ARTIFACT[stage];
    const definition = contracts.ARTIFACT_DEFINITIONS[type];
    return {
      schema_version: contracts.SCHEMA_VERSION,
      project_id: project.project_id,
      artifact_id: `ART-${String(index).padStart(2, '0')}`,
      type,
      stage,
      status: 'LOCKED',
      version: 1,
      owner_capability: definition.owner_capability,
      decision_bearing: true,
      input_artifact_ids: [],
      path: `artifacts/${String(index).padStart(2, '0')}.md`,
      content_hash: sha256(`${project.project_id}:${stage}`),
      previous_version_id: null,
      created_at: project.created_at,
      updated_at: project.updated_at,
    };
  });
}

function validateFixtureRecord(fixture, index) {
  requireRecord(fixture, `fixtures[${index}]`);
  for (const field of ['id', 'category', 'categoryName', 'severity', 'inputVersion', 'input', 'expectedBehavior', 'expectedOutcome']) {
    requireNonEmptyString(fixture[field], `fixtures[${index}].${field}`);
  }
  if (fixture.skip === true || fixture.skipped === true || fixture.disabled === true || fixture.documentationOnly === true) {
    throw registryError('NON_EXECUTABLE_FIXTURE', `Fixture ${fixture.id} cannot be skipped, disabled, or documentation-only.`);
  }
  if (!/^[A-Z]{2}-\d{2}$/.test(fixture.id)) {
    throw registryError('INVALID_FIXTURE_ID', `Invalid fixture ID: ${fixture.id}`);
  }
  const definition = CATEGORY_DEFINITIONS[fixture.category];
  if (!definition || !fixture.id.startsWith(`${fixture.category}-`)) {
    throw registryError('FIXTURE_CATEGORY_MISMATCH', `Fixture ${fixture.id} has an invalid category ${fixture.category}.`);
  }
  if (fixture.categoryName !== definition.name) {
    throw registryError('FIXTURE_CATEGORY_NAME_MISMATCH', `Fixture ${fixture.id} does not preserve its category name.`);
  }
  if (!ALLOWED_SEVERITIES.has(fixture.severity)) {
    throw registryError('INVALID_FIXTURE_SEVERITY', `Fixture ${fixture.id} has invalid severity ${fixture.severity}.`);
  }
  if (!ALLOWED_OUTCOMES.has(fixture.expectedOutcome)) {
    throw registryError('INVALID_EXPECTED_OUTCOME', `Fixture ${fixture.id} must expect pass or reject.`);
  }
  validateCheck(fixture.check, `fixture ${fixture.id}`, fixture.expectedOutcome, false);
  return fixture.id;
}

function validateCheck(check, path, expectedOutcome, isProbe) {
  requireRecord(check, `${path}.check`);
  if (!ALLOWED_CHECK_TYPES.has(check.type)) {
    throw registryError('UNMAPPED_CHECK_TYPE', `${path} has unsupported check type ${check.type ?? '<missing>'}.`);
  }
  if (check.skip === true || check.skipped === true || check.documentationOnly === true) {
    throw registryError('NON_EXECUTABLE_CHECK', `${path} contains a skipped or documentation-only check.`);
  }
  if (isProbe) {
    requireNonEmptyString(check.name, `${path}.name`);
    if (!ALLOWED_OUTCOMES.has(check.expectedOutcome)) {
      throw registryError('INVALID_EXPECTED_OUTCOME', `${path} probe must expect pass or reject.`);
    }
  }

  if (check.type === 'contract') {
    const moduleName = check.module ?? 'contracts';
    const module = MODULES[moduleName];
    if (!module || typeof module[check.operation] !== 'function') {
      throw registryError('UNMAPPED_CONTRACT_OPERATION', `${path} maps to unknown operation ${moduleName}#${check.operation}.`);
    }
    if (!Array.isArray(check.arguments)) {
      throw registryError('CONTRACT_ARGUMENTS_REQUIRED', `${path} contract arguments must be an array.`);
    }
    if (expectedOutcome === 'reject' && typeof check.expectedError !== 'string') {
      throw registryError('EXPECTED_ERROR_REQUIRED', `${path} rejecting contract check requires an exact expectedError.`);
    }
    if (check.expectedErrorPath !== undefined) requireNonEmptyString(check.expectedErrorPath, `${path}.expectedErrorPath`);
  } else if (check.type === 'structural') {
    if (!STRUCTURAL_OPERATIONS.has(check.operation)) {
      throw registryError('UNMAPPED_STRUCTURAL_OPERATION', `${path} maps to unknown structural operation ${check.operation}.`);
    }
  } else {
    requireNonEmptyString(check.scenario, `${path}.scenario`);
    requireRecord(check.assertion, `${path}.assertion`);
    if (!ASSERTION_OPERATORS.has(check.assertion.operator)) {
      throw registryError('UNMAPPED_SCENARIO_ASSERTION', `${path} maps to unknown assertion ${check.assertion.operator}.`);
    }
    requireNonEmptyString(check.onPass, `${path}.onPass`);
    requireNonEmptyString(check.onReject, `${path}.onReject`);
    requireNonEmptyString(check.expectedDecision, `${path}.expectedDecision`);
  }

  if (check.probes !== undefined) {
    if (isProbe) throw registryError('NESTED_PROBES_FORBIDDEN', `${path} cannot contain nested probes.`);
    if (!Array.isArray(check.probes)) throw registryError('INVALID_PROBE_LIST', `${path}.probes must be an array.`);
    check.probes.forEach((probe, index) => validateCheck(probe, `${path}.probes[${index}]`, probe.expectedOutcome, true));
  }
}

function resolveFixture(fixtureOrId, fixtures) {
  if (typeof fixtureOrId !== 'string') return fixtureOrId;
  const registry = fixtures ?? loadFixtures();
  if (!Array.isArray(registry)) throw registryError('FIXTURE_REGISTRY_ARRAY_REQUIRED', 'Fixture lookup requires an array registry.');
  const fixture = registry.find((candidate) => candidate.id === fixtureOrId);
  if (!fixture) throw registryError('UNKNOWN_FIXTURE_ID', `Unknown fixture ID: ${fixtureOrId}`);
  return fixture;
}

function executeCheck(check) {
  switch (check.type) {
    case 'contract':
      return executeContract(check);
    case 'structural':
      return executeStructural(check);
    case 'scenario':
      return executeScenario(check);
    default:
      throw registryError('UNMAPPED_CHECK_TYPE', `Unsupported check type: ${check.type}`);
  }
}

function executeContract(check) {
  const moduleName = check.module ?? 'contracts';
  const operation = MODULES[moduleName]?.[check.operation];
  if (typeof operation !== 'function') {
    throw registryError('UNMAPPED_CONTRACT_OPERATION', `Unknown contract operation ${moduleName}#${check.operation}.`);
  }
  try {
    const result = operation(...structuredClone(check.arguments));
    return Object.freeze({
      outcome: 'pass',
      decision: 'CONTRACT_ACCEPTED',
      invoked: true,
      target: `${moduleName}#${check.operation}`,
      result: summarizeResult(result),
    });
  } catch (error) {
    return Object.freeze({
      outcome: 'reject',
      decision: 'CONTRACT_REJECTED',
      invoked: true,
      target: `${moduleName}#${check.operation}`,
      error: normalizeError(error),
    });
  }
}

function executeStructural(check) {
  if (check.operation === 'artifact-owner') {
    const definition = contracts.ARTIFACT_DEFINITIONS[check.artifactType];
    if (!definition) throw registryError('UNKNOWN_ARTIFACT_TYPE', `Unknown structural artifact type ${check.artifactType}.`);
    const accepted = definition.owner_capability === check.attemptedOwner;
    return Object.freeze({
      outcome: accepted ? 'pass' : 'reject',
      decision: accepted ? 'STRUCTURE_CONFIRMED' : 'STRUCTURE_REJECTED',
      invoked: true,
      target: `ARTIFACT_DEFINITIONS.${check.artifactType}.owner_capability`,
      evidence: Object.freeze({ expectedOwner: definition.owner_capability, attemptedOwner: check.attemptedOwner }),
    });
  }
  if (check.operation === 'stages-in-order') {
    const indexes = check.stages.map((stage) => contracts.stageIndex(stage));
    const accepted = indexes.every((value, index) => index === 0 || indexes[index - 1] < value);
    return Object.freeze({
      outcome: accepted ? 'pass' : 'reject',
      decision: accepted ? 'STRUCTURE_CONFIRMED' : 'STRUCTURE_REJECTED',
      invoked: true,
      target: 'contracts#stageIndex',
      evidence: Object.freeze({ stages: structuredClone(check.stages), indexes }),
    });
  }
  throw registryError('UNMAPPED_STRUCTURAL_OPERATION', `Unknown structural operation ${check.operation}.`);
}

function executeScenario(check) {
  const evaluation = evaluateAssertion(check.assertion);
  return Object.freeze({
    outcome: evaluation.accepted ? 'pass' : 'reject',
    decision: evaluation.accepted ? check.onPass : check.onReject,
    invoked: true,
    target: `scenario:${check.scenario}/${check.assertion.operator}`,
    evidence: evaluation.evidence,
  });
}

function evaluateAssertion(assertion) {
  switch (assertion.operator) {
    case 'equals': {
      const accepted = isDeepStrictEqual(assertion.actual, assertion.expected);
      return evaluation(accepted, { actual: assertion.actual, expected: assertion.expected });
    }
    case 'all-present': {
      const present = new Set(assertion.present);
      const missing = assertion.required.filter((value) => !present.has(value));
      return evaluation(missing.length === 0, { required: assertion.required, present: assertion.present, missing });
    }
    case 'all-true': {
      const falseKeys = Object.entries(assertion.values).filter(([, value]) => value !== true).map(([key]) => key);
      return evaluation(falseKeys.length === 0, { values: assertion.values, falseKeys });
    }
    case 'allowed-value': {
      const accepted = assertion.allowed.includes(assertion.value);
      return evaluation(accepted, { value: assertion.value, allowed: assertion.allowed });
    }
    case 'unique-count-at-least': {
      const uniqueCount = new Set(assertion.values).size;
      return evaluation(uniqueCount >= assertion.minimum, { uniqueCount, minimum: assertion.minimum });
    }
    case 'count-at-most': {
      const count = assertion.values.length;
      return evaluation(count <= assertion.maximum, { count, maximum: assertion.maximum });
    }
    case 'distinct': {
      const uniqueCount = new Set(assertion.values).size;
      return evaluation(uniqueCount === assertion.values.length, { count: assertion.values.length, uniqueCount });
    }
    case 'subset': {
      const superset = new Set(assertion.superset);
      const missing = assertion.subset.filter((value) => !superset.has(value));
      return evaluation(missing.length === 0, { subset: assertion.subset, superset: assertion.superset, missing });
    }
    case 'exact-set': {
      const actual = [...new Set(assertion.actual)].sort();
      const expected = [...new Set(assertion.expected)].sort();
      return evaluation(isDeepStrictEqual(actual, expected), { actual, expected });
    }
    case 'disjoint': {
      const right = new Set(assertion.right);
      const overlap = assertion.left.filter((value) => right.has(value));
      return evaluation(overlap.length === 0, { left: assertion.left, right: assertion.right, overlap });
    }
    case 'implication': {
      const accepted = !assertion.condition || assertion.consequence === true;
      return evaluation(accepted, { condition: assertion.condition, consequence: assertion.consequence });
    }
    default:
      throw registryError('UNMAPPED_SCENARIO_ASSERTION', `Unknown scenario assertion ${assertion.operator}.`);
  }
}

function matchExpectation(expectedOutcome, check, actual) {
  const differences = {};
  if (actual.outcome !== expectedOutcome) differences.outcome = { expected: expectedOutcome, actual: actual.outcome };
  if (check.expectedError !== undefined && actual.error?.code !== check.expectedError) {
    differences.errorCode = { expected: check.expectedError, actual: actual.error?.code ?? null };
  }
  if (check.expectedErrorPath !== undefined && actual.error?.details?.path !== check.expectedErrorPath) {
    differences.errorPath = { expected: check.expectedErrorPath, actual: actual.error?.details?.path ?? null };
  }
  if (Object.hasOwn(check, 'expectedResult') && !isDeepStrictEqual(actual.result, check.expectedResult)) {
    differences.result = { expected: check.expectedResult, actual: actual.result ?? null };
  }
  if (check.expectedDecision !== undefined && actual.decision !== check.expectedDecision) {
    differences.decision = { expected: check.expectedDecision, actual: actual.decision ?? null };
  }
  const passed = Object.keys(differences).length === 0 && actual.invoked === true;
  if (actual.invoked !== true) differences.invoked = { expected: true, actual: actual.invoked ?? false };
  return Object.freeze({ passed, diff: passed ? null : Object.freeze(differences) });
}

function expectedReceipt(expectedOutcome, check) {
  return Object.freeze({
    outcome: expectedOutcome,
    ...(check.expectedError ? { errorCode: check.expectedError } : {}),
    ...(check.expectedErrorPath ? { errorPath: check.expectedErrorPath } : {}),
    ...(Object.hasOwn(check, 'expectedResult') ? { result: structuredClone(check.expectedResult) } : {}),
    ...(check.expectedDecision ? { decision: check.expectedDecision } : {}),
  });
}

function checkRoute(check) {
  if (check.type === 'contract') {
    return Object.freeze({ checkType: check.type, target: `${check.module ?? 'contracts'}#${check.operation}` });
  }
  if (check.type === 'structural') {
    return Object.freeze({ checkType: check.type, target: `structural:${check.operation}` });
  }
  return Object.freeze({ checkType: check.type, target: `scenario:${check.scenario}/${check.assertion.operator}` });
}

function decisionPacketEvidence(check) {
  if (check.type !== 'contract') return [];
  const packets = [];
  for (const argument of check.arguments) {
    if (argument && typeof argument === 'object' && typeof argument.packet_id === 'string') {
      packets.push({ packetId: argument.packet_id, interactionPhase: argument.interaction_phase ?? null });
    }
  }
  return packets;
}

function artifactEvidence(check) {
  if (check.type !== 'contract') return [];
  const artifacts = [];
  for (const argument of check.arguments) {
    if (argument && typeof argument === 'object' && typeof argument.artifact_id === 'string') {
      artifacts.push({ artifactId: argument.artifact_id, status: argument.status ?? null });
    }
  }
  return artifacts;
}

function stateChangeEvidence(check, actual) {
  if (check.type === 'contract' && check.operation === 'validateArtifactTransition') {
    return [{ from: check.arguments[0], to: check.arguments[1], accepted: actual.outcome === 'pass' }];
  }
  if (check.type === 'scenario') {
    return [{ scenario: check.scenario, decision: actual.decision, outcome: actual.outcome }];
  }
  return [];
}

function summarizeResult(result) {
  if (result === null || result === undefined) return result ?? null;
  if (['string', 'number', 'boolean'].includes(typeof result)) return result;
  if (Array.isArray(result)) return Object.freeze({ type: 'array', length: result.length });
  return Object.freeze({
    type: 'object',
    validated: true,
    id: result.project_id ?? result.artifact_id ?? result.packet_id ?? result.attempt_id ?? null,
    status: result.status ?? result.state ?? result.outcome ?? null,
  });
}

function executionFailure(error) {
  return Object.freeze({
    outcome: 'error',
    decision: 'RUNNER_ERROR',
    invoked: false,
    target: 'fixture-runner',
    error: normalizeError(error),
  });
}

function normalizeError(error) {
  return Object.freeze({
    name: error?.name ?? 'Error',
    code: error?.code ?? 'UNEXPECTED_ERROR',
    message: error?.message ?? String(error),
    details: structuredClone(error?.details ?? {}),
  });
}

function evaluation(accepted, evidence) {
  return Object.freeze({ accepted, evidence: Object.freeze(structuredClone(evidence)) });
}

function requireRecord(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw registryError('FIXTURE_RECORD_REQUIRED', `${path} must be an object.`);
  }
}

function requireNonEmptyString(value, path) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw registryError('FIXTURE_STRING_REQUIRED', `${path} must be a non-empty string.`);
  }
}

function registryError(code, message, details = {}) {
  const error = new Error(message);
  error.name = 'FixtureRegistryError';
  error.code = code;
  error.details = details;
  return error;
}
