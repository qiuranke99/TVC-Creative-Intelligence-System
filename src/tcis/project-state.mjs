import {
  ARTIFACT_DEFINITIONS,
  SCHEMA_VERSION,
  validateArtifact,
  validateArtifactForProject,
  validateArtifactTransition,
  validateAttempt,
  validateClaim,
  validateDecisionPacketForArtifact,
  validateDecisionRecord,
  validateDependency,
  validateHumanFeedback,
  validateLockRecord,
  validateProject,
  validateRight,
  validateShot,
  validateTake,
  validateTimeline,
} from './contracts.mjs';
import { ConcurrencyError, ContractError, NotFoundError, StateError, TransitionError } from './errors.mjs';
import { clone, compareCodeUnits, nonEmptyString, sha256, stableStringify, uniqueStrings } from './utils.mjs';

export const STATE_FORMAT_VERSION = 1;
export const HASH_PATTERN = /^[0-9a-f]{64}$/;

const PROJECT_STORAGE_FIELDS = new Set(['state_hash', 'manifest_hash', 'state_path']);

export function createProjectRecord(spec, { at }) {
  requireRecord(spec, 'project spec');
  const {
    artifacts: _artifacts,
    attempts: _attempts,
    claims: _claims,
    decisions: _decisions,
    dependencies: _dependencies,
    events: _events,
    facts: _facts,
    rights: _rights,
    shots: _shots,
    takes: _takes,
    timelines: _timelines,
    ...projectSpec
  } = clone(spec);

  const project = {
    ...projectSpec,
    schema_version: SCHEMA_VERSION,
    current_stage: projectSpec.current_stage ?? 'P0_BRIEF_ALIGNMENT',
    status: projectSpec.status ?? 'ACTIVE',
    revision: 0,
    active_artifact_id: projectSpec.active_artifact_id ?? null,
    created_at: projectSpec.created_at ?? at,
    updated_at: projectSpec.updated_at ?? at,
  };
  validateProject(project);
  return project;
}

export function createEmptySnapshot(project) {
  return {
    project: clone(project),
    artifacts: [],
    dependencies: [],
    facts: [],
    claims: [],
    rights: [],
    attempts: [],
    shots: [],
    takes: [],
    timelines: [],
    interactions: [],
    decision_packets: [],
    human_feedback: [],
    lock_records: [],
    decisions: [],
    events: [],
  };
}

export function assertExpectedRevision(project, expectedRevision) {
  const revision = typeof expectedRevision === 'object' && expectedRevision !== null
    ? expectedRevision.project_revision ?? expectedRevision.projectRevision ?? expectedRevision.revision
    : expectedRevision;
  if (!Number.isInteger(revision) || revision < 0) {
    throw new ConcurrencyError(
      'REVISION_REQUIRED',
      'A non-negative integer expectedRevision is required for every project mutation.',
      { expected_revision: expectedRevision, actual_revision: project.revision },
    );
  }
  if (project.revision !== revision) {
    throw new ConcurrencyError('REVISION_CONFLICT', 'The project changed after the caller loaded it.', {
      expected_revision: revision,
      actual_revision: project.revision,
    });
  }
  return revision;
}

export function assertArtifactCas(artifact, expectedRevision) {
  if (typeof expectedRevision !== 'object' || expectedRevision === null) {
    return { artifact_version: artifact.version, artifact_hash: artifact.content_hash };
  }
  const expectedArtifactId = expectedRevision.artifact_id ?? expectedRevision.artifactId;
  const expectedVersion = expectedRevision.artifact_version ?? expectedRevision.artifactVersion;
  const expectedHash = expectedRevision.artifact_hash ?? expectedRevision.artifactHash ?? expectedRevision.content_hash;
  if (expectedArtifactId !== undefined && expectedArtifactId !== artifact.artifact_id) {
    throw new ConcurrencyError('ARTIFACT_CAS_CONFLICT', 'The artifact CAS token identifies a different artifact.', {
      expected_artifact_id: expectedArtifactId,
      actual_artifact_id: artifact.artifact_id,
    });
  }
  if (!Number.isInteger(expectedVersion) || !HASH_PATTERN.test(expectedHash ?? '')) {
    throw new ConcurrencyError(
      'ARTIFACT_CAS_REQUIRED',
      'An object revision token for an artifact mutation must include artifact_version and artifact_hash.',
      { artifact_id: artifact.artifact_id },
    );
  }
  if (artifact.version !== expectedVersion || artifact.content_hash !== expectedHash) {
    throw new ConcurrencyError('ARTIFACT_CAS_CONFLICT', 'The artifact version or content hash changed after it was loaded.', {
      artifact_id: artifact.artifact_id,
      expected_version: expectedVersion,
      actual_version: artifact.version,
      expected_hash: expectedHash,
      actual_hash: artifact.content_hash,
    });
  }
  return { artifact_version: expectedVersion, artifact_hash: expectedHash };
}

export function advanceRevision(snapshot, at) {
  snapshot.project.revision += 1;
  snapshot.project.updated_at = at;
  return snapshot.project.revision;
}

export function calculateStateHash(snapshot) {
  const project = Object.fromEntries(
    Object.entries(snapshot.project).filter(([key]) => !PROJECT_STORAGE_FIELDS.has(key)),
  );
  return sha256(stableStringify({
    format_version: STATE_FORMAT_VERSION,
    project,
    artifacts: sortBy(snapshot.artifacts, 'artifact_id'),
    dependencies: sortDependencies(snapshot.dependencies),
    facts: sortBy(snapshot.facts, 'fact_id'),
    claims: sortBy(snapshot.claims, 'claim_id'),
    rights: sortBy(snapshot.rights, 'right_id'),
    attempts: sortBy(snapshot.attempts, 'attempt_id'),
    shots: sortBy(snapshot.shots ?? [], 'shot_id'),
    takes: sortBy(snapshot.takes ?? [], 'take_id'),
    timelines: sortBy(snapshot.timelines ?? [], 'timeline_id'),
    interactions: clone(snapshot.interactions),
    decisions: clone(snapshot.decisions),
  }));
}

export function validateSnapshot(snapshot, { requireStateHash = true } = {}) {
  requireRecord(snapshot, 'snapshot');
  validateProject(snapshot.project);
  for (const key of [
    'artifacts',
    'dependencies',
    'facts',
    'claims',
    'rights',
    'attempts',
    'shots',
    'takes',
    'timelines',
    'interactions',
    'decision_packets',
    'human_feedback',
    'lock_records',
    'decisions',
    'events',
  ]) {
    if (!Array.isArray(snapshot[key])) stateFail('MALFORMED_STATE', `snapshot.${key} must be an array.`, { key });
  }

  if (requireStateHash) requireHash(snapshot.project.state_hash, 'project.state_hash');
  if (snapshot.project.manifest_hash !== undefined) requireHash(snapshot.project.manifest_hash, 'project.manifest_hash');

  const artifacts = new Map();
  const artifactPaths = new Map();
  for (const artifact of snapshot.artifacts) {
    validateArtifactForProject(snapshot.project, artifact, artifact.platform ?? null);
    requireProjectScope(artifact, snapshot.project.project_id, `artifact ${artifact.artifact_id}`);
    requireHash(artifact.content_hash, `artifact ${artifact.artifact_id} content_hash`);
    addUnique(artifacts, artifact.artifact_id, artifact, 'DUPLICATE_ARTIFACT_ID');
    if (artifactPaths.has(artifact.path)) {
      stateFail('DUPLICATE_ARTIFACT_PATH', `Multiple artifacts use path ${artifact.path}.`, {
        path: artifact.path,
        artifact_ids: [artifactPaths.get(artifact.path), artifact.artifact_id],
      });
    }
    artifactPaths.set(artifact.path, artifact.artifact_id);
  }

  for (const artifact of snapshot.artifacts) {
    for (const inputId of artifact.input_artifact_ids) {
      if (!artifacts.has(inputId)) {
        stateFail('ORPHAN_ARTIFACT_INPUT', `Artifact ${artifact.artifact_id} references missing input ${inputId}.`, {
          artifact_id: artifact.artifact_id,
          input_artifact_id: inputId,
        });
      }
    }
    if (artifact.previous_version_id !== null && artifact.previous_version_id !== undefined) {
      const previous = artifacts.get(artifact.previous_version_id);
      if (!previous) {
        stateFail('ORPHAN_ARTIFACT_VERSION', `Artifact ${artifact.artifact_id} has a missing previous version.`, {
          artifact_id: artifact.artifact_id,
          previous_version_id: artifact.previous_version_id,
        });
      }
      if (previous.type !== artifact.type || previous.version >= artifact.version) {
        stateFail('INVALID_ARTIFACT_VERSION_LINEAGE', `Artifact ${artifact.artifact_id} has invalid version lineage.`, {
          artifact_id: artifact.artifact_id,
          previous_version_id: artifact.previous_version_id,
        });
      }
    }
  }

  if (snapshot.project.active_artifact_id !== null) {
    const activeArtifact = artifacts.get(snapshot.project.active_artifact_id);
    if (!activeArtifact) {
      stateFail('ORPHAN_ACTIVE_ARTIFACT', 'The active artifact does not exist.', {
        active_artifact_id: snapshot.project.active_artifact_id,
      });
    }
    if (activeArtifact.stage !== snapshot.project.current_stage) {
      stateFail('ACTIVE_STAGE_MISMATCH', 'The active artifact and project current stage disagree.', {
        active_artifact_id: activeArtifact.artifact_id,
        artifact_stage: activeArtifact.stage,
        project_stage: snapshot.project.current_stage,
      });
    }
  }

  validateDependencies(snapshot.dependencies, artifacts, snapshot.project.project_id);
  const edges = new Set(snapshot.dependencies.map(dependencyKey));
  for (const artifact of snapshot.artifacts) {
    for (const inputId of artifact.input_artifact_ids) {
      if (!edges.has(dependencyKey({ upstream_id: inputId, downstream_id: artifact.artifact_id }))) {
        stateFail('MISSING_ARTIFACT_DEPENDENCY', `Artifact ${artifact.artifact_id} input ${inputId} has no dependency edge.`, {
          artifact_id: artifact.artifact_id,
          input_artifact_id: inputId,
        });
      }
    }
  }

  const facts = new Map();
  for (const fact of snapshot.facts) {
    validateFact(fact);
    requireProjectScope(fact, snapshot.project.project_id, `fact ${fact.fact_id}`);
    addUnique(facts, fact.fact_id, fact, 'DUPLICATE_FACT_ID');
  }

  const claims = new Map();
  for (const claim of snapshot.claims) {
    validateClaim(claim);
    requireProjectScope(claim, snapshot.project.project_id, `claim ${claim.claim_id}`);
    addUnique(claims, claim.claim_id, claim, 'DUPLICATE_CLAIM_ID');
  }

  const rights = new Map();
  for (const right of snapshot.rights) {
    validateRight(right);
    requireProjectScope(right, snapshot.project.project_id, `right ${right.right_id}`);
    addUnique(rights, right.right_id, right, 'DUPLICATE_RIGHT_ID');
  }

  const attempts = new Map();
  for (const attempt of snapshot.attempts) {
    validateAttempt(attempt);
    requireProjectScope(attempt, snapshot.project.project_id, `attempt ${attempt.attempt_id}`);
    requireHash(attempt.request_hash, `attempt ${attempt.attempt_id} request_hash`);
    if (attempt.output_hash !== undefined) requireHash(attempt.output_hash, `attempt ${attempt.attempt_id} output_hash`);
    if (!artifacts.has(attempt.artifact_id)) {
      stateFail('ORPHAN_ATTEMPT', `Attempt ${attempt.attempt_id} references a missing artifact.`, {
        attempt_id: attempt.attempt_id,
        artifact_id: attempt.artifact_id,
      });
    }
    addUnique(attempts, attempt.attempt_id, attempt, 'DUPLICATE_ATTEMPT_ID');
  }

  const shots = new Map();
  for (const shot of snapshot.shots) {
    validateShot(shot);
    requireProjectScope(shot, snapshot.project.project_id, `shot ${shot.shot_id}`);
    if (!artifacts.has(shot.artifact_id)) stateFail('ORPHAN_SHOT', `Shot ${shot.shot_id} references a missing artifact.`);
    addUnique(shots, shot.shot_id, shot, 'DUPLICATE_SHOT_ID');
  }

  const takes = new Map();
  for (const take of snapshot.takes) {
    validateTake(take);
    requireProjectScope(take, snapshot.project.project_id, `take ${take.take_id}`);
    if (!shots.has(take.shot_id)) stateFail('ORPHAN_TAKE', `Take ${take.take_id} references a missing shot.`);
    if (take.attempt_id && !attempts.has(take.attempt_id)) stateFail('ORPHAN_TAKE_ATTEMPT', `Take ${take.take_id} references a missing attempt.`);
    addUnique(takes, take.take_id, take, 'DUPLICATE_TAKE_ID');
  }

  const timelines = new Map();
  for (const timeline of snapshot.timelines) {
    validateTimeline(timeline);
    requireProjectScope(timeline, snapshot.project.project_id, `timeline ${timeline.timeline_id}`);
    if (!artifacts.has(timeline.artifact_id)) stateFail('ORPHAN_TIMELINE', `Timeline ${timeline.timeline_id} references a missing artifact.`);
    for (const track of timeline.tracks) {
      if (track.kind !== 'VIDEO') continue;
      for (const clip of track.clips) {
        const shot = shots.get(clip.shot_id);
        const take = takes.get(clip.take_id);
        if (!shot || !take || take.shot_id !== shot.shot_id || take.status !== 'SELECTED') {
          stateFail('INVALID_TIMELINE_MEDIA_LINEAGE', `Timeline clip ${clip.clip_id} must reference a selected take for its shot.`);
        }
      }
    }
    addUnique(timelines, timeline.timeline_id, timeline, 'DUPLICATE_TIMELINE_ID');
  }

  const interactions = validateInteractionLedger(snapshot.interactions, artifacts, snapshot.project);
  for (const key of ['decision_packets', 'human_feedback', 'lock_records']) {
    if (stableStringify(snapshot[key]) !== stableStringify(interactions[key])) {
      stateFail('INTERACTION_VIEW_DIVERGENCE', `${key} does not match the append-only interaction ledger.`, { key });
    }
  }
  validateDecisionHistory(snapshot.decisions, artifacts, snapshot.project, new Set(snapshot.lock_records.map((record) => record.lock_id)));
  validateEventHistory(snapshot.events, snapshot.project);

  if (requireStateHash) {
    const actual = calculateStateHash(snapshot);
    if (actual !== snapshot.project.state_hash) {
      stateFail('STATE_HASH_MISMATCH', 'The semantic project state hash does not match canonical state.', {
        expected: snapshot.project.state_hash,
        actual,
      });
    }
  }
  return snapshot;
}

export function createArtifactState(snapshot, spec, { artifactId, at, path, contentHash }) {
  requireRecord(spec, 'artifact spec');
  assertInputProjectScope(spec, snapshot.project.project_id, 'artifact spec');
  const definition = ARTIFACT_DEFINITIONS[spec.type];
  if (!definition) throw new ContractError('UNKNOWN_ARTIFACT_TYPE', `Unknown artifact type: ${spec.type}`, { type: spec.type });
  if (snapshot.artifacts.some((artifact) => artifact.artifact_id === artifactId)) {
    throw new StateError('ARTIFACT_EXISTS', `Artifact ${artifactId} already exists.`, { artifact_id: artifactId });
  }

  const previous = spec.previous_version_id === null || spec.previous_version_id === undefined
    ? null
    : findArtifact(snapshot, spec.previous_version_id);
  if (previous && previous.type !== spec.type) {
    throw new ContractError('ARTIFACT_VERSION_TYPE_MISMATCH', 'An artifact version must retain its artifact type.', {
      previous_version_id: previous.artifact_id,
      previous_type: previous.type,
      type: spec.type,
    });
  }

  const inputArtifactIds = uniqueStrings(spec.input_artifact_ids ?? []);
  for (const inputId of inputArtifactIds) {
    findArtifact(snapshot, inputId);
    if (inputId === artifactId) throw new TransitionError('SELF_DEPENDENCY', 'An artifact cannot depend on itself.');
  }

  const { content: _content, content_hash: _providedHash, ...recordSpec } = clone(spec);
  const artifact = {
    ...recordSpec,
    schema_version: SCHEMA_VERSION,
    project_id: snapshot.project.project_id,
    artifact_id: artifactId,
    type: spec.type,
    stage: spec.stage ?? definition.stage,
    status: spec.status ?? 'DRAFT',
    version: spec.version ?? (previous ? previous.version + 1 : 1),
    owner_capability: spec.owner_capability ?? definition.owner_capability,
    decision_bearing: spec.decision_bearing ?? definition.decision_bearing,
    input_artifact_ids: inputArtifactIds,
    path,
    content_hash: contentHash,
    previous_version_id: previous?.artifact_id ?? null,
    created_at: spec.created_at ?? at,
    updated_at: at,
  };
  if (artifact.type === 'campaign_platform') {
    artifact.platform = clone(spec.platform);
    validateArtifactForProject(snapshot.project, artifact, artifact.platform);
  } else {
    validateArtifact(artifact);
  }
  requireHash(artifact.content_hash, 'artifact.content_hash');

  if (snapshot.artifacts.some((candidate) => candidate.path === path)) {
    throw new StateError('ARTIFACT_PATH_EXISTS', `Artifact path ${path} is already registered.`, { path });
  }

  snapshot.artifacts.push(artifact);
  for (const inputId of inputArtifactIds) {
    const upstream = findArtifact(snapshot, inputId);
    snapshot.dependencies.push(createDependencyRecord(snapshot.project.project_id, upstream, artifact));
  }
  snapshot.artifacts = sortBy(snapshot.artifacts, 'artifact_id');
  snapshot.dependencies = sortDependencies(snapshot.dependencies);
  snapshot.project.active_artifact_id = artifactId;
  snapshot.project.current_stage = artifact.stage;
  return artifact;
}

export function transitionArtifactState(snapshot, artifactId, toStatus, at) {
  const artifact = findArtifact(snapshot, artifactId);
  validateArtifactTransition(artifact.status, toStatus);
  artifact.status = toStatus;
  artifact.updated_at = at;
  snapshot.project.active_artifact_id = artifact.artifact_id;
  snapshot.project.current_stage = artifact.stage;
  return artifact;
}

export function finalizeArtifactLockState(snapshot, artifactId, { feedback, lockRecord }, at) {
  const artifact = transitionArtifactState(snapshot, artifactId, 'LOCKED', at);
  artifact.pending_lock_confirmation = false;
  artifact.revision_required = false;
  artifact.locked_by = feedback.decision_owner;
  artifact.locked_content_hash = artifact.content_hash;
  artifact.lock_id = lockRecord.lock_id;
  artifact.human_feedback_ids = uniqueStrings([...(artifact.human_feedback_ids ?? []), feedback.feedback_id]);
  artifact.signoffs = clone(lockRecord.signoffs);
  validateArtifact(artifact);
  return artifact;
}

export function addDependencyState(snapshot, upstreamId, downstreamId, at) {
  if (upstreamId === downstreamId) throw new TransitionError('SELF_DEPENDENCY', 'An artifact cannot depend on itself.');
  const downstream = findArtifact(snapshot, downstreamId);
  const upstream = findArtifact(snapshot, upstreamId);
  const edge = createDependencyRecord(snapshot.project.project_id, upstream, downstream);
  if (snapshot.dependencies.some((candidate) => dependencyKey(candidate) === dependencyKey(edge))) {
    throw new StateError('DEPENDENCY_EXISTS', `Dependency ${upstreamId} -> ${downstreamId} already exists.`, edge);
  }

  const candidateDependencies = [...snapshot.dependencies, edge];
  validateDependencies(
    candidateDependencies,
    new Map(snapshot.artifacts.map((artifact) => [artifact.artifact_id, artifact])),
    snapshot.project.project_id,
  );
  snapshot.dependencies = sortDependencies(candidateDependencies);
  downstream.input_artifact_ids = uniqueStrings([...downstream.input_artifact_ids, upstreamId]);
  downstream.updated_at = at;
  return edge;
}

export function invalidateDescendantsState(snapshot, upstreamId, reason, at) {
  if (!nonEmptyString(reason)) throw new ContractError('INVALIDATION_REASON_REQUIRED', 'Invalidation requires a non-empty reason.');
  const upstream = findArtifact(snapshot, upstreamId);
  const descendantIds = collectDescendantIds(snapshot.dependencies, upstreamId);
  const invalidatedIds = [];

  for (const artifactId of descendantIds) {
    const artifact = findArtifact(snapshot, artifactId);
    let nextStatus = artifact.status;
    if (artifact.status === 'LOCKED') nextStatus = 'STALE';
    else if (!['STALE', 'BLOCKED'].includes(artifact.status)) nextStatus = 'BLOCKED';

    if (nextStatus !== artifact.status) validateArtifactTransition(artifact.status, nextStatus);
    artifact.status = nextStatus;
    artifact.invalidated_by = upstreamId;
    artifact.invalidation_reason = reason;
    artifact.invalidated_at = at;
    artifact.updated_at = at;
    invalidatedIds.push(artifactId);
  }

  snapshot.project.active_artifact_id = upstream.artifact_id;
  snapshot.project.current_stage = upstream.stage;
  return { descendantIds, invalidatedIds };
}

export function appendDecisionState(snapshot, record, { at, revision }) {
  requireRecord(record, 'decision');
  assertInputProjectScope(record, snapshot.project.project_id, 'decision');
  const decision = {
    ...clone(record),
    schema_version: record.schema_version ?? SCHEMA_VERSION,
    record_type: record.record_type ?? 'DECISION',
    project_id: snapshot.project.project_id,
    decided_at: record.decided_at ?? at,
    project_revision: revision,
  };
  validateDecisionRecord(decision);
  if (snapshot.decisions.some((candidate) => candidate.decision_id === decision.decision_id)) {
    throw new StateError('DECISION_EXISTS', `Decision ${decision.decision_id} already exists.`, { decision_id: decision.decision_id });
  }
  const artifact = findArtifact(snapshot, decision.artifact_id);
  if (artifact.version !== decision.artifact_version) {
    throw new ContractError('DECISION_ARTIFACT_VERSION_MISMATCH', 'Decision artifact_version does not match the artifact.', {
      decision_id: decision.decision_id,
      expected_version: artifact.version,
      actual_version: decision.artifact_version,
    });
  }
  decision.record_hash = hashRecord(decision);
  snapshot.decisions.push(decision);
  return decision;
}

export function appendDecisionPacketState(snapshot, record, { at, revision }) {
  requireRecord(record, 'decision packet');
  assertInputProjectScope(record, snapshot.project.project_id, 'decision packet');
  const artifact = findArtifact(snapshot, record.artifact_id);
  const priorPackets = snapshot.decision_packets.filter((candidate) => candidate.artifact_id === artifact.artifact_id);
  const packet = enrichInteraction({
    ...clone(record),
    schema_version: record.schema_version ?? SCHEMA_VERSION,
    record_type: 'DECISION_PACKET',
    project_id: snapshot.project.project_id,
    packet_version: record.packet_version ?? (Math.max(0, ...priorPackets.map((candidate) => candidate.packet_version)) + 1),
  }, snapshot, { at, revision });
  validateDecisionPacketForArtifact(packet, artifact);
  if (!Number.isInteger(packet.packet_version) || packet.packet_version < 1) {
    throw new ContractError('PACKET_VERSION_REQUIRED', 'decision_packet.packet_version must be an integer >= 1.');
  }
  if (snapshot.decision_packets.some((candidate) => candidate.packet_id === packet.packet_id)) {
    throw new StateError('DECISION_PACKET_EXISTS', `Decision packet ${packet.packet_id} already exists.`, { packet_id: packet.packet_id });
  }
  if (priorPackets.some((candidate) => candidate.packet_version === packet.packet_version)) {
    throw new StateError('DECISION_PACKET_VERSION_EXISTS', `Artifact ${artifact.artifact_id} already has decision packet version ${packet.packet_version}.`);
  }
  if (packet.interaction_phase === 'CONFIRMATION') {
    const priorFeedback = snapshot.human_feedback.find((candidate) => candidate.feedback_id === packet.prior_feedback_id);
    if (!priorFeedback) throw new NotFoundError('HUMAN_FEEDBACK_NOT_FOUND', `Prior feedback ${packet.prior_feedback_id} was not found.`);
    if (!['SELECT', 'ADVISE', 'REVISE'].includes(priorFeedback.action)) {
      throw new ContractError(
        'CONFIRMATION_FEEDBACK_MISMATCH',
        'A confirmation packet must descend from feedback that requested a revision.',
        { prior_feedback_id: priorFeedback.feedback_id, action: priorFeedback.action },
      );
    }
    const priorPacket = snapshot.decision_packets.find((candidate) => candidate.packet_id === priorFeedback.packet_id);
    const artifactMap = new Map(snapshot.artifacts.map((candidate) => [candidate.artifact_id, candidate]));
    const priorArtifact = priorPacket ? artifactMap.get(priorPacket.artifact_id) : null;
    if (!priorPacket
      || priorPacket.interaction_phase !== 'PROPOSAL'
      || artifact.artifact_id === priorPacket.artifact_id
      || !artifactDescendsFrom(artifactMap, artifact.artifact_id, priorPacket.artifact_id)
      || !priorArtifact
      || artifact.content_hash === priorArtifact.content_hash) {
      throw new ContractError('CONFIRMATION_LINEAGE_MISMATCH', 'A confirmation packet must bind a changed descendant of the earlier proposed artifact.');
    }
  }
  appendInteraction(snapshot, packet);
  return packet;
}

export function appendHumanFeedbackState(snapshot, record, { at, revision }) {
  requireRecord(record, 'human feedback');
  assertInputProjectScope(record, snapshot.project.project_id, 'human feedback');
  const packet = snapshot.decision_packets.find((candidate) => candidate.packet_id === record.packet_id);
  if (!packet) throw new NotFoundError('DECISION_PACKET_NOT_FOUND', `Decision packet ${record.packet_id} was not found.`, { packet_id: record.packet_id });
  const feedback = enrichInteraction({
    ...clone(record),
    schema_version: record.schema_version ?? SCHEMA_VERSION,
    record_type: 'HUMAN_FEEDBACK',
    project_id: snapshot.project.project_id,
  }, snapshot, { at, revision });
  validateHumanFeedback(feedback, packet);
  if (snapshot.human_feedback.some((candidate) => candidate.feedback_id === feedback.feedback_id)) {
    throw new StateError('HUMAN_FEEDBACK_EXISTS', `Human feedback ${feedback.feedback_id} already exists.`, { feedback_id: feedback.feedback_id });
  }
  appendInteraction(snapshot, feedback);
  return feedback;
}

export function appendLockRecordState(snapshot, record, { at, revision }) {
  requireRecord(record, 'lock record');
  assertInputProjectScope(record, snapshot.project.project_id, 'lock record');
  const artifact = findArtifact(snapshot, record.artifact_id);
  const packet = snapshot.decision_packets.find((candidate) => candidate.packet_id === record.packet_id);
  if (!packet) throw new NotFoundError('DECISION_PACKET_NOT_FOUND', `Decision packet ${record.packet_id} was not found.`, { packet_id: record.packet_id });
  const priorFeedback = snapshot.human_feedback.find((candidate) => candidate.feedback_id === record.prior_feedback_id);
  if (!priorFeedback) throw new NotFoundError('HUMAN_FEEDBACK_NOT_FOUND', `Human feedback ${record.prior_feedback_id} was not found.`, { feedback_id: record.prior_feedback_id });
  const confirmationFeedback = snapshot.human_feedback.findLast((candidate) => candidate.packet_id === packet.packet_id
    && candidate.action === 'LOCK'
    && candidate.confirmed_artifact_hash === record.artifact_hash);
  if (!confirmationFeedback) {
    throw new ContractError('LOCK_FEEDBACK_MISMATCH', 'A lock record requires explicit LOCK feedback for the same packet and artifact hash.');
  }
  const lockRecord = enrichInteraction({
    ...clone(record),
    schema_version: record.schema_version ?? SCHEMA_VERSION,
    record_type: 'LOCK_RECORD',
    project_id: snapshot.project.project_id,
    confirmation_feedback_id: record.confirmation_feedback_id ?? confirmationFeedback.feedback_id,
    confirmed_at: record.confirmed_at ?? at,
  }, snapshot, { at, revision });
  validateLockRecord(lockRecord);
  assertInteractionArtifact(lockRecord, artifact, 'lock record');
  if (packet.interaction_phase !== 'CONFIRMATION' || packet.revised_artifact_hash !== lockRecord.artifact_hash) {
    throw new ContractError('LOCK_PACKET_MISMATCH', 'A lock record must bind the matching confirmation packet and revised artifact hash.');
  }
  if (packet.prior_feedback_id !== priorFeedback.feedback_id
    || lockRecord.confirmation_feedback_id !== confirmationFeedback.feedback_id) {
    throw new ContractError('LOCK_FEEDBACK_MISMATCH', 'A lock record must bind both prior selection feedback and explicit confirmation feedback.');
  }
  if (snapshot.lock_records.some((candidate) => candidate.lock_id === lockRecord.lock_id)) {
    throw new StateError('LOCK_RECORD_EXISTS', `Lock record ${lockRecord.lock_id} already exists.`, { lock_id: lockRecord.lock_id });
  }
  appendInteraction(snapshot, lockRecord);
  return lockRecord;
}

export function addFactState(snapshot, record, at) {
  requireRecord(record, 'fact');
  assertInputProjectScope(record, snapshot.project.project_id, 'fact');
  const fact = {
    ...clone(record),
    schema_version: record.schema_version ?? SCHEMA_VERSION,
    record_type: record.record_type ?? 'FACT',
    project_id: snapshot.project.project_id,
    recorded_at: record.recorded_at ?? at,
  };
  validateFact(fact);
  if (snapshot.facts.some((candidate) => candidate.fact_id === fact.fact_id)) {
    throw new StateError('FACT_EXISTS', `Fact ${fact.fact_id} already exists.`, { fact_id: fact.fact_id });
  }
  snapshot.facts.push(fact);
  snapshot.facts = sortBy(snapshot.facts, 'fact_id');
  return fact;
}

export function addClaimState(snapshot, record, at) {
  requireRecord(record, 'claim');
  assertInputProjectScope(record, snapshot.project.project_id, 'claim');
  const claim = {
    ...clone(record),
    schema_version: record.schema_version ?? SCHEMA_VERSION,
    record_type: record.record_type ?? 'CLAIM',
    project_id: snapshot.project.project_id,
    clearance_refs: clone(record.clearance_refs ?? []),
    recorded_at: record.recorded_at ?? at,
  };
  validateClaim(claim);
  if (snapshot.claims.some((candidate) => candidate.claim_id === claim.claim_id)) {
    throw new StateError('CLAIM_EXISTS', `Claim ${claim.claim_id} already exists.`, { claim_id: claim.claim_id });
  }
  snapshot.claims.push(claim);
  snapshot.claims = sortBy(snapshot.claims, 'claim_id');
  return claim;
}

export function addRightState(snapshot, record, at) {
  requireRecord(record, 'right');
  assertInputProjectScope(record, snapshot.project.project_id, 'right');
  const right = {
    ...clone(record),
    schema_version: record.schema_version ?? SCHEMA_VERSION,
    record_type: record.record_type ?? 'RIGHT',
    project_id: snapshot.project.project_id,
    clearance_refs: clone(record.clearance_refs ?? []),
    recorded_at: record.recorded_at ?? at,
  };
  validateRight(right);
  if (snapshot.rights.some((candidate) => candidate.right_id === right.right_id)) {
    throw new StateError('RIGHT_EXISTS', `Right ${right.right_id} already exists.`, { right_id: right.right_id });
  }
  snapshot.rights.push(right);
  snapshot.rights = sortBy(snapshot.rights, 'right_id');
  return right;
}

export function addAttemptState(snapshot, record, { at, revision }) {
  assertInputProjectScope(record, snapshot.project.project_id, 'attempt');
  const attempt = enrichAttempt({
    ...clone(record),
    schema_version: record.schema_version ?? SCHEMA_VERSION,
    record_type: record.record_type ?? 'ATTEMPT',
    project_id: snapshot.project.project_id,
  }, { at, revision });
  if (snapshot.attempts.some((candidate) => candidate.attempt_id === attempt.attempt_id)) {
    throw new StateError('ATTEMPT_EXISTS', `Attempt ${attempt.attempt_id} already exists.`, { attempt_id: attempt.attempt_id });
  }
  findArtifact(snapshot, attempt.artifact_id);
  snapshot.attempts.push(attempt);
  snapshot.attempts = sortBy(snapshot.attempts, 'attempt_id');
  return attempt;
}

export function updateAttemptState(snapshot, attemptId, patch, { at, revision }) {
  requireRecord(patch, 'attempt patch');
  assertInputProjectScope(patch, snapshot.project.project_id, 'attempt patch');
  const index = snapshot.attempts.findIndex((attempt) => attempt.attempt_id === attemptId);
  if (index < 0) throw new NotFoundError('ATTEMPT_NOT_FOUND', `Attempt ${attemptId} was not found.`, { attempt_id: attemptId });
  const current = snapshot.attempts[index];
  for (const field of ['attempt_id', 'artifact_id']) {
    if (patch[field] !== undefined && patch[field] !== current[field]) {
      throw new ContractError('IMMUTABLE_ATTEMPT_IDENTITY', `${field} cannot change during attempt update.`, { field });
    }
  }
  const attempt = enrichAttempt({
    ...current,
    ...clone(patch),
    project_id: snapshot.project.project_id,
    attempt_id: current.attempt_id,
    artifact_id: current.artifact_id,
  }, { at, revision });
  snapshot.attempts[index] = attempt;
  snapshot.attempts = sortBy(snapshot.attempts, 'attempt_id');
  return attempt;
}

export function addShotState(snapshot, record) {
  const shot = { ...clone(record), schema_version: record.schema_version ?? SCHEMA_VERSION, project_id: snapshot.project.project_id };
  validateShot(shot);
  assertInputProjectScope(record, snapshot.project.project_id, 'shot');
  findArtifact(snapshot, shot.artifact_id);
  if (snapshot.shots.some((candidate) => candidate.shot_id === shot.shot_id)) throw new StateError('SHOT_EXISTS', `Shot ${shot.shot_id} already exists.`);
  snapshot.shots.push(shot);
  snapshot.shots = sortBy(snapshot.shots, 'shot_id');
  return shot;
}

export function updateShotState(snapshot, shotId, patch) {
  requireRecord(patch, 'shot patch');
  const index = snapshot.shots.findIndex((shot) => shot.shot_id === shotId);
  if (index < 0) throw new NotFoundError('SHOT_NOT_FOUND', `Shot ${shotId} was not found.`);
  const current = snapshot.shots[index];
  for (const field of ['shot_id', 'artifact_id', 'project_id']) {
    if (patch[field] !== undefined && patch[field] !== current[field]) throw new ContractError('IMMUTABLE_SHOT_IDENTITY', `${field} cannot change.`);
  }
  const shot = { ...current, ...clone(patch), project_id: current.project_id, shot_id: current.shot_id, artifact_id: current.artifact_id };
  validateShot(shot);
  snapshot.shots[index] = shot;
  snapshot.shots = sortBy(snapshot.shots, 'shot_id');
  return shot;
}

export function addTakeState(snapshot, record) {
  const take = { ...clone(record), schema_version: record.schema_version ?? SCHEMA_VERSION, project_id: snapshot.project.project_id };
  validateTake(take);
  assertInputProjectScope(record, snapshot.project.project_id, 'take');
  if (!snapshot.shots.some((shot) => shot.shot_id === take.shot_id)) throw new NotFoundError('SHOT_NOT_FOUND', `Shot ${take.shot_id} was not found.`);
  if (take.attempt_id && !snapshot.attempts.some((attempt) => attempt.attempt_id === take.attempt_id)) throw new NotFoundError('ATTEMPT_NOT_FOUND', `Attempt ${take.attempt_id} was not found.`);
  if (snapshot.takes.some((candidate) => candidate.take_id === take.take_id)) throw new StateError('TAKE_EXISTS', `Take ${take.take_id} already exists.`);
  snapshot.takes.push(take);
  snapshot.takes = sortBy(snapshot.takes, 'take_id');
  return take;
}

export function updateTakeState(snapshot, takeId, patch) {
  requireRecord(patch, 'take patch');
  const index = snapshot.takes.findIndex((take) => take.take_id === takeId);
  if (index < 0) throw new NotFoundError('TAKE_NOT_FOUND', `Take ${takeId} was not found.`);
  const current = snapshot.takes[index];
  for (const field of ['take_id', 'shot_id', 'project_id']) {
    if (patch[field] !== undefined && patch[field] !== current[field]) throw new ContractError('IMMUTABLE_TAKE_IDENTITY', `${field} cannot change.`);
  }
  const take = { ...current, ...clone(patch), project_id: current.project_id, take_id: current.take_id, shot_id: current.shot_id };
  validateTake(take);
  snapshot.takes[index] = take;
  snapshot.takes = sortBy(snapshot.takes, 'take_id');
  return take;
}

export function addTimelineState(snapshot, record) {
  const timeline = { ...clone(record), schema_version: record.schema_version ?? SCHEMA_VERSION, project_id: snapshot.project.project_id };
  validateTimeline(timeline);
  assertInputProjectScope(record, snapshot.project.project_id, 'timeline');
  findArtifact(snapshot, timeline.artifact_id);
  if (snapshot.timelines.some((candidate) => candidate.timeline_id === timeline.timeline_id)) throw new StateError('TIMELINE_EXISTS', `Timeline ${timeline.timeline_id} already exists.`);
  snapshot.timelines.push(timeline);
  snapshot.timelines = sortBy(snapshot.timelines, 'timeline_id');
  return timeline;
}

export function createEvent({ project, type, details, at, eventId, previousEventHash }) {
  if (!nonEmptyString(type)) throw new ContractError('EVENT_TYPE_REQUIRED', 'Event type must be a non-empty string.');
  const event = {
    schema_version: SCHEMA_VERSION,
    event_id: eventId,
    project_id: project.project_id,
    revision: project.revision,
    type,
    at,
    details: clone(details ?? {}),
    previous_event_hash: previousEventHash ?? null,
    state_hash: project.state_hash,
  };
  event.event_hash = hashRecord(event);
  return event;
}

export function validateInteractionLedger(history, artifacts, project) {
  if (!Array.isArray(history)) stateFail('MALFORMED_STATE', 'Interaction history must be an array.');
  const decisionPackets = [];
  const humanFeedback = [];
  const lockRecords = [];
  const packetsById = new Map();
  const latestPacketVersionByArtifact = new Map();
  const feedbackById = new Map();
  const lockIds = new Set();
  let previousHash = null;
  let lastRevision = -1;

  for (const record of history) {
    requireRecord(record, 'interaction');
    requireProjectScope(record, project.project_id, `interaction ${record.record_type ?? 'UNKNOWN'}`);
    if (!Number.isInteger(record.project_revision) || record.project_revision < 0 || record.project_revision > project.revision) {
      stateFail('INVALID_INTERACTION_REVISION', 'Interaction record has an invalid project revision.', {
        record_type: record.record_type,
        project_revision: record.project_revision,
      });
    }
    if (record.project_revision < lastRevision) stateFail('INTERACTION_HISTORY_ORDER', 'Interaction revisions must be non-decreasing.');
    if (record.previous_interaction_hash !== previousHash) {
      stateFail('INTERACTION_HASH_CHAIN_BROKEN', 'The interaction hash chain is broken.', {
        record_type: record.record_type,
        project_revision: record.project_revision,
      });
    }
    requireRecordHash(record, 'interaction');
    lastRevision = record.project_revision;
    previousHash = record.record_hash;

    if (record.record_type === 'DECISION_PACKET') {
      const artifact = artifacts.get(record.artifact_id);
      if (!artifact) stateFail('ORPHAN_DECISION_PACKET', `Decision packet ${record.packet_id} references a missing artifact.`);
      validateDecisionPacketForArtifact(record, artifact);
      if (!Number.isInteger(record.packet_version) || record.packet_version < 1) {
        stateFail('INVALID_PACKET_VERSION', `Decision packet ${record.packet_id} has an invalid packet_version.`);
      }
      const latestVersion = latestPacketVersionByArtifact.get(record.artifact_id) ?? 0;
      if (record.packet_version <= latestVersion) {
        stateFail('DECISION_PACKET_VERSION_ORDER', `Decision packet ${record.packet_id} does not advance the artifact packet version.`);
      }
      if (packetsById.has(record.packet_id)) stateFail('DUPLICATE_DECISION_PACKET_ID', `Decision packet ${record.packet_id} is duplicated.`);
      if (record.interaction_phase === 'CONFIRMATION') {
        const priorFeedback = feedbackById.get(record.prior_feedback_id);
        const priorPacket = priorFeedback ? packetsById.get(priorFeedback.packet_id) : null;
        const priorArtifact = priorPacket ? artifacts.get(priorPacket.artifact_id) : null;
        const confirmationArtifact = artifacts.get(record.artifact_id);
        if (!priorFeedback
          || !priorPacket
          || priorPacket.interaction_phase !== 'PROPOSAL'
          || record.artifact_id === priorPacket.artifact_id
          || !artifactDescendsFrom(artifacts, record.artifact_id, priorPacket.artifact_id)
          || !priorArtifact
          || !confirmationArtifact
          || confirmationArtifact.content_hash === priorArtifact.content_hash) {
          stateFail('CONFIRMATION_LINEAGE_MISMATCH', `Decision packet ${record.packet_id} has no valid proposal-feedback lineage.`);
        }
      }
      packetsById.set(record.packet_id, record);
      latestPacketVersionByArtifact.set(record.artifact_id, record.packet_version);
      decisionPackets.push(record);
      continue;
    }

    if (record.record_type === 'HUMAN_FEEDBACK') {
      const packet = packetsById.get(record.packet_id);
      if (!packet) stateFail('ORPHAN_HUMAN_FEEDBACK', `Human feedback ${record.feedback_id} references a missing earlier packet.`);
      validateHumanFeedback(record, packet);
      if (feedbackById.has(record.feedback_id)) stateFail('DUPLICATE_HUMAN_FEEDBACK_ID', `Human feedback ${record.feedback_id} is duplicated.`);
      feedbackById.set(record.feedback_id, record);
      humanFeedback.push(record);
      continue;
    }

    if (record.record_type === 'LOCK_RECORD') {
      validateLockRecord(record);
      const artifact = artifacts.get(record.artifact_id);
      if (!artifact) stateFail('ORPHAN_LOCK_RECORD', `Lock record ${record.lock_id} references a missing artifact.`);
      assertInteractionArtifact(record, artifact, 'lock record');
      const packet = packetsById.get(record.packet_id);
      const priorFeedback = feedbackById.get(record.prior_feedback_id);
      const confirmationFeedback = feedbackById.get(record.confirmation_feedback_id);
      if (!packet || packet.interaction_phase !== 'CONFIRMATION' || packet.revised_artifact_hash !== record.artifact_hash) {
        stateFail('LOCK_PACKET_MISMATCH', `Lock record ${record.lock_id} does not bind a matching earlier confirmation packet.`);
      }
      if (!priorFeedback || packet.prior_feedback_id !== priorFeedback.feedback_id
        || !confirmationFeedback || confirmationFeedback.packet_id !== packet.packet_id
        || confirmationFeedback.action !== 'LOCK'
        || confirmationFeedback.confirmed_artifact_hash !== record.artifact_hash) {
        stateFail('LOCK_FEEDBACK_MISMATCH', `Lock record ${record.lock_id} does not bind its prior selection and explicit LOCK feedback.`);
      }
      if (lockIds.has(record.lock_id)) stateFail('DUPLICATE_LOCK_RECORD_ID', `Lock record ${record.lock_id} is duplicated.`);
      lockIds.add(record.lock_id);
      lockRecords.push(record);
      continue;
    }

    stateFail('UNKNOWN_INTERACTION_TYPE', `Unknown interaction record_type: ${record.record_type}.`);
  }

  return {
    decision_packets: clone(decisionPackets),
    human_feedback: clone(humanFeedback),
    lock_records: clone(lockRecords),
  };
}

export function validateAttemptLedger(history, project) {
  if (!Array.isArray(history)) stateFail('MALFORMED_STATE', 'Attempt history must be an array.');
  const current = new Map();
  let lastRevision = -1;
  for (const record of history) {
    validateAttempt(record);
    requireProjectScope(record, project.project_id, `attempt ${record.attempt_id}`);
    requireHash(record.request_hash, `attempt ${record.attempt_id} request_hash`);
    if (record.output_hash !== undefined) requireHash(record.output_hash, `attempt ${record.attempt_id} output_hash`);
    requireRecordHash(record, 'attempt');
    if (!Number.isInteger(record.project_revision) || record.project_revision < 0 || record.project_revision > project.revision) {
      stateFail('INVALID_ATTEMPT_REVISION', `Attempt ${record.attempt_id} has an invalid project revision.`, {
        attempt_id: record.attempt_id,
        project_revision: record.project_revision,
      });
    }
    if (record.project_revision < lastRevision) {
      stateFail('ATTEMPT_HISTORY_ORDER', 'Attempt history revisions must be non-decreasing.');
    }
    lastRevision = record.project_revision;
    const previous = current.get(record.attempt_id);
    if (previous && previous.artifact_id !== record.artifact_id) {
      stateFail('ATTEMPT_IDENTITY_CHANGED', `Attempt ${record.attempt_id} changed artifact identity.`);
    }
    current.set(record.attempt_id, record);
  }
  return sortBy([...current.values()], 'attempt_id');
}

export function validateFact(record) {
  requireRecord(record, 'fact');
  if (!nonEmptyString(record.fact_id)) throw new ContractError('FACT_ID_REQUIRED', 'fact.fact_id must be a non-empty string.');
  if (!('text' in record) && !('value' in record) && !('statement' in record)) {
    throw new ContractError('FACT_VALUE_REQUIRED', 'A fact requires text, statement, or value.');
  }
  return record;
}

export function findArtifact(snapshot, artifactId) {
  const artifact = snapshot.artifacts.find((candidate) => candidate.artifact_id === artifactId);
  if (!artifact) throw new NotFoundError('ARTIFACT_NOT_FOUND', `Artifact ${artifactId} was not found.`, { artifact_id: artifactId });
  return artifact;
}

export function collectDescendantIds(dependencies, upstreamId) {
  const children = new Map();
  for (const { upstream_id: upstream, downstream_id: downstream } of dependencies) {
    if (!children.has(upstream)) children.set(upstream, []);
    children.get(upstream).push(downstream);
  }
  for (const values of children.values()) values.sort(compareCodeUnits);

  const descendants = new Set();
  const queue = [...(children.get(upstreamId) ?? [])];
  while (queue.length > 0) {
    const artifactId = queue.shift();
    if (descendants.has(artifactId)) continue;
    descendants.add(artifactId);
    queue.push(...(children.get(artifactId) ?? []));
  }
  return [...descendants].sort(compareCodeUnits);
}

function artifactDescendsFrom(artifacts, artifactId, ancestorId) {
  let current = artifacts.get(artifactId);
  const visited = new Set();
  while (current && !visited.has(current.artifact_id)) {
    if (current.artifact_id === ancestorId) return true;
    visited.add(current.artifact_id);
    current = current.previous_version_id ? artifacts.get(current.previous_version_id) : null;
  }
  return false;
}

function validateDependencies(dependencies, artifacts, projectId) {
  const keys = new Set();
  const adjacency = new Map();
  for (const [index, dependency] of dependencies.entries()) {
    requireRecord(dependency, `dependency[${index}]`);
    requireProjectScope(dependency, projectId, `dependency[${index}]`);
    validateDependency(dependency);
    const { upstream_id: upstreamId, downstream_id: downstreamId } = dependency;
    if (!nonEmptyString(upstreamId) || !nonEmptyString(downstreamId)) {
      stateFail('MALFORMED_DEPENDENCY', 'Dependency IDs must be non-empty strings.', { index });
    }
    if (upstreamId === downstreamId) stateFail('SELF_DEPENDENCY', 'An artifact cannot depend on itself.', { artifact_id: upstreamId });
    if (!artifacts.has(upstreamId) || !artifacts.has(downstreamId)) {
      stateFail('ORPHAN_DEPENDENCY', `Dependency ${upstreamId} -> ${downstreamId} references a missing artifact.`, dependency);
    }
    const upstream = artifacts.get(upstreamId);
    const downstream = artifacts.get(downstreamId);
    const endpointFields = [
      ['upstream_version', upstream.version],
      ['upstream_content_hash', upstream.content_hash],
      ['downstream_version', downstream.version],
      ['downstream_content_hash', downstream.content_hash],
    ];
    for (const [field, expected] of endpointFields) {
      if (dependency[field] !== expected) {
        stateFail('STALE_DEPENDENCY_ENDPOINT', `Dependency ${upstreamId} -> ${downstreamId} has a stale ${field}.`, {
          ...dependency,
          field,
          expected,
          actual: dependency[field],
        });
      }
    }
    const key = dependencyKey(dependency);
    if (keys.has(key)) stateFail('DUPLICATE_DEPENDENCY', `Dependency ${upstreamId} -> ${downstreamId} is duplicated.`, dependency);
    keys.add(key);
    if (!adjacency.has(upstreamId)) adjacency.set(upstreamId, []);
    adjacency.get(upstreamId).push(downstreamId);
  }

  const visiting = new Set();
  const visited = new Set();
  const visit = (artifactId) => {
    if (visiting.has(artifactId)) stateFail('DEPENDENCY_CYCLE', 'Artifact dependencies must be acyclic.', { artifact_id: artifactId });
    if (visited.has(artifactId)) return;
    visiting.add(artifactId);
    for (const downstreamId of adjacency.get(artifactId) ?? []) visit(downstreamId);
    visiting.delete(artifactId);
    visited.add(artifactId);
  };
  for (const artifactId of artifacts.keys()) visit(artifactId);
}

function validateDecisionHistory(decisions, artifacts, project, lockIds = new Set()) {
  const ids = new Set();
  let lastRevision = -1;
  for (const decision of decisions) {
    validateDecisionRecord(decision);
    requireProjectScope(decision, project.project_id, `decision ${decision.decision_id}`);
    requireRecordHash(decision, 'decision');
    if (ids.has(decision.decision_id)) stateFail('DUPLICATE_DECISION_ID', `Decision ${decision.decision_id} is duplicated.`);
    ids.add(decision.decision_id);
    if (!Number.isInteger(decision.project_revision) || decision.project_revision < 0 || decision.project_revision > project.revision) {
      stateFail('INVALID_DECISION_REVISION', `Decision ${decision.decision_id} has an invalid project revision.`, {
        decision_id: decision.decision_id,
        project_revision: decision.project_revision,
      });
    }
    if (decision.project_revision < lastRevision) stateFail('DECISION_HISTORY_ORDER', 'Decision revisions must be non-decreasing.');
    lastRevision = decision.project_revision;
    const artifact = artifacts.get(decision.artifact_id);
    if (!artifact || artifact.version !== decision.artifact_version) {
      stateFail('ORPHAN_DECISION', `Decision ${decision.decision_id} references a missing artifact version.`, {
        decision_id: decision.decision_id,
        artifact_id: decision.artifact_id,
        artifact_version: decision.artifact_version,
      });
    }
    if (decision.outcome === 'LOCK' && !lockIds.has(decision.lock_id)) {
      stateFail('ORPHAN_LOCK_DECISION', `Decision ${decision.decision_id} references a missing lock record.`, {
        decision_id: decision.decision_id,
        lock_id: decision.lock_id,
      });
    }
  }
}

function validateEventHistory(events, project) {
  if (events.length !== project.revision + 1) {
    stateFail('EVENT_REVISION_GAP', 'The event log must contain exactly one event for every project revision.', {
      revision: project.revision,
      event_count: events.length,
    });
  }
  const ids = new Set();
  let previousHash = null;
  for (const [revision, event] of events.entries()) {
    requireRecord(event, `event[${revision}]`);
    requireProjectScope(event, project.project_id, `event[${revision}]`);
    if (event.schema_version !== SCHEMA_VERSION || event.project_id !== project.project_id || event.revision !== revision) {
      stateFail('MALFORMED_EVENT', `Event at revision ${revision} does not match the project.`, { revision });
    }
    if (!nonEmptyString(event.event_id) || !nonEmptyString(event.type) || !nonEmptyString(event.at)) {
      stateFail('MALFORMED_EVENT', `Event at revision ${revision} is missing required fields.`, { revision });
    }
    if (ids.has(event.event_id)) stateFail('DUPLICATE_EVENT_ID', `Event ${event.event_id} is duplicated.`);
    ids.add(event.event_id);
    if (event.previous_event_hash !== previousHash) {
      stateFail('EVENT_HASH_CHAIN_BROKEN', `Event hash chain is broken at revision ${revision}.`, { revision });
    }
    requireHash(event.state_hash, `event ${event.event_id} state_hash`);
    requireRecordHash(event, 'event', 'event_hash');
    previousHash = event.event_hash;
  }
  if (events.at(-1)?.state_hash !== project.state_hash) {
    stateFail('EVENT_STATE_HASH_MISMATCH', 'The latest event does not bind the current project state hash.');
  }
}

function enrichInteraction(record, snapshot, { at, revision }) {
  const {
    record_hash: _recordHash,
    project_revision: _projectRevision,
    recorded_at: _recordedAt,
    previous_interaction_hash: _previousHash,
    ...body
  } = clone(record);
  const interaction = {
    ...body,
    project_revision: revision,
    recorded_at: at,
    previous_interaction_hash: snapshot.interactions.at(-1)?.record_hash ?? null,
  };
  interaction.record_hash = hashRecord(interaction);
  return interaction;
}

function appendInteraction(snapshot, record) {
  snapshot.interactions.push(record);
  if (record.record_type === 'DECISION_PACKET') snapshot.decision_packets.push(record);
  else if (record.record_type === 'HUMAN_FEEDBACK') snapshot.human_feedback.push(record);
  else if (record.record_type === 'LOCK_RECORD') snapshot.lock_records.push(record);
}

function assertInteractionArtifact(record, artifact, label) {
  if (record.project_id !== artifact.project_id
    || record.artifact_id !== artifact.artifact_id
    || record.artifact_version !== artifact.version
    || record.artifact_hash !== artifact.content_hash
    || record.stage !== artifact.stage) {
    throw new ContractError('INTERACTION_ARTIFACT_MISMATCH', `${label} does not bind the current artifact version and hash.`, {
      artifact_id: record.artifact_id,
    });
  }
}

function enrichAttempt(record, { at, revision }) {
  requireRecord(record, 'attempt');
  const { record_hash: _recordHash, project_revision: _projectRevision, recorded_at: _recordedAt, ...body } = clone(record);
  const attempt = {
    ...body,
    project_revision: revision,
    recorded_at: at,
  };
  validateAttempt(attempt);
  requireHash(attempt.request_hash, 'attempt.request_hash');
  if (attempt.output_hash !== undefined) requireHash(attempt.output_hash, 'attempt.output_hash');
  attempt.record_hash = hashRecord(attempt);
  return attempt;
}

function requireRecordHash(record, kind, field = 'record_hash') {
  requireHash(record[field], `${kind}.${field}`);
  const actual = hashRecord(record, field);
  if (actual !== record[field]) {
    stateFail(`${kind.toUpperCase()}_HASH_MISMATCH`, `${kind} record hash does not match its content.`, {
      expected: record[field],
      actual,
    });
  }
}

function hashRecord(record, hashField = 'record_hash') {
  const body = Object.fromEntries(Object.entries(record).filter(([key]) => key !== hashField));
  return sha256(stableStringify(body));
}

function requireHash(value, path) {
  if (!HASH_PATTERN.test(value ?? '')) stateFail('INVALID_CONTENT_HASH', `${path} must be a lowercase SHA-256 hash.`, { path, value });
}

function requireRecord(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ContractError('OBJECT_REQUIRED', `${path} must be an object.`, { path });
  }
}

function addUnique(map, id, record, code) {
  if (map.has(id)) stateFail(code, `${id} is duplicated.`, { id });
  map.set(id, record);
}

function createDependencyRecord(projectId, upstream, downstream) {
  return {
    schema_version: SCHEMA_VERSION,
    project_id: projectId,
    from_artifact_id: upstream.artifact_id,
    from_artifact_version: upstream.version,
    from_content_hash: upstream.content_hash,
    to_artifact_id: downstream.artifact_id,
    to_artifact_version: downstream.version,
    to_content_hash: downstream.content_hash,
    kind: 'DERIVED_FROM',
    upstream_id: upstream.artifact_id,
    upstream_version: upstream.version,
    upstream_content_hash: upstream.content_hash,
    downstream_id: downstream.artifact_id,
    downstream_version: downstream.version,
    downstream_content_hash: downstream.content_hash,
  };
}

function requireProjectScope(record, projectId, path) {
  if (record.project_id !== projectId) {
    stateFail('CROSS_PROJECT_REFERENCE', `${path} is not scoped to project ${projectId}.`, {
      path,
      expected_project_id: projectId,
      actual_project_id: record.project_id,
    });
  }
}

function assertInputProjectScope(record, projectId, path) {
  if (record?.project_id !== undefined && record.project_id !== projectId) {
    throw new ContractError('CROSS_PROJECT_REFERENCE', `${path} belongs to a different project.`, {
      expected_project_id: projectId,
      actual_project_id: record.project_id,
    });
  }
}

function dependencyKey({ upstream_id: upstreamId, downstream_id: downstreamId }) {
  return `${upstreamId}\u0000${downstreamId}`;
}

function sortDependencies(dependencies) {
  return clone(dependencies).sort((left, right) => compareCodeUnits(dependencyKey(left), dependencyKey(right)));
}

function sortBy(records, field) {
  return clone(records).sort((left, right) => compareCodeUnits(left[field], right[field]));
}

function stateFail(code, message, details = {}) {
  throw new StateError(code, message, details);
}
