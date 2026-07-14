import { constants as fsConstants } from 'node:fs';
import {
  lstat,
  link,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  unlink,
} from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { SCHEMA_VERSION } from './contracts.mjs';
import { ConcurrencyError, ContractError, NotFoundError, StateError } from './errors.mjs';
import {
  HASH_PATTERN,
  STATE_FORMAT_VERSION,
  addAttemptState,
  addClaimState,
  addDependencyState,
  addFactState,
  addRightState,
  addShotState,
  addTakeState,
  addTimelineState,
  advanceRevision,
  appendDecisionState,
  appendDecisionPacketState,
  appendHumanFeedbackState,
  appendLockRecordState,
  assertArtifactCas,
  assertExpectedRevision,
  calculateStateHash,
  createArtifactState,
  createEmptySnapshot,
  createEvent,
  createProjectRecord,
  findArtifact,
  finalizeArtifactLockState,
  invalidateDescendantsState,
  transitionArtifactState,
  updateAttemptState,
  updateShotState,
  updateTakeState,
  validateAttemptLedger,
  validateInteractionLedger,
  validateSnapshot,
} from './project-state.mjs';
import { clone, nonEmptyString, nowIso, sha256, stableId, stableStringify } from './utils.mjs';
import { verifyAttemptMedia, verifyTakeMedia } from './media-verification.mjs';

export const PROJECT_FILE = 'project.json';
export const INTERNAL_DIRECTORY = '.tcis';
export const FAULT_STAGES = Object.freeze({
  AFTER_WAL_PREPARED: 'after_wal_prepared',
  AFTER_REVISION_PUBLISHED: 'after_revision_published',
  AFTER_CONTENT_PUBLISHED: 'after_content_published',
  BEFORE_PROJECT_CAS: 'before_project_cas',
  AFTER_PROJECT_COMMITTED: 'after_project_committed',
  AFTER_WAL_COMMITTED: 'after_wal_committed',
});

export const CANONICAL_STATE_FILES = Object.freeze({
  artifacts: 'artifact_registry.yaml',
  dependencies: 'dependencies.yaml',
  orthogonal_records: 'claims_rights.yaml',
  attempts: 'attempts.jsonl',
  interactions: 'interactions.jsonl',
  production_state: 'production_state.yaml',
  decisions: 'decisions.jsonl',
  events: 'events.jsonl',
});

const MANIFEST_FILE = 'manifest.json';
const REQUIRED_STATE_FILES = Object.freeze(Object.values(CANONICAL_STATE_FILES).sort());
const WAL_PHASES = Object.freeze(['PREPARED', 'REVISION_PUBLISHED', 'CONTENT_PUBLISHED', 'COMMITTED', 'ROLLED_BACK']);
const LOCK_LEASE_MS = 30_000;
const LOCK_HEARTBEAT_MS = 10_000;
const PROCESS_STARTED_AT_MS = Math.trunc(Date.now() - (process.uptime() * 1_000));
const PROCESS_START_TOLERANCE_MS = 2_000;

export class ProjectStore {
  constructor({ clock = () => new Date(), idFactory = stableId, faultInjector = null } = {}) {
    if (typeof clock !== 'function') throw new TypeError('clock must be a function.');
    if (typeof idFactory !== 'function') throw new TypeError('idFactory must be a function.');
    if (faultInjector !== null && typeof faultInjector !== 'function') throw new TypeError('faultInjector must be a function or null.');
    this.clock = clock;
    this.idFactory = idFactory;
    this.faultInjector = faultInjector;
  }

  async createProject(root, spec) {
    const rootPath = normalizeRoot(root);
    const input = clone(spec);
    await mkdir(rootPath, { recursive: true });
    return withProjectLock(rootPath, this.clock, async () => {
      await recoverWal(rootPath, this.clock);
      if (await exists(path.join(rootPath, PROJECT_FILE))) {
        throw new StateError('PROJECT_EXISTS', `A TCIS project already exists at ${rootPath}.`, { root: rootPath });
      }

      const at = nowIso(this.clock);
      const project = createProjectRecord(input, { at });
      project.state_format_version = STATE_FORMAT_VERSION;
      delete project.state_hash;
      delete project.manifest_hash;
      delete project.state_path;
      const snapshot = createEmptySnapshot(project);
      snapshot.project.state_hash = calculateStateHash(snapshot);
      snapshot.events.push(createEvent({
        project: snapshot.project,
        type: 'PROJECT_CREATED',
        details: { project_id: project.project_id },
        at,
        eventId: this.idFactory('EVT'),
        previousEventHash: null,
      }));
      validateSnapshot(snapshot);

      await this.#commitRevision(rootPath, null, snapshot, [], { at });
      return clone((await loadInternal(rootPath)).snapshot);
    });
  }

  async loadSnapshot(root) {
    const rootPath = normalizeRoot(root);
    return withProjectLock(rootPath, this.clock, async () => {
      await recoverWal(rootPath, this.clock);
      return clone((await loadInternal(rootPath)).snapshot);
    });
  }

  async updateProjectMetadata(root, patch, expectedRevision) {
    const input = cloneRecord(patch, 'project metadata patch');
    const keys = Object.keys(input);
    if (keys.length === 0) {
      throw new ContractError('EMPTY_METADATA_PATCH', 'A project metadata patch must contain at least one key.');
    }
    for (const key of keys) {
      if (!nonEmptyString(key)) throw new ContractError('STRING_REQUIRED', 'Project metadata keys must be non-empty strings.');
    }

    return this.#mutate(root, expectedRevision, 'PROJECT_METADATA_UPDATED', async (snapshot) => {
      const before = clone(snapshot.project.metadata ?? {});
      const next = clone(before);
      const removedKeys = [];
      const updatedKeys = [];
      for (const [key, value] of Object.entries(input)) {
        if (value === null) {
          if (Object.hasOwn(next, key)) removedKeys.push(key);
          delete next[key];
        } else {
          next[key] = clone(value);
          updatedKeys.push(key);
        }
      }
      if (stableStringify(before) === stableStringify(next)) {
        throw new ContractError('UNCHANGED_METADATA', 'A project metadata update must make a material change.');
      }
      snapshot.project.metadata = next;
      return { updated_keys: updatedKeys.sort(), removed_keys: removedKeys.sort() };
    });
  }

  async createArtifact(root, spec, expectedRevision) {
    const input = clone(spec);
    if (input?.status === 'LOCKED') {
      throw new ContractError('ATOMIC_LOCK_REQUIRED', 'Artifacts can become LOCKED only through commitLock.');
    }
    if (input?.status && !['DRAFT', 'INTERNAL_REVIEW'].includes(input.status)) {
      throw new ContractError('CONTROLLED_STATUS_REQUIRED', 'New artifacts must enter as DRAFT or INTERNAL_REVIEW; proposal and revision states require interaction commits.');
    }
    return this.#mutate(root, expectedRevision, 'ARTIFACT_CREATED', async (snapshot, context) => {
      assertArtifactSetCas(snapshot, expectedRevision);
      const prepared = await prepareArtifactContent(context.root, input, this.idFactory);
      const artifact = createArtifactState(snapshot, input, {
        artifactId: prepared.artifactId,
        at: context.at,
        path: prepared.relativePath,
        contentHash: prepared.contentHash,
      });
      if (prepared.publication) context.beforeCommit.push(prepared.publication);
      return {
        artifact_id: artifact.artifact_id,
        artifact_version: artifact.version,
        content_hash: artifact.content_hash,
      };
    });
  }

  async transitionArtifact(root, artifactId, toStatus, expectedRevision) {
    if (toStatus === 'LOCKED') {
      throw new ContractError('ATOMIC_LOCK_REQUIRED', 'LOCKED is not a public status transition; use commitLock.');
    }
    if (['PROPOSED', 'REVISED'].includes(toStatus)) {
      throw new ContractError('ATOMIC_INTERACTION_REQUIRED', `${toStatus} requires a decision packet and interaction commit.`);
    }
    return this.#mutate(root, expectedRevision, 'ARTIFACT_TRANSITIONED', async (snapshot, context) => {
      const artifact = findArtifact(snapshot, artifactId);
      assertArtifactCas(artifact, expectedRevision);
      const fromStatus = artifact.status;
      transitionArtifactState(snapshot, artifactId, toStatus, context.at);
      return {
        artifact_id: artifactId,
        artifact_version: artifact.version,
        content_hash: artifact.content_hash,
        from_status: fromStatus,
        to_status: toStatus,
      };
    });
  }

  async addDependency(root, upstreamId, downstreamId, expectedRevision) {
    return this.#mutate(root, expectedRevision, 'DEPENDENCY_ADDED', async (snapshot, context) => {
      assertArtifactSetCas(snapshot, expectedRevision, [upstreamId, downstreamId]);
      const edge = addDependencyState(snapshot, upstreamId, downstreamId, context.at);
      return clone(edge);
    });
  }

  async invalidateDescendants(root, upstreamId, reason, expectedRevision) {
    return this.#mutate(root, expectedRevision, 'DESCENDANTS_INVALIDATED', async (snapshot, context) => {
      const upstream = findArtifact(snapshot, upstreamId);
      assertArtifactCas(upstream, expectedRevision);
      const result = invalidateDescendantsState(snapshot, upstreamId, reason, context.at);
      return { upstream_id: upstreamId, reason, ...result };
    });
  }

  async appendDecision(root, record, expectedRevision) {
    const input = clone(record);
    if (input?.outcome === 'LOCK') throw new ContractError('ATOMIC_LOCK_REQUIRED', 'LOCK decisions must be persisted through commitLock.');
    return this.#mutate(root, expectedRevision, 'DECISION_APPENDED', async (snapshot, context) => {
      const artifact = findArtifact(snapshot, input.artifact_id);
      assertArtifactCas(artifact, expectedRevision);
      const decision = appendDecisionState(snapshot, input, { at: context.at, revision: context.revision });
      return {
        decision_id: decision.decision_id,
        artifact_id: decision.artifact_id,
        outcome: decision.outcome,
        record_hash: decision.record_hash,
      };
    });
  }

  async appendDecisionPacket(root, record, expectedRevision) {
    const input = clone(record);
    return this.#mutate(root, expectedRevision, 'DECISION_PACKET_APPENDED', async (snapshot, context) => {
      const artifact = findArtifact(snapshot, input.artifact_id);
      assertArtifactCas(artifact, expectedRevision);
      const packet = appendDecisionPacketState(snapshot, input, { at: context.at, revision: context.revision });
      return {
        packet_id: packet.packet_id,
        packet_version: packet.packet_version,
        artifact_id: packet.artifact_id,
        interaction_phase: packet.interaction_phase,
        record_hash: packet.record_hash,
      };
    });
  }

  async appendHumanFeedback(root, record, expectedRevision) {
    const input = clone(record);
    if (input?.action === 'LOCK') throw new ContractError('ATOMIC_LOCK_REQUIRED', 'LOCK feedback must be persisted through commitLock.');
    return this.#mutate(root, expectedRevision, 'HUMAN_FEEDBACK_APPENDED', async (snapshot, context) => {
      const packet = snapshot.decision_packets.find((candidate) => candidate.packet_id === input.packet_id);
      if (!packet) throw new NotFoundError('DECISION_PACKET_NOT_FOUND', `Decision packet ${input.packet_id} was not found.`, { packet_id: input.packet_id });
      const artifact = findArtifact(snapshot, packet.artifact_id);
      assertArtifactCas(artifact, expectedRevision);
      const feedback = appendHumanFeedbackState(snapshot, input, { at: context.at, revision: context.revision });
      return {
        feedback_id: feedback.feedback_id,
        packet_id: feedback.packet_id,
        action: feedback.action,
        record_hash: feedback.record_hash,
      };
    });
  }

  async appendLockRecord(root, record, expectedRevision) {
    void root; void record; void expectedRevision;
    throw new ContractError('ATOMIC_LOCK_REQUIRED', 'Lock records can be persisted only through commitLock.');
  }

  async addDecisionPacket(root, record, expectedRevision) {
    return this.appendDecisionPacket(root, record, expectedRevision);
  }

  async addHumanFeedback(root, record, expectedRevision) {
    return this.appendHumanFeedback(root, record, expectedRevision);
  }

  async addLockRecord(root, record, expectedRevision) {
    return this.appendLockRecord(root, record, expectedRevision);
  }

  async commitInteraction(root, spec, expectedRevision) {
    const input = cloneRecord(spec, 'interaction commit');
    const packetInput = input.decision_packet ?? input.packet ?? null;
    const feedbackInput = input.human_feedback ?? input.feedback ?? null;
    if (!packetInput && !feedbackInput) {
      throw new ContractError('INTERACTION_RECORD_REQUIRED', 'commitInteraction requires a decision packet or human feedback.');
    }
    const operationId = input.operation_id ?? input.idempotency_key
      ?? (feedbackInput ? `FEEDBACK:${feedbackInput.feedback_id}` : `PACKET:${packetInput.packet_id}`);
    const operationHash = sha256(stableStringify(input));

    return this.#mutate(root, expectedRevision, 'INTERACTION_COMMITTED', async (snapshot, context) => {
      const packet = ensureDecisionPacket(snapshot, packetInput, context, feedbackInput?.packet_id ?? null);
      const artifact = findArtifact(snapshot, packet.artifact_id);
      assertArtifactCas(artifact, expectedRevision);
      let feedback = null;
      if (feedbackInput) feedback = appendHumanFeedbackState(snapshot, feedbackInput, { at: context.at, revision: context.revision });

      let persistedArtifact = artifact;
      const revisedSpecInput = input.revised_artifact ?? input.revised_artifact_spec ?? null;
      if (revisedSpecInput) {
        if (!feedback) {
          throw new ContractError('HUMAN_FEEDBACK_REQUIRED', 'A revised artifact requires the human feedback that requested it.');
        }
        if (!['SELECT', 'ADVISE', 'REVISE'].includes(feedback.action) || packet.interaction_phase !== 'PROPOSAL') {
          throw new ContractError(
            'REVISION_ACTION_MISMATCH',
            'A revised artifact can be created only from SELECT, ADVISE, or REVISE feedback on a proposal packet.',
          );
        }
        assertRevisionSpecConsistency(revisedSpecInput, artifact);
        const revisedSpec = {
          ...clone(revisedSpecInput),
          type: artifact.type,
          stage: artifact.stage,
          status: 'REVISED',
          version: artifact.version + 1,
          previous_version_id: artifact.artifact_id,
          owner_capability: artifact.owner_capability,
          decision_bearing: artifact.decision_bearing,
          input_artifact_ids: revisedSpecInput.input_artifact_ids ?? artifact.input_artifact_ids,
        };
        const prepared = await prepareArtifactContent(context.root, revisedSpec, this.idFactory);
        if (prepared.contentHash === artifact.content_hash) {
          throw new ContractError('UNCHANGED_REVISION', 'A revised artifact must contain a material content change.');
        }
        persistedArtifact = createArtifactState(snapshot, revisedSpec, {
          artifactId: prepared.artifactId,
          at: context.at,
          path: prepared.relativePath,
          contentHash: prepared.contentHash,
        });
        if (prepared.publication) context.beforeCommit.push(prepared.publication);
      } else {
        const inferredStatus = feedback ? inferFeedbackStatus(feedback.action, packet.interaction_phase, artifact.status) : null;
        const requestedStatus = input.to_status ?? input.artifact_transition?.to_status ?? inferredStatus;
        if (feedback && requestedStatus !== inferredStatus) {
          throw new ContractError(
            'FEEDBACK_TRANSITION_MISMATCH',
            `Feedback action ${feedback.action} requires artifact status ${inferredStatus}, not ${requestedStatus}.`,
          );
        }
        if (requestedStatus === 'LOCKED') throw new ContractError('ATOMIC_LOCK_REQUIRED', 'LOCKED requires commitLock.');
        if (requestedStatus && requestedStatus !== artifact.status) {
          transitionArtifactState(snapshot, artifact.artifact_id, requestedStatus, context.at);
        }
      }

      return {
        packet_id: packet.packet_id,
        feedback_id: feedback?.feedback_id ?? null,
        artifact_id: persistedArtifact.artifact_id,
        artifact_version: persistedArtifact.version,
        artifact_hash: persistedArtifact.content_hash,
        artifact_status: persistedArtifact.status,
      };
    }, { operationId, operationHash });
  }

  async commitProposal(root, spec, expectedRevision) {
    const input = cloneRecord(spec, 'proposal commit');
    const packet = input.decision_packet ?? input.packet ?? (input.packet_id ? input : null);
    if (!packet) throw new ContractError('DECISION_PACKET_REQUIRED', 'commitProposal requires a decision packet.');
    return this.commitInteraction(root, {
      ...input,
      packet,
      to_status: 'PROPOSED',
      operation_id: input.operation_id ?? input.idempotency_key ?? `PROPOSAL:${packet.packet_id}`,
    }, expectedRevision);
  }

  async commitFeedback(root, spec, expectedRevision) {
    const input = cloneRecord(spec, 'feedback commit');
    const feedback = input.human_feedback ?? input.feedback ?? (input.feedback_id ? input : null);
    if (!feedback) throw new ContractError('HUMAN_FEEDBACK_REQUIRED', 'commitFeedback requires human_feedback.');
    const packet = input.decision_packet ?? input.packet ?? null;
    return this.commitInteraction(root, {
      ...input,
      packet,
      feedback,
      operation_id: input.operation_id ?? input.idempotency_key ?? `FEEDBACK:${feedback.feedback_id}`,
    }, expectedRevision);
  }

  async commitLock(root, spec, expectedRevision) {
    const input = cloneRecord(spec, 'lock commit');
    const packetInput = input.decision_packet ?? input.packet ?? null;
    const feedbackInput = input.human_feedback ?? input.feedback;
    const lockInput = input.lock_record;
    const decisionInput = input.decision_record ?? input.decision;
    if (!feedbackInput || !lockInput || !decisionInput) {
      throw new ContractError(
        'LOCK_COMMIT_RECORDS_REQUIRED',
        'commitLock requires confirmation feedback, lock_record, and decision_record.',
      );
    }
    const operationId = input.operation_id ?? input.idempotency_key ?? `LOCK:${lockInput.lock_id}`;
    const operationHash = sha256(stableStringify(input));

    return this.#mutate(root, expectedRevision, 'LOCK_COMMITTED', async (snapshot, context) => {
      const packet = ensureDecisionPacket(snapshot, packetInput, context, lockInput.packet_id);
      const artifact = findArtifact(snapshot, lockInput.artifact_id);
      assertArtifactCas(artifact, expectedRevision);
      if (artifact.status !== 'REVISED') {
        throw new ContractError('REVISED_ARTIFACT_REQUIRED', 'commitLock requires the exact REVISED artifact shown in a confirmation packet.');
      }
      if (packet.interaction_phase !== 'CONFIRMATION' || packet.revised_artifact_hash !== artifact.content_hash) {
        throw new ContractError('LOCK_PACKET_MISMATCH', 'commitLock requires a confirmation packet bound to the exact revised artifact hash.');
      }
      if (artifact.version !== lockInput.artifact_version || artifact.content_hash !== lockInput.artifact_hash) {
        throw new ConcurrencyError('ARTIFACT_CAS_CONFLICT', 'The lock record does not bind the current artifact version and hash.', {
          artifact_id: artifact.artifact_id,
          expected_version: lockInput.artifact_version,
          actual_version: artifact.version,
          expected_hash: lockInput.artifact_hash,
          actual_hash: artifact.content_hash,
        });
      }
      if (packet.packet_id !== lockInput.packet_id) throw new ContractError('LOCK_PACKET_MISMATCH', 'Lock packet IDs disagree.');
      assertLockCommitConsistency({ packet, feedbackInput, lockInput, decisionInput, artifact });

      const feedback = appendHumanFeedbackState(snapshot, feedbackInput, { at: context.at, revision: context.revision });
      const lockRecord = appendLockRecordState(snapshot, lockInput, { at: context.at, revision: context.revision });
      finalizeArtifactLockState(snapshot, artifact.artifact_id, { feedback, lockRecord }, context.at);
      const decision = appendDecisionState(snapshot, {
        ...decisionInput,
        lock_id: decisionInput.lock_id ?? lockRecord.lock_id,
      }, { at: context.at, revision: context.revision });

      return {
        packet_id: packet.packet_id,
        feedback_id: feedback.feedback_id,
        lock_id: lockRecord.lock_id,
        decision_id: decision.decision_id,
        artifact_id: artifact.artifact_id,
        artifact_version: artifact.version,
        artifact_hash: artifact.content_hash,
        artifact_status: artifact.status,
      };
    }, { operationId, operationHash });
  }

  async addFact(root, record, expectedRevision) {
    const input = clone(record);
    return this.#mutate(root, expectedRevision, 'FACT_ADDED', async (snapshot, context) => {
      const fact = addFactState(snapshot, input, context.at);
      return { fact_id: fact.fact_id };
    });
  }

  async addClaim(root, record, expectedRevision) {
    const input = clone(record);
    return this.#mutate(root, expectedRevision, 'CLAIM_ADDED', async (snapshot, context) => {
      const claim = addClaimState(snapshot, input, context.at);
      return {
        claim_id: claim.claim_id,
        evidence_status: claim.evidence_status,
        clearance_status: claim.clearance_status,
      };
    });
  }

  async addRight(root, record, expectedRevision) {
    const input = clone(record);
    return this.#mutate(root, expectedRevision, 'RIGHT_ADDED', async (snapshot, context) => {
      const right = addRightState(snapshot, input, context.at);
      return { right_id: right.right_id, clearance_status: right.clearance_status };
    });
  }

  async addAttempt(root, record, expectedRevision) {
    const input = clone(record);
    return this.#mutate(root, expectedRevision, 'ATTEMPT_ADDED', async (snapshot, context) => {
      const prepared = await prepareAttempt(context.root, input, this.idFactory);
      const artifact = findArtifact(snapshot, prepared.record.artifact_id);
      assertArtifactCas(artifact, expectedRevision);
      if (['INSPECTED', 'SELECTED'].includes(prepared.record.status)) {
        await verifyAttemptMedia(context.root, prepared.record);
      }
      const attempt = addAttemptState(snapshot, prepared.record, { at: context.at, revision: context.revision });
      context.attemptAppend = attempt;
      return {
        attempt_id: attempt.attempt_id,
        artifact_id: attempt.artifact_id,
        status: attempt.status,
        record_hash: attempt.record_hash,
      };
    });
  }

  async updateAttempt(root, attemptId, patch, expectedRevision) {
    const input = clone(patch);
    return this.#mutate(root, expectedRevision, 'ATTEMPT_UPDATED', async (snapshot, context) => {
      const current = snapshot.attempts.find((attempt) => attempt.attempt_id === attemptId);
      if (!current) throw new NotFoundError('ATTEMPT_NOT_FOUND', `Attempt ${attemptId} was not found.`, { attempt_id: attemptId });
      const artifact = findArtifact(snapshot, current.artifact_id);
      assertArtifactCas(artifact, expectedRevision);
      const prepared = await prepareAttempt(context.root, { ...current, ...input, attempt_id: attemptId }, this.idFactory);
      if (['INSPECTED', 'SELECTED'].includes(prepared.record.status)) {
        await verifyAttemptMedia(context.root, prepared.record);
      }
      const attempt = updateAttemptState(snapshot, attemptId, prepared.record, { at: context.at, revision: context.revision });
      context.attemptAppend = attempt;
      return { attempt_id: attempt.attempt_id, artifact_id: attempt.artifact_id, status: attempt.status, record_hash: attempt.record_hash };
    });
  }

  async addShot(root, record, expectedRevision) {
    const input = clone(record);
    return this.#mutate(root, expectedRevision, 'SHOT_ADDED', async (snapshot) => {
      const artifact = findArtifact(snapshot, input.artifact_id);
      assertArtifactCas(artifact, expectedRevision);
      const shot = addShotState(snapshot, input);
      return { shot_id: shot.shot_id, artifact_id: shot.artifact_id, status: shot.status };
    });
  }

  async updateShot(root, shotId, patch, expectedRevision) {
    const input = clone(patch);
    return this.#mutate(root, expectedRevision, 'SHOT_UPDATED', async (snapshot) => {
      const current = snapshot.shots.find((shot) => shot.shot_id === shotId);
      if (!current) throw new NotFoundError('SHOT_NOT_FOUND', `Shot ${shotId} was not found.`);
      const artifact = findArtifact(snapshot, current.artifact_id);
      assertArtifactCas(artifact, expectedRevision);
      const shot = updateShotState(snapshot, shotId, input);
      return { shot_id: shot.shot_id, artifact_id: shot.artifact_id, status: shot.status };
    });
  }

  async addTake(root, record, expectedRevision) {
    const input = clone(record);
    return this.#mutate(root, expectedRevision, 'TAKE_ADDED', async (snapshot, context) => {
      const shot = snapshot.shots.find((candidate) => candidate.shot_id === input.shot_id);
      if (!shot) throw new NotFoundError('SHOT_NOT_FOUND', `Shot ${input.shot_id} was not found.`);
      const artifact = findArtifact(snapshot, shot.artifact_id);
      assertArtifactCas(artifact, expectedRevision);
      const prepared = await prepareTake(context.root, input);
      if (['INSPECTED', 'SELECTED'].includes(prepared.status)) await verifyTakeMedia(context.root, prepared);
      const take = addTakeState(snapshot, prepared);
      return { take_id: take.take_id, shot_id: take.shot_id, status: take.status, media_hash: take.media_hash };
    });
  }

  async updateTake(root, takeId, patch, expectedRevision) {
    const input = clone(patch);
    return this.#mutate(root, expectedRevision, 'TAKE_UPDATED', async (snapshot, context) => {
      const current = snapshot.takes.find((take) => take.take_id === takeId);
      if (!current) throw new NotFoundError('TAKE_NOT_FOUND', `Take ${takeId} was not found.`);
      const shot = snapshot.shots.find((candidate) => candidate.shot_id === current.shot_id);
      const artifact = findArtifact(snapshot, shot.artifact_id);
      assertArtifactCas(artifact, expectedRevision);
      const prepared = await prepareTake(context.root, { ...current, ...input, take_id: takeId });
      if (['INSPECTED', 'SELECTED'].includes(prepared.status)) await verifyTakeMedia(context.root, prepared);
      const take = updateTakeState(snapshot, takeId, prepared);
      return { take_id: take.take_id, shot_id: take.shot_id, status: take.status, media_hash: take.media_hash };
    });
  }

  async addTimeline(root, record, expectedRevision) {
    const input = clone(record);
    return this.#mutate(root, expectedRevision, 'TIMELINE_ADDED', async (snapshot) => {
      const artifact = findArtifact(snapshot, input.artifact_id);
      assertArtifactCas(artifact, expectedRevision);
      const timeline = addTimelineState(snapshot, input);
      return { timeline_id: timeline.timeline_id, artifact_id: timeline.artifact_id, version: timeline.version };
    });
  }

  async verifyIntegrity(root) {
    const rootPath = normalizeRoot(root);
    return withProjectLock(rootPath, this.clock, async () => {
      await recoverWal(rootPath, this.clock);
      const loaded = await loadInternal(rootPath);
      const wal = await inspectWal(rootPath, loaded.snapshot.project);
      return {
        ok: true,
        project_id: loaded.snapshot.project.project_id,
        revision: loaded.snapshot.project.revision,
        state_hash: loaded.snapshot.project.state_hash,
        manifest_hash: loaded.snapshot.project.manifest_hash,
        artifact_count: loaded.snapshot.artifacts.length,
        decision_count: loaded.snapshot.decisions.length,
        interaction_count: loaded.snapshot.interactions.length,
        shot_count: loaded.snapshot.shots.length,
        take_count: loaded.snapshot.takes.length,
        timeline_count: loaded.snapshot.timelines.length,
        event_count: loaded.snapshot.events.length,
        pending_transactions: wal.filter((record) => !['COMMITTED', 'ROLLED_BACK'].includes(record.phase)).length,
      };
    });
  }

  async #mutate(root, expectedRevision, eventType, mutate, { operationId = null, operationHash = null } = {}) {
    const rootPath = normalizeRoot(root);
    return withProjectLock(rootPath, this.clock, async () => {
      await recoverWal(rootPath, this.clock);
      const current = await loadInternal(rootPath);
      if (operationId !== null) {
        const prior = current.snapshot.events.find((event) => event.type === eventType && event.details?.operation_id === operationId);
        if (prior) {
          if (prior.details.operation_hash !== operationHash) {
            throw new ConcurrencyError('IDEMPOTENCY_CONFLICT', `Operation ${operationId} was already committed with different input.`, {
              operation_id: operationId,
            });
          }
          return clone(current.snapshot);
        }
      }
      assertExpectedRevision(current.snapshot.project, expectedRevision);

      const snapshot = clone(current.snapshot);
      const at = nowIso(this.clock);
      const revision = advanceRevision(snapshot, at);
      const context = {
        root: rootPath,
        at,
        revision,
        beforeCommit: [],
        attemptAppend: null,
      };
      const eventDetails = await mutate(snapshot, context);
      const attemptHistory = [...current.attemptHistory];
      if (context.attemptAppend) attemptHistory.push(clone(context.attemptAppend));

      snapshot.project.state_hash = calculateStateHash(snapshot);
      snapshot.events.push(createEvent({
        project: snapshot.project,
        type: eventType,
        details: operationId === null
          ? eventDetails
          : { ...eventDetails, operation_id: operationId, operation_hash: operationHash },
        at,
        eventId: this.idFactory('EVT'),
        previousEventHash: current.snapshot.events.at(-1).event_hash,
      }));
      validateSnapshot(snapshot);
      const reducedAttempts = validateAttemptLedger(attemptHistory, snapshot.project);
      if (stableStringify(reducedAttempts) !== stableStringify(snapshot.attempts)) {
        throw new StateError('ATTEMPT_LEDGER_DIVERGENCE', 'The attempt ledger does not reduce to the canonical attempt view.');
      }

      await this.#commitRevision(rootPath, current, snapshot, attemptHistory, {
        at,
        publications: context.beforeCommit,
      });
      return clone((await loadInternal(rootPath)).snapshot);
    });
  }

  async #commitRevision(rootPath, current, snapshot, attemptHistory, { at, publications = [] }) {
    const transactionId = this.idFactory('TX');
    const statePath = revisionStatePath(snapshot.project.revision);
    snapshot.project.state_path = statePath;

    const files = buildRevisionFiles(snapshot, attemptHistory);
    const manifest = buildManifest(snapshot.project, files, at);
    snapshot.project.manifest_hash = sha256(stableStringify(manifest));

    const wal = {
      format_version: STATE_FORMAT_VERSION,
      schema_version: SCHEMA_VERSION,
      transaction_id: transactionId,
      project_id: snapshot.project.project_id,
      expected_revision: current?.snapshot.project.revision ?? null,
      expected_state_hash: current?.snapshot.project.state_hash ?? null,
      expected_manifest_hash: current?.snapshot.project.manifest_hash ?? null,
      next_revision: snapshot.project.revision,
      next_state_hash: snapshot.project.state_hash,
      next_manifest_hash: snapshot.project.manifest_hash,
      revision_path: statePath,
      content_publications: publications.map((publication, index) => ({
        publication_id: `PUB-${index + 1}`,
        relative_path: publication.relativePath,
        content_hash: publication.contentHash,
        action: publication.createsFile ? 'CREATE' : 'VERIFY_EXISTING',
        staging_path: publication.createsFile
          ? `${INTERNAL_DIRECTORY}/staging/${safeFileName(transactionId)}/publication-${index + 1}.bin`
          : null,
        status: 'PENDING',
      })),
      phase: 'PREPARED',
      created_at: at,
      updated_at: at,
    };
    const walPath = await writeWal(rootPath, wal);
    await this.#injectFault(FAULT_STAGES.AFTER_WAL_PREPARED, wal);

    await writeRevisionDirectory(rootPath, statePath, files, manifest, transactionId);
    wal.phase = 'REVISION_PUBLISHED';
    wal.updated_at = nowIso(this.clock);
    await atomicWriteJson(walPath, wal);
    await this.#injectFault(FAULT_STAGES.AFTER_REVISION_PUBLISHED, wal);

    for (let index = 0; index < publications.length; index += 1) {
      const record = wal.content_publications[index];
      await publications[index].publish({
        transactionId,
        stagingPath: record.staging_path,
      });
      record.status = record.action === 'CREATE' ? 'CREATED' : 'VERIFIED';
      record.updated_at = nowIso(this.clock);
      await atomicWriteJson(walPath, wal);
    }
    wal.phase = 'CONTENT_PUBLISHED';
    wal.updated_at = nowIso(this.clock);
    await atomicWriteJson(walPath, wal);
    await this.#injectFault(FAULT_STAGES.AFTER_CONTENT_PUBLISHED, wal);

    await verifyContentFiles(rootPath, snapshot);
    await this.#injectFault(FAULT_STAGES.BEFORE_PROJECT_CAS, wal);
    await assertProjectPointerCas(rootPath, current?.snapshot.project ?? null);
    await atomicWriteJson(path.join(rootPath, PROJECT_FILE), snapshot.project);
    await this.#injectFault(FAULT_STAGES.AFTER_PROJECT_COMMITTED, wal);

    wal.phase = 'COMMITTED';
    wal.updated_at = nowIso(this.clock);
    await atomicWriteJson(walPath, wal);
    await this.#injectFault(FAULT_STAGES.AFTER_WAL_COMMITTED, wal);
    await retireTerminalWal(rootPath, walPath, wal, snapshot.project);
  }

  async #injectFault(stage, wal) {
    if (!this.faultInjector) return;
    await this.faultInjector(stage, clone(wal));
  }
}

export function validateStore() {
  const requiredMethods = [
    'createProject', 'loadSnapshot', 'createArtifact', 'transitionArtifact', 'addDependency',
    'invalidateDescendants', 'commitProposal', 'commitFeedback', 'commitLock', 'addClaim',
    'addRight', 'addAttempt', 'updateAttempt', 'addShot', 'updateShot', 'addTake', 'updateTake', 'addTimeline', 'verifyIntegrity',
  ];
  const missing = requiredMethods.filter((name) => typeof ProjectStore.prototype[name] !== 'function');
  return {
    kind: 'tcis.store-validation.v1',
    passed: missing.length === 0,
    checks: {
      required_methods: { passed: missing.length === 0, missing },
      state_format_version: { passed: STATE_FORMAT_VERSION === 1, value: STATE_FORMAT_VERSION },
      canonical_file_count: { passed: Object.keys(CANONICAL_STATE_FILES).length >= 7, value: Object.keys(CANONICAL_STATE_FILES).length },
      fault_stage_count: { passed: Object.keys(FAULT_STAGES).length >= 5, value: Object.keys(FAULT_STAGES).length },
    },
  };
}

export default ProjectStore;

export async function atomicWriteFile(filePath, value) {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });
  const temporaryPath = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  const data = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
  let handle;
  try {
    handle = await open(temporaryPath, 'wx', 0o600);
    await handle.writeFile(data);
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporaryPath, filePath);
    await syncDirectory(directory);
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

export async function atomicWriteJson(filePath, value) {
  await atomicWriteFile(filePath, `${stableStringify(value)}\n`);
}

async function loadInternal(rootPath) {
  try {
    const project = await readProjectPointer(rootPath);
    const expectedStatePath = revisionStatePath(project.revision);
    if (project.state_path !== expectedStatePath) {
      stateFail('STATE_POINTER_MISMATCH', 'project.json does not point to its immutable revision directory.', {
        expected: expectedStatePath,
        actual: project.state_path,
      });
    }
    const stateDirectory = resolveInternalPath(rootPath, project.state_path);
    const manifest = await readJson(path.join(stateDirectory, MANIFEST_FILE), 'state manifest');
    validateManifest(manifest, project);
    const actualManifestHash = sha256(stableStringify(manifest));
    if (actualManifestHash !== project.manifest_hash) {
      stateFail('MANIFEST_HASH_MISMATCH', 'The state manifest hash does not match project.json.', {
        expected: project.manifest_hash,
        actual: actualManifestHash,
      });
    }

    const fileBuffers = new Map();
    for (const entry of manifest.files) {
      const filePath = path.join(stateDirectory, entry.name);
      const buffer = await readFile(filePath);
      const actualHash = sha256(buffer);
      if (buffer.length !== entry.bytes || actualHash !== entry.sha256) {
        stateFail('CANONICAL_FILE_HASH_MISMATCH', `Canonical file ${entry.name} failed its manifest check.`, {
          file: entry.name,
          expected_hash: entry.sha256,
          actual_hash: actualHash,
          expected_bytes: entry.bytes,
          actual_bytes: buffer.length,
        });
      }
      fileBuffers.set(entry.name, buffer);
    }

    const artifacts = parseRegistry(fileBuffers.get(CANONICAL_STATE_FILES.artifacts), 'artifacts', project);
    const dependencies = parseRegistry(fileBuffers.get(CANONICAL_STATE_FILES.dependencies), 'dependencies', project);
    const orthogonal = parseRegistry(fileBuffers.get(CANONICAL_STATE_FILES.orthogonal_records), null, project);
    for (const key of ['facts', 'claims', 'rights']) {
      if (!Array.isArray(orthogonal[key])) stateFail('MALFORMED_STATE', `${CANONICAL_STATE_FILES.orthogonal_records} is missing ${key}.`);
    }
    const attemptHistory = parseJsonLines(fileBuffers.get(CANONICAL_STATE_FILES.attempts).toString('utf8'), CANONICAL_STATE_FILES.attempts);
    const decisions = parseJsonLines(fileBuffers.get(CANONICAL_STATE_FILES.decisions).toString('utf8'), CANONICAL_STATE_FILES.decisions);
    const interactions = parseJsonLines(fileBuffers.get(CANONICAL_STATE_FILES.interactions).toString('utf8'), CANONICAL_STATE_FILES.interactions);
    const events = parseJsonLines(fileBuffers.get(CANONICAL_STATE_FILES.events).toString('utf8'), CANONICAL_STATE_FILES.events);
    const attempts = validateAttemptLedger(attemptHistory, project);
    const productionState = parseRegistry(fileBuffers.get(CANONICAL_STATE_FILES.production_state), null, project);
    for (const key of ['shots', 'takes', 'timelines']) {
      if (!Array.isArray(productionState[key])) stateFail('MALFORMED_STATE', `${CANONICAL_STATE_FILES.production_state} is missing ${key}.`);
    }
    const artifactMap = new Map(artifacts.map((artifact) => [artifact.artifact_id, artifact]));
    const interactionViews = validateInteractionLedger(interactions, artifactMap, project);
    const snapshot = {
      project,
      artifacts,
      dependencies,
      facts: orthogonal.facts,
      claims: orthogonal.claims,
      rights: orthogonal.rights,
      attempts,
      shots: productionState.shots,
      takes: productionState.takes,
      timelines: productionState.timelines,
      interactions,
      decision_packets: interactionViews.decision_packets,
      human_feedback: interactionViews.human_feedback,
      lock_records: interactionViews.lock_records,
      decisions,
      events,
    };
    validateSnapshot(snapshot);
    await verifyContentFiles(rootPath, snapshot);
    return { snapshot, attemptHistory, manifest };
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof StateError || error instanceof ConcurrencyError) throw error;
    if (error.code === 'ENOENT') {
      throw new NotFoundError('PROJECT_NOT_FOUND', `No complete TCIS project exists at ${rootPath}.`, { root: rootPath });
    }
    throw new StateError('MALFORMED_STATE', 'Canonical TCIS state is malformed or incomplete.', {
      cause_code: error.code,
      cause: error.message,
    });
  }
}

async function readProjectPointer(rootPath) {
  const projectPath = path.join(rootPath, PROJECT_FILE);
  let project;
  try {
    project = await readJson(projectPath, PROJECT_FILE);
  } catch (error) {
    if (error.code === 'ENOENT') throw new NotFoundError('PROJECT_NOT_FOUND', `No TCIS project exists at ${rootPath}.`, { root: rootPath });
    throw error;
  }
  const { validateProject } = await import('./contracts.mjs');
  validateProject(project);
  if (project.state_format_version !== STATE_FORMAT_VERSION) stateFail('STATE_FORMAT_MISMATCH', 'Unsupported project state format.');
  if (!nonEmptyString(project.state_path)) stateFail('STATE_POINTER_REQUIRED', 'project.state_path is required.');
  requireHash(project.state_hash, 'project.state_hash');
  requireHash(project.manifest_hash, 'project.manifest_hash');
  return project;
}

function buildRevisionFiles(snapshot, attemptHistory) {
  const envelope = (extra) => ({
    format_version: STATE_FORMAT_VERSION,
    schema_version: SCHEMA_VERSION,
    project_id: snapshot.project.project_id,
    revision: snapshot.project.revision,
    ...extra,
  });
  return new Map([
    [CANONICAL_STATE_FILES.artifacts, bufferJson(envelope({ artifacts: snapshot.artifacts }))],
    [CANONICAL_STATE_FILES.dependencies, bufferJson(envelope({ dependencies: snapshot.dependencies }))],
    [CANONICAL_STATE_FILES.orthogonal_records, bufferJson(envelope({ facts: snapshot.facts, claims: snapshot.claims, rights: snapshot.rights }))],
    [CANONICAL_STATE_FILES.attempts, bufferJsonLines(attemptHistory)],
    [CANONICAL_STATE_FILES.interactions, bufferJsonLines(snapshot.interactions)],
    [CANONICAL_STATE_FILES.production_state, bufferJson(envelope({ shots: snapshot.shots, takes: snapshot.takes, timelines: snapshot.timelines }))],
    [CANONICAL_STATE_FILES.decisions, bufferJsonLines(snapshot.decisions)],
    [CANONICAL_STATE_FILES.events, bufferJsonLines(snapshot.events)],
  ]);
}

function buildManifest(project, files, at) {
  return {
    format_version: STATE_FORMAT_VERSION,
    schema_version: SCHEMA_VERSION,
    project_id: project.project_id,
    revision: project.revision,
    created_at: at,
    files: [...files.entries()]
      .map(([name, buffer]) => ({ name, bytes: buffer.length, sha256: sha256(buffer) }))
      .sort((left, right) => left.name.localeCompare(right.name)),
  };
}

async function writeRevisionDirectory(rootPath, relativeStatePath, files, manifest, transactionId) {
  const revisionsDirectory = resolveInternalPath(rootPath, path.posix.dirname(relativeStatePath));
  await mkdir(revisionsDirectory, { recursive: true });
  const finalDirectory = resolveInternalPath(rootPath, relativeStatePath);
  const temporaryDirectory = path.join(revisionsDirectory, `.${path.basename(finalDirectory)}.${transactionId}.tmp`);
  if (await exists(finalDirectory)) {
    throw new ConcurrencyError('REVISION_COLLISION', `Revision directory ${relativeStatePath} already exists.`, {
      revision_path: relativeStatePath,
    });
  }
  await mkdir(temporaryDirectory, { recursive: false });
  try {
    for (const [name, buffer] of files) await atomicWriteFile(path.join(temporaryDirectory, name), buffer);
    await atomicWriteJson(path.join(temporaryDirectory, MANIFEST_FILE), manifest);
    await rename(temporaryDirectory, finalDirectory);
    await syncDirectory(revisionsDirectory);
  } catch (error) {
    if (await exists(temporaryDirectory)) {
      const abortedDirectory = path.join(revisionsDirectory, `.aborted-${transactionId}`);
      await rename(temporaryDirectory, abortedDirectory).catch(() => {});
    }
    throw error;
  }
}

async function verifyContentFiles(rootPath, snapshot) {
  for (const artifact of snapshot.artifacts) {
    const actualHash = sha256(await readVerifiedProjectFile(rootPath, artifact.path));
    if (actualHash !== artifact.content_hash) {
      stateFail('CONTENT_HASH_MISMATCH', `Artifact ${artifact.artifact_id} content changed outside the state transaction.`, {
        artifact_id: artifact.artifact_id,
        path: artifact.path,
        expected: artifact.content_hash,
        actual: actualHash,
      });
    }
  }
  for (const attempt of snapshot.attempts) {
    if (!attempt.output_path) continue;
    const { target } = await resolveProjectPath(rootPath, attempt.output_path, { mustExist: true });
    const actualHash = sha256(await readFile(target));
    if (actualHash !== attempt.output_hash) {
      stateFail('OUTPUT_HASH_MISMATCH', `Attempt ${attempt.attempt_id} output changed outside the state transaction.`, {
        attempt_id: attempt.attempt_id,
        path: attempt.output_path,
        expected: attempt.output_hash,
        actual: actualHash,
      });
    }
  }
  for (const take of snapshot.takes) {
    const { target } = await resolveProjectPath(rootPath, take.media_path, { mustExist: true });
    const actualHash = sha256(await readFile(target));
    if (actualHash !== take.media_hash) {
      stateFail('TAKE_MEDIA_HASH_MISMATCH', `Take ${take.take_id} media changed outside the state transaction.`, {
        take_id: take.take_id, path: take.media_path, expected: take.media_hash, actual: actualHash,
      });
    }
  }
}

async function prepareArtifactContent(rootPath, spec, idFactory) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new ContractError('OBJECT_REQUIRED', 'artifact spec must be an object.');
  const artifactId = spec.artifact_id ?? idFactory('ART');
  if (!nonEmptyString(artifactId)) throw new ContractError('STRING_REQUIRED', 'artifact_id must be a non-empty string.');
  const hasContent = Object.hasOwn(spec, 'content');
  const defaultExtension = hasContent && typeof spec.content === 'object' && !Buffer.isBuffer(spec.content) ? '.json' : '.md';
  const requestedPath = spec.path ?? `artifacts/${safeFileName(artifactId)}${defaultExtension}`;
  const resolved = await resolveProjectPath(rootPath, requestedPath, { mustExist: !hasContent });

  let contentHash;
  let bytes = null;
  let targetExists = await exists(resolved.target);
  if (hasContent) {
    bytes = contentBuffer(spec.content);
    contentHash = sha256(bytes);
    if (spec.content_hash !== undefined && spec.content_hash !== contentHash) {
      throw new ContractError('CONTENT_HASH_MISMATCH', 'Provided artifact content_hash does not match content.', {
        expected: spec.content_hash,
        actual: contentHash,
      });
    }
    if (targetExists) {
      const existingHash = sha256(await readVerifiedProjectFile(rootPath, resolved.relativePath));
      if (existingHash !== contentHash) {
        throw new StateError('ARTIFACT_PATH_OCCUPIED', `Artifact path ${resolved.relativePath} already contains different bytes.`, {
          path: resolved.relativePath,
        });
      }
      bytes = null;
    }
  } else {
    contentHash = sha256(await readVerifiedProjectFile(rootPath, resolved.relativePath));
    if (spec.content_hash !== undefined && spec.content_hash !== contentHash) {
      throw new ContractError('CONTENT_HASH_MISMATCH', 'Provided artifact content_hash does not match the existing file.', {
        expected: spec.content_hash,
        actual: contentHash,
      });
    }
  }

  return {
    artifactId,
    relativePath: resolved.relativePath,
    contentHash,
    publication: {
      relativePath: resolved.relativePath,
      contentHash,
      createsFile: bytes !== null,
      publish: async ({ stagingPath }) => {
        const current = await resolveProjectPath(rootPath, resolved.relativePath, { mustExist: bytes === null });
        if (bytes) {
          if (await exists(current.target)) {
            throw new ConcurrencyError('ARTIFACT_PATH_RACE', `Artifact path ${resolved.relativePath} appeared before commit.`);
          }
          const absoluteStagingPath = resolveInternalPath(rootPath, stagingPath);
          await atomicWriteFile(absoluteStagingPath, bytes);
          await mkdir(path.dirname(current.target), { recursive: true });
          await assertContainedParent(rootPath, current.target);
          try {
            await link(absoluteStagingPath, current.target);
          } catch (error) {
            if (error.code === 'EEXIST') {
              throw new ConcurrencyError('ARTIFACT_PATH_RACE', `Artifact path ${resolved.relativePath} appeared before commit.`);
            }
            throw error;
          }
          await assertContainedParent(rootPath, current.target);
        }
        const actualHash = sha256(await readVerifiedProjectFile(rootPath, resolved.relativePath));
        if (actualHash !== contentHash) throw new ConcurrencyError('ARTIFACT_CONTENT_RACE', 'Artifact bytes changed before commit.');
      },
    },
  };
}

async function prepareAttempt(rootPath, input, idFactory) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ContractError('OBJECT_REQUIRED', 'attempt must be an object.');
  const record = clone(input);
  record.attempt_id = record.attempt_id ?? idFactory('AT');
  if (!record.request_hash && Object.hasOwn(record, 'request')) record.request_hash = sha256(stableStringify(record.request));
  if (record.output_path) {
    const resolved = await resolveProjectPath(rootPath, record.output_path, { mustExist: true });
    const actualHash = sha256(await readVerifiedProjectFile(rootPath, resolved.relativePath));
    if (record.output_hash !== undefined && record.output_hash !== actualHash) {
      throw new ContractError('OUTPUT_HASH_MISMATCH', 'Provided attempt output_hash does not match output_path.', {
        expected: record.output_hash,
        actual: actualHash,
      });
    }
    record.output_path = resolved.relativePath;
    record.output_hash = actualHash;
  }
  return { record };
}

async function prepareTake(rootPath, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ContractError('OBJECT_REQUIRED', 'take must be an object.');
  const record = clone(input);
  const resolved = await resolveProjectPath(rootPath, record.media_path, { mustExist: true });
  const actualHash = sha256(await readVerifiedProjectFile(rootPath, resolved.relativePath));
  if (record.media_hash !== undefined && record.media_hash !== actualHash) {
    throw new ContractError('TAKE_MEDIA_HASH_MISMATCH', 'Provided take media_hash does not match media_path.', {
      expected: record.media_hash, actual: actualHash,
    });
  }
  record.media_path = resolved.relativePath;
  record.media_hash = actualHash;
  return record;
}

async function resolveProjectPath(rootPath, candidate, { mustExist }) {
  if (!nonEmptyString(candidate)) throw new ContractError('PATH_REQUIRED', 'A non-empty project-relative path is required.');
  if (path.isAbsolute(candidate) || path.win32.isAbsolute(candidate) || path.posix.isAbsolute(candidate)) {
    throw new ContractError('PATH_OUTSIDE_PROJECT', 'Absolute paths are not allowed in project records.', { path: candidate });
  }
  const segments = candidate.split(/[\\/]+/);
  if (segments.includes('..')) throw new ContractError('PATH_OUTSIDE_PROJECT', 'Parent traversal is not allowed in project records.', { path: candidate });
  const target = path.resolve(rootPath, candidate);
  const relative = path.relative(rootPath, target);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    throw new ContractError('PATH_OUTSIDE_PROJECT', 'The path must identify a file inside the project root.', { path: candidate });
  }
  const topLevel = relative.split(path.sep)[0].toLowerCase();
  if (topLevel === INTERNAL_DIRECTORY || relative.toLowerCase() === PROJECT_FILE) {
    throw new ContractError('RESERVED_PROJECT_PATH', 'Artifact and media paths cannot overwrite TCIS state files.', { path: candidate });
  }

  const rootReal = await realpath(rootPath);
  const existingAncestor = await nearestExistingPath(target, rootPath);
  const ancestorReal = await realpath(existingAncestor);
  if (!isContained(rootReal, ancestorReal)) {
    throw new ContractError('SYMLINK_ESCAPE', 'The path escapes the project through a symlink or junction.', { path: candidate });
  }
  if (mustExist) {
    const targetReal = await realpath(target);
    if (!isContained(rootReal, targetReal)) {
      throw new ContractError('SYMLINK_ESCAPE', 'The path escapes the project through a symlink or junction.', { path: candidate });
    }
    const targetStat = await stat(targetReal);
    if (!targetStat.isFile()) throw new ContractError('FILE_REQUIRED', 'The project path must identify a regular file.', { path: candidate });
  }
  return { target, relativePath: relative.split(path.sep).join('/') };
}

async function readVerifiedProjectFile(rootPath, relativePath) {
  const resolved = await resolveProjectPath(rootPath, relativePath, { mustExist: true });
  const before = await lstat(resolved.target);
  if (before.isSymbolicLink() || !before.isFile()) throw new ContractError('FILE_REQUIRED', 'The project path must identify a regular non-symlink file.');
  const handle = await open(resolved.target, 'r');
  try {
    const opened = await handle.stat();
    if (!opened.isFile()) throw new ContractError('FILE_REQUIRED', 'The opened project path is not a regular file.');
    const bytes = await handle.readFile();
    const afterPath = await realpath(resolved.target);
    const rootReal = await realpath(rootPath);
    if (!isContained(rootReal, afterPath)) throw new ContractError('SYMLINK_ESCAPE', 'The opened file escaped the project root.');
    const after = await lstat(resolved.target);
    if (!sameFileIdentity(opened, after)) throw new ConcurrencyError('PROJECT_PATH_RACE', 'The project file changed identity while it was being read.');
    return bytes;
  } finally {
    await handle.close();
  }
}

async function assertContainedParent(rootPath, target) {
  const rootReal = await realpath(rootPath);
  const parentReal = await realpath(path.dirname(target));
  if (!isContained(rootReal, parentReal)) {
    throw new ContractError('SYMLINK_ESCAPE', 'The target parent escapes the project through a symlink or junction.');
  }
}

function sameFileIdentity(left, right) {
  if (left.dev !== undefined && left.ino !== undefined && (left.ino !== 0 || right.ino !== 0)) {
    return left.dev === right.dev && left.ino === right.ino;
  }
  return left.size === right.size && left.mtimeMs === right.mtimeMs;
}

async function nearestExistingPath(target, rootPath) {
  let current = target;
  while (isContained(rootPath, current)) {
    try {
      await lstat(current);
      return current;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (current === rootPath) break;
      current = path.dirname(current);
    }
  }
  return rootPath;
}

async function withProjectLock(rootPath, clock, operation) {
  const internalDirectory = path.join(rootPath, INTERNAL_DIRECTORY);
  await mkdir(internalDirectory, { recursive: true });
  const lockPath = path.join(rootPath, INTERNAL_DIRECTORY, 'write.lock');
  const token = randomUUID();
  let acquired = false;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    let handle;
    let created = false;
    try {
      handle = await open(lockPath, 'wx', 0o600);
      created = true;
      await handle.writeFile(`${stableStringify(createProjectLockRecord(token, clock))}\n`);
      await handle.sync();
      await handle.close();
      handle = null;
      await syncDirectory(internalDirectory);
      acquired = true;
      break;
    } catch (error) {
      if (handle) await handle.close().catch(() => {});
      if (created) await unlink(lockPath).catch(() => {});
      if (error.code !== 'EEXIST') throw error;
      const lock = await readProjectLock(lockPath, clock);
      if (lock && isProjectLockActive(lock, clock)) {
        throw new ConcurrencyError('PROJECT_LOCKED', 'Another process holds an active project lease.', {
          pid: lock.pid,
          lease_expires_at: lock.lease_expires_at ?? null,
        });
      }
      await quarantineStaleProjectLock(lockPath, lock, clock);
    }
  }
  if (!acquired) throw new ConcurrencyError('PROJECT_LOCKED', 'Could not acquire the project write lease.');

  let heartbeatError = null;
  let heartbeatPromise = Promise.resolve();
  const heartbeat = setInterval(() => {
    heartbeatPromise = heartbeatPromise
      .then(() => renewProjectLock(lockPath, token, clock))
      .catch((error) => {
        heartbeatError = error;
        clearInterval(heartbeat);
      });
  }, LOCK_HEARTBEAT_MS);
  heartbeat.unref();

  let result;
  let operationError = null;
  try {
    result = await operation();
  } catch (error) {
    operationError = error;
  }

  clearInterval(heartbeat);
  await heartbeatPromise;
  let releaseError = null;
  try {
    await releaseProjectLock(lockPath, token);
  } catch (error) {
    releaseError = error;
  }

  if (operationError) throw operationError;
  if (heartbeatError) throw heartbeatError;
  if (releaseError) throw releaseError;
  return result;
}

function createProjectLockRecord(token, clock, acquiredAt = null) {
  const updatedAt = nowIso(clock);
  return {
    lock_version: 1,
    token,
    pid: process.pid,
    process_started_at_ms: PROCESS_STARTED_AT_MS,
    acquired_at: acquiredAt ?? updatedAt,
    updated_at: updatedAt,
    lease_expires_at: new Date(Date.parse(updatedAt) + LOCK_LEASE_MS).toISOString(),
  };
}

async function readProjectLock(lockPath, clock) {
  try {
    return await readJson(lockPath, 'project write lock');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    const lockStat = await stat(lockPath).catch((statError) => {
      if (statError.code === 'ENOENT') return null;
      throw statError;
    });
    if (!lockStat) return null;
    const ageMs = Date.parse(nowIso(clock)) - lockStat.mtimeMs;
    if (ageMs <= LOCK_LEASE_MS) {
      throw new ConcurrencyError('PROJECT_LOCK_AMBIGUOUS', 'The project lock is malformed but its lease window has not expired.', {
        modified_at: new Date(lockStat.mtimeMs).toISOString(),
      });
    }
    return { malformed: true, token: null, pid: null, modified_at_ms: lockStat.mtimeMs };
  }
}

function isProjectLockActive(lock, clock) {
  if (!lock || lock.malformed) return false;
  const leaseExpiresAt = Date.parse(lock.lease_expires_at ?? '');
  const legacyStartedAt = Date.parse(lock.started_at ?? '');
  const effectiveExpiry = Number.isFinite(leaseExpiresAt)
    ? leaseExpiresAt
    : legacyStartedAt + LOCK_LEASE_MS;
  if (!Number.isFinite(effectiveExpiry) || effectiveExpiry <= Date.parse(nowIso(clock))) return false;
  if (lock.pid === process.pid
    && Number.isFinite(lock.process_started_at_ms)
    && Math.abs(lock.process_started_at_ms - PROCESS_STARTED_AT_MS) > PROCESS_START_TOLERANCE_MS) {
    return false;
  }
  return isProcessAlive(lock.pid);
}

async function quarantineStaleProjectLock(lockPath, observedLock, clock) {
  const current = await readProjectLock(lockPath, clock);
  if (!current) return;
  if (isProjectLockActive(current, clock)) {
    throw new ConcurrencyError('PROJECT_LOCKED', 'The project write lease was renewed while acquiring it.', {
      pid: current.pid,
      lease_expires_at: current.lease_expires_at ?? null,
    });
  }
  if (observedLock?.token && current.token !== observedLock.token) return;

  const stalePath = `${lockPath}.stale.${randomUUID()}`;
  try {
    await rename(lockPath, stalePath);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  const quarantined = await readJson(stalePath, 'stale project write lock').catch(() => null);
  if (current.token && quarantined?.token !== current.token) {
    if (!await exists(lockPath)) await rename(stalePath, lockPath);
    throw new ConcurrencyError('PROJECT_LOCKED', 'Project lock ownership changed during stale-lock recovery.');
  }
  await rm(stalePath, { force: true });
}

async function renewProjectLock(lockPath, token, clock) {
  const lock = await readJson(lockPath, 'project write lock');
  if (lock.token !== token) {
    throw new ConcurrencyError('PROJECT_LOCK_LOST', 'The project write lease changed owners during the operation.');
  }
  await atomicWriteJson(lockPath, createProjectLockRecord(token, clock, lock.acquired_at));
}

async function releaseProjectLock(lockPath, token) {
  let lock;
  try {
    lock = await readJson(lockPath, 'project write lock');
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  if (lock.token !== token) {
    throw new ConcurrencyError('PROJECT_LOCK_LOST', 'The project write lease changed owners before release.');
  }
  await unlink(lockPath);
  await syncDirectory(path.dirname(lockPath));
}

async function writeWal(rootPath, wal) {
  const walDirectory = path.join(rootPath, INTERNAL_DIRECTORY, 'wal');
  await mkdir(walDirectory, { recursive: true });
  const walPath = path.join(walDirectory, `${safeFileName(wal.transaction_id)}.json`);
  await atomicWriteJson(walPath, wal);
  return walPath;
}

async function recoverWal(rootPath, clock) {
  const project = await readProjectPointer(rootPath).catch((error) => {
    if (error instanceof NotFoundError) return null;
    throw error;
  });
  const records = await readWalRecords(rootPath);
  for (const { filePath, record } of records) {
    if (project && record.project_id !== project.project_id) {
      stateFail('WAL_DIVERGENCE', `Transaction ${record.transaction_id} belongs to another project.`, {
        transaction_id: record.transaction_id,
        wal_project_id: record.project_id,
        project_id: project.project_id,
      });
    }
    const committed = walIsCommittedByProject(project, record);
    const canRollBack = (!project && record.expected_revision === null)
      || (project
        && project.revision === record.expected_revision
        && project.state_hash === record.expected_state_hash
        && project.manifest_hash === record.expected_manifest_hash);
    const rollbackIsHistorical = Boolean(project && project.revision >= record.next_revision);

    if (record.phase === 'COMMITTED') {
      if (!committed) {
        stateFail('WAL_DIVERGENCE', `Committed transaction ${record.transaction_id} is not reflected by project.json.`);
      }
      await retireTerminalWal(rootPath, filePath, record, project);
      continue;
    }
    if (record.phase === 'ROLLED_BACK') {
      if (!canRollBack && !rollbackIsHistorical) {
        stateFail('WAL_DIVERGENCE', `Rolled-back transaction ${record.transaction_id} no longer matches project.json.`);
      }
      await retireTerminalWal(rootPath, filePath, record, project);
      continue;
    }
    if (committed) {
      record.phase = 'COMMITTED';
      record.recovered_at = nowIso(clock);
      record.updated_at = record.recovered_at;
      await atomicWriteJson(filePath, record);
      await retireTerminalWal(rootPath, filePath, record, project);
      continue;
    }
    if (canRollBack) {
      await rollbackContentPublications(rootPath, record);
      await discardUncommittedRevision(rootPath, record);
      record.phase = 'ROLLED_BACK';
      record.recovered_at = nowIso(clock);
      record.updated_at = record.recovered_at;
      await atomicWriteJson(filePath, record);
      await retireTerminalWal(rootPath, filePath, record, project);
      continue;
    }
    stateFail('WAL_DIVERGENCE', `Transaction ${record.transaction_id} cannot be reconciled with project.json.`, {
      transaction_id: record.transaction_id,
      phase: record.phase,
    });
  }
  if (project) await pruneSupersededRevisions(rootPath, project.state_path);
  await cleanupOrphanTransactionStorage(rootPath);
}

function walIsCommittedByProject(project, record) {
  return Boolean(project
    && (project.revision > record.next_revision
      || (project.revision === record.next_revision
        && project.state_hash === record.next_state_hash
        && project.manifest_hash === record.next_manifest_hash)));
}

async function retireTerminalWal(rootPath, filePath, record, project) {
  if (record.phase === 'COMMITTED') {
    await cleanupPublicationStaging(rootPath, record);
    await pruneSupersededRevisions(rootPath, project.state_path);
  } else if (record.phase === 'ROLLED_BACK') {
    await rollbackContentPublications(rootPath, record);
    await discardUncommittedRevision(rootPath, record);
  } else {
    stateFail('WAL_NOT_TERMINAL', `Transaction ${record.transaction_id} cannot be retired from phase ${record.phase}.`);
  }
  await cleanupAbortedTransaction(rootPath, record);
  await unlink(filePath).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
  await syncDirectory(path.dirname(filePath));
}

async function discardUncommittedRevision(rootPath, record) {
  const revisionDirectory = resolveInternalPath(rootPath, record.revision_path);
  await rm(revisionDirectory, { recursive: true, force: true });
  await cleanupAbortedTransaction(rootPath, record);
  await syncDirectory(path.dirname(revisionDirectory));
}

async function cleanupAbortedTransaction(rootPath, record) {
  const revisionsDirectory = resolveInternalPath(rootPath, `${INTERNAL_DIRECTORY}/revisions`);
  const revisionName = path.basename(resolveInternalPath(rootPath, record.revision_path));
  const transactionName = safeFileName(record.transaction_id);
  await rm(path.join(rootPath, INTERNAL_DIRECTORY, 'aborted', transactionName), { recursive: true, force: true });
  await rm(path.join(revisionsDirectory, `.aborted-${transactionName}`), { recursive: true, force: true });
  await rm(path.join(revisionsDirectory, `.${revisionName}.${transactionName}.tmp`), { recursive: true, force: true });
}

async function pruneSupersededRevisions(rootPath, retainedStatePath) {
  const revisionsDirectory = resolveInternalPath(rootPath, `${INTERNAL_DIRECTORY}/revisions`);
  const retainedName = path.basename(resolveInternalPath(rootPath, retainedStatePath));
  let entries;
  try {
    entries = await readdir(revisionsDirectory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const isRevision = /^\d{12}$/.test(entry.name);
    const isTransactionGarbage = entry.name.startsWith('.aborted-') || entry.name.endsWith('.tmp');
    if ((isRevision && entry.name !== retainedName) || isTransactionGarbage) {
      await rm(path.join(revisionsDirectory, entry.name), { recursive: true, force: true });
    }
  }
  await syncDirectory(revisionsDirectory);
}

async function cleanupOrphanTransactionStorage(rootPath) {
  await rm(path.join(rootPath, INTERNAL_DIRECTORY, 'staging'), { recursive: true, force: true });
  await rm(path.join(rootPath, INTERNAL_DIRECTORY, 'aborted'), { recursive: true, force: true });
}

async function inspectWal(rootPath, project) {
  const records = (await readWalRecords(rootPath)).map(({ record }) => record);
  for (const record of records) {
    if (['COMMITTED', 'ROLLED_BACK'].includes(record.phase)) continue;
    const pointerMatches = project.revision === record.expected_revision || project.revision === record.next_revision || project.revision > record.next_revision;
    if (!pointerMatches) stateFail('WAL_DIVERGENCE', `Pending transaction ${record.transaction_id} does not match project revision.`);
  }
  return records;
}

async function readWalRecords(rootPath) {
  const walDirectory = path.join(rootPath, INTERNAL_DIRECTORY, 'wal');
  let names;
  try {
    names = (await readdir(walDirectory)).filter((name) => name.endsWith('.json')).sort();
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const records = [];
  for (const name of names) {
    const filePath = path.join(walDirectory, name);
    const record = await readJson(filePath, `WAL ${name}`);
    validateWalRecord(record, rootPath);
    records.push({ filePath, record });
  }
  return records;
}

function validateWalRecord(record, rootPath) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) stateFail('MALFORMED_WAL', 'WAL record must be an object.');
  if (record.format_version !== STATE_FORMAT_VERSION || record.schema_version !== SCHEMA_VERSION) stateFail('MALFORMED_WAL', 'WAL version is invalid.');
  if (!nonEmptyString(record.transaction_id) || !nonEmptyString(record.project_id)) stateFail('MALFORMED_WAL', 'WAL identity is invalid.');
  if (!WAL_PHASES.includes(record.phase)) stateFail('MALFORMED_WAL', `Unknown WAL phase ${record.phase}.`);
  if (!Number.isInteger(record.next_revision) || record.next_revision < 0) stateFail('MALFORMED_WAL', 'WAL next_revision is invalid.');
  if (record.expected_revision !== null && (!Number.isInteger(record.expected_revision) || record.expected_revision < 0)) {
    stateFail('MALFORMED_WAL', 'WAL expected_revision is invalid.');
  }
  requireHash(record.next_state_hash, 'WAL next_state_hash');
  requireHash(record.next_manifest_hash, 'WAL next_manifest_hash');
  if (record.expected_revision !== null) {
    requireHash(record.expected_state_hash, 'WAL expected_state_hash');
    requireHash(record.expected_manifest_hash, 'WAL expected_manifest_hash');
  }
  if (record.revision_path !== revisionStatePath(record.next_revision)) stateFail('MALFORMED_WAL', 'WAL revision path is invalid.');
  resolveInternalPath(rootPath, record.revision_path);
  if (!Array.isArray(record.content_publications ?? [])) stateFail('MALFORMED_WAL', 'WAL content_publications must be an array.');
  for (const publication of record.content_publications ?? []) {
    if (!['CREATE', 'VERIFY_EXISTING'].includes(publication.action) || !['PENDING', 'CREATED', 'VERIFIED'].includes(publication.status)) {
      stateFail('MALFORMED_WAL', 'WAL content publication state is invalid.');
    }
    requireHash(publication.content_hash, 'WAL content publication hash');
    const publicationTarget = path.resolve(rootPath, publication.relative_path);
    if (!isContained(rootPath, publicationTarget) || publicationTarget === rootPath) {
      stateFail('MALFORMED_WAL', 'WAL content publication path escapes the project.');
    }
    const relativeTarget = path.relative(rootPath, publicationTarget);
    const topLevel = relativeTarget.split(path.sep)[0].toLowerCase();
    if (topLevel === INTERNAL_DIRECTORY || relativeTarget.toLowerCase() === PROJECT_FILE) {
      stateFail('MALFORMED_WAL', 'WAL content publication path targets reserved Runtime state.');
    }
    if (publication.action === 'CREATE') resolveInternalPath(rootPath, publication.staging_path);
  }
}

async function rollbackContentPublications(rootPath, wal) {
  for (const publication of wal.content_publications ?? []) {
    if (publication.action !== 'CREATE') continue;
    const target = path.resolve(rootPath, publication.relative_path);
    const staging = resolveInternalPath(rootPath, publication.staging_path);
    if (await exists(target) && await exists(staging)) {
      const [targetStat, stagingStat] = await Promise.all([lstat(target), lstat(staging)]);
      const targetHash = targetStat.isFile() ? sha256(await readFile(target)) : null;
      if (targetStat.isFile() && stagingStat.isFile() && sameFileIdentity(targetStat, stagingStat) && targetHash === publication.content_hash) {
        await unlink(target);
      }
    }
  }
  await cleanupPublicationStaging(rootPath, wal);
}

async function cleanupPublicationStaging(rootPath, wal) {
  const stagingPaths = (wal.content_publications ?? [])
    .map((publication) => publication.staging_path)
    .filter(nonEmptyString);
  const transactionDirectory = stagingPaths.length > 0 ? path.dirname(resolveInternalPath(rootPath, stagingPaths[0])) : null;
  if (transactionDirectory) await rm(transactionDirectory, { recursive: true, force: true });
}

async function assertProjectPointerCas(rootPath, expectedProject) {
  if (!expectedProject) {
    if (await exists(path.join(rootPath, PROJECT_FILE))) {
      throw new ConcurrencyError('REVISION_CONFLICT', 'project.json appeared during project creation.');
    }
    return;
  }
  const actual = await readProjectPointer(rootPath);
  const fields = ['project_id', 'revision', 'state_hash', 'manifest_hash', 'state_path'];
  if (fields.some((field) => actual[field] !== expectedProject[field])) {
    throw new ConcurrencyError('REVISION_CONFLICT', 'project.json changed before the commit pointer CAS.', {
      expected_revision: expectedProject.revision,
      actual_revision: actual.revision,
      expected_state_hash: expectedProject.state_hash,
      actual_state_hash: actual.state_hash,
    });
  }
}

function assertArtifactSetCas(snapshot, expectedRevision, fallbackIds = []) {
  if (typeof expectedRevision !== 'object' || expectedRevision === null) return;
  const entries = expectedRevision.artifacts ?? expectedRevision.artifact_cas;
  if (entries && typeof entries === 'object') {
    for (const [artifactId, token] of Object.entries(entries)) {
      const artifact = findArtifact(snapshot, artifactId);
      assertArtifactCas(artifact, { ...token, artifact_id: artifactId });
    }
    return;
  }
  for (const artifactId of fallbackIds) {
    const artifact = findArtifact(snapshot, artifactId);
    assertArtifactCas(artifact, expectedRevision);
  }
}

function ensureDecisionPacket(snapshot, packetInput, context, requiredPacketId = null) {
  const packetId = packetInput?.packet_id ?? requiredPacketId;
  if (!nonEmptyString(packetId)) {
    throw new ContractError('DECISION_PACKET_REQUIRED', 'The interaction commit requires a packet_id.');
  }
  const existing = snapshot.decision_packets.find((candidate) => candidate.packet_id === packetId);
  if (existing) return existing;
  if (!packetInput) {
    throw new NotFoundError('DECISION_PACKET_NOT_FOUND', `Decision packet ${packetId} was not found.`, { packet_id: packetId });
  }
  return appendDecisionPacketState(snapshot, packetInput, { at: context.at, revision: context.revision });
}

function inferFeedbackStatus(action, interactionPhase, artifactStatus) {
  if (['SELECT', 'ADVISE', 'REVISE'].includes(action) && interactionPhase === 'PROPOSAL') {
    throw new ContractError('REVISED_ARTIFACT_REQUIRED', `${action} feedback on a proposal requires a changed revised_artifact.`);
  }
  if (['ADVISE', 'REVISE'].includes(action) && interactionPhase === 'CONFIRMATION' && artifactStatus === 'REVISED') return 'DRAFT';
  if (['NONE', 'REOPEN'].includes(action)) return 'DRAFT';
  if (action === 'STOP') return 'BLOCKED';
  if (action === 'LOCK') {
    throw new ContractError('ATOMIC_LOCK_REQUIRED', 'LOCK feedback must be committed with commitLock.');
  }
  throw new ContractError('UNKNOWN_FEEDBACK_ACTION', `Cannot infer an artifact transition for feedback action ${action}.`);
}

function assertLockCommitConsistency({ packet, feedbackInput, lockInput, decisionInput, artifact }) {
  const mismatches = [];
  if (feedbackInput.action !== 'LOCK') mismatches.push('feedback.action');
  if (feedbackInput.packet_id !== packet.packet_id) mismatches.push('feedback.packet_id');
  if (feedbackInput.decision_owner !== packet.decision_owner) mismatches.push('feedback.decision_owner');
  if (feedbackInput.confirmed_artifact_hash !== artifact.content_hash) mismatches.push('feedback.confirmed_artifact_hash');
  if (lockInput.packet_id !== packet.packet_id) mismatches.push('lock_record.packet_id');
  if (lockInput.artifact_id !== artifact.artifact_id) mismatches.push('lock_record.artifact_id');
  if (lockInput.confirmed_by !== packet.decision_owner) mismatches.push('lock_record.confirmed_by');
  if (decisionInput.outcome !== 'LOCK') mismatches.push('decision.outcome');
  if (decisionInput.packet_id !== packet.packet_id) mismatches.push('decision.packet_id');
  if (decisionInput.artifact_id !== artifact.artifact_id) mismatches.push('decision.artifact_id');
  if (decisionInput.artifact_version !== artifact.version) mismatches.push('decision.artifact_version');
  if (decisionInput.decision_owner !== packet.decision_owner) mismatches.push('decision.decision_owner');
  if (decisionInput.lock_id !== lockInput.lock_id) mismatches.push('decision.lock_id');
  const clientDecision = Array.isArray(lockInput.signoffs)
    ? lockInput.signoffs.find((signoff) => signoff?.type === 'CLIENT_DECISION')
    : null;
  if (clientDecision?.status !== 'APPROVED' || clientDecision.reference_id !== feedbackInput.feedback_id) {
    mismatches.push('lock_record.signoffs.CLIENT_DECISION');
  }
  if (mismatches.length > 0) {
    throw new ContractError(
      'LOCK_COMMIT_INCONSISTENT',
      'Lock feedback, packet, lock record, decision record, and artifact must describe one exact LOCK transaction.',
      { mismatches },
    );
  }
}

function assertRevisionSpecConsistency(spec, artifact) {
  const expected = {
    type: artifact.type,
    stage: artifact.stage,
    status: 'REVISED',
    version: artifact.version + 1,
    previous_version_id: artifact.artifact_id,
    owner_capability: artifact.owner_capability,
    decision_bearing: artifact.decision_bearing,
  };
  const mismatches = Object.entries(expected)
    .filter(([field, value]) => spec[field] !== undefined && spec[field] !== value)
    .map(([field]) => `revised_artifact.${field}`);
  if (mismatches.length > 0) {
    throw new ContractError(
      'REVISION_LINEAGE_MISMATCH',
      'A revision must preserve artifact identity and advance exactly one version from the proposed artifact.',
      { mismatches },
    );
  }
}

function cloneRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ContractError('OBJECT_REQUIRED', `${label} must be an object.`);
  }
  return clone(value);
}

function parseRegistry(buffer, key, project) {
  let value;
  try {
    value = JSON.parse(buffer.toString('utf8'));
  } catch (error) {
    stateFail('MALFORMED_STATE', 'Canonical registry is not valid JSON-compatible YAML.', { cause: error.message });
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) stateFail('MALFORMED_STATE', 'Canonical registry must be an object.');
  if (value.format_version !== STATE_FORMAT_VERSION
    || value.schema_version !== SCHEMA_VERSION
    || value.project_id !== project.project_id
    || value.revision !== project.revision) {
    stateFail('REGISTRY_SCOPE_MISMATCH', 'Canonical registry version, project, or revision does not match project.json.');
  }
  if (key !== null && !Array.isArray(value[key])) stateFail('MALFORMED_STATE', `Canonical registry is missing ${key}.`);
  return key === null ? value : value[key];
}

function validateManifest(manifest, project) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) stateFail('MALFORMED_MANIFEST', 'State manifest must be an object.');
  if (manifest.format_version !== STATE_FORMAT_VERSION
    || manifest.schema_version !== SCHEMA_VERSION
    || manifest.project_id !== project.project_id
    || manifest.revision !== project.revision
    || !Array.isArray(manifest.files)) {
    stateFail('MANIFEST_SCOPE_MISMATCH', 'State manifest does not match project.json.');
  }
  const names = manifest.files.map((entry) => entry?.name).sort();
  if (stableStringify(names) !== stableStringify(REQUIRED_STATE_FILES)) {
    stateFail('MANIFEST_FILE_SET_MISMATCH', 'State manifest does not contain the exact canonical file set.', { names });
  }
  for (const entry of manifest.files) {
    if (!entry || typeof entry !== 'object' || !REQUIRED_STATE_FILES.includes(entry.name)) stateFail('MALFORMED_MANIFEST', 'Manifest file entry is invalid.');
    if (!Number.isInteger(entry.bytes) || entry.bytes < 0) stateFail('MALFORMED_MANIFEST', 'Manifest byte count is invalid.');
    requireHash(entry.sha256, `manifest ${entry.name} hash`);
  }
}

function parseJsonLines(text, label) {
  if (text === '') return [];
  if (!text.endsWith('\n')) stateFail('PARTIAL_JSONL_RECORD', `${label} ends with a partial JSONL record.`);
  const lines = text.slice(0, -1).split('\n');
  const records = [];
  for (const [index, line] of lines.entries()) {
    if (line.length === 0) stateFail('MALFORMED_JSONL', `${label} contains an empty record.`, { index });
    try {
      records.push(JSON.parse(line));
    } catch (error) {
      stateFail('MALFORMED_JSONL', `${label} contains invalid JSON.`, { index, cause: error.message });
    }
  }
  return records;
}

async function readJson(filePath, label) {
  const text = await readFile(filePath, 'utf8');
  try {
    return JSON.parse(text);
  } catch (error) {
    stateFail('MALFORMED_JSON', `${label} is not valid JSON.`, { path: filePath, cause: error.message });
  }
}

function bufferJson(value) {
  return Buffer.from(`${stableStringify(value)}\n`, 'utf8');
}

function bufferJsonLines(records) {
  if (records.length === 0) return Buffer.alloc(0);
  return Buffer.from(`${records.map((record) => stableStringify(record)).join('\n')}\n`, 'utf8');
}

function contentBuffer(value) {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  return Buffer.from(`${stableStringify(value)}\n`, 'utf8');
}

function revisionStatePath(revision) {
  return `${INTERNAL_DIRECTORY}/revisions/${String(revision).padStart(12, '0')}`;
}

function resolveInternalPath(rootPath, relativePath) {
  if (!nonEmptyString(relativePath) || path.isAbsolute(relativePath) || relativePath.split(/[\\/]+/).includes('..')) {
    stateFail('INTERNAL_PATH_ESCAPE', 'Internal state path is not project-relative.', { path: relativePath });
  }
  const target = path.resolve(rootPath, relativePath);
  if (!isContained(path.resolve(rootPath), target)) stateFail('INTERNAL_PATH_ESCAPE', 'Internal state path escapes the project.', { path: relativePath });
  return target;
}

function normalizeRoot(root) {
  if (!nonEmptyString(root)) throw new ContractError('ROOT_REQUIRED', 'Project root must be a non-empty path string.');
  return path.resolve(root);
}

function isContained(rootPath, targetPath) {
  const relative = path.relative(rootPath, targetPath);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function exists(filePath) {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function requireHash(value, label) {
  if (!HASH_PATTERN.test(value ?? '')) stateFail('INVALID_CONTENT_HASH', `${label} must be a lowercase SHA-256 hash.`, { value });
}

function safeFileName(value) {
  return String(value).replace(/[^A-Za-z0-9._-]/g, '_');
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

async function syncDirectory(directory) {
  let handle;
  try {
    handle = await open(directory, fsConstants.O_RDONLY);
    await handle.sync();
  } catch (error) {
    if (!['EINVAL', 'EISDIR', 'EPERM', 'ENOTSUP', 'EBADF'].includes(error.code)) throw error;
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

function stateFail(code, message, details = {}) {
  throw new StateError(code, message, details);
}
