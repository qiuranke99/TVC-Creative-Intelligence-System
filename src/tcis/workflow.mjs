import {
  ARTIFACT_DEFINITIONS,
  SCHEMA_VERSION,
  validateArtifact,
  validateArtifactTransition,
  validateDecisionPacket,
  validateDecisionRecord,
  validateHumanFeedback,
  validateLockRecord,
  validatePlatformApplicability,
} from './contracts.mjs';
import { ContractError, StateError, TransitionError } from './errors.mjs';
import { clone, nonEmptyString, sha256, stableStringify, uniqueStrings } from './utils.mjs';

const PROPOSAL_RESPONSES = Object.freeze([
  'SELECT',
  'ADVISE',
  'NONE',
  'REVISE',
  'REOPEN',
  'STOP',
]);

const CONFIRMATION_RESPONSES = Object.freeze([
  'LOCK',
  'REVISE',
  'NONE',
  'REOPEN',
  'STOP',
]);

const UNNAMED_OWNERS = new Set(['tbd', 'unknown', 'committee', 'all', 'anyone', 'n/a']);

export function createDecisionPacket(artifact, proposal) {
  assertArtifactAuthority(artifact);
  requireObject(proposal, 'proposal');
  if (!['PROPOSED', 'REVISED'].includes(artifact.status)) {
    throw new StateError(
      'ARTIFACT_NOT_READY_FOR_PROPOSAL',
      'A decision packet requires a proposed artifact or a revised artifact ready for confirmation.',
      { artifact_id: artifact.artifact_id, status: artifact.status },
    );
  }
  if (proposal.stage !== undefined && proposal.stage !== artifact.stage) {
    throw new ContractError('PACKET_STAGE_MISMATCH', 'Proposal stage must match the artifact stage.', {
      artifact_stage: artifact.stage,
      proposal_stage: proposal.stage,
    });
  }

  const decisionOwner = requireNamedOwner(proposal.decision_owner, 'proposal.decision_owner');
  requireString(proposal.decision_question, 'proposal.decision_question');
  requireArray(proposal.options, 'proposal.options');
  if (proposal.options.length < 1 || proposal.options.length > 4) {
    throw new ContractError('INVALID_OPTION_COUNT', 'A decision packet requires one to four mature options.', {
      count: proposal.options.length,
    });
  }

  const options = proposal.options.map((option, index) => normalizeOption(option, index));
  ensureUniqueIds(options.map((option) => option.id), 'DUPLICATE_OPTION_ID', 'Decision option IDs must be unique.');
  if (artifact.type === 'production_selects') assertActualMediaOptions(options);

  const interactionPhase = artifact.status === 'REVISED' ? 'CONFIRMATION' : 'PROPOSAL';
  const recommendation = normalizeRecommendation(proposal.recommendation, options);
  const allowedResponses = normalizeAllowedResponses(proposal.allowed_responses, interactionPhase);
  const campaignContext = artifact.type === 'campaign_platform'
    ? validateCampaignPlatformContext({ artifact, proposal })
    : null;
  const confirmationContext = interactionPhase === 'CONFIRMATION'
    ? validateConfirmationContext({ artifact, proposal })
    : null;

  const packetSeed = {
    artifact_id: artifact.artifact_id,
    artifact_version: artifact.version,
    artifact_content_hash: artifact.content_hash,
    decision_owner: decisionOwner,
    decision_question: proposal.decision_question,
    options,
    recommendation,
  };

  const packet = {
    schema_version: SCHEMA_VERSION,
    project_id: artifact.project_id,
    packet_id: proposal.packet_id ?? deterministicId(`DP-${stageCode(artifact.stage)}`, packetSeed),
    artifact_id: artifact.artifact_id,
    artifact_version: artifact.version,
    artifact_content_hash: artifact.content_hash,
    artifact_owner_capability: artifact.owner_capability,
    stage: artifact.stage,
    interaction_phase: interactionPhase,
    decision_owner: decisionOwner,
    decision_question: proposal.decision_question,
    reviewers: copyArray(proposal.reviewers),
    brief_trace: copyArray(proposal.brief_trace),
    options,
    recommendation,
    known_facts: copyArray(proposal.known_facts),
    assumptions: copyArray(proposal.assumptions),
    unknowns: copyArray(proposal.unknowns),
    hard_blocks: copyArray(proposal.hard_blocks),
    allowed_responses: allowedResponses,
    signoffs: copyArray(proposal.signoffs ?? artifact.signoffs),
    ...(campaignContext ? { campaign_platform_context: campaignContext } : {}),
    ...(confirmationContext ?? {}),
  };

  validateDecisionPacket(packet);
  return packet;
}

export function applyHumanFeedback({ artifact, packet, feedback }) {
  assertArtifactAuthority(artifact);
  assertPacketMatchesArtifact(packet, artifact);

  const responses = extractResponses(feedback);
  if (responses.length === 0) {
    return waitingResult(artifact, packet, 'Silence does not authorize selection, revision, or lock.');
  }

  const conflict = detectFeedbackConflict(feedback, responses, packet);
  if (conflict) {
    for (const response of responses) validateConflictFeedbackShape(response, packet);
    const decisionRecord = {
      schema_version: SCHEMA_VERSION,
      project_id: artifact.project_id,
      decision_id: deterministicId('DEC-CONFLICT', {
        packet_id: packet.packet_id,
        artifact_hash: artifact.content_hash,
        responses,
      }),
      packet_id: packet.packet_id,
      artifact_id: artifact.artifact_id,
      artifact_version: artifact.version,
      decision_owner: packet.decision_owner,
      outcome: 'CONFLICT',
      rationale: 'Conflicting feedback requires an explicit resolution from the named decision owner.',
      conflict: clone(conflict),
      rejected_option_ids: [],
      residual_risks: ['No artifact transition is authorized while the conflict remains unresolved.'],
      reopen_conditions: ['Submit one non-conflicting binding response from the named decision owner.'],
      decided_at: responses.find((response) => response.decided_at ?? response.created_at)?.decided_at
        ?? responses.find((response) => response.created_at)?.created_at
        ?? artifact.updated_at,
    };
    validateDecisionRecord(decisionRecord);
    return {
      state: 'CONFLICT',
      status: 'CONFLICT',
      outcome: 'CONFLICT',
      artifact: clone(artifact),
      packet: clone(packet),
      decision_record: decisionRecord,
      requires_confirmation: false,
      conflict,
    };
  }

  for (const response of responses) {
    assertActionAllowed(response.action, packet);
    assertFeedbackOwner(response, packet);
    validateHumanFeedback(response, packet);
  }

  if (responses.length !== 1) {
    throw new ContractError(
      'SINGLE_OWNER_DECISION_REQUIRED',
      'Non-conflicting feedback must resolve to one binding response from the named decision owner.',
    );
  }

  const response = responses[0];
  if (!['PROPOSED', 'REVISED'].includes(artifact.status)) {
    throw new StateError('ARTIFACT_NOT_AWAITING_FEEDBACK', 'Feedback can only apply to a proposed or revised artifact.', {
      artifact_id: artifact.artifact_id,
      status: artifact.status,
    });
  }

  switch (response.action) {
    case 'SELECT':
      return revisionResult({ artifact, packet, response, selectedOptionId: response.selected_option_id });
    case 'LOCK':
      throw new TransitionError('CONFIRM_LOCK_REQUIRED', 'LOCK must be applied through confirmLock with a confirmation packet.');
    case 'ADVISE':
    case 'REVISE':
      return revisionResult({ artifact, packet, response, selectedOptionId: response.selected_option_id ?? null });
    case 'NONE':
      return reexploreResult({ artifact, packet, response });
    case 'REOPEN':
      return reopenResult({ artifact, packet, response });
    case 'STOP':
      return stopResult({ artifact, packet, response });
    default:
      throw new ContractError('UNSUPPORTED_FEEDBACK_ACTION', `Unsupported feedback action: ${response.action}.`);
  }
}

export function confirmLock({ artifact, packet, feedback }) {
  assertArtifactAuthority(artifact);
  assertPacketMatchesArtifact(packet, artifact);

  if (feedback === null || feedback === undefined) {
    return waitingResult(artifact, packet, 'Silence cannot confirm a lock.');
  }
  if (artifact.status !== 'REVISED' || packet.interaction_phase !== 'CONFIRMATION') {
    throw new TransitionError(
      'REVISION_CONFIRMATION_REQUIRED',
      'A first selection cannot lock a proposed artifact; lock requires a confirmation packet for a revised artifact.',
      { artifact_status: artifact.status, interaction_phase: packet.interaction_phase },
    );
  }
  requireObject(feedback, 'feedback');
  assertActionAllowed(feedback.action, packet);
  assertFeedbackOwner(feedback, packet);
  validateHumanFeedback(feedback, packet);

  if (feedback.action !== 'LOCK') {
    throw new TransitionError('EXPLICIT_LOCK_REQUIRED', 'Lock confirmation requires action LOCK.', {
      action: feedback.action,
    });
  }
  if (packet.revised_artifact_hash !== artifact.content_hash) {
    throw new TransitionError(
      'REVISED_ARTIFACT_HASH_MISMATCH',
      'The confirmation packet must bind the exact revised artifact hash.',
      { expected: artifact.content_hash, actual: packet.revised_artifact_hash },
    );
  }
  if (packet.proposed_artifact_hash === artifact.content_hash) {
    throw new TransitionError(
      'REVISED_HASH_REQUIRED',
      'Lock requires a revised artifact hash different from the proposed artifact hash.',
      { content_hash: artifact.content_hash },
    );
  }
  if (packet.hard_blocks.length > 0) {
    throw new TransitionError('HARD_BLOCK_PREVENTS_LOCK', 'A decision packet with unresolved hard blocks cannot lock.', {
      hard_blocks: clone(packet.hard_blocks),
    });
  }

  const selectedOption = packet.options.find((option) => option.id === feedback.selected_option_id);
  if (!selectedOption) {
    throw new ContractError('UNKNOWN_SELECTED_OPTION', 'The lock must select an option in the packet.');
  }
  if (artifact.selected_option_id && artifact.selected_option_id !== feedback.selected_option_id) {
    throw new TransitionError('SELECTION_CONFIRMATION_MISMATCH', 'The confirmed option differs from the revised selection.', {
      revised_selection: artifact.selected_option_id,
      confirmed_selection: feedback.selected_option_id,
    });
  }
  if (artifact.type === 'production_selects' && !hasActualMediaEvidence(selectedOption)) {
    throw new TransitionError('ACTUAL_MEDIA_REQUIRED', 'Production selects must bind inspected actual media, not a prompt or tool result.');
  }

  validateArtifactTransition('REVISED', 'LOCKED');
  const decidedAt = feedback.decided_at ?? feedback.created_at ?? artifact.updated_at;
  const signoffs = preserveOrthogonalSignoffs({ artifact, packet, feedback });
  const lockedArtifact = {
    ...clone(artifact),
    status: 'LOCKED',
    selected_option_id: feedback.selected_option_id,
    pending_lock_confirmation: false,
    locked_by: feedback.decision_owner,
    locked_content_hash: artifact.content_hash,
    signoffs: clone(signoffs),
    updated_at: decidedAt,
  };
  const rejectedOptionIds = packet.options
    .map((option) => option.id)
    .filter((optionId) => optionId !== feedback.selected_option_id);
  const lockId = deterministicId('LOCK', {
    artifact_id: artifact.artifact_id,
    artifact_version: artifact.version,
    artifact_hash: artifact.content_hash,
    packet_id: packet.packet_id,
  });
  const lockRecord = {
    schema_version: SCHEMA_VERSION,
    project_id: artifact.project_id,
    lock_id: lockId,
    packet_id: packet.packet_id,
    prior_feedback_id: packet.prior_feedback_id,
    artifact_id: artifact.artifact_id,
    artifact_version: artifact.version,
    artifact_hash: artifact.content_hash,
    stage: artifact.stage,
    confirmed_by: feedback.decision_owner,
    confirmed_at: decidedAt,
    signoffs,
  };
  validateLockRecord(lockRecord);

  const decisionRecord = {
    schema_version: SCHEMA_VERSION,
    project_id: artifact.project_id,
    decision_id: deterministicId('DEC', {
      packet_id: packet.packet_id,
      artifact_hash: artifact.content_hash,
      feedback_id: feedback.feedback_id,
    }),
    lock_id: lockId,
    packet_id: packet.packet_id,
    artifact_id: artifact.artifact_id,
    artifact_version: artifact.version,
    decision_owner: feedback.decision_owner,
    outcome: 'LOCK',
    rationale: feedback.comment,
    rejected_option_ids: rejectedOptionIds,
    residual_risks: copyArray(feedback.residual_risks ?? packet.unknowns),
    reopen_conditions: copyArray(feedback.reopen_conditions),
    decided_at: decidedAt,
  };
  validateDecisionRecord(decisionRecord);

  return {
    state: 'LOCKED',
    status: 'LOCKED',
    outcome: 'LOCK',
    artifact: lockedArtifact,
    packet: clone(packet),
    decision_record: decisionRecord,
    lock_record: lockRecord,
    requires_confirmation: false,
  };
}

export function planReopen({ artifactId, dependencies, reason }) {
  requireString(artifactId, 'artifactId');
  if (!isReason(reason)) {
    throw new ContractError('REOPEN_REASON_REQUIRED', 'A reopen plan requires a non-empty reason or evidence object.');
  }

  const graph = normalizeDependencyGraph(dependencies);
  const affected = descendantsOf(graph.adjacency, artifactId);
  const affectedSet = new Set(affected);
  const preserved = [...graph.nodes]
    .filter((id) => id !== artifactId && !affectedSet.has(id))
    .sort();

  return {
    action: 'REOPEN',
    outcome: 'REOPEN',
    artifact_id: artifactId,
    reason: clone(reason),
    reopened_artifact: {
      artifact_id: artifactId,
      action: 'CREATE_REVISED_VERSION',
      status: 'DRAFT',
    },
    affected_artifact_ids: affected,
    stale_artifact_ids: affected,
    preserved_artifact_ids: preserved,
    transitions: affected.map((id) => ({ artifact_id: id, status: 'STALE' })),
  };
}

export function validateWorkflow() {
  const base = {
    schema_version: SCHEMA_VERSION,
    project_id: 'VALIDATION-PRJ',
    artifact_id: 'VALIDATION-ART-V1',
    type: 'creative_routes',
    stage: 'P4_CREATIVE_ROUTES',
    status: 'PROPOSED',
    version: 1,
    owner_capability: 'creative_director',
    decision_bearing: true,
    input_artifact_ids: [],
    path: 'artifacts/validation-v1.md',
    content_hash: sha256('validation-proposal'),
    previous_version_id: null,
    created_at: '2026-07-11T00:00:00.000Z',
    updated_at: '2026-07-11T00:00:00.000Z',
  };
  const proposal = createDecisionPacket(base, validationProposal('VALIDATION-DP-1'));
  const feedback = {
    schema_version: SCHEMA_VERSION,
    project_id: base.project_id,
    feedback_id: 'VALIDATION-FB-1',
    packet_id: proposal.packet_id,
    action: 'SELECT',
    decision_owner: 'validation_owner',
    selected_option_id: 'A',
    comment: 'Develop A.',
  };
  const revised = applyHumanFeedback({ artifact: base, packet: proposal, feedback });
  const revisedArtifact = {
    ...revised.artifact,
    artifact_id: 'VALIDATION-ART-V2',
    version: 2,
    content_hash: sha256('validation-revision'),
    path: 'artifacts/validation-v2.md',
    previous_version_id: base.artifact_id,
  };
  const confirmation = createDecisionPacket(revisedArtifact, {
    ...validationProposal('VALIDATION-DP-2'),
    proposed_artifact_hash: base.content_hash,
    prior_feedback_id: feedback.feedback_id,
    allowed_responses: CONFIRMATION_RESPONSES,
    signoffs: [
      { type: 'CLIENT_DECISION', status: 'APPROVED', reference_id: 'SIGNOFF-CLIENT' },
      { type: 'STRATEGY', status: 'APPROVED', reference_id: 'SIGNOFF-STRATEGY' },
      { type: 'CREATIVE', status: 'APPROVED', reference_id: 'SIGNOFF-CREATIVE' },
    ],
  });
  const locked = confirmLock({ artifact: revisedArtifact, packet: confirmation, feedback: {
    schema_version: SCHEMA_VERSION,
    project_id: base.project_id,
    feedback_id: 'VALIDATION-FB-2',
    packet_id: confirmation.packet_id,
    action: 'LOCK',
    decision_owner: 'validation_owner',
    selected_option_id: 'A',
    confirmed_artifact_hash: revisedArtifact.content_hash,
    comment: 'Lock revised A.',
    created_at: '2026-07-11T00:01:00.000Z',
  } });
  const passed = proposal.interaction_phase === 'PROPOSAL'
    && !proposal.allowed_responses.includes('LOCK')
    && revised.status === 'REVISED'
    && confirmation.interaction_phase === 'CONFIRMATION'
    && locked.status === 'LOCKED';
  return { kind: 'tcis.workflow-validation.v1', passed, phases: [proposal.interaction_phase, revised.status, confirmation.interaction_phase, locked.status] };
}

function validationProposal(packetId) {
  return {
    packet_id: packetId,
    decision_owner: 'validation_owner',
    decision_question: 'Which route should advance?',
    options: [{ id: 'A', proposition: 'Route A', strengths: ['clear'], risks: ['bounded'] }],
    recommendation: { option_id: 'A', rationale: 'Best fit.' },
    known_facts: [], assumptions: [], unknowns: [], hard_blocks: [],
    allowed_responses: PROPOSAL_RESPONSES,
  };
}

function assertArtifactAuthority(artifact) {
  requireObject(artifact, 'artifact');
  const definition = ARTIFACT_DEFINITIONS[artifact.type];
  if (!definition) {
    validateArtifact(artifact);
  }
  if (artifact.owner_capability !== definition.owner_capability) {
    throw new ContractError('ARTIFACT_OWNER_MISMATCH', 'Artifact owner does not match the professional stage contract.', {
      artifact_id: artifact.artifact_id,
      expected: definition.owner_capability,
      actual: artifact.owner_capability,
    });
  }
  if (artifact.decision_bearing !== true || definition.decision_bearing !== true) {
    throw new ContractError('DECISION_BEARING_ARTIFACT_REQUIRED', 'Only a decision-bearing artifact may enter the human lock loop.', {
      artifact_id: artifact.artifact_id,
    });
  }
  validateArtifact(artifact);
  return artifact;
}

function assertPacketMatchesArtifact(packet, artifact) {
  validateDecisionPacket(packet);
  if (packet.artifact_id !== artifact.artifact_id
    || packet.project_id !== artifact.project_id
    || packet.artifact_version !== artifact.version
    || packet.stage !== artifact.stage) {
    throw new ContractError('PACKET_ARTIFACT_MISMATCH', 'Packet ID, version, and stage must match the artifact exactly.', {
      packet_artifact_id: packet.artifact_id,
      artifact_id: artifact.artifact_id,
      packet_project_id: packet.project_id,
      artifact_project_id: artifact.project_id,
      packet_version: packet.artifact_version,
      artifact_version: artifact.version,
      packet_stage: packet.stage,
      artifact_stage: artifact.stage,
    });
  }
  if (packet.artifact_owner_capability !== undefined
    && packet.artifact_owner_capability !== artifact.owner_capability) {
    throw new ContractError('PACKET_OWNER_MISMATCH', 'Packet artifact owner must match the artifact owner capability.');
  }
}

function normalizeOption(option, index) {
  requireObject(option, `proposal.options[${index}]`);
  requireString(option.id, `proposal.options[${index}].id`);
  requireString(option.proposition, `proposal.options[${index}].proposition`);
  const normalized = {
    ...clone(option),
    id: option.id,
    proposition: option.proposition,
    strengths: copyArray(option.strengths),
    risks: copyArray(option.risks),
    downstream_effects: copyArray(option.downstream_effects),
  };
  return normalized;
}

function normalizeRecommendation(recommendation, options) {
  requireObject(recommendation, 'proposal.recommendation');
  requireString(recommendation.option_id, 'proposal.recommendation.option_id');
  requireString(recommendation.rationale, 'proposal.recommendation.rationale');
  if (!options.some((option) => option.id === recommendation.option_id)) {
    throw new ContractError('INVALID_RECOMMENDATION', 'The recommendation must identify one presented option.');
  }
  return clone(recommendation);
}

function normalizeAllowedResponses(responses, interactionPhase) {
  const defaults = interactionPhase === 'CONFIRMATION' ? CONFIRMATION_RESPONSES : PROPOSAL_RESPONSES;
  const selected = responses === undefined ? [...defaults] : copyArray(responses);
  for (const required of ['NONE', 'REOPEN']) {
    if (!selected.includes(required)) selected.push(required);
  }
  ensureUniqueIds(selected, 'DUPLICATE_ALLOWED_RESPONSE', 'Allowed responses must be unique.');
  return selected;
}

function validateConfirmationContext({ artifact, proposal }) {
  requireString(proposal.prior_feedback_id, 'proposal.prior_feedback_id');
  const proposedHash = proposal.proposed_artifact_hash ?? artifact.proposed_content_hash;
  requireSha256(proposedHash, 'proposal.proposed_artifact_hash');
  if (proposedHash === artifact.content_hash) {
    throw new TransitionError(
      'REVISED_HASH_REQUIRED',
      'A confirmation packet requires a revised artifact hash different from the proposed artifact hash.',
      { content_hash: artifact.content_hash },
    );
  }
  return {
    revised_artifact_hash: artifact.content_hash,
    proposed_artifact_hash: proposedHash,
    prior_feedback_id: proposal.prior_feedback_id,
  };
}

function validateCampaignPlatformContext({ artifact, proposal }) {
  if (!proposal.project) {
    throw new ContractError(
      'PLATFORM_PROJECT_CONTEXT_REQUIRED',
      'A campaign platform decision requires project context for the applicability gate.',
    );
  }
  const platform = proposal.platform ?? artifact.platform ?? platformFieldsFrom(artifact);
  requireObject(platform, 'proposal.platform');
  if (proposal.project.project_id !== artifact.project_id) {
    throw new ContractError('PLATFORM_PROJECT_MISMATCH', 'Campaign platform project context must match the artifact project.');
  }
  assertUniqueNonEmptyStrings(platform.example_executions, 'platform.example_executions');
  assertUniqueNonEmptyStrings(platform.coverage_dimensions, 'platform.coverage_dimensions');
  validatePlatformApplicability({ project: proposal.project, platform });

  return {
    project_id: proposal.project.project_id,
    scope_mode: proposal.project.scope_mode,
    platform: clone(platform),
  };
}

function platformFieldsFrom(artifact) {
  const fields = [
    'organizing_idea',
    'brand_product_role',
    'invariants',
    'variables',
    'prohibitions',
    'example_executions',
    'coverage_dimensions',
  ];
  return Object.fromEntries(fields.filter((field) => field in artifact).map((field) => [field, clone(artifact[field])]));
}

function assertUniqueNonEmptyStrings(values, path) {
  requireArray(values, path);
  for (const [index, value] of values.entries()) requireString(value, `${path}[${index}]`);
  const normalized = values.map((value) => value.trim());
  if (new Set(normalized).size !== normalized.length) {
    throw new ContractError('DUPLICATE_PLATFORM_ENTRY', `${path} entries must be unique.`, { path });
  }
}

function assertActualMediaOptions(options) {
  const invalid = options.filter((option) => !hasActualMediaEvidence(option)).map((option) => option.id);
  if (invalid.length > 0) {
    throw new ContractError(
      'ACTUAL_MEDIA_REQUIRED',
      'Every production-select option must bind inspected actual pixels, frames, or audio.',
      { option_ids: invalid },
    );
  }
}

function hasActualMediaEvidence(option) {
  const candidates = [option.actual_media, option.attempt, option.proof_or_preview, option]
    .filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry));
  return candidates.some((entry) => {
    const path = entry.output_path ?? entry.path ?? entry.media_path;
    const hash = entry.output_hash ?? entry.hash ?? entry.media_hash;
    const inspection = entry.inspection ?? entry.actual_media_inspection;
    const validStatus = entry.status === undefined || ['INSPECTED', 'SELECTED'].includes(entry.status);
    return isContainedRelativePath(path) && isSha256(hash) && inspection?.passed === true && validStatus;
  });
}

function extractResponses(feedback) {
  if (feedback === null || feedback === undefined) return [];
  if (Array.isArray(feedback)) return feedback;
  if (Array.isArray(feedback.responses)) return feedback.responses;
  if (Array.isArray(feedback.stakeholder_feedback) && feedback.action === undefined) return feedback.stakeholder_feedback;
  return [feedback];
}

function detectFeedbackConflict(feedback, responses, packet) {
  const explicit = !Array.isArray(feedback) && feedback && typeof feedback === 'object'
    && (feedback.conflict === true
      || feedback.compatible === false
      || (Array.isArray(feedback.conflicting_requirements) && feedback.conflicting_requirements.length > 0));
  const bindingIntents = responses
    .filter((response) => response.action !== 'ADVISE')
    .map((response) => `${response.action}:${response.selected_option_id ?? ''}`);
  const selectionConflict = uniqueStrings(bindingIntents).length > 1;
  const adviceConflict = conflictingAdvice(responses);
  if (!explicit && !selectionConflict && !adviceConflict) return null;

  return {
    decision_owner: packet.decision_owner,
    original_requirements: clone(responses),
    incompatible_requirements: !Array.isArray(feedback)
      ? copyArray(feedback?.conflicting_requirements)
      : [],
    recommendation: 'Preserve the conflict and ask the named decision owner to choose; do not average or silently merge.',
    authority_issues: responses
      .filter((response) => response.decision_owner !== packet.decision_owner)
      .map((response) => ({ feedback_id: response.feedback_id, decision_owner: response.decision_owner })),
  };
}

function validateConflictFeedbackShape(response, packet) {
  requireObject(response, 'feedback');
  if (response.schema_version !== SCHEMA_VERSION) {
    throw new ContractError('FEEDBACK_SCHEMA_MISMATCH', 'Conflicting feedback must use the current schema version.');
  }
  if (response.project_id !== packet.project_id || response.packet_id !== packet.packet_id) {
    throw new ContractError('FEEDBACK_PACKET_MISMATCH', 'Conflicting feedback must refer to the same project and packet.');
  }
  requireString(response.feedback_id, 'feedback.feedback_id');
  requireString(response.decision_owner, 'feedback.decision_owner');
  requireString(response.action, 'feedback.action');
  requireString(response.comment, 'feedback.comment');
  assertActionAllowed(response.action, packet);
  if (['SELECT', 'LOCK'].includes(response.action)) requireString(response.selected_option_id, 'feedback.selected_option_id');
}

function conflictingAdvice(responses) {
  const byField = new Map();
  for (const response of responses) {
    const entries = [];
    if (nonEmptyString(response.field) && response.value !== undefined) entries.push([response.field, response.value]);
    if (Array.isArray(response.advice)) {
      for (const item of response.advice) {
        if (item && typeof item === 'object' && nonEmptyString(item.field) && item.value !== undefined) {
          entries.push([item.field, item.value]);
        }
      }
    }
    for (const [field, value] of entries) {
      const encoded = stableStringify(value);
      if (byField.has(field) && byField.get(field) !== encoded) return true;
      byField.set(field, encoded);
    }
  }
  return false;
}

function revisionResult({ artifact, packet, response, selectedOptionId }) {
  if (artifact.status === 'REVISED') {
    validateArtifactTransition('REVISED', 'DRAFT');
    return {
      state: 'REVISION_REQUESTED',
      status: 'DRAFT',
      outcome: 'REVISE',
      artifact: {
        ...clone(artifact),
        status: 'DRAFT',
        pending_lock_confirmation: false,
        revision_required: true,
        human_feedback_ids: [...(artifact.human_feedback_ids ?? []), response.feedback_id],
      },
      packet: clone(packet),
      selected_option_id: selectedOptionId,
      revision_directive: response.comment,
      decision_record: null,
      requires_confirmation: false,
    };
  }
  validateArtifactTransition('PROPOSED', 'REVISED');
  const revisedArtifact = {
    ...clone(artifact),
    status: 'REVISED',
    selected_option_id: selectedOptionId,
    pending_lock_confirmation: true,
    revision_required: true,
    proposed_content_hash: packet.artifact_content_hash,
    human_feedback_ids: [response.feedback_id],
  };
  return {
    state: 'REVISED',
    status: 'REVISED',
    outcome: 'REVISE',
    artifact: revisedArtifact,
    packet: clone(packet),
    selected_option_id: selectedOptionId,
    revision_directive: response.comment,
    decision_record: null,
    requires_confirmation: true,
  };
}

function reexploreResult({ artifact, packet, response }) {
  validateArtifactTransition(artifact.status, 'DRAFT');
  return {
    state: 'REEXPLORE',
    status: 'DRAFT',
    outcome: 'REVISE',
    artifact: {
      ...clone(artifact),
      status: 'DRAFT',
      selected_option_id: null,
      rejected_option_ids: packet.options.map((option) => option.id),
      rejection_reason: response.comment,
    },
    packet: clone(packet),
    decision_record: null,
    requires_confirmation: false,
  };
}

function reopenResult({ artifact, packet, response }) {
  validateArtifactTransition(artifact.status, 'DRAFT');
  return {
    state: 'REOPEN_REQUIRED',
    status: 'DRAFT',
    outcome: 'REOPEN',
    artifact: {
      ...clone(artifact),
      status: 'DRAFT',
      selected_option_id: null,
      reopen_reason: response.comment,
    },
    packet: clone(packet),
    reopen: { artifact_id: artifact.artifact_id, reason: response.comment },
    decision_record: null,
    requires_confirmation: false,
  };
}

function stopResult({ artifact, packet, response }) {
  validateArtifactTransition(artifact.status, 'BLOCKED');
  return {
    state: 'STOPPED',
    status: 'BLOCKED',
    outcome: 'STOP',
    artifact: { ...clone(artifact), status: 'BLOCKED', block_reason: response.comment },
    packet: clone(packet),
    decision_record: null,
    requires_confirmation: false,
  };
}

function waitingResult(artifact, packet, reason) {
  return {
    state: 'AWAITING_HUMAN',
    status: artifact.status,
    outcome: 'NO_DECISION',
    artifact: clone(artifact),
    packet: clone(packet),
    decision_record: null,
    requires_confirmation: false,
    reason,
  };
}

function preserveOrthogonalSignoffs({ artifact, packet, feedback }) {
  const merged = new Map();
  for (const [path, source] of [
    ['artifact.signoffs', artifact.signoffs ?? []],
    ['packet.signoffs', packet.signoffs ?? []],
    ['feedback.signoffs', feedback.signoffs ?? []],
  ]) {
    requireArray(source, path);
    for (const signoff of source) {
      requireObject(signoff, `${path}[]`);
      requireString(signoff.type, `${path}[].type`);
      if (signoff.type === 'CLIENT_DECISION') continue;
      merged.set(signoff.type, clone(signoff));
    }
  }
  merged.set('CLIENT_DECISION', {
    type: 'CLIENT_DECISION',
    status: 'APPROVED',
    reference_id: feedback.feedback_id,
  });
  return [...merged.values()];
}

function assertActionAllowed(action, packet) {
  if (!packet.allowed_responses.includes(action)) {
    throw new ContractError('FEEDBACK_ACTION_NOT_ALLOWED', `Feedback action ${action} is not allowed by this packet.`, {
      action,
      allowed_responses: clone(packet.allowed_responses),
    });
  }
}

function assertFeedbackOwner(feedback, packet) {
  if (feedback.decision_owner !== packet.decision_owner) {
    throw new ContractError('FEEDBACK_OWNER_MISMATCH', 'Feedback owner must equal the packet decision owner.', {
      expected: packet.decision_owner,
      actual: feedback.decision_owner,
    });
  }
}

function requireNamedOwner(value, path) {
  requireString(value, path);
  if (UNNAMED_OWNERS.has(value.trim().toLowerCase())) {
    throw new ContractError('NAMED_DECISION_OWNER_REQUIRED', `${path} must identify one named human or authorized role.`, { path });
  }
  return value;
}

function normalizeDependencyGraph(dependencies) {
  const adjacency = new Map();
  const nodes = new Set();
  const addEdge = (from, to) => {
    if (!nonEmptyString(from) || !nonEmptyString(to)) return;
    nodes.add(from);
    nodes.add(to);
    if (!adjacency.has(from)) adjacency.set(from, new Set());
    adjacency.get(from).add(to);
  };
  const addNode = (id) => {
    if (nonEmptyString(id)) nodes.add(id);
  };

  const consume = (value) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (nonEmptyString(entry)) {
          addNode(entry);
          continue;
        }
        if (!entry || typeof entry !== 'object') continue;
        const artifactId = entry.artifact_id ?? entry.id;
        addNode(artifactId);
        for (const parent of entry.input_artifact_ids ?? entry.depends_on ?? []) addEdge(parent, artifactId);
        const from = entry.from ?? entry.from_artifact_id ?? entry.source ?? entry.parent ?? entry.upstream_artifact_id;
        const to = entry.to ?? entry.to_artifact_id ?? entry.target ?? entry.child ?? entry.downstream_artifact_id;
        if (from && to) addEdge(from, to);
      }
      return;
    }
    requireObject(value, 'dependencies');
    if (Array.isArray(value.edges)) consume(value.edges);
    if (Array.isArray(value.artifacts)) consume(value.artifacts);
    for (const [from, children] of Object.entries(value.adjacency ?? value.downstream ?? {})) {
      addNode(from);
      for (const child of Array.isArray(children) ? children : []) addEdge(from, child);
    }
    if (!value.edges && !value.artifacts && !value.adjacency && !value.downstream) {
      for (const [from, children] of Object.entries(value)) {
        addNode(from);
        if (Array.isArray(children)) for (const child of children) addEdge(from, child);
      }
    }
  };

  consume(dependencies);
  return { adjacency, nodes };
}

function descendantsOf(adjacency, root) {
  const visited = new Set([root]);
  const result = [];
  const queue = [...(adjacency.get(root) ?? [])].sort();
  while (queue.length > 0) {
    const id = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    result.push(id);
    const children = [...(adjacency.get(id) ?? [])].sort();
    for (const child of children) if (!visited.has(child)) queue.push(child);
  }
  return result;
}

function isReason(reason) {
  if (nonEmptyString(reason)) return true;
  return Boolean(reason && typeof reason === 'object' && !Array.isArray(reason) && Object.keys(reason).length > 0);
}

function stageCode(stage) {
  return stage.split('_', 1)[0];
}

function deterministicId(prefix, value) {
  return `${prefix}-${sha256(stableStringify(value)).slice(0, 16).toUpperCase()}`;
}

function copyArray(value) {
  if (value === undefined) return [];
  requireArray(value, 'array value');
  return clone(value);
}

function ensureUniqueIds(values, code, message) {
  if (uniqueStrings(values).length !== values.length) throw new ContractError(code, message);
}

function requireObject(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ContractError('OBJECT_REQUIRED', `${path} must be an object.`, { path });
  }
}

function requireArray(value, path) {
  if (!Array.isArray(value)) throw new ContractError('ARRAY_REQUIRED', `${path} must be an array.`, { path });
}

function requireString(value, path) {
  if (!nonEmptyString(value)) throw new ContractError('STRING_REQUIRED', `${path} must be a non-empty string.`, { path });
}

function requireSha256(value, path) {
  if (typeof value !== 'string' || !/^[a-fA-F0-9]{64}$/.test(value)) {
    throw new ContractError('INVALID_SHA256', `${path} must be a 64-character SHA-256 hex digest.`, { path });
  }
}

function isSha256(value) {
  return typeof value === 'string' && /^[a-fA-F0-9]{64}$/.test(value);
}

function isContainedRelativePath(value) {
  if (!nonEmptyString(value)) return false;
  const normalized = value.replaceAll('\\', '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) return false;
  return normalized.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}
