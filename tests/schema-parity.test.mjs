import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  ARTIFACT_STATUSES,
  ATTEMPT_STATUSES,
  PRODUCTION_MODES,
  SCHEMA_VERSION,
  SCOPE_MODES,
  TAKE_KINDS,
  TAKE_STATUSES,
  validateAttempt,
  validateArtifact,
  validateClaim,
  validateDecisionPacket,
  validateDependency,
  validateLockRecord,
  validateProject,
  validateTake,
  validateTimeline,
} from '../src/tcis/contracts.mjs';
import { validateJsonSchema } from '../src/tcis/schema-validator.mjs';

const schemas = new Map();

test('schema enums and project scoping match canonical JS constants', async () => {
  const projectSchema = await load('project.schema.json');
  const artifactSchema = await load('artifact.schema.json');
  const attemptSchema = await load('attempt.schema.json');
  const takeSchema = await load('take.schema.json');
  assert.deepEqual(projectSchema.properties.scope_mode.enum, SCOPE_MODES);
  assert.deepEqual(projectSchema.properties.production_mode.enum, PRODUCTION_MODES);
  assert.deepEqual(artifactSchema.properties.status.enum, ARTIFACT_STATUSES);
  assert.deepEqual(attemptSchema.properties.status.enum, ATTEMPT_STATUSES);
  assert.deepEqual(takeSchema.properties.status.enum, TAKE_STATUSES);
  assert.deepEqual(takeSchema.properties.kind.enum, TAKE_KINDS);
  for (const schema of [artifactSchema, attemptSchema, takeSchema, await load('shot.schema.json'), await load('timeline.schema.json'), await load('decision-record.schema.json'), await load('dependency.schema.json')]) {
    assert.ok(schema.required.includes('schema_version'), schema.title);
    assert.ok(schema.required.includes('project_id'), schema.title);
  }
});

test('valid public examples pass both JSON Schema and canonical JS contracts', async () => {
  const packet = JSON.parse(await readFile(new URL('../examples/decision-packet.json', import.meta.url), 'utf8'));
  const attempt = JSON.parse(await readFile(new URL('../examples/selected-attempt.json', import.meta.url), 'utf8'));
  assert.equal(validateJsonSchema(await load('decision-packet.schema.json'), packet).valid, true);
  assert.doesNotThrow(() => validateDecisionPacket(packet));
  assert.equal(validateJsonSchema(await load('attempt.schema.json'), attempt).valid, true);
  assert.doesNotThrow(() => validateAttempt(attempt));
});

test('shared malicious corpus produces the same fail verdict in schema and JS', async () => {
  const baseProject = {
    schema_version: SCHEMA_VERSION, project_id: 'PRJ-1', title: 'Project', scope_mode: 'single_tvc', production_mode: 'live_action',
    current_stage: 'P0_BRIEF_ALIGNMENT', status: 'ACTIVE', revision: 0, active_artifact_id: null,
    created_at: '2026-07-11T00:00:00.000Z', updated_at: '2026-07-11T00:00:00.000Z',
  };
  const cases = [
    ['project.schema.json', { ...baseProject, project_id: '..\\victim' }, validateProject],
    ['claim-right.schema.json', { schema_version: SCHEMA_VERSION, record_type: 'CLAIM', project_id: 'PRJ-1', claim_id: 'CL-1', kind: 'EXPRESS', text: 'Fast', evidence_status: 'LIMITED', clearance_status: 'CLEARED', evidence_refs: [], clearance_refs: [] }, validateClaim],
    ['attempt.schema.json', { schema_version: SCHEMA_VERSION, project_id: 'PRJ-1', attempt_id: 'AT-1', artifact_id: 'ART-1', status: 'SELECTED', tool: 'imagegen', request_hash: 'a'.repeat(64), reference_ids: [], output_path: 'media/x.png', output_hash: 'b'.repeat(64), selected_by: 'user' }, validateAttempt],
    ['take.schema.json', { schema_version: SCHEMA_VERSION, project_id: 'PRJ-1', take_id: 'TAKE-1', shot_id: 'SH-1', kind: 'AI_GENERATED', status: 'GENERATED', media_path: 'media/x.mp4', media_hash: 'c'.repeat(64), duration_seconds: 2 }, validateTake],
  ];
  for (const [schemaName, value, validator] of cases) {
    assert.equal(validateJsonSchema(await load(schemaName), value).valid, false, schemaName);
    assert.throws(() => validator(value), undefined, schemaName);
  }
});

test('red-team schema differential corpus now fails in both schema and JS', async () => {
  const artifact = {
    schema_version: SCHEMA_VERSION, project_id: 'PRJ-1', artifact_id: 'ART-1', type: 'creative_routes',
    stage: 'P4_CREATIVE_ROUTES', status: 'DRAFT', version: 1, owner_capability: 'creative_director', decision_bearing: true,
    input_artifact_ids: [], path: 'artifacts/routes.md', content_hash: 'a'.repeat(64), previous_version_id: null,
    created_at: '2026-07-11T00:00:00.000Z', updated_at: '2026-07-11T00:00:00.000Z',
  };
  const packet = {
    schema_version: SCHEMA_VERSION, project_id: 'PRJ-1', packet_id: 'DP-1', artifact_id: 'ART-1', artifact_version: 1,
    stage: 'P4_CREATIVE_ROUTES', interaction_phase: 'PROPOSAL', decision_owner: 'client_owner', decision_question: 'Choose?',
    options: [{}], recommendation: {}, known_facts: [], assumptions: [], unknowns: [], hard_blocks: [],
    allowed_responses: ['SELECT', 'NONE', 'REOPEN'],
  };
  const cases = [
    ['artifact.schema.json', { ...artifact, stage: 'P4_CREATIVE_ROUTES_SUFFIX' }, validateArtifact],
    ['artifact.schema.json', { ...artifact, owner_capability: 'production_designer' }, validateArtifact],
    ['decision-packet.schema.json', packet, validateDecisionPacket],
    ['project.schema.json', {
      schema_version: SCHEMA_VERSION, project_id: 'PRJ-1', title: 'Project', scope_mode: 'single_tvc', production_mode: 'live_action',
      current_stage: 'P0_BRIEF_ALIGNMENT', status: 'ACTIVE', revision: 0, active_artifact_id: null,
      created_at: '2026-07-11T00:00:00Z', updated_at: '2026-07-11T00:00:00Z',
    }, validateProject],
    ['attempt.schema.json', {
      schema_version: SCHEMA_VERSION, project_id: 'PRJ-1', attempt_id: '', artifact_id: 'ART-1', status: 'REQUESTED',
      tool: 'imagegen', request_hash: 'a'.repeat(64), reference_ids: [],
    }, validateAttempt],
    ['dependency.schema.json', {
      schema_version: SCHEMA_VERSION, project_id: 'PRJ-1', from_artifact_id: 'ART-1', from_artifact_version: 1,
      to_artifact_id: 'ART-1', to_artifact_version: 1, kind: 'DERIVED_FROM',
    }, validateDependency],
    ['timeline.schema.json', {
      schema_version: SCHEMA_VERSION, project_id: 'PRJ-1', timeline_id: 'TL-1', artifact_id: 'ART-1', version: 1,
      fps: 24, duration_seconds: 5, tracks: [{ track_id: 'V1', kind: 'VIDEO', clips: [{ clip_id: 'CL-1', start_seconds: 4, duration_seconds: 2 }] }],
    }, validateTimeline],
    ['lock-record.schema.json', {
      schema_version: SCHEMA_VERSION, project_id: 'PRJ-1', lock_id: 'LK-1', packet_id: 'DP-1', prior_feedback_id: 'FB-1',
      artifact_id: 'ART-1', artifact_version: 1, artifact_hash: 'a'.repeat(64), stage: 'P14_FINAL_RELEASE',
      confirmed_by: 'client_owner', confirmed_at: '2026-07-11T00:00:00.000Z', signoffs: [
        { type: 'CLIENT_DECISION', status: 'APPROVED', reference_id: 'SO-1' },
        { type: 'CLIENT_DECISION', status: 'APPROVED', reference_id: 'SO-2' },
      ],
    }, validateLockRecord],
  ];
  for (const [schemaName, value, validator] of cases) {
    assert.equal(validateJsonSchema(await load(schemaName), value).valid, false, schemaName);
    assert.throws(() => validator(value), undefined, schemaName);
  }
});

async function load(name) {
  if (!schemas.has(name)) {
    schemas.set(name, JSON.parse(await readFile(new URL(`../schemas/tcis/${name}`, import.meta.url), 'utf8')));
  }
  return schemas.get(name);
}
