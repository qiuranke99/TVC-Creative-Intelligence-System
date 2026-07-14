import { ContractError } from './errors.mjs';
import path from 'node:path';
import { immutableSnapshot, nonEmptyString, uniqueStrings } from './utils.mjs';

export const SCHEMA_VERSION = '1.0.0';

export const STAGES = Object.freeze([
  'P0_BRIEF_ALIGNMENT',
  'P1_DIAGNOSIS',
  'P2_COMMUNICATIONS_STRATEGY',
  'P3_CREATIVE_BRIEF',
  'P4_CREATIVE_ROUTES',
  'P5_CORE_CREATIVE_DECISION',
  'P6_TVC_EXPRESSION',
  'P7_SCRIPT_AGENCY_BOARD',
  'P8_VISUAL_PREDEVELOPMENT',
  'P9_PRODUCTION_PITCH',
  'P10_DIRECTOR_TREATMENT_AWARD',
  'P11_PREPRODUCTION_PPM',
  'P12_PRODUCTION_SELECTS',
  'P13_OFFLINE_LOCK',
  'P14_FINAL_RELEASE',
]);

export const SCOPE_MODES = Object.freeze([
  'single_tvc',
  'campaign_system',
  'existing_platform_expression',
  'social_native',
  'version_system',
  'direct_response_or_offer',
  'brand_film',
  'product_demo',
]);

export const PRODUCTION_MODES = Object.freeze([
  'live_action',
  'animation',
  'vfx_first',
  'ai_native',
  'hybrid',
  'director_led',
]);

export const PROJECT_STATUSES = Object.freeze(['ACTIVE', 'STOPPED', 'COMPLETE']);
export const ARTIFACT_STATUSES = Object.freeze([
  'DRAFT',
  'INTERNAL_REVIEW',
  'PROPOSED',
  'REVISED',
  'LOCKED',
  'STALE',
  'BLOCKED',
]);

export const DECISION_ACTIONS = Object.freeze([
  'SELECT',
  'ADVISE',
  'NONE',
  'REVISE',
  'REOPEN',
  'STOP',
  'LOCK',
]);

export const DECISION_OUTCOMES = Object.freeze(['LOCK', 'REVISE', 'REOPEN', 'STOP', 'CONFLICT']);
export const EVIDENCE_STATUSES = Object.freeze(['UNASSESSED', 'SUPPORTED', 'LIMITED', 'CONTRADICTED']);
export const CLEARANCE_STATUSES = Object.freeze(['NOT_ASSESSED', 'PENDING', 'CLEARED', 'BLOCKED', 'NOT_APPLICABLE']);
export const ATTEMPT_STATUSES = Object.freeze(['REQUESTED', 'GENERATED', 'INSPECTED', 'SELECTED', 'REJECTED', 'FAILED']);
export const SHOT_STATUSES = Object.freeze(['PLANNED', 'APPROVED', 'IN_PROGRESS', 'CAPTURED', 'SELECTED', 'LOCKED', 'STALE', 'BLOCKED']);
export const TAKE_STATUSES = Object.freeze(['RECORDED', 'GENERATED', 'INSPECTED', 'SELECTED', 'REJECTED', 'FAILED']);
export const TAKE_KINDS = Object.freeze(['LIVE_ACTION', 'AI_GENERATED', 'ANIMATION', 'VFX', 'ARCHIVAL']);
export const SIGNOFF_STATUSES = Object.freeze(['APPROVED', 'CLEARED', 'NOT_APPLICABLE', 'PENDING', 'BLOCKED']);
export const SIGNOFF_TYPES = Object.freeze(['CLIENT_DECISION', 'STRATEGY', 'CREATIVE', 'CLAIMS', 'RIGHTS', 'PRODUCTION', 'TECHNICAL_QC', 'RELEASE']);

export const ARTIFACT_DEFINITIONS = Object.freeze({
  client_brief: artifact('P0_BRIEF_ALIGNMENT', 'account_project_lead'),
  diagnosis: artifact('P1_DIAGNOSIS', 'strategy_planning_lead'),
  communications_strategy: artifact('P2_COMMUNICATIONS_STRATEGY', 'strategy_planning_lead'),
  creative_brief: artifact('P3_CREATIVE_BRIEF', 'strategy_planning_lead'),
  creative_routes: artifact('P4_CREATIVE_ROUTES', 'creative_director'),
  core_creative_concept: artifact('P5_CORE_CREATIVE_DECISION', 'creative_director'),
  campaign_platform: artifact('P5_CORE_CREATIVE_DECISION', 'creative_director', { conditional: true }),
  tvc_expression: artifact('P6_TVC_EXPRESSION', 'copywriter'),
  script_agency_board: artifact('P7_SCRIPT_AGENCY_BOARD', 'creative_director'),
  visual_predevelopment: artifact('P8_VISUAL_PREDEVELOPMENT', 'agency_art_director'),
  production_pitch: artifact('P9_PRODUCTION_PITCH', 'agency_producer'),
  director_treatment_award: artifact('P10_DIRECTOR_TREATMENT_AWARD', 'commercial_director'),
  ppm_production_plan: artifact('P11_PREPRODUCTION_PPM', 'production_company_producer'),
  production_selects: artifact('P12_PRODUCTION_SELECTS', 'commercial_director'),
  offline_lock: artifact('P13_OFFLINE_LOCK', 'editor'),
  final_release: artifact('P14_FINAL_RELEASE', 'post_producer'),
});

export const STAGE_ARTIFACT = Object.freeze(
  Object.fromEntries(Object.entries(ARTIFACT_DEFINITIONS).filter(([, definition]) => !definition.conditional).map(([type, definition]) => [definition.stage, type])),
);

export const ALLOWED_ARTIFACT_TRANSITIONS = Object.freeze({
  DRAFT: ['INTERNAL_REVIEW', 'BLOCKED'],
  INTERNAL_REVIEW: ['DRAFT', 'PROPOSED', 'BLOCKED'],
  PROPOSED: ['REVISED', 'DRAFT', 'BLOCKED'],
  REVISED: ['PROPOSED', 'LOCKED', 'DRAFT', 'BLOCKED'],
  LOCKED: ['STALE'],
  STALE: ['DRAFT', 'BLOCKED'],
  BLOCKED: ['DRAFT'],
});

export const PLATFORM_REQUIRED_FIELDS = Object.freeze([
  'organizing_idea',
  'brand_product_role',
  'invariants',
  'variables',
  'prohibitions',
  'example_executions',
  'coverage_dimensions',
]);

function artifact(stage, ownerCapability, extra = {}) {
  return Object.freeze({ stage, owner_capability: ownerCapability, decision_bearing: true, ...extra });
}

export function stageIndex(stage) {
  const index = STAGES.indexOf(stage);
  if (index < 0) fail('INVALID_STAGE', `Unknown stage: ${stage}`, { stage });
  return index;
}

export function nextStage(stage) {
  const index = stageIndex(stage);
  return STAGES[index + 1] ?? null;
}

export function expectedArtifactType(stage) {
  stageIndex(stage);
  return STAGE_ARTIFACT[stage];
}

export function validateProject(project) {
  requireObject(project, 'project');
  requireExact(project.schema_version, SCHEMA_VERSION, 'project.schema_version');
  requireId(project.project_id, 'project.project_id');
  requireString(project.title, 'project.title');
  requireEnum(project.scope_mode, SCOPE_MODES, 'project.scope_mode');
  requireEnum(project.production_mode, PRODUCTION_MODES, 'project.production_mode');
  requireEnum(project.current_stage, STAGES, 'project.current_stage');
  requireEnum(project.status, PROJECT_STATUSES, 'project.status');
  requireInteger(project.revision, 'project.revision', 0);
  requireTimestamp(project.created_at, 'project.created_at');
  requireTimestamp(project.updated_at, 'project.updated_at');
  if (project.active_artifact_id !== null && project.active_artifact_id !== undefined) {
    requireId(project.active_artifact_id, 'project.active_artifact_id');
  }
  return immutableSnapshot(project);
}

export function validateArtifact(artifactRecord) {
  requireObject(artifactRecord, 'artifact');
  requireExact(artifactRecord.schema_version, SCHEMA_VERSION, 'artifact.schema_version');
  requireId(artifactRecord.project_id, 'artifact.project_id');
  requireId(artifactRecord.artifact_id, 'artifact.artifact_id');
  requireString(artifactRecord.type, 'artifact.type');
  const definition = ARTIFACT_DEFINITIONS[artifactRecord.type];
  if (!definition) fail('UNKNOWN_ARTIFACT_TYPE', `Unknown artifact type: ${artifactRecord.type}`, { type: artifactRecord.type });
  requireExact(artifactRecord.stage, definition.stage, 'artifact.stage');
  requireEnum(artifactRecord.status, ARTIFACT_STATUSES, 'artifact.status');
  requireInteger(artifactRecord.version, 'artifact.version', 1);
  requireExact(artifactRecord.owner_capability, definition.owner_capability, 'artifact.owner_capability');
  requireExact(artifactRecord.decision_bearing, definition.decision_bearing, 'artifact.decision_bearing');
  requireArray(artifactRecord.input_artifact_ids, 'artifact.input_artifact_ids');
  artifactRecord.input_artifact_ids.forEach((value, index) => requireId(value, `artifact.input_artifact_ids[${index}]`));
  requireUnique(artifactRecord.input_artifact_ids, 'artifact.input_artifact_ids');
  requireRelativePath(artifactRecord.path, 'artifact.path');
  requireSha256(artifactRecord.content_hash, 'artifact.content_hash');
  requireTimestamp(artifactRecord.created_at, 'artifact.created_at');
  requireTimestamp(artifactRecord.updated_at, 'artifact.updated_at');
  if (artifactRecord.previous_version_id !== null && artifactRecord.previous_version_id !== undefined) {
    requireId(artifactRecord.previous_version_id, 'artifact.previous_version_id');
  }
  return immutableSnapshot(artifactRecord);
}

export function validateDecisionPacket(packet) {
  requireObject(packet, 'decision_packet');
  requireExact(packet.schema_version, SCHEMA_VERSION, 'decision_packet.schema_version');
  requireId(packet.project_id, 'decision_packet.project_id');
  requireId(packet.packet_id, 'decision_packet.packet_id');
  requireId(packet.artifact_id, 'decision_packet.artifact_id');
  requireInteger(packet.artifact_version, 'decision_packet.artifact_version', 1);
  requireEnum(packet.stage, STAGES, 'decision_packet.stage');
  requireEnum(packet.interaction_phase, ['PROPOSAL', 'CONFIRMATION'], 'decision_packet.interaction_phase');
  requireString(packet.decision_owner, 'decision_packet.decision_owner');
  requireString(packet.decision_question, 'decision_packet.decision_question');
  requireArray(packet.options, 'decision_packet.options');
  if (packet.options.length < 1 || packet.options.length > 4) {
    fail('INVALID_OPTION_COUNT', 'A decision packet requires one to four mature options.', { count: packet.options.length });
  }
  const optionIds = [];
  for (const [index, option] of packet.options.entries()) {
    requireObject(option, `decision_packet.options[${index}]`);
    requireId(option.id, `decision_packet.options[${index}].id`);
    requireString(option.proposition, `decision_packet.options[${index}].proposition`);
    requireArray(option.strengths, `decision_packet.options[${index}].strengths`);
    requireArray(option.risks, `decision_packet.options[${index}].risks`);
    optionIds.push(option.id);
  }
  if (uniqueStrings(optionIds).length !== optionIds.length) fail('DUPLICATE_OPTION_ID', 'Decision option IDs must be unique.');
  requireObject(packet.recommendation, 'decision_packet.recommendation');
  requireString(packet.recommendation.option_id, 'decision_packet.recommendation.option_id');
  if (!optionIds.includes(packet.recommendation.option_id)) {
    fail('INVALID_RECOMMENDATION', 'The recommendation must identify one presented option.');
  }
  requireString(packet.recommendation.rationale, 'decision_packet.recommendation.rationale');
  for (const name of ['known_facts', 'assumptions', 'unknowns', 'hard_blocks', 'allowed_responses']) {
    requireArray(packet[name], `decision_packet.${name}`);
  }
  const allowedResponses = uniqueStrings(packet.allowed_responses);
  for (const action of allowedResponses) requireEnum(action, DECISION_ACTIONS, 'decision_packet.allowed_responses[]');
  for (const required of ['NONE', 'REOPEN']) {
    if (!allowedResponses.includes(required)) fail('MISSING_ESCAPE_RESPONSE', `Decision packets must allow ${required}.`);
  }
  if (packet.interaction_phase === 'PROPOSAL' && allowedResponses.includes('LOCK')) {
    fail('PREMATURE_LOCK_ACTION', 'A proposal packet cannot offer LOCK before AI revision and human confirmation.');
  }
  if (packet.interaction_phase === 'CONFIRMATION') {
    requireSha256(packet.revised_artifact_hash, 'decision_packet.revised_artifact_hash');
    requireId(packet.prior_feedback_id, 'decision_packet.prior_feedback_id');
    if (!allowedResponses.includes('LOCK')) fail('LOCK_ACTION_REQUIRED', 'A confirmation packet must offer explicit LOCK.');
  }
  return immutableSnapshot(packet);
}

export function validateHumanFeedback(feedback, packet) {
  requireObject(feedback, 'feedback');
  requireExact(feedback.schema_version, SCHEMA_VERSION, 'feedback.schema_version');
  requireId(feedback.project_id, 'feedback.project_id');
  requireExact(feedback.project_id, packet.project_id, 'feedback.project_id');
  requireId(feedback.feedback_id, 'feedback.feedback_id');
  requireExact(feedback.packet_id, packet.packet_id, 'feedback.packet_id');
  requireEnum(feedback.action, DECISION_ACTIONS, 'feedback.action');
  requireExact(feedback.decision_owner, packet.decision_owner, 'feedback.decision_owner');
  if (!packet.allowed_responses.includes(feedback.action)) {
    fail('ACTION_NOT_ALLOWED', `Feedback action ${feedback.action} is not allowed by this packet.`, { action: feedback.action });
  }
  requireString(feedback.comment, 'feedback.comment');
  if (feedback.selected_option_id !== null && feedback.selected_option_id !== undefined) {
    requireString(feedback.selected_option_id, 'feedback.selected_option_id');
    if (!packet.options.some((option) => option.id === feedback.selected_option_id)) {
      fail('UNKNOWN_SELECTED_OPTION', 'Selected option is not present in the decision packet.');
    }
  }
  if (['SELECT', 'LOCK'].includes(feedback.action) && !feedback.selected_option_id) {
    fail('SELECTION_REQUIRED', `${feedback.action} requires selected_option_id.`);
  }
  if (feedback.action === 'SELECT' && packet.interaction_phase !== 'PROPOSAL') {
    fail('INVALID_INTERACTION_PHASE', 'SELECT is only valid for a proposal packet.');
  }
  if (feedback.action === 'LOCK') {
    if (packet.interaction_phase !== 'CONFIRMATION') {
      fail('PREMATURE_LOCK_ACTION', 'LOCK is only valid for a confirmation packet after revision.');
    }
    requireExact(feedback.confirmed_artifact_hash, packet.revised_artifact_hash, 'feedback.confirmed_artifact_hash');
  }
  return immutableSnapshot(feedback);
}

export function validateDecisionRecord(record) {
  requireObject(record, 'decision');
  requireExact(record.schema_version, SCHEMA_VERSION, 'decision.schema_version');
  requireId(record.project_id, 'decision.project_id');
  requireId(record.decision_id, 'decision.decision_id');
  requireId(record.packet_id, 'decision.packet_id');
  requireId(record.artifact_id, 'decision.artifact_id');
  requireInteger(record.artifact_version, 'decision.artifact_version', 1);
  requireString(record.decision_owner, 'decision.decision_owner');
  requireEnum(record.outcome, DECISION_OUTCOMES, 'decision.outcome');
  requireString(record.rationale, 'decision.rationale');
  requireArray(record.rejected_option_ids, 'decision.rejected_option_ids');
  requireArray(record.residual_risks, 'decision.residual_risks');
  requireArray(record.reopen_conditions, 'decision.reopen_conditions');
  requireTimestamp(record.decided_at, 'decision.decided_at');
  if (record.outcome === 'LOCK') requireId(record.lock_id, 'decision.lock_id');
  if (record.outcome === 'CONFLICT') {
    requireObject(record.conflict, 'decision.conflict');
    requireExact(record.conflict.decision_owner, record.decision_owner, 'decision.conflict.decision_owner');
    requireArray(record.conflict.original_requirements, 'decision.conflict.original_requirements');
    requireArray(record.conflict.incompatible_requirements, 'decision.conflict.incompatible_requirements');
    requireArray(record.conflict.authority_issues, 'decision.conflict.authority_issues');
    requireString(record.conflict.recommendation, 'decision.conflict.recommendation');
  }
  return immutableSnapshot(record);
}

export function validateClaim(record) {
  requireObject(record, 'claim');
  requireExact(record.schema_version, SCHEMA_VERSION, 'claim.schema_version');
  requireExact(record.record_type, 'CLAIM', 'claim.record_type');
  requireId(record.project_id, 'claim.project_id');
  requireId(record.claim_id, 'claim.claim_id');
  requireEnum(record.kind, ['EXPRESS', 'IMPLIED'], 'claim.kind');
  requireString(record.text, 'claim.text');
  requireEnum(record.evidence_status, EVIDENCE_STATUSES, 'claim.evidence_status');
  requireEnum(record.clearance_status, CLEARANCE_STATUSES, 'claim.clearance_status');
  requireArray(record.evidence_refs, 'claim.evidence_refs');
  requireArray(record.clearance_refs, 'claim.clearance_refs');
  if (record.clearance_status === 'CLEARED' && record.evidence_status !== 'SUPPORTED') {
    fail('CLAIM_WITHOUT_SUPPORT', 'A claim cannot be cleared without supported evidence.', { claim_id: record.claim_id });
  }
  if (record.evidence_status === 'SUPPORTED' && record.evidence_refs.length === 0) {
    fail('CLAIM_EVIDENCE_REQUIRED', 'A supported claim requires evidence references.', { claim_id: record.claim_id });
  }
  if (record.clearance_status === 'CLEARED' && record.clearance_refs.length === 0) {
    fail('CLAIM_CLEARANCE_REQUIRED', 'A cleared claim requires an independent clearance reference.', { claim_id: record.claim_id });
  }
  rejectFields(record, ['right_id', 'subject', 'usage'], 'CLAIM_RIGHT_TYPE_CONFUSION');
  return immutableSnapshot(record);
}

export function validateRight(record) {
  requireObject(record, 'right');
  requireExact(record.schema_version, SCHEMA_VERSION, 'right.schema_version');
  requireExact(record.record_type, 'RIGHT', 'right.record_type');
  requireId(record.project_id, 'right.project_id');
  requireId(record.right_id, 'right.right_id');
  requireString(record.subject, 'right.subject');
  requireEnum(record.clearance_status, CLEARANCE_STATUSES, 'right.clearance_status');
  requireArray(record.usage, 'right.usage');
  requireArray(record.clearance_refs, 'right.clearance_refs');
  if (record.clearance_status === 'CLEARED' && record.usage.length === 0) {
    fail('RIGHT_USAGE_REQUIRED', 'A cleared right requires an explicit usage scope.', { right_id: record.right_id });
  }
  if (record.clearance_status === 'CLEARED' && record.clearance_refs.length === 0) {
    fail('RIGHT_CLEARANCE_REQUIRED', 'A cleared right requires an independent clearance reference.', { right_id: record.right_id });
  }
  rejectFields(record, ['claim_id', 'kind', 'text', 'evidence_status', 'evidence_refs'], 'CLAIM_RIGHT_TYPE_CONFUSION');
  return immutableSnapshot(record);
}

export function validateAttempt(attemptRecord) {
  requireObject(attemptRecord, 'attempt');
  requireExact(attemptRecord.schema_version, SCHEMA_VERSION, 'attempt.schema_version');
  requireId(attemptRecord.project_id, 'attempt.project_id');
  requireId(attemptRecord.attempt_id, 'attempt.attempt_id');
  requireId(attemptRecord.artifact_id, 'attempt.artifact_id');
  requireEnum(attemptRecord.status, ATTEMPT_STATUSES, 'attempt.status');
  requireString(attemptRecord.tool, 'attempt.tool');
  requireSha256(attemptRecord.request_hash, 'attempt.request_hash');
  requireArray(attemptRecord.reference_ids, 'attempt.reference_ids');
  if (['GENERATED', 'INSPECTED', 'SELECTED', 'REJECTED'].includes(attemptRecord.status)) {
    requireRelativePath(attemptRecord.output_path, 'attempt.output_path');
    requireSha256(attemptRecord.output_hash, 'attempt.output_hash');
  }
  if (attemptRecord.status === 'SELECTED') {
    requireObject(attemptRecord.inspection, 'attempt.inspection');
    requireExact(attemptRecord.inspection.passed, true, 'attempt.inspection.passed');
    requireString(attemptRecord.selected_by, 'attempt.selected_by');
  }
  return immutableSnapshot(attemptRecord);
}

export function validateShot(shotRecord) {
  requireObject(shotRecord, 'shot');
  requireExact(shotRecord.schema_version, SCHEMA_VERSION, 'shot.schema_version');
  requireId(shotRecord.project_id, 'shot.project_id');
  requireId(shotRecord.shot_id, 'shot.shot_id');
  requireId(shotRecord.artifact_id, 'shot.artifact_id');
  requireEnum(shotRecord.stage, STAGES, 'shot.stage');
  if (stageIndex(shotRecord.stage) < stageIndex('P11_PREPRODUCTION_PPM')) {
    fail('SHOT_TOO_EARLY', 'Shot state may only be created at production-ready stages.', { stage: shotRecord.stage });
  }
  requireEnum(shotRecord.status, SHOT_STATUSES, 'shot.status');
  requireString(shotRecord.objective, 'shot.objective');
  requireString(shotRecord.start_state, 'shot.start_state');
  requireString(shotRecord.end_state, 'shot.end_state');
  requireString(shotRecord.action, 'shot.action');
  requirePositiveNumber(shotRecord.duration_seconds, 'shot.duration_seconds');
  requireArray(shotRecord.continuity, 'shot.continuity');
  requireArray(shotRecord.prohibitions, 'shot.prohibitions');
  requireArray(shotRecord.source_artifact_ids, 'shot.source_artifact_ids');
  return immutableSnapshot(shotRecord);
}

export function validateTake(takeRecord) {
  requireObject(takeRecord, 'take');
  requireExact(takeRecord.schema_version, SCHEMA_VERSION, 'take.schema_version');
  requireId(takeRecord.project_id, 'take.project_id');
  requireId(takeRecord.take_id, 'take.take_id');
  requireId(takeRecord.shot_id, 'take.shot_id');
  requireEnum(takeRecord.kind, TAKE_KINDS, 'take.kind');
  requireEnum(takeRecord.status, TAKE_STATUSES, 'take.status');
  if (takeRecord.attempt_id !== null && takeRecord.attempt_id !== undefined) {
    requireId(takeRecord.attempt_id, 'take.attempt_id');
  }
  if (takeRecord.kind === 'AI_GENERATED' && !takeRecord.attempt_id) {
    fail('ATTEMPT_REQUIRED', 'An AI-generated take must reference its generation attempt.');
  }
  requireRelativePath(takeRecord.media_path, 'take.media_path');
  requireSha256(takeRecord.media_hash, 'take.media_hash');
  requirePositiveNumber(takeRecord.duration_seconds, 'take.duration_seconds');
  if (takeRecord.status === 'SELECTED') {
    requireObject(takeRecord.inspection, 'take.inspection');
    requireExact(takeRecord.inspection.passed, true, 'take.inspection.passed');
    requireString(takeRecord.selected_by, 'take.selected_by');
  }
  return immutableSnapshot(takeRecord);
}

export function validateTimeline(timeline) {
  requireObject(timeline, 'timeline');
  requireExact(timeline.schema_version, SCHEMA_VERSION, 'timeline.schema_version');
  requireId(timeline.project_id, 'timeline.project_id');
  requireId(timeline.timeline_id, 'timeline.timeline_id');
  requireId(timeline.artifact_id, 'timeline.artifact_id');
  requireInteger(timeline.version, 'timeline.version', 1);
  requirePositiveNumber(timeline.fps, 'timeline.fps');
  requirePositiveNumber(timeline.duration_seconds, 'timeline.duration_seconds');
  requireArray(timeline.tracks, 'timeline.tracks');
  const clipIds = [];
  for (const [trackIndex, track] of timeline.tracks.entries()) {
    requireObject(track, `timeline.tracks[${trackIndex}]`);
    requireString(track.track_id, `timeline.tracks[${trackIndex}].track_id`);
    requireEnum(track.kind, ['VIDEO', 'AUDIO', 'GRAPHICS', 'CAPTIONS'], `timeline.tracks[${trackIndex}].kind`);
    requireArray(track.clips, `timeline.tracks[${trackIndex}].clips`);
    const intervals = [];
    for (const [clipIndex, clip] of track.clips.entries()) {
      const path = `timeline.tracks[${trackIndex}].clips[${clipIndex}]`;
      requireObject(clip, path);
      requireString(clip.clip_id, `${path}.clip_id`);
      requireNonNegativeNumber(clip.start_seconds, `${path}.start_seconds`);
      requirePositiveNumber(clip.duration_seconds, `${path}.duration_seconds`);
      if (clip.start_seconds + clip.duration_seconds > timeline.duration_seconds + Number.EPSILON) {
        fail('CLIP_OUTSIDE_TIMELINE', 'A timeline clip cannot extend past timeline duration.', { clip_id: clip.clip_id });
      }
      if (track.kind === 'VIDEO') {
        requireString(clip.shot_id, `${path}.shot_id`);
        requireString(clip.take_id, `${path}.take_id`);
      }
      intervals.push({ clip_id: clip.clip_id, start: clip.start_seconds, end: clip.start_seconds + clip.duration_seconds });
      clipIds.push(clip.clip_id);
    }
    intervals.sort((left, right) => left.start - right.start || left.end - right.end);
    for (let index = 1; index < intervals.length; index += 1) {
      if (intervals[index].start < intervals[index - 1].end - Number.EPSILON) {
        fail('OVERLAPPING_CLIPS', 'Clips on the same timeline track cannot overlap.', { track_id: track.track_id, clips: [intervals[index - 1].clip_id, intervals[index].clip_id] });
      }
    }
  }
  if (uniqueStrings(clipIds).length !== clipIds.length) {
    fail('DUPLICATE_CLIP_ID', 'Timeline clip IDs must be unique across tracks.');
  }
  return immutableSnapshot(timeline);
}

export function validatePlatformApplicability({ project, platform }) {
  validateProject(project);
  requireObject(platform, 'platform');
  if (!['campaign_system'].includes(project.scope_mode)) {
    fail('PLATFORM_SCOPE_MISMATCH', 'A new platform is only valid for campaign_system scope.', { scope_mode: project.scope_mode });
  }
  for (const field of PLATFORM_REQUIRED_FIELDS) {
    if (!Object.hasOwn(platform, field)) fail('PLATFORM_FIELD_MISSING', `Platform is missing own field ${field}.`, { field });
  }
  requireNonEmptyStringArray(platform.invariants, 'platform.invariants');
  requireNonEmptyStringArray(platform.variables, 'platform.variables');
  requireNonEmptyStringArray(platform.prohibitions, 'platform.prohibitions');
  requireNonEmptyStringArray(platform.example_executions, 'platform.example_executions');
  requireNonEmptyStringArray(platform.coverage_dimensions, 'platform.coverage_dimensions');
  if (platform.example_executions.length < 3) fail('PLATFORM_EXECUTION_COVERAGE', 'A platform requires at least three non-duplicate executions.');
  if (uniqueStrings(platform.example_executions).length !== platform.example_executions.length) {
    fail('PLATFORM_DUPLICATE_EXECUTION', 'Platform example executions must be distinct.');
  }
  if (uniqueStrings(platform.coverage_dimensions).length < 2) fail('PLATFORM_DIMENSION_COVERAGE', 'A platform must span at least two dimensions.');
  validatePlatformExecutionEvidence(platform);
  requireString(platform.organizing_idea, 'platform.organizing_idea');
  requireString(platform.brand_product_role, 'platform.brand_product_role');
  return immutableSnapshot(platform);
}

function validatePlatformExecutionEvidence(platform) {
  requireArray(platform.execution_evidence, 'platform.execution_evidence');
  if (platform.execution_evidence.length !== platform.example_executions.length) {
    fail('PLATFORM_EVIDENCE_COUNT', 'Every platform example execution requires one evidence record.');
  }
  const expectedIds = new Set(platform.example_executions);
  const evidenceIds = [];
  const mechanismIds = [];
  const coverageSignatures = [];
  for (const [index, evidence] of platform.execution_evidence.entries()) {
    requireObject(evidence, `platform.execution_evidence[${index}]`);
    requireExact(evidence.evidence_kind, 'STRUCTURED_PROTOTYPE', `platform.execution_evidence[${index}].evidence_kind`);
    requireString(evidence.execution_id, `platform.execution_evidence[${index}].execution_id`);
    requireString(evidence.mechanism_id, `platform.execution_evidence[${index}].mechanism_id`);
    requireObject(evidence.coverage, `platform.execution_evidence[${index}].coverage`);
    for (const dimension of platform.coverage_dimensions) {
      if (!Object.hasOwn(evidence.coverage, dimension)) {
        fail('PLATFORM_COVERAGE_EVIDENCE', `Execution ${evidence.execution_id} is missing coverage dimension ${dimension}.`);
      }
      requireString(String(evidence.coverage[dimension]), `platform.execution_evidence[${index}].coverage.${dimension}`);
    }
    evidenceIds.push(evidence.execution_id);
    mechanismIds.push(evidence.mechanism_id);
    coverageSignatures.push(stableCoverageSignature(evidence.coverage, platform.coverage_dimensions));
  }
  if (evidenceIds.some((id) => !expectedIds.has(id)) || uniqueStrings(evidenceIds).length !== expectedIds.size) {
    fail('PLATFORM_EXECUTION_EVIDENCE_MISMATCH', 'Execution evidence IDs must exactly match example executions.');
  }
  if (uniqueStrings(mechanismIds).length !== 1) {
    fail('PLATFORM_MECHANISM_DRIFT', 'Platform executions must demonstrate one shared organizing mechanism.');
  }
  if (uniqueStrings(coverageSignatures).length !== coverageSignatures.length) {
    fail('PLATFORM_COVERAGE_DUPLICATE', 'Platform executions must vary across declared coverage dimensions.');
  }
}

function stableCoverageSignature(coverage, dimensions) {
  return dimensions.slice().sort().map((dimension) => `${dimension}:${String(coverage[dimension])}`).join('|');
}

export function validateArtifactForProject(project, artifactRecord, platform = null) {
  const projectSnapshot = validateProject(project);
  const artifactSnapshot = validateArtifact(artifactRecord);
  requireExact(artifactSnapshot.project_id, projectSnapshot.project_id, 'artifact.project_id');
  if (artifactSnapshot.type === 'campaign_platform') {
    if (!platform) fail('PLATFORM_EVIDENCE_REQUIRED', 'Campaign platform artifacts require applicability evidence.');
    validatePlatformApplicability({ project: projectSnapshot, platform });
  }
  return artifactSnapshot;
}

export function validateDecisionPacketForArtifact(packet, artifactRecord) {
  const packetSnapshot = validateDecisionPacket(packet);
  const artifactSnapshot = validateArtifact(artifactRecord);
  requireExact(packetSnapshot.project_id, artifactSnapshot.project_id, 'decision_packet.project_id');
  requireExact(packetSnapshot.artifact_id, artifactSnapshot.artifact_id, 'decision_packet.artifact_id');
  requireExact(packetSnapshot.artifact_version, artifactSnapshot.version, 'decision_packet.artifact_version');
  requireExact(packetSnapshot.stage, artifactSnapshot.stage, 'decision_packet.stage');
  return packetSnapshot;
}

export function validateDependency(dependency) {
  requireObject(dependency, 'dependency');
  requireExact(dependency.schema_version, SCHEMA_VERSION, 'dependency.schema_version');
  requireId(dependency.project_id, 'dependency.project_id');
  requireId(dependency.from_artifact_id, 'dependency.from_artifact_id');
  requireInteger(dependency.from_artifact_version, 'dependency.from_artifact_version', 1);
  requireId(dependency.to_artifact_id, 'dependency.to_artifact_id');
  requireInteger(dependency.to_artifact_version, 'dependency.to_artifact_version', 1);
  requireEnum(dependency.kind, ['DERIVED_FROM', 'CONSTRAINED_BY', 'EVIDENCED_BY'], 'dependency.kind');
  if (dependency.from_artifact_id === dependency.to_artifact_id) {
    fail('SELF_DEPENDENCY', 'An artifact cannot depend on itself.', { artifact_id: dependency.from_artifact_id });
  }
  return immutableSnapshot(dependency);
}

export function validateLockRecord(record) {
  requireObject(record, 'lock_record');
  requireExact(record.schema_version, SCHEMA_VERSION, 'lock_record.schema_version');
  requireId(record.project_id, 'lock_record.project_id');
  requireId(record.lock_id, 'lock_record.lock_id');
  requireId(record.packet_id, 'lock_record.packet_id');
  requireId(record.prior_feedback_id, 'lock_record.prior_feedback_id');
  requireId(record.artifact_id, 'lock_record.artifact_id');
  requireInteger(record.artifact_version, 'lock_record.artifact_version', 1);
  requireSha256(record.artifact_hash, 'lock_record.artifact_hash');
  requireEnum(record.stage, STAGES, 'lock_record.stage');
  requireString(record.confirmed_by, 'lock_record.confirmed_by');
  requireTimestamp(record.confirmed_at, 'lock_record.confirmed_at');
  requireArray(record.signoffs, 'lock_record.signoffs');
  const byType = new Map();
  for (const [index, signoff] of record.signoffs.entries()) {
    requireObject(signoff, `lock_record.signoffs[${index}]`);
    requireEnum(signoff.type, SIGNOFF_TYPES, `lock_record.signoffs[${index}].type`);
    requireEnum(signoff.status, SIGNOFF_STATUSES, `lock_record.signoffs[${index}].status`);
    requireId(signoff.reference_id, `lock_record.signoffs[${index}].reference_id`);
    if (byType.has(signoff.type)) fail('DUPLICATE_SIGNOFF', `Duplicate signoff type: ${signoff.type}.`);
    byType.set(signoff.type, signoff.status);
  }
  const required = requiredSignoffs(record.stage);
  for (const [type, allowedStatuses] of Object.entries(required)) {
    const status = byType.get(type);
    if (!status || !allowedStatuses.includes(status)) {
      fail('SIGNOFF_GATE_BLOCKED', `${record.stage} lock requires ${type} in ${allowedStatuses.join(' or ')} state.`, { type, status: status ?? null });
    }
  }
  return immutableSnapshot(record);
}

function requiredSignoffs(stage) {
  const required = { CLIENT_DECISION: ['APPROVED'] };
  if (stageIndex(stage) >= stageIndex('P3_CREATIVE_BRIEF')) required.STRATEGY = ['APPROVED', 'NOT_APPLICABLE'];
  if (stageIndex(stage) >= stageIndex('P4_CREATIVE_ROUTES')) required.CREATIVE = ['APPROVED'];
  if (stageIndex(stage) >= stageIndex('P7_SCRIPT_AGENCY_BOARD')) required.CLAIMS = ['CLEARED', 'NOT_APPLICABLE'];
  if (stageIndex(stage) >= stageIndex('P11_PREPRODUCTION_PPM')) required.RIGHTS = ['CLEARED', 'NOT_APPLICABLE'];
  if (stageIndex(stage) >= stageIndex('P11_PREPRODUCTION_PPM')) required.PRODUCTION = ['APPROVED'];
  if (stageIndex(stage) >= stageIndex('P14_FINAL_RELEASE')) required.TECHNICAL_QC = ['APPROVED'];
  if (stageIndex(stage) >= stageIndex('P14_FINAL_RELEASE')) required.RELEASE = ['APPROVED'];
  return required;
}

export function validateArtifactTransition(fromStatus, toStatus) {
  requireEnum(fromStatus, ARTIFACT_STATUSES, 'from_status');
  requireEnum(toStatus, ARTIFACT_STATUSES, 'to_status');
  if (!(ALLOWED_ARTIFACT_TRANSITIONS[fromStatus] ?? []).includes(toStatus)) {
    fail('INVALID_ARTIFACT_TRANSITION', `Cannot transition artifact from ${fromStatus} to ${toStatus}.`, { fromStatus, toStatus });
  }
  return true;
}

function requireObject(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('OBJECT_REQUIRED', `${path} must be an object.`, { path });
  const forbiddenProofFields = [
    'commercialProductionReadiness', 'commercial_production_readiness', 'realWorldValidation', 'real_world_validation',
    'creative_quality', 'legal_approved', 'rights_cleared', 'release_approved',
  ];
  const conflicts = forbiddenProofFields.filter((field) => Object.hasOwn(value, field));
  if (conflicts.length > 0) {
    fail('UNSCOPED_PROOF_FIELD', `${path} contains proof claims that must be represented by independent evidence records.`, { path, conflicts });
  }
}

function requireArray(value, path) {
  if (!Array.isArray(value)) fail('ARRAY_REQUIRED', `${path} must be an array.`, { path });
}

function requireString(value, path) {
  if (!nonEmptyString(value)) fail('STRING_REQUIRED', `${path} must be a non-empty string.`, { path });
}

function requireId(value, pathName) {
  requireString(value, pathName);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value) || value.includes('..') || /[. ]$/.test(value)) {
    fail('INVALID_ID', `${pathName} must be a stable non-path identifier.`, { path: pathName, value });
  }
}

function requireTimestamp(value, pathName) {
  requireString(value, pathName);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || Number.isNaN(Date.parse(value))) {
    fail('INVALID_TIMESTAMP', `${pathName} must be an ISO-8601 UTC timestamp with milliseconds.`, { path: pathName, value });
  }
}

function requireSha256(value, pathName) {
  if (typeof value !== 'string' || !/^[a-fA-F0-9]{64}$/.test(value)) {
    fail('INVALID_SHA256', `${pathName} must be a 64-character SHA-256 hex digest.`, { path: pathName });
  }
}

function requireRelativePath(value, pathName) {
  requireString(value, pathName);
  const normalized = value.replaceAll('\\', '/');
  const segments = normalized.split('/');
  if (path.win32.isAbsolute(value) || path.posix.isAbsolute(value) || segments.some((segment) => segment === '' || segment === '.' || segment === '..') || value.includes('\0')) {
    fail('UNSAFE_RELATIVE_PATH', `${pathName} must be a contained project-relative path.`, { path: pathName, value });
  }
}

function requireUnique(values, pathName) {
  if (uniqueStrings(values).length !== values.length) fail('DUPLICATE_VALUE', `${pathName} must contain unique values.`, { path: pathName });
}

function requireNonEmptyStringArray(value, pathName) {
  requireArray(value, pathName);
  if (value.length === 0) fail('NON_EMPTY_ARRAY_REQUIRED', `${pathName} must not be empty.`, { path: pathName });
  value.forEach((item, index) => requireString(item, `${pathName}[${index}]`));
  requireUnique(value, pathName);
}

function rejectFields(record, fields, code) {
  const conflicts = fields.filter((field) => field in record);
  if (conflicts.length > 0) fail(code, `Record contains fields from a different contract type: ${conflicts.join(', ')}.`, { conflicts });
}

function requireBoolean(value, path) {
  if (typeof value !== 'boolean') fail('BOOLEAN_REQUIRED', `${path} must be a boolean.`, { path });
}

function requireInteger(value, path, minimum = Number.MIN_SAFE_INTEGER) {
  if (!Number.isInteger(value) || value < minimum) fail('INTEGER_REQUIRED', `${path} must be an integer >= ${minimum}.`, { path });
}

function requirePositiveNumber(value, path) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    fail('POSITIVE_NUMBER_REQUIRED', `${path} must be a finite number greater than zero.`, { path });
  }
}

function requireNonNegativeNumber(value, path) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    fail('NON_NEGATIVE_NUMBER_REQUIRED', `${path} must be a finite number greater than or equal to zero.`, { path });
  }
}

function requireEnum(value, allowed, path) {
  if (!allowed.includes(value)) fail('INVALID_ENUM', `${path} must be one of: ${allowed.join(', ')}.`, { path, value });
}

function requireExact(value, expected, path) {
  if (value !== expected) fail('EXACT_VALUE_REQUIRED', `${path} must equal ${expected}.`, { path, value });
}

function fail(code, message, details = {}) {
  throw new ContractError(code, message, details);
}
