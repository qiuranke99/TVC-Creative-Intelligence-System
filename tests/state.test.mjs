import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as storeModule from '../src/tcis/store.mjs';
import { onePixelPng } from './helpers/media-fixtures.mjs';

const { CANONICAL_STATE_FILES, FAULT_STAGES, ProjectStore } = storeModule;

const projectSpec = {
  project_id: 'PRJ-STATE',
  title: 'Persistent State Fixture',
  scope_mode: 'single_tvc',
  production_mode: 'live_action',
};

async function temporaryRoot(t, prefix = 'tcis-state-') {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function artifactSpec(artifactId, type = 'client_brief', extra = {}) {
  return {
    artifact_id: artifactId,
    type,
    path: `artifacts/${artifactId}.md`,
    content: `# ${artifactId}\n`,
    ...extra,
  };
}

function artifactToken(snapshot, artifact) {
  return {
    project_revision: snapshot.project.revision,
    artifact_id: artifact.artifact_id,
    artifact_version: artifact.version,
    artifact_hash: artifact.content_hash,
  };
}

async function createLockedArtifact(root, store, artifactId, inputArtifactIds = []) {
  let snapshot = await store.createArtifact(root, artifactSpec(`${artifactId}-DRAFT`, 'client_brief', { status: 'INTERNAL_REVIEW' }), (await store.loadSnapshot(root)).project.revision);
  const original = snapshot.artifacts.find((artifact) => artifact.artifact_id === `${artifactId}-DRAFT`);
  const option = { id: `${artifactId}-OPTION`, proposition: artifactId, strengths: ['Traceable'], risks: ['Synthetic fixture'] };
  const proposalId = `${artifactId}-PROPOSAL`;
  snapshot = await store.commitProposal(root, {
    operation_id: `${artifactId}-OP-PROPOSAL`,
    packet: {
      packet_id: proposalId, artifact_id: original.artifact_id, artifact_version: original.version, stage: original.stage,
      interaction_phase: 'PROPOSAL', decision_owner: 'client_brand_lead', decision_question: `Select ${artifactId}?`,
      options: [option], recommendation: { option_id: option.id, rationale: 'Fixture route.' },
      known_facts: [], assumptions: [], unknowns: [], hard_blocks: [],
      allowed_responses: ['SELECT', 'ADVISE', 'NONE', 'REVISE', 'REOPEN', 'STOP'],
    },
  }, artifactToken(snapshot, original));
  snapshot = await store.commitFeedback(root, {
    operation_id: `${artifactId}-OP-REVISION`,
    feedback: {
      feedback_id: `${artifactId}-SELECT`, packet_id: proposalId, action: 'SELECT', decision_owner: 'client_brand_lead',
      selected_option_id: option.id, comment: 'Create a changed revision.',
    },
    revised_artifact: artifactSpec(artifactId, 'client_brief', {
      content: `# ${artifactId}\n\nChanged revision.\n`,
      input_artifact_ids: inputArtifactIds,
    }),
  }, artifactToken(snapshot, original));
  const revised = snapshot.artifacts.find((artifact) => artifact.artifact_id === artifactId);
  const confirmationId = `${artifactId}-CONFIRM`;
  snapshot = await store.commitInteraction(root, {
    operation_id: `${artifactId}-OP-CONFIRM`,
    packet: {
      packet_id: confirmationId, artifact_id: revised.artifact_id, artifact_version: revised.version, stage: revised.stage,
      interaction_phase: 'CONFIRMATION', revised_artifact_hash: revised.content_hash, prior_feedback_id: `${artifactId}-SELECT`,
      decision_owner: 'client_brand_lead', decision_question: `Lock ${artifactId}?`, options: [option],
      recommendation: { option_id: option.id, rationale: 'Revision is bound.' }, known_facts: [], assumptions: [], unknowns: [], hard_blocks: [],
      allowed_responses: ['LOCK', 'NONE', 'REVISE', 'REOPEN', 'STOP'],
    },
  }, artifactToken(snapshot, revised));
  snapshot = await store.commitLock(root, {
    operation_id: `${artifactId}-OP-LOCK`,
    feedback: {
      feedback_id: `${artifactId}-LOCK-FEEDBACK`, packet_id: confirmationId, action: 'LOCK', decision_owner: 'client_brand_lead',
      selected_option_id: option.id, confirmed_artifact_hash: revised.content_hash, comment: 'Exact revision confirmed.',
    },
    lock_record: {
      lock_id: `${artifactId}-LOCK`, packet_id: confirmationId, prior_feedback_id: `${artifactId}-SELECT`, artifact_id: revised.artifact_id,
      artifact_version: revised.version, artifact_hash: revised.content_hash, stage: revised.stage, confirmed_by: 'client_brand_lead',
      signoffs: [{ type: 'CLIENT_DECISION', status: 'APPROVED', reference_id: `${artifactId}-LOCK-FEEDBACK` }],
    },
    decision_record: {
      decision_id: `${artifactId}-DECISION`, packet_id: confirmationId, artifact_id: revised.artifact_id, artifact_version: revised.version,
      decision_owner: 'client_brand_lead', outcome: 'LOCK', lock_id: `${artifactId}-LOCK`, rationale: 'Explicit confirmation.',
      rejected_option_ids: [], residual_risks: [], reopen_conditions: ['Upstream change'],
    },
  }, artifactToken(snapshot, revised));
  return { snapshot, artifact: snapshot.artifacts.find((artifact) => artifact.artifact_id === artifactId) };
}

test('create and load recover the same canonical snapshot without chat state', async (t) => {
  const root = await temporaryRoot(t);
  const input = { ...projectSpec, metadata: { labels: ['original'], retired_source: 'reference_only' } };
  const store = new ProjectStore();
  const created = await store.createProject(root, input);
  input.metadata.labels.push('mutated-after-call');

  const loaded = await store.loadSnapshot(root);
  assert.deepEqual(loaded, created);
  assert.equal(loaded.project.revision, 0);
  assert.deepEqual(loaded.project.metadata, { labels: ['original'], retired_source: 'reference_only' });
  assert.equal(loaded.events.length, 1);
  assert.equal(loaded.events[0].type, 'PROJECT_CREATED');
  assert.match(loaded.project.state_hash, /^[0-9a-f]{64}$/);
  assert.match(loaded.project.manifest_hash, /^[0-9a-f]{64}$/);

  const integrity = await store.verifyIntegrity(root);
  assert.equal(integrity.ok, true);
  assert.equal(integrity.revision, 0);
  assert.equal(integrity.pending_transactions, 0);

  const updated = await store.updateProjectMetadata(root, {
    labels: ['current'],
    retired_source: null,
  }, 0);
  assert.equal(updated.project.revision, 1);
  assert.deepEqual(updated.project.metadata, { labels: ['current'] });
  assert.equal(updated.events.at(-1).type, 'PROJECT_METADATA_UPDATED');
  assert.deepEqual(updated.events.at(-1).details, {
    removed_keys: ['retired_source'],
    updated_keys: ['labels'],
  });
  assert.equal((await store.verifyIntegrity(root)).revision, 1);
});

test('project revision and artifact version/hash are compare-and-swap tokens', async (t) => {
  const root = await temporaryRoot(t);
  const store = new ProjectStore();
  await store.createProject(root, projectSpec);
  const input = artifactSpec('ART-CAS');
  const revisionOne = await store.createArtifact(root, input, 0);
  input.content = 'mutated';

  await assert.rejects(
    store.createArtifact(root, artifactSpec('ART-STALE'), 0),
    { code: 'REVISION_CONFLICT' },
  );
  await assert.rejects(
    store.createArtifact(root, artifactSpec('ART-NO-REVISION'), undefined),
    { code: 'REVISION_REQUIRED' },
  );

  const artifact = revisionOne.artifacts.find((record) => record.artifact_id === 'ART-CAS');
  await assert.rejects(
    store.transitionArtifact(root, 'ART-CAS', 'INTERNAL_REVIEW', {
      project_revision: 1,
      artifact_id: 'ART-CAS',
      artifact_version: artifact.version + 1,
      artifact_hash: artifact.content_hash,
    }),
    { code: 'ARTIFACT_CAS_CONFLICT' },
  );
  const revisionTwo = await store.transitionArtifact(root, 'ART-CAS', 'INTERNAL_REVIEW', {
    project_revision: 1,
    artifact_id: 'ART-CAS',
    artifact_version: artifact.version,
    artifact_hash: artifact.content_hash,
  });
  assert.equal(revisionTwo.project.revision, 2);
  assert.equal((await readFile(path.join(root, 'artifacts', 'ART-CAS.md'), 'utf8')), '# ART-CAS\n');
});

test('simultaneous writers cannot both commit the same project revision', async (t) => {
  const root = await temporaryRoot(t);
  const storeA = new ProjectStore();
  const storeB = new ProjectStore();
  await storeA.createProject(root, projectSpec);

  const results = await Promise.allSettled([
    storeA.createArtifact(root, artifactSpec('ART-A'), 0),
    storeB.createArtifact(root, artifactSpec('ART-B'), 0),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const rejection = results.find((result) => result.status === 'rejected').reason;
  assert.ok(['PROJECT_LOCKED', 'REVISION_CONFLICT'].includes(rejection.code));
  assert.equal((await storeA.loadSnapshot(root)).project.revision, 1);
});

test('project lock lease blocks an active owner and reclaims a reused PID identity', async (t) => {
  const root = await temporaryRoot(t, 'tcis-lock-lease-');
  const normal = new ProjectStore();
  await normal.createProject(root, { ...projectSpec, project_id: 'PRJ-LOCK-LEASE' });

  let enteredResolve;
  let releaseResolve;
  const entered = new Promise((resolve) => { enteredResolve = resolve; });
  const release = new Promise((resolve) => { releaseResolve = resolve; });
  const holder = new ProjectStore({
    async faultInjector(stage) {
      if (stage === FAULT_STAGES.AFTER_WAL_PREPARED) {
        enteredResolve();
        await release;
      }
    },
  });
  const heldMutation = holder.addFact(root, {
    fact_id: 'FACT-LOCK-HELD',
    text: 'The active lease owns this mutation.',
    source: 'fixture',
  }, 0);
  await entered;
  await assert.rejects(normal.loadSnapshot(root), { code: 'PROJECT_LOCKED' });
  releaseResolve();
  await heldMutation;

  const lockPath = path.join(root, '.tcis', 'write.lock');
  const now = Date.now();
  await writeFile(lockPath, `${JSON.stringify({
    lock_version: 1,
    token: 'orphaned-process-instance',
    pid: process.pid,
    process_started_at_ms: 0,
    acquired_at: new Date(now - 1_000).toISOString(),
    updated_at: new Date(now - 1_000).toISOString(),
    lease_expires_at: new Date(now + 60_000).toISOString(),
  })}\n`, 'utf8');

  const recovered = await normal.loadSnapshot(root);
  assert.equal(recovered.project.revision, 1);
  assert.equal(recovered.facts[0].fact_id, 'FACT-LOCK-HELD');
  assert.equal(await existsForTest(lockPath), false);
});

test('store module removes the unused non-serializing JSONL append API', () => {
  assert.equal(Object.hasOwn(storeModule, 'atomicAppendJsonLine'), false);
});

test('artifact and media paths reject absolute, traversal, and junction escapes', async (t) => {
  const root = await temporaryRoot(t);
  const store = new ProjectStore();
  await store.createProject(root, projectSpec);

  await assert.rejects(
    store.createArtifact(root, { ...artifactSpec('ART-UP'), path: '../outside.md' }, 0),
    { code: 'PATH_OUTSIDE_PROJECT' },
  );
  await assert.rejects(
    store.createArtifact(root, { ...artifactSpec('ART-ABS'), path: path.join(root, 'absolute.md') }, 0),
    { code: 'PATH_OUTSIDE_PROJECT' },
  );

  const outside = await temporaryRoot(t, 'tcis-outside-');
  const link = path.join(root, 'linked-outside');
  try {
    await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return;
    throw error;
  }
  await assert.rejects(
    store.createArtifact(root, { ...artifactSpec('ART-LINK'), path: 'linked-outside/escape.md' }, 0),
    { code: 'SYMLINK_ESCAPE' },
  );
});

test('PROPOSED cannot lock without the revised confirmation state', async (t) => {
  const root = await temporaryRoot(t);
  const store = new ProjectStore();
  await store.createProject(root, projectSpec);
  await assert.rejects(store.createArtifact(root, artifactSpec('ART-DIRECT-LOCK', 'client_brief', { status: 'LOCKED' }), 0), { code: 'ATOMIC_LOCK_REQUIRED' });
  let snapshot = await store.createArtifact(root, artifactSpec('ART-LOCK', 'client_brief', { status: 'INTERNAL_REVIEW' }), 0);
  const original = snapshot.artifacts.find((artifact) => artifact.artifact_id === 'ART-LOCK');
  const option = { id: 'OPT-LOCK', proposition: 'Lock test', strengths: ['Trace'], risks: ['None'] };
  snapshot = await store.commitProposal(root, {
    operation_id: 'OP-LOCK-PROPOSAL', packet: {
      packet_id: 'DP-LOCK-PROPOSAL', artifact_id: original.artifact_id, artifact_version: original.version, stage: original.stage,
      interaction_phase: 'PROPOSAL', decision_owner: 'client_brand_lead', decision_question: 'Select?', options: [option],
      recommendation: { option_id: option.id, rationale: 'Test.' }, known_facts: [], assumptions: [], unknowns: [], hard_blocks: [],
      allowed_responses: ['SELECT', 'ADVISE', 'NONE', 'REVISE', 'REOPEN', 'STOP'],
    },
  }, artifactToken(snapshot, original));
  await assert.rejects(store.transitionArtifact(root, original.artifact_id, 'LOCKED', artifactToken(snapshot, original)), { code: 'ATOMIC_LOCK_REQUIRED' });
  snapshot = await store.commitFeedback(root, {
    operation_id: 'OP-LOCK-REVISION',
    feedback: { feedback_id: 'FB-LOCK-SELECT', packet_id: 'DP-LOCK-PROPOSAL', action: 'SELECT', decision_owner: 'client_brand_lead', selected_option_id: option.id, comment: 'Create a changed revision.' },
    revised_artifact: artifactSpec('ART-LOCK-R1', 'client_brief', { content: '# changed revision\n' }),
  }, artifactToken(snapshot, original));
  const revised = snapshot.artifacts.find((artifact) => artifact.artifact_id === 'ART-LOCK-R1');
  await assert.rejects(store.transitionArtifact(root, revised.artifact_id, 'LOCKED', artifactToken(snapshot, revised)), { code: 'ATOMIC_LOCK_REQUIRED' });
  assert.equal((await store.loadSnapshot(root)).artifacts.find((artifact) => artifact.artifact_id === revised.artifact_id).status, 'REVISED');
});

test('canonical writes cannot bypass campaign platform applicability', async (t) => {
  const root = await temporaryRoot(t, 'tcis-platform-scope-');
  const store = new ProjectStore();
  await store.createProject(root, projectSpec);
  await assert.rejects(
    () => store.createArtifact(root, {
      artifact_id: 'ART-PLATFORM',
      type: 'campaign_platform',
      status: 'DRAFT',
      path: 'artifacts/platform.md',
      content: '# Invalid one-off platform\n',
      platform: {
        organizing_idea: 'System', brand_product_role: 'Proof', invariants: ['mechanic'], variables: ['audience'],
        prohibitions: ['generic'], example_executions: ['A', 'B', 'C'], coverage_dimensions: ['audience', 'channel'],
      },
    }, 0),
    { code: 'PLATFORM_SCOPE_MISMATCH' },
  );

  const campaignRoot = await temporaryRoot(t, 'tcis-platform-persist-');
  const campaignProject = { ...projectSpec, project_id: 'PRJ-CAMPAIGN', scope_mode: 'campaign_system' };
  await store.createProject(campaignRoot, campaignProject);
  const platform = {
    organizing_idea: 'Make waiting useful', brand_product_role: 'The product converts waiting into progress',
    invariants: ['one mechanism'], variables: ['setting'], prohibitions: ['passive montage'],
    example_executions: ['Commute', 'Checkout', 'Airport'], coverage_dimensions: ['channel', 'situation'],
    execution_evidence: [
      { evidence_kind: 'STRUCTURED_PROTOTYPE', execution_id: 'Commute', mechanism_id: 'USE-WAIT', coverage: { channel: 'social', situation: 'commute' } },
      { evidence_kind: 'STRUCTURED_PROTOTYPE', execution_id: 'Checkout', mechanism_id: 'USE-WAIT', coverage: { channel: 'retail', situation: 'checkout' } },
      { evidence_kind: 'STRUCTURED_PROTOTYPE', execution_id: 'Airport', mechanism_id: 'USE-WAIT', coverage: { channel: 'video', situation: 'airport' } },
    ],
  };
  await store.createArtifact(campaignRoot, {
    artifact_id: 'ART-CAMPAIGN-PLATFORM', type: 'campaign_platform', path: 'artifacts/platform.md',
    content: '# Campaign platform\n', platform,
  }, 0);
  const recovered = await new ProjectStore().loadSnapshot(campaignRoot);
  assert.deepEqual(recovered.artifacts.find((artifact) => artifact.artifact_id === 'ART-CAMPAIGN-PLATFORM').platform, platform);
});

test('dependency graph is project-scoped, version-bound, acyclic, and selectively invalidated', async (t) => {
  const root = await temporaryRoot(t);
  const store = new ProjectStore();
  await store.createProject(root, projectSpec);
  const lockedA = await createLockedArtifact(root, store, 'ART-A');
  const lockedB = await createLockedArtifact(root, store, 'ART-B', [lockedA.artifact.artifact_id]);
  const lockedC = await createLockedArtifact(root, store, 'ART-C', [lockedB.artifact.artifact_id]);
  const lockedU = await createLockedArtifact(root, store, 'ART-U');

  const before = await store.loadSnapshot(root);
  for (const edge of before.dependencies) {
    assert.equal(edge.project_id, projectSpec.project_id);
    const upstream = before.artifacts.find((artifact) => artifact.artifact_id === edge.upstream_id);
    const downstream = before.artifacts.find((artifact) => artifact.artifact_id === edge.downstream_id);
    assert.equal(edge.upstream_version, upstream.version);
    assert.equal(edge.upstream_content_hash, upstream.content_hash);
    assert.equal(edge.downstream_version, downstream.version);
    assert.equal(edge.downstream_content_hash, downstream.content_hash);
  }

  const revision = before.project.revision;
  await assert.rejects(store.addDependency(root, lockedA.artifact.artifact_id, lockedA.artifact.artifact_id, revision), { code: 'SELF_DEPENDENCY' });
  await assert.rejects(store.addDependency(root, lockedC.artifact.artifact_id, lockedA.artifact.artifact_id, revision), { code: 'DEPENDENCY_CYCLE' });
  await assert.rejects(
    store.addClaim(root, {
      project_id: 'PRJ-OTHER',
      claim_id: 'CL-X',
      kind: 'EXPRESS',
      text: 'Cross project',
      evidence_status: 'UNASSESSED',
      clearance_status: 'NOT_ASSESSED',
      evidence_refs: [],
    }, revision),
    { code: 'CROSS_PROJECT_REFERENCE' },
  );

  const reopened = await store.invalidateDescendants(root, lockedA.artifact.artifact_id, 'Upstream premise changed.', revision);
  const statuses = Object.fromEntries(reopened.artifacts.map((artifact) => [artifact.artifact_id, artifact.status]));
  assert.equal(statuses[lockedA.artifact.artifact_id], 'LOCKED');
  assert.equal(statuses[lockedB.artifact.artifact_id], 'STALE');
  assert.equal(statuses[lockedC.artifact.artifact_id], 'STALE');
  assert.equal(statuses[lockedU.artifact.artifact_id], 'LOCKED');
  assert.equal(reopened.project.active_artifact_id, lockedA.artifact.artifact_id);
});

test('facts, claims, rights, attempts, decisions, and artifact status remain orthogonal', async (t) => {
  const root = await temporaryRoot(t);
  const store = new ProjectStore();
  await store.createProject(root, projectSpec);
  await store.createArtifact(root, artifactSpec('ART-ORTHO'), 0);
  await store.addFact(root, { fact_id: 'FACT-1', text: 'Observed fact', source: 'fixture' }, 1);
  const claimInput = {
    claim_id: 'CL-1',
    kind: 'IMPLIED',
    text: 'A limited claim',
    evidence_status: 'LIMITED',
    clearance_status: 'PENDING',
    evidence_refs: ['FACT-1'],
  };
  await store.addClaim(root, claimInput, 2);
  claimInput.evidence_status = 'SUPPORTED';
  await store.addRight(root, {
    right_id: 'RIGHT-1',
    subject: 'Music use',
    clearance_status: 'BLOCKED',
    usage: ['online'],
  }, 3);
  await store.addAttempt(root, {
    attempt_id: 'AT-1',
    artifact_id: 'ART-ORTHO',
    status: 'REQUESTED',
    tool: 'native_imagegen',
    request_hash: 'a'.repeat(64),
    reference_ids: [],
  }, 4);
  await store.updateAttempt(root, 'AT-1', { status: 'FAILED', failure_reason: 'Injected fixture failure' }, 5);
  await store.appendDecision(root, {
    decision_id: 'DEC-1',
    packet_id: 'DP-1',
    artifact_id: 'ART-ORTHO',
    artifact_version: 1,
    decision_owner: 'client_brand_lead',
    outcome: 'REVISE',
    rationale: 'Needs revision.',
    rejected_option_ids: [],
    residual_risks: ['Claim remains pending.'],
    reopen_conditions: [],
  }, 6);

  const snapshot = await store.loadSnapshot(root);
  assert.equal(snapshot.project.status, 'ACTIVE');
  assert.equal(snapshot.artifacts[0].status, 'DRAFT');
  assert.equal(snapshot.facts[0].fact_id, 'FACT-1');
  assert.equal(snapshot.claims[0].evidence_status, 'LIMITED');
  assert.equal(snapshot.claims[0].clearance_status, 'PENDING');
  assert.equal(snapshot.rights[0].clearance_status, 'BLOCKED');
  assert.equal(snapshot.attempts[0].status, 'FAILED');
  assert.equal(snapshot.decisions[0].outcome, 'REVISE');
  for (const collection of ['artifacts', 'facts', 'claims', 'rights', 'attempts', 'decisions', 'events']) {
    assert.ok(snapshot[collection].every((record) => record.project_id === projectSpec.project_id));
  }
});

test('decision packets, feedback, and lock records recover as a versioned append-only interaction ledger', async (t) => {
  const root = await temporaryRoot(t);
  const store = new ProjectStore();
  await store.createProject(root, projectSpec);
  let snapshot = await store.createArtifact(root, artifactSpec('ART-LOOP', 'client_brief', { status: 'INTERNAL_REVIEW' }), 0);
  const artifact = snapshot.artifacts[0];
  const options = [{ id: 'OPT-A', proposition: 'Advance option A', strengths: ['Clear'], risks: ['Needs revision'] }];

  snapshot = await store.commitProposal(root, { operation_id: 'OP-LOOP-PROPOSAL', packet: {
    packet_id: 'DP-PROPOSAL',
    artifact_id: artifact.artifact_id,
    artifact_version: artifact.version,
    stage: artifact.stage,
    interaction_phase: 'PROPOSAL',
    decision_owner: 'client_brand_lead',
    decision_question: 'Which option should be revised?',
    options,
    recommendation: { option_id: 'OPT-A', rationale: 'Strongest fit.' },
    known_facts: [],
    assumptions: [],
    unknowns: [],
    hard_blocks: [],
    allowed_responses: ['SELECT', 'ADVISE', 'NONE', 'REVISE', 'REOPEN', 'STOP'],
  } }, artifactToken(snapshot, artifact));
  assert.equal(snapshot.decision_packets[0].packet_version, 1);

  await assert.rejects(store.commitFeedback(root, {
    operation_id: 'OP-LOOP-FALSE-REVISION',
    feedback: {
      feedback_id: 'FB-FALSE-REVISION', packet_id: 'DP-PROPOSAL', action: 'SELECT', decision_owner: 'client_brand_lead',
      selected_option_id: 'OPT-A', comment: 'Selection without revised content must not advance state.',
    },
  }, artifactToken(snapshot, artifact)), { code: 'REVISED_ARTIFACT_REQUIRED' });
  assert.equal((await store.loadSnapshot(root)).artifacts.find((candidate) => candidate.artifact_id === artifact.artifact_id).status, 'PROPOSED');

  snapshot = await store.commitFeedback(root, {
    operation_id: 'OP-LOOP-REVISION',
    feedback: {
      feedback_id: 'FB-SELECT', packet_id: 'DP-PROPOSAL', action: 'SELECT', decision_owner: 'client_brand_lead',
      selected_option_id: 'OPT-A', comment: 'Revise option A.',
    },
    revised_artifact: artifactSpec('ART-LOOP-R1', 'client_brief', { content: '# ART-LOOP-R1\n\nChanged revision.\n' }),
  }, artifactToken(snapshot, artifact));
  const revised = snapshot.artifacts.find((candidate) => candidate.artifact_id === 'ART-LOOP-R1');
  snapshot = await store.appendDecisionPacket(root, {
    packet_id: 'DP-CONFIRM',
    artifact_id: revised.artifact_id,
    artifact_version: revised.version,
    stage: revised.stage,
    interaction_phase: 'CONFIRMATION',
    revised_artifact_hash: revised.content_hash,
    prior_feedback_id: 'FB-SELECT',
    decision_owner: 'client_brand_lead',
    decision_question: 'Confirm the revised artifact?',
    options,
    recommendation: { option_id: 'OPT-A', rationale: 'Revision applied.' },
    known_facts: [],
    assumptions: [],
    unknowns: [],
    hard_blocks: [],
    allowed_responses: ['LOCK', 'NONE', 'REVISE', 'REOPEN', 'STOP'],
  }, artifactToken(snapshot, revised));
  assert.deepEqual(snapshot.decision_packets.map((packet) => packet.packet_version), [1, 1]);

  const lockFeedback = {
    feedback_id: 'FB-LOCK', packet_id: 'DP-CONFIRM', action: 'LOCK', decision_owner: 'client_brand_lead',
    selected_option_id: 'OPT-A', confirmed_artifact_hash: revised.content_hash, comment: 'Confirmed and locked.',
  };
  const lockRecord = {
    lock_id: 'LOCK-1', packet_id: 'DP-CONFIRM', prior_feedback_id: 'FB-SELECT', artifact_id: revised.artifact_id,
    artifact_version: revised.version, artifact_hash: revised.content_hash, stage: revised.stage, confirmed_by: 'client_brand_lead',
    signoffs: [{ type: 'CLIENT_DECISION', status: 'APPROVED', reference_id: 'FB-LOCK' }],
  };
  const decisionRecord = {
    decision_id: 'DEC-LOCK-1', packet_id: 'DP-CONFIRM', artifact_id: revised.artifact_id, artifact_version: revised.version,
    decision_owner: 'client_brand_lead', outcome: 'LOCK', lock_id: 'LOCK-1', rationale: 'Explicit confirmation completed.',
    rejected_option_ids: [], residual_risks: [], reopen_conditions: ['Material brief change'],
  };
  await assert.rejects(store.appendHumanFeedback(root, lockFeedback, artifactToken(snapshot, revised)), { code: 'ATOMIC_LOCK_REQUIRED' });
  await assert.rejects(store.appendLockRecord(root, lockRecord, artifactToken(snapshot, revised)), { code: 'ATOMIC_LOCK_REQUIRED' });
  await assert.rejects(store.appendDecision(root, decisionRecord, artifactToken(snapshot, revised)), { code: 'ATOMIC_LOCK_REQUIRED' });
  const inconsistentLocks = [
    { label: 'non-lock decision', mutate: (spec) => { spec.decision_record.outcome = 'REVISE'; delete spec.decision_record.lock_id; } },
    { label: 'decision packet mismatch', mutate: (spec) => { spec.decision_record.packet_id = 'DP-OTHER'; } },
    { label: 'decision owner mismatch', mutate: (spec) => { spec.decision_record.decision_owner = 'other_owner'; } },
    { label: 'lock confirmer mismatch', mutate: (spec) => { spec.lock_record.confirmed_by = 'other_owner'; } },
    { label: 'client signoff reference mismatch', mutate: (spec) => { spec.lock_record.signoffs[0].reference_id = 'FB-OTHER'; } },
  ];
  for (const [index, candidate] of inconsistentLocks.entries()) {
    const malformed = structuredClone({ feedback: lockFeedback, lock_record: lockRecord, decision_record: decisionRecord });
    malformed.operation_id = `OP-INCONSISTENT-LOCK-${index + 1}`;
    candidate.mutate(malformed);
    await assert.rejects(store.commitLock(root, malformed, artifactToken(snapshot, revised)), {
      code: 'LOCK_COMMIT_INCONSISTENT',
    }, candidate.label);
  }
  assert.equal((await store.loadSnapshot(root)).project.revision, snapshot.project.revision);
  snapshot = await store.commitLock(root, {
    operation_id: 'OP-LOOP-LOCK', feedback: lockFeedback, lock_record: lockRecord, decision_record: decisionRecord,
  }, artifactToken(snapshot, revised));

  const recovered = await new ProjectStore().loadSnapshot(root);
  assert.equal(recovered.project.revision, 5);
  assert.equal(recovered.decision_packets.length, 2);
  assert.equal(recovered.human_feedback.length, 2);
  assert.equal(recovered.lock_records.length, 1);
  assert.equal(recovered.interactions.length, 5);
  assert.equal(recovered.decisions[0].lock_id, 'LOCK-1');
  assert.equal(recovered.artifacts.find((candidate) => candidate.artifact_id === revised.artifact_id).status, 'LOCKED');
  assert.ok(recovered.interactions.every((record) => record.project_id === projectSpec.project_id));
  assert.ok(recovered.interactions.every((record) => /^[0-9a-f]{64}$/.test(record.record_hash)));
  assert.equal((await new ProjectStore().verifyIntegrity(root)).interaction_count, 5);
});

test('proposal, feedback revision, and lock commit atomically and retry idempotently after ambiguous WAL commits', async (t) => {
  const root = await temporaryRoot(t);
  const normal = new ProjectStore();
  await normal.createProject(root, projectSpec);
  let snapshot = await normal.createArtifact(root, artifactSpec('ART-ATOMIC', 'client_brief', { status: 'INTERNAL_REVIEW' }), 0);
  const original = snapshot.artifacts[0];
  const options = [{ id: 'OPT-A', proposition: 'Atomic route', strengths: ['Coherent'], risks: ['Needs confirmation'] }];
  const proposal = {
    packet_id: 'DP-ATOMIC-PROPOSAL',
    artifact_id: original.artifact_id,
    artifact_version: original.version,
    stage: original.stage,
    interaction_phase: 'PROPOSAL',
    decision_owner: 'client_brand_lead',
    decision_question: 'Advance this route?',
    options,
    recommendation: { option_id: 'OPT-A', rationale: 'Best current route.' },
    known_facts: [], assumptions: [], unknowns: [], hard_blocks: [],
    allowed_responses: ['SELECT', 'ADVISE', 'NONE', 'REVISE', 'REOPEN', 'STOP'],
  };
  const proposalCommit = { packet: proposal, operation_id: 'OP-PROPOSAL-1' };
  snapshot = await normal.commitProposal(root, proposalCommit, 1);
  assert.equal(snapshot.project.revision, 2);
  assert.equal(snapshot.artifacts[0].status, 'PROPOSED');
  assert.equal(snapshot.decision_packets.length, 1);
  const proposalRetry = await normal.commitProposal(root, proposalCommit, 1);
  assert.equal(proposalRetry.project.revision, 2);
  assert.equal(proposalRetry.decision_packets.length, 1);

  const feedbackCommit = {
    operation_id: 'OP-FEEDBACK-1',
    feedback: {
      feedback_id: 'FB-ATOMIC-SELECT',
      packet_id: proposal.packet_id,
      action: 'SELECT',
      decision_owner: proposal.decision_owner,
      selected_option_id: 'OPT-A',
      comment: 'Revise this route.',
    },
    revised_artifact: {
      artifact_id: 'ART-ATOMIC-R1',
      path: 'artifacts/ART-ATOMIC-R1.md',
      content: '# ART-ATOMIC revised\n',
    },
  };
  let feedbackFault = false;
  const interruptedFeedback = new ProjectStore({
    faultInjector(stage) {
      if (!feedbackFault && stage === FAULT_STAGES.AFTER_PROJECT_COMMITTED) {
        feedbackFault = true;
        throw new Error('ambiguous feedback commit');
      }
    },
  });
  const originalToken = {
    project_revision: 2,
    artifact_id: original.artifact_id,
    artifact_version: original.version,
    artifact_hash: original.content_hash,
  };
  await assert.rejects(interruptedFeedback.commitFeedback(root, feedbackCommit, originalToken), /ambiguous feedback commit/);
  snapshot = await normal.commitFeedback(root, feedbackCommit, originalToken);
  assert.equal(snapshot.project.revision, 3);
  assert.equal(snapshot.human_feedback.length, 1);
  const revised = snapshot.artifacts.find((artifact) => artifact.artifact_id === 'ART-ATOMIC-R1');
  assert.equal(revised.status, 'REVISED');
  assert.equal(revised.previous_version_id, original.artifact_id);

  const confirmation = {
    packet_id: 'DP-ATOMIC-CONFIRM',
    artifact_id: revised.artifact_id,
    artifact_version: revised.version,
    stage: revised.stage,
    interaction_phase: 'CONFIRMATION',
    revised_artifact_hash: revised.content_hash,
    prior_feedback_id: 'FB-ATOMIC-SELECT',
    decision_owner: 'client_brand_lead',
    decision_question: 'Lock the revised route?',
    options,
    recommendation: { option_id: 'OPT-A', rationale: 'Requested revision is present.' },
    known_facts: [], assumptions: [], unknowns: [], hard_blocks: [],
    allowed_responses: ['LOCK', 'NONE', 'REVISE', 'REOPEN', 'STOP'],
  };
  snapshot = await normal.commitInteraction(root, {
    packet: confirmation,
    operation_id: 'OP-CONFIRMATION-1',
  }, {
    project_revision: 3,
    artifact_id: revised.artifact_id,
    artifact_version: revised.version,
    artifact_hash: revised.content_hash,
  });
  assert.equal(snapshot.project.revision, 4);

  const lockCommit = {
    operation_id: 'OP-LOCK-1',
    feedback: {
      feedback_id: 'FB-ATOMIC-LOCK',
      packet_id: confirmation.packet_id,
      action: 'LOCK',
      decision_owner: confirmation.decision_owner,
      selected_option_id: 'OPT-A',
      confirmed_artifact_hash: revised.content_hash,
      comment: 'Lock confirmed.',
    },
    lock_record: {
      lock_id: 'LOCK-ATOMIC-1',
      packet_id: confirmation.packet_id,
      prior_feedback_id: 'FB-ATOMIC-SELECT',
      artifact_id: revised.artifact_id,
      artifact_version: revised.version,
      artifact_hash: revised.content_hash,
      stage: revised.stage,
      confirmed_by: confirmation.decision_owner,
      signoffs: [{ type: 'CLIENT_DECISION', status: 'APPROVED', reference_id: 'FB-ATOMIC-LOCK' }],
    },
    decision_record: {
      decision_id: 'DEC-ATOMIC-LOCK',
      packet_id: confirmation.packet_id,
      artifact_id: revised.artifact_id,
      artifact_version: revised.version,
      decision_owner: confirmation.decision_owner,
      outcome: 'LOCK',
      lock_id: 'LOCK-ATOMIC-1',
      rationale: 'Explicit confirmation completed.',
      rejected_option_ids: [], residual_risks: [], reopen_conditions: ['Material brief change'],
    },
  };
  const revisedToken = {
    project_revision: 4,
    artifact_id: revised.artifact_id,
    artifact_version: revised.version,
    artifact_hash: revised.content_hash,
  };
  let lockFault = false;
  const interruptedLock = new ProjectStore({
    faultInjector(stage) {
      if (!lockFault && stage === FAULT_STAGES.AFTER_PROJECT_COMMITTED) {
        lockFault = true;
        throw new Error('ambiguous lock commit');
      }
    },
  });
  await assert.rejects(interruptedLock.commitLock(root, lockCommit, revisedToken), /ambiguous lock commit/);
  snapshot = await normal.commitLock(root, lockCommit, revisedToken);
  assert.equal(snapshot.project.revision, 5);
  assert.equal(snapshot.artifacts.find((artifact) => artifact.artifact_id === revised.artifact_id).status, 'LOCKED');
  assert.equal(snapshot.human_feedback.length, 2);
  assert.equal(snapshot.lock_records.length, 1);
  assert.equal(snapshot.decisions.length, 1);
  assert.equal(snapshot.events.filter((event) => event.details?.operation_id === 'OP-LOCK-1').length, 1);
  assert.equal((await normal.verifyIntegrity(root)).pending_transactions, 0);
});

test('attempt inspection cannot promote malformed media even when its hash is correct', async (t) => {
  const root = await temporaryRoot(t, 'tcis-malformed-media-');
  const store = new ProjectStore();
  await store.createProject(root, projectSpec);
  const snapshot = await store.createArtifact(root, artifactSpec('ART-MEDIA'), 0);
  const artifact = snapshot.artifacts.find((candidate) => candidate.artifact_id === 'ART-MEDIA');
  await mkdir(path.join(root, 'media'), { recursive: true });
  await writeFile(path.join(root, 'media', 'broken.png'), Buffer.from('not an image'));
  await assert.rejects(
    () => store.addAttempt(root, {
      schema_version: '1.0.0',
      project_id: projectSpec.project_id,
      attempt_id: 'AT-BROKEN',
      artifact_id: artifact.artifact_id,
      status: 'INSPECTED',
      tool: 'codex_native_imagegen',
      request_hash: 'a'.repeat(64),
      reference_ids: [],
      output_path: 'media/broken.png',
      inspection: { passed: false, inspector: 'creative_lead', checks: ['actual_file_seen'] },
    }, {
      project_revision: snapshot.project.revision,
      artifact_id: artifact.artifact_id,
      artifact_version: artifact.version,
      artifact_hash: artifact.content_hash,
    }),
    { code: 'UNRECOGNIZED_MEDIA' },
  );

  const signatureLieMp4 = Buffer.from('0000000066747970000000006d6f6f760000000000000000', 'hex');
  await writeFile(path.join(root, 'media', 'signature-lie.mp4'), signatureLieMp4);
  await assert.rejects(
    () => store.addAttempt(root, {
      schema_version: '1.0.0',
      project_id: projectSpec.project_id,
      attempt_id: 'AT-SIGNATURE-LIE',
      artifact_id: artifact.artifact_id,
      status: 'SELECTED',
      tool: 'external_video_generator',
      request_hash: 'b'.repeat(64),
      reference_ids: [],
      output_path: 'media/signature-lie.mp4',
      inspection: { passed: true, inspector: 'media_inspector', checks: ['actual_file_seen'] },
      selected_by: 'client_owner',
    }, {
      project_revision: snapshot.project.revision,
      artifact_id: artifact.artifact_id,
      artifact_version: artifact.version,
      artifact_hash: artifact.content_hash,
    }),
    { code: 'MALFORMED_MP4' },
  );
  assert.equal((await store.loadSnapshot(root)).attempts.length, 0);
});

test('shot, selected take, and timeline persist and recover with actual-media lineage', async (t) => {
  const root = await temporaryRoot(t, 'tcis-production-state-');
  const store = new ProjectStore();
  await store.createProject(root, { ...projectSpec, production_mode: 'hybrid' });
  let snapshot = await store.createArtifact(root, artifactSpec('ART-PPM', 'ppm_production_plan'), 0);
  let artifact = snapshot.artifacts.find((candidate) => candidate.artifact_id === 'ART-PPM');
  const token = () => ({
    project_revision: snapshot.project.revision,
    artifact_id: artifact.artifact_id,
    artifact_version: artifact.version,
    artifact_hash: artifact.content_hash,
  });
  snapshot = await store.addShot(root, {
    schema_version: '1.0.0', project_id: projectSpec.project_id, shot_id: 'SH-001', artifact_id: artifact.artifact_id,
    stage: 'P11_PREPRODUCTION_PPM', status: 'APPROVED', objective: 'Show the proof', start_state: 'Closed', end_state: 'Open',
    action: 'Hand opens product', duration_seconds: 2, continuity: ['same hand'], prohibitions: ['no label drift'], source_artifact_ids: [artifact.artifact_id],
  }, token());
  artifact = snapshot.artifacts.find((candidate) => candidate.artifact_id === 'ART-PPM');
  await mkdir(path.join(root, 'media'), { recursive: true });
  await writeFile(path.join(root, 'media', 'take-001.png'), onePixelPng);
  snapshot = await store.addTake(root, {
    schema_version: '1.0.0', project_id: projectSpec.project_id, take_id: 'TAKE-001', shot_id: 'SH-001', kind: 'LIVE_ACTION',
    status: 'SELECTED', media_path: 'media/take-001.png', duration_seconds: 2,
    inspection: { passed: true, inspector: 'commercial_director', checks: ['actual_file_seen'] }, selected_by: 'client_owner',
  }, token());
  artifact = snapshot.artifacts.find((candidate) => candidate.artifact_id === 'ART-PPM');
  snapshot = await store.addTimeline(root, {
    schema_version: '1.0.0', project_id: projectSpec.project_id, timeline_id: 'TL-001', artifact_id: artifact.artifact_id,
    version: 1, fps: 25, duration_seconds: 2,
    tracks: [{ track_id: 'V1', kind: 'VIDEO', clips: [{ clip_id: 'CLIP-001', shot_id: 'SH-001', take_id: 'TAKE-001', start_seconds: 0, duration_seconds: 2 }] }],
  }, token());

  const recovered = await new ProjectStore().loadSnapshot(root);
  assert.equal(recovered.shots.length, 1);
  assert.equal(recovered.takes.length, 1);
  assert.equal(recovered.timelines.length, 1);
  assert.equal(recovered.timelines[0].tracks[0].clips[0].take_id, 'TAKE-001');
  assert.match(recovered.takes[0].media_hash, /^[0-9a-f]{64}$/);
});

test('content tampering and malformed canonical state are detected', async (t) => {
  const contentRoot = await temporaryRoot(t, 'tcis-content-corrupt-');
  const store = new ProjectStore();
  await store.createProject(contentRoot, projectSpec);
  await store.createArtifact(contentRoot, artifactSpec('ART-TAMPER'), 0);
  await writeFile(path.join(contentRoot, 'artifacts', 'ART-TAMPER.md'), 'tampered', 'utf8');
  await assert.rejects(store.loadSnapshot(contentRoot), { code: 'CONTENT_HASH_MISMATCH' });

  const stateRoot = await temporaryRoot(t, 'tcis-state-corrupt-');
  await store.createProject(stateRoot, { ...projectSpec, project_id: 'PRJ-CORRUPT' });
  const project = JSON.parse(await readFile(path.join(stateRoot, 'project.json'), 'utf8'));
  const eventsPath = path.join(stateRoot, ...project.state_path.split('/'), CANONICAL_STATE_FILES.events);
  await writeFile(eventsPath, '{"partial":', 'utf8');
  await assert.rejects(store.loadSnapshot(stateRoot), { code: 'CANONICAL_FILE_HASH_MISMATCH' });

  const pointerRoot = await temporaryRoot(t, 'tcis-pointer-corrupt-');
  await store.createProject(pointerRoot, { ...projectSpec, project_id: 'PRJ-POINTER' });
  const pointerPath = path.join(pointerRoot, 'project.json');
  const pointer = JSON.parse(await readFile(pointerPath, 'utf8'));
  pointer.revision += 1;
  await writeFile(pointerPath, `${JSON.stringify(pointer)}\n`, 'utf8');
  await assert.rejects(store.loadSnapshot(pointerRoot), { code: 'STATE_POINTER_MISMATCH' });
});

test('WAL interruption before pointer commit deterministically rolls back to the prior revision', async (t) => {
  const root = await temporaryRoot(t);
  const normal = new ProjectStore();
  await normal.createProject(root, projectSpec);
  let injected = false;
  const interrupted = new ProjectStore({
    faultInjector(stage) {
      if (!injected && stage === FAULT_STAGES.AFTER_REVISION_PUBLISHED) {
        injected = true;
        throw new Error('injected after revision publication');
      }
    },
  });
  await assert.rejects(
    interrupted.createArtifact(root, artifactSpec('ART-WAL'), 0),
    /injected after revision publication/,
  );

  const recovered = await normal.loadSnapshot(root);
  assert.equal(recovered.project.revision, 0);
  assert.equal(recovered.artifacts.length, 0);
  assert.equal((await normal.verifyIntegrity(root)).pending_transactions, 0);

  const retried = await normal.createArtifact(root, artifactSpec('ART-WAL'), 0);
  assert.equal(retried.project.revision, 1);
  assert.equal(retried.artifacts[0].artifact_id, 'ART-WAL');
  assert.equal((await normal.verifyIntegrity(root)).pending_transactions, 0);
});

test('WAL interruption after pointer CAS recovers the committed revision exactly once', async (t) => {
  const root = await temporaryRoot(t);
  const normal = new ProjectStore();
  await normal.createProject(root, projectSpec);
  let injected = false;
  const interrupted = new ProjectStore({
    faultInjector(stage) {
      if (!injected && stage === FAULT_STAGES.AFTER_PROJECT_COMMITTED) {
        injected = true;
        throw new Error('injected after project commit');
      }
    },
  });
  await assert.rejects(
    interrupted.createArtifact(root, artifactSpec('ART-COMMITTED'), 0),
    /injected after project commit/,
  );

  const recovered = await normal.loadSnapshot(root);
  assert.equal(recovered.project.revision, 1);
  assert.equal(recovered.artifacts[0].artifact_id, 'ART-COMMITTED');
  assert.equal((await normal.verifyIntegrity(root)).pending_transactions, 0);
  assert.deepEqual(await walJsonFiles(root), []);
  assert.deepEqual(await revisionDirectoryNames(root), ['000000000001']);

  const advanced = await normal.transitionArtifact(root, 'ART-COMMITTED', 'INTERNAL_REVIEW', 1);
  assert.equal(advanced.project.revision, 2);
  assert.equal((await normal.verifyIntegrity(root)).pending_transactions, 0);
  assert.deepEqual(await walJsonFiles(root), []);
  assert.deepEqual(await revisionDirectoryNames(root), ['000000000002']);
});

test('a committed pointer is recoverable without its terminal WAL record', async (t) => {
  const root = await temporaryRoot(t, 'tcis-no-terminal-wal-');
  const normal = new ProjectStore();
  await normal.createProject(root, { ...projectSpec, project_id: 'PRJ-NO-TERMINAL-WAL' });
  assert.deepEqual(await walJsonFiles(root), []);

  const interrupted = new ProjectStore({
    faultInjector(stage) {
      if (stage === FAULT_STAGES.AFTER_WAL_COMMITTED) throw new Error('injected after terminal WAL');
    },
  });
  await assert.rejects(
    interrupted.addFact(root, { fact_id: 'FACT-COMMITTED', text: 'Committed fact', source: 'fixture' }, 0),
    /injected after terminal WAL/,
  );

  const terminalFiles = await walJsonFiles(root);
  assert.equal(terminalFiles.length, 1);
  const terminalPath = path.join(root, '.tcis', 'wal', terminalFiles[0]);
  assert.equal(JSON.parse(await readFile(terminalPath, 'utf8')).phase, 'COMMITTED');
  await unlink(terminalPath);

  const recovered = await normal.loadSnapshot(root);
  assert.equal(recovered.project.revision, 1);
  assert.equal(recovered.facts[0].fact_id, 'FACT-COMMITTED');
  assert.deepEqual(await walJsonFiles(root), []);
  assert.deepEqual(await revisionDirectoryNames(root), ['000000000001']);
});

test('content published after WAL is removed on rollback before pointer commit', async (t) => {
  const root = await temporaryRoot(t);
  const normal = new ProjectStore();
  await normal.createProject(root, { ...projectSpec, project_id: 'PRJ-CONTENT-WAL' });
  let injected = false;
  const interrupted = new ProjectStore({
    faultInjector(stage) {
      if (!injected && stage === FAULT_STAGES.AFTER_CONTENT_PUBLISHED) {
        injected = true;
        throw new Error('injected after content publication');
      }
    },
  });

  const artifactPath = path.join(root, 'artifacts', 'ART-CONTENT-WAL.md');
  await assert.rejects(
    interrupted.createArtifact(root, artifactSpec('ART-CONTENT-WAL'), 0),
    /injected after content publication/,
  );
  assert.equal(await existsForTest(artifactPath), true);

  const recovered = await normal.loadSnapshot(root);
  assert.equal(recovered.project.revision, 0);
  assert.equal(recovered.artifacts.length, 0);
  assert.equal(await existsForTest(artifactPath), false);
  assert.equal((await normal.verifyIntegrity(root)).pending_transactions, 0);

  const retried = await normal.createArtifact(root, artifactSpec('ART-CONTENT-WAL'), 0);
  assert.equal(retried.project.revision, 1);
  assert.equal(retried.artifacts[0].artifact_id, 'ART-CONTENT-WAL');
});

test('WAL recovery rejects cross-project identity and reserved publication targets', async (t) => {
  async function createInterrupted(projectId, artifactId) {
    const root = await temporaryRoot(t);
    const normal = new ProjectStore();
    await normal.createProject(root, { ...projectSpec, project_id: projectId });
    const interrupted = new ProjectStore({
      faultInjector(stage) {
        if (stage === FAULT_STAGES.AFTER_WAL_PREPARED) throw new Error('pending WAL');
      },
    });
    await assert.rejects(interrupted.createArtifact(root, artifactSpec(artifactId), 0), /pending WAL/);
    const walDirectory = path.join(root, '.tcis', 'wal');
    const pendingPath = await findPendingWal(walDirectory);
    return { root, pendingPath, record: JSON.parse(await readFile(pendingPath, 'utf8')) };
  }

  const crossProject = await createInterrupted('PRJ-WAL-SCOPE', 'ART-WAL-SCOPE');
  crossProject.record.project_id = 'PRJ-OTHER';
  await writeFile(crossProject.pendingPath, `${JSON.stringify(crossProject.record)}\n`, 'utf8');
  await assert.rejects(new ProjectStore().loadSnapshot(crossProject.root), { code: 'WAL_DIVERGENCE' });

  const reserved = await createInterrupted('PRJ-WAL-RESERVED', 'ART-WAL-RESERVED');
  reserved.record.content_publications[0].relative_path = '.tcis/wal/foreign.json';
  await writeFile(reserved.pendingPath, `${JSON.stringify(reserved.record)}\n`, 'utf8');
  await assert.rejects(new ProjectStore().loadSnapshot(reserved.root), { code: 'MALFORMED_WAL' });
});

test('fixed-size mutations keep cumulative revision storage near-linear', { timeout: 30_000 }, async (t) => {
  const root = await temporaryRoot(t, 'tcis-storage-scale-');
  const store = new ProjectStore();
  let snapshot = await store.createProject(root, { ...projectSpec, project_id: 'PRJ-STORAGE-SCALE' });
  const measurements = new Map();

  for (let index = 1; index <= 32; index += 1) {
    const suffix = String(index).padStart(3, '0');
    snapshot = await store.addFact(root, {
      fact_id: `FACT-SCALE-${suffix}`,
      text: 'Fixed-width storage growth fixture.',
      source: 'scale-test',
    }, snapshot.project.revision);
    if (index === 16 || index === 32) {
      measurements.set(index, await directoryBytes(path.join(root, '.tcis', 'revisions')));
      assert.deepEqual(await revisionDirectoryNames(root), [String(index).padStart(12, '0')]);
    }
  }

  const first = measurements.get(16);
  const second = measurements.get(32);
  assert.ok(second <= first * 2.4, `revision storage grew ${second / first}x when mutation count doubled (${first} -> ${second} bytes)`);
  assert.equal((await store.loadSnapshot(root)).facts.length, 32);
  assert.deepEqual(await walJsonFiles(root), []);
});

async function findPendingWal(walDirectory) {
  for (const name of await readdir(walDirectory)) {
    if (!name.endsWith('.json')) continue;
    const candidate = path.join(walDirectory, name);
    const record = JSON.parse(await readFile(candidate, 'utf8'));
    if (!['COMMITTED', 'ROLLED_BACK'].includes(record.phase)) return candidate;
  }
  throw new Error('pending WAL not found');
}

async function walJsonFiles(root) {
  try {
    return (await readdir(path.join(root, '.tcis', 'wal')))
      .filter((name) => name.endsWith('.json'))
      .sort();
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function revisionDirectoryNames(root) {
  try {
    return (await readdir(path.join(root, '.tcis', 'revisions'), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && /^\d{12}$/.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function directoryBytes(directory) {
  let total = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) total += await directoryBytes(candidate);
    else if (entry.isFile()) total += (await stat(candidate)).size;
  }
  return total;
}

async function existsForTest(candidate) {
  try {
    await stat(candidate);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}
