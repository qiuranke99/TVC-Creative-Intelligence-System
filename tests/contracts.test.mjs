import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SCHEMA_VERSION,
  validateArtifact,
  validateArtifactTransition,
  validateAttempt,
  validateClaim,
  validateDependency,
  validateDecisionPacket,
  validateHumanFeedback,
  validateLockRecord,
  validatePlatformApplicability,
  validateProject,
  validateRight,
  validateShot,
  validateTake,
  validateTimeline,
} from '../src/tcis/contracts.mjs';

const project = {
  schema_version: SCHEMA_VERSION,
  project_id: 'PRJ-001',
  title: 'Fixture',
  scope_mode: 'single_tvc',
  production_mode: 'live_action',
  current_stage: 'P0_BRIEF_ALIGNMENT',
  status: 'ACTIVE',
  revision: 0,
  active_artifact_id: null,
  created_at: '2026-07-11T00:00:00.000Z',
  updated_at: '2026-07-11T00:00:00.000Z',
};

test('project contract accepts a valid project', () => {
  const validated = validateProject(project);
  assert.deepEqual(validated, project);
  assert.notEqual(validated, project);
  assert.equal(Object.isFrozen(validated), true);
});

test('unknown commercial or real-world proof fields cannot be smuggled into canonical state', () => {
  assert.throws(() => validateProject({ ...project, commercialProductionReadiness: 'PROVEN' }), { code: 'UNSCOPED_PROOF_FIELD' });
});

test('artifact cannot skip the human revision state into lock', () => {
  assert.throws(() => validateArtifactTransition('PROPOSED', 'LOCKED'), { code: 'INVALID_ARTIFACT_TRANSITION' });
  assert.equal(validateArtifactTransition('REVISED', 'LOCKED'), true);
});

test('decision packet requires none and reopen escape responses', () => {
  const packet = {
    schema_version: SCHEMA_VERSION,
    project_id: 'PRJ-001',
    packet_id: 'DP-1',
    artifact_id: 'ART-1',
    artifact_version: 1,
    stage: 'P4_CREATIVE_ROUTES',
    interaction_phase: 'PROPOSAL',
    decision_owner: 'client_brand_lead',
    decision_question: 'Which route should advance?',
    options: [{ id: 'A', proposition: 'Route A', strengths: [], risks: [] }],
    recommendation: { option_id: 'A', rationale: 'Best fit.' },
    known_facts: [],
    assumptions: [],
    unknowns: [],
    hard_blocks: [],
    allowed_responses: ['SELECT'],
  };
  assert.throws(() => validateDecisionPacket(packet), { code: 'MISSING_ESCAPE_RESPONSE' });
});

test('unsupported claim cannot be marked cleared', () => {
  assert.throws(
    () => validateClaim({ schema_version: SCHEMA_VERSION, record_type: 'CLAIM', project_id: 'PRJ-001', claim_id: 'CL-1', kind: 'IMPLIED', text: 'Works instantly', evidence_status: 'LIMITED', clearance_status: 'CLEARED', evidence_refs: [], clearance_refs: [] }),
    { code: 'CLAIM_WITHOUT_SUPPORT' },
  );
});

test('prompt success cannot be selected without inspection', () => {
  assert.throws(
    () => validateAttempt({ schema_version: SCHEMA_VERSION, project_id: 'PRJ-001', attempt_id: 'AT-1', artifact_id: 'ART-1', status: 'SELECTED', tool: 'native_imagegen', request_hash: 'a'.repeat(64), reference_ids: [], output_path: 'x.png', output_hash: 'b'.repeat(64), selected_by: 'user' }),
    { code: 'OBJECT_REQUIRED' },
  );
});

test('platform is rejected for a one-off TVC', () => {
  assert.throws(
    () => validatePlatformApplicability({ project, platform: {} }),
    { code: 'PLATFORM_SCOPE_MISMATCH' },
  );
});

test('shots cannot be created before production-ready stages', () => {
  assert.throws(
    () => validateShot({
      schema_version: SCHEMA_VERSION,
      project_id: 'PRJ-001',
      shot_id: 'SH-1',
      artifact_id: 'ART-1',
      stage: 'P8_VISUAL_PREDEVELOPMENT',
      status: 'PLANNED',
      objective: 'Show product proof.',
      start_state: 'Closed package.',
      end_state: 'Open package.',
      action: 'Hand opens package.',
      duration_seconds: 2,
      continuity: [],
      prohibitions: [],
      source_artifact_ids: ['ART-1'],
    }),
    { code: 'SHOT_TOO_EARLY' },
  );
});

test('selected takes require an actual media inspection', () => {
  assert.throws(
    () => validateTake({
      schema_version: SCHEMA_VERSION,
      project_id: 'PRJ-001',
      take_id: 'TAKE-1',
      shot_id: 'SH-1',
      kind: 'AI_GENERATED',
      status: 'SELECTED',
      attempt_id: 'AT-1',
      media_path: 'media/take-1.mp4',
      media_hash: 'c'.repeat(64),
      duration_seconds: 2,
      selected_by: 'client',
    }),
    { code: 'OBJECT_REQUIRED' },
  );
});

test('timeline clips cannot extend beyond the master duration', () => {
  assert.throws(
    () => validateTimeline({
      schema_version: SCHEMA_VERSION,
      project_id: 'PRJ-001',
      timeline_id: 'TL-1',
      artifact_id: 'ART-OFFLINE',
      version: 1,
      fps: 25,
      duration_seconds: 6,
      tracks: [{
        track_id: 'V1',
        kind: 'VIDEO',
        clips: [{ clip_id: 'C1', shot_id: 'SH-1', take_id: 'TAKE-1', start_seconds: 5, duration_seconds: 2 }],
      }],
    }),
    { code: 'CLIP_OUTSIDE_TIMELINE' },
  );
});

test('timeline clips on one track cannot overlap', () => {
  assert.throws(
    () => validateTimeline({
      schema_version: SCHEMA_VERSION,
      project_id: 'PRJ-001',
      timeline_id: 'TL-OVERLAP',
      artifact_id: 'ART-OFFLINE',
      version: 1,
      fps: 25,
      duration_seconds: 6,
      tracks: [{
        track_id: 'V1',
        kind: 'VIDEO',
        clips: [
          { clip_id: 'C1', shot_id: 'SH-1', take_id: 'TAKE-1', start_seconds: 0, duration_seconds: 4 },
          { clip_id: 'C2', shot_id: 'SH-2', take_id: 'TAKE-2', start_seconds: 3, duration_seconds: 2 },
        ],
      }],
    }),
    { code: 'OVERLAPPING_CLIPS' },
  );
});

test('unsafe IDs and paths are rejected before persistence', () => {
  assert.throws(() => validateProject({ ...project, project_id: '..\\victim' }), { code: 'INVALID_ID' });
  assert.throws(
    () => validateAttempt({
      project_id: 'PRJ-001',
      attempt_id: 'AT-1',
      schema_version: SCHEMA_VERSION,
      artifact_id: 'ART-1',
      status: 'GENERATED',
      tool: 'native_imagegen',
      request_hash: 'a'.repeat(64),
      reference_ids: [],
      output_path: '..\\victim\\fake.png',
      output_hash: 'b'.repeat(64),
    }),
    { code: 'UNSAFE_RELATIVE_PATH' },
  );
});

test('feedback owner and action are bound to the decision packet', () => {
  const packet = validateDecisionPacket({
    schema_version: SCHEMA_VERSION,
    project_id: 'PRJ-001',
    packet_id: 'DP-OWNER',
    artifact_id: 'ART-1',
    artifact_version: 1,
    stage: 'P4_CREATIVE_ROUTES',
    interaction_phase: 'PROPOSAL',
    decision_owner: 'client_owner',
    decision_question: 'Choose?',
    options: [{ id: 'A', proposition: 'A', strengths: [], risks: [] }],
    recommendation: { option_id: 'A', rationale: 'Reason.' },
    known_facts: [], assumptions: [], unknowns: [], hard_blocks: [],
    allowed_responses: ['SELECT', 'NONE', 'REOPEN'],
  });
  assert.throws(
    () => validateHumanFeedback({ schema_version: SCHEMA_VERSION, project_id: 'PRJ-001', feedback_id: 'FB-1', packet_id: 'DP-OWNER', action: 'SELECT', decision_owner: 'mallory', selected_option_id: 'A', comment: 'Take it.' }, packet),
    { code: 'EXACT_VALUE_REQUIRED' },
  );
  assert.throws(
    () => validateHumanFeedback({ schema_version: SCHEMA_VERSION, project_id: 'PRJ-001', feedback_id: 'FB-2', packet_id: 'DP-OWNER', action: 'LOCK', decision_owner: 'client_owner', selected_option_id: 'A', comment: 'Lock.' }, packet),
    { code: 'ACTION_NOT_ALLOWED' },
  );
});

test('artifact ownership and decision-bearing authority are exact', () => {
  const base = {
    schema_version: SCHEMA_VERSION,
    project_id: 'PRJ-001',
    artifact_id: 'ART-ROUTES-1',
    type: 'creative_routes',
    stage: 'P4_CREATIVE_ROUTES',
    status: 'DRAFT',
    version: 1,
    owner_capability: 'creative_director',
    decision_bearing: true,
    input_artifact_ids: [],
    path: 'artifacts/routes-v1.md',
    content_hash: 'a'.repeat(64),
    created_at: '2026-07-11T00:00:00.000Z',
    updated_at: '2026-07-11T00:00:00.000Z',
  };
  assert.doesNotThrow(() => validateArtifact(base));
  assert.throws(() => validateArtifact({ ...base, owner_capability: 'production_designer' }), { code: 'EXACT_VALUE_REQUIRED' });
  assert.throws(() => validateArtifact({ ...base, decision_bearing: false }), { code: 'EXACT_VALUE_REQUIRED' });
});

test('platform applicability rejects duplicate executions and empty mechanics', () => {
  const campaignProject = { ...project, scope_mode: 'campaign_system' };
  assert.throws(
    () => validatePlatformApplicability({ project: campaignProject, platform: {
      organizing_idea: 'One system',
      brand_product_role: 'Proof',
      invariants: ['mechanic'],
      variables: ['audience'],
      prohibitions: ['generic ending'],
      example_executions: ['same', 'same', 'same'],
      coverage_dimensions: ['audience', 'channel'],
    } }),
    { code: 'DUPLICATE_VALUE' },
  );
});

test('platform applicability rejects prototype-only evidence', () => {
  const campaignProject = { ...project, scope_mode: 'campaign_system' };
  const platform = Object.create({
    organizing_idea: 'Inherited', brand_product_role: 'Inherited', invariants: ['mechanic'], variables: ['audience'],
    prohibitions: ['generic'], example_executions: ['A', 'B', 'C'], coverage_dimensions: ['audience', 'channel'],
  });
  assert.throws(() => validatePlatformApplicability({ project: campaignProject, platform }), { code: 'PLATFORM_FIELD_MISSING' });
});

test('platform applicability requires one shared mechanism and varied execution coverage', () => {
  const campaignProject = { ...project, scope_mode: 'campaign_system' };
  const base = {
    organizing_idea: 'Use the wait', brand_product_role: 'Turns waiting into proof',
    invariants: ['waiting mechanic'], variables: ['setting'], prohibitions: ['passive montage'],
    example_executions: ['Commute', 'Checkout', 'Airport'], coverage_dimensions: ['channel', 'situation'],
    execution_evidence: [
      { evidence_kind: 'STRUCTURED_PROTOTYPE', execution_id: 'Commute', mechanism_id: 'M1', coverage: { channel: 'social', situation: 'commute' } },
      { evidence_kind: 'STRUCTURED_PROTOTYPE', execution_id: 'Checkout', mechanism_id: 'M2', coverage: { channel: 'retail', situation: 'checkout' } },
      { evidence_kind: 'STRUCTURED_PROTOTYPE', execution_id: 'Airport', mechanism_id: 'M1', coverage: { channel: 'video', situation: 'airport' } },
    ],
  };
  assert.throws(() => validatePlatformApplicability({ project: campaignProject, platform: base }), { code: 'PLATFORM_MECHANISM_DRIFT' });
  const sameCoverage = {
    ...base,
    execution_evidence: base.execution_evidence.map((item) => ({ ...item, mechanism_id: 'M1', coverage: { channel: 'social', situation: 'commute' } })),
  };
  assert.throws(() => validatePlatformApplicability({ project: campaignProject, platform: sameCoverage }), { code: 'PLATFORM_COVERAGE_DUPLICATE' });
});

test('claims and rights cannot share a hybrid object or infer clearance', () => {
  const hybrid = {
    schema_version: SCHEMA_VERSION,
    record_type: 'CLAIM',
    project_id: 'PRJ-001',
    claim_id: 'CL-1',
    kind: 'EXPRESS',
    text: 'Fast',
    evidence_status: 'SUPPORTED',
    clearance_status: 'CLEARED',
    evidence_refs: ['EV-1'],
    clearance_refs: ['CLR-1'],
    right_id: 'RT-1',
    subject: 'music',
    usage: ['worldwide'],
  };
  assert.throws(() => validateClaim(hybrid), { code: 'CLAIM_RIGHT_TYPE_CONFUSION' });
  assert.throws(() => validateRight({ ...hybrid, record_type: 'RIGHT' }), { code: 'CLAIM_RIGHT_TYPE_CONFUSION' });
});

test('AI-generated takes require a bound generation attempt', () => {
  assert.throws(
    () => validateTake({
      schema_version: SCHEMA_VERSION,
      project_id: 'PRJ-001',
      take_id: 'TAKE-AI',
      shot_id: 'SH-1',
      kind: 'AI_GENERATED',
      status: 'GENERATED',
      media_path: 'media/take-ai.mp4',
      media_hash: 'd'.repeat(64),
      duration_seconds: 2,
    }),
    { code: 'ATTEMPT_REQUIRED' },
  );
});

test('dependencies are versioned and cannot point to themselves', () => {
  assert.throws(
    () => validateDependency({
      schema_version: SCHEMA_VERSION,
      project_id: 'PRJ-001',
      from_artifact_id: 'ART-1',
      from_artifact_version: 1,
      to_artifact_id: 'ART-1',
      to_artifact_version: 2,
      kind: 'DERIVED_FROM',
    }),
    { code: 'SELF_DEPENDENCY' },
  );
});

test('late-stage lock requires independent claims, rights, production and release signoffs', () => {
  const lock = {
    schema_version: SCHEMA_VERSION,
    project_id: 'PRJ-001',
    lock_id: 'LOCK-1',
    packet_id: 'DP-1',
    prior_feedback_id: 'FB-1',
    artifact_id: 'ART-FINAL',
    artifact_version: 1,
    artifact_hash: 'e'.repeat(64),
    stage: 'P14_FINAL_RELEASE',
    confirmed_by: 'client_owner',
    confirmed_at: '2026-07-11T00:00:00.000Z',
    signoffs: [{ type: 'CLIENT_DECISION', status: 'APPROVED', reference_id: 'S-CLIENT' }],
  };
  assert.throws(() => validateLockRecord(lock), { code: 'SIGNOFF_GATE_BLOCKED' });
});

test('template placeholders are invalid canonical state', async () => {
  const { readFile } = await import('node:fs/promises');
  const template = JSON.parse(await readFile(new URL('../templates/project/project.template.json', import.meta.url), 'utf8'));
  assert.throws(() => validateProject(template), { code: 'INVALID_ID' });
});
