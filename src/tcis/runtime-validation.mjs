import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PROBE_PROJECT = Object.freeze({
  project_id: 'PRJ-RUNTIME-VALIDATION',
  title: 'Runtime validation probe',
  scope_mode: 'single_tvc',
  production_mode: 'live_action',
});

const PROBE_CLAIM = Object.freeze({
  claim_id: 'CLAIM-RUNTIME-VALIDATION',
  kind: 'IMPLIED',
  text: 'Behavioral Runtime validation probe.',
  evidence_status: 'UNASSESSED',
  clearance_status: 'NOT_ASSESSED',
  evidence_refs: [],
});

export async function validateStoreRuntime(storeModule, options = {}) {
  const interfaceResult = await validateStoreInterface(storeModule, options.validatorContext);
  const behaviorResult = await validateStoreBehavior(storeModule, options);
  const checks = [
    { name: 'interface', passed: explicitPassState(interfaceResult) === true, result: interfaceResult },
    { name: 'behavior', passed: behaviorResult.passed, result: behaviorResult },
  ];
  return {
    kind: 'tcis.store-runtime-validation.v2',
    passed: checks.every((check) => check.passed),
    checks,
  };
}

export async function validateStoreBehavior(storeModule, { temporaryRoot = tmpdir() } = {}) {
  const checks = [];
  let workspace = null;
  let activeCheck = 'store_interface';

  try {
    const Store = findStoreClass(storeModule);
    assertProbe(typeof Store === 'function', 'No ProjectStore constructor is available.');

    const clock = () => new Date('2026-01-01T00:00:00.000Z');
    let idSequence = 0;
    const idFactory = (prefix) => `${prefix}-RUNTIME-${String(++idSequence).padStart(4, '0')}`;
    const createStore = () => new Store({ clock, idFactory });

    workspace = await mkdtemp(path.join(path.resolve(temporaryRoot), 'tcis-runtime-validation-'));
    const projectRoot = path.join(workspace, 'project');
    const writer = createStore();

    activeCheck = 'create_project';
    assertMethod(writer, 'createProject');
    const created = await writer.createProject(projectRoot, PROBE_PROJECT);
    assertSnapshot(created, 0);
    assertProbe(created.project.project_id === PROBE_PROJECT.project_id, 'createProject returned the wrong project.');
    assertProbe(created.events?.some((event) => event.type === 'PROJECT_CREATED'), 'createProject did not persist its creation event.');
    checks.push({ name: activeCheck, passed: true, revision: created.project.revision });

    activeCheck = 'load_snapshot';
    const reader = createStore();
    assertMethod(reader, 'loadSnapshot');
    const loaded = await reader.loadSnapshot(projectRoot);
    assertSnapshot(loaded, 0);
    assertProbe(loaded.project.state_hash === created.project.state_hash, 'loadSnapshot returned a different state hash.');
    assertProbe(loaded.project.manifest_hash === created.project.manifest_hash, 'loadSnapshot returned a different manifest hash.');
    checks.push({ name: activeCheck, passed: true, revision: loaded.project.revision });

    activeCheck = 'mutate_and_reload';
    assertMethod(writer, 'addClaim');
    const mutated = await writer.addClaim(projectRoot, PROBE_CLAIM, loaded.project.revision);
    assertSnapshot(mutated, 1);
    assertProbe(mutated.claims?.some((claim) => claim.claim_id === PROBE_CLAIM.claim_id), 'The mutation result omitted the probe claim.');
    const reloaded = await createStore().loadSnapshot(projectRoot);
    assertSnapshot(reloaded, 1);
    assertProbe(reloaded.claims?.some((claim) => claim.claim_id === PROBE_CLAIM.claim_id), 'The probe claim was not durable after reload.');
    checks.push({ name: activeCheck, passed: true, revision: reloaded.project.revision, claim_count: reloaded.claims.length });

    activeCheck = 'verify_integrity';
    const verifier = createStore();
    assertMethod(verifier, 'verifyIntegrity');
    const integrity = await verifier.verifyIntegrity(projectRoot);
    assertProbe(integrity?.ok === true, 'verifyIntegrity did not return an explicit success result.');
    assertProbe(integrity.project_id === PROBE_PROJECT.project_id, 'verifyIntegrity returned the wrong project.');
    assertProbe(integrity.revision === 1, 'verifyIntegrity returned the wrong revision.');
    assertProbe(integrity.pending_transactions === 0, 'verifyIntegrity found pending transactions.');
    checks.push({ name: activeCheck, passed: true, revision: integrity.revision, pending_transactions: integrity.pending_transactions });

    activeCheck = 'detect_tampering';
    const pointerPath = path.join(projectRoot, storeModule?.PROJECT_FILE ?? 'project.json');
    const pointer = JSON.parse(await readFile(pointerPath, 'utf8'));
    pointer.revision += 1;
    await writeFile(pointerPath, `${JSON.stringify(pointer)}\n`, 'utf8');
    let tamperError = null;
    try {
      await createStore().verifyIntegrity(projectRoot);
    } catch (error) {
      tamperError = error;
    }
    assertProbe(tamperError, 'verifyIntegrity accepted a tampered project pointer.');
    checks.push({ name: activeCheck, passed: true, detected_error: tamperError.code ?? tamperError.name });
  } catch (error) {
    checks.push({ name: activeCheck, passed: false, error: describeError(error, workspace) });
  } finally {
    if (workspace) {
      try {
        await rm(workspace, { recursive: true, force: true });
        checks.push({ name: 'cleanup', passed: true });
      } catch (error) {
        checks.push({ name: 'cleanup', passed: false, error: describeError(error, workspace) });
      }
    }
  }

  return {
    kind: 'tcis.store-behavior-validation.v1',
    passed: checks.length > 0 && checks.every((check) => check.passed),
    checks,
  };
}

async function validateStoreInterface(storeModule, validatorContext) {
  const validator = storeModule?.validateRuntime ?? storeModule?.validateStore;
  if (typeof validator !== 'function') {
    return {
      kind: 'tcis.store-interface-validation.v1',
      passed: false,
      error: { code: 'STORE_VALIDATOR_MISSING', message: 'No store interface validator is available.' },
    };
  }
  try {
    return await validator(validatorContext);
  } catch (error) {
    return {
      kind: 'tcis.store-interface-validation.v1',
      passed: false,
      error: describeError(error),
    };
  }
}

function findStoreClass(storeModule) {
  return storeModule?.ProjectStore
    ?? storeModule?.Store
    ?? (typeof storeModule?.default === 'function' ? storeModule.default : null);
}

function assertMethod(target, name) {
  assertProbe(typeof target?.[name] === 'function', `ProjectStore.${name} is not available.`);
}

function assertSnapshot(snapshot, expectedRevision) {
  assertProbe(snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot), 'Store operation did not return a snapshot.');
  assertProbe(snapshot.project && typeof snapshot.project === 'object', 'Store snapshot is missing project state.');
  assertProbe(snapshot.project.revision === expectedRevision, `Expected revision ${expectedRevision}, received ${snapshot.project.revision}.`);
  assertProbe(/^[0-9a-f]{64}$/.test(snapshot.project.state_hash ?? ''), 'Store snapshot is missing a valid state hash.');
  assertProbe(/^[0-9a-f]{64}$/.test(snapshot.project.manifest_hash ?? ''), 'Store snapshot is missing a valid manifest hash.');
}

function assertProbe(condition, message) {
  if (condition) return;
  const error = new Error(message);
  error.code = 'STORE_BEHAVIOR_MISMATCH';
  throw error;
}

function describeError(error, workspace = null) {
  let message = String(error?.message ?? error);
  if (workspace) message = message.split(workspace).join('<temporary-workspace>');
  return {
    name: error?.name ?? 'Error',
    code: error?.code ?? 'STORE_BEHAVIOR_ERROR',
    message,
  };
}

function explicitPassState(result) {
  if (typeof result === 'boolean') return result;
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
  if (typeof result.ok === 'boolean') return result.ok;
  if (typeof result.valid === 'boolean') return result.valid;
  if (typeof result.passed === 'boolean') return result.passed;
  return null;
}
