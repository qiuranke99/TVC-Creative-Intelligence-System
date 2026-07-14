import { access, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateStoreRuntime } from './tcis/runtime-validation.mjs';

const CLI_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.dirname(CLI_DIR);

const COMMAND_SPECS = Object.freeze({
  init: command('Initialize a local TCIS project.', true, true),
  status: command('Read the canonical project status.', true, false),
  next: command('Report the next workflow action and capability route.', true, false),
  propose: command('Register a decision packet proposal.', true, true),
  feedback: command('Apply explicit human feedback; selection creates a revision, never a lock.', true, true),
  'confirm-lock': command('Confirm and lock an already revised artifact.', true, true),
  reopen: command('Reopen a locked artifact and invalidate affected descendants.', true, true),
  'register-claim': command('Register a claim and its independent evidence/clearance state.', true, true),
  'register-right': command('Register a right and its independent clearance state.', true, true),
  'request-attempt': command('Register a local media/tool attempt request.', true, true),
  'inspect-attempt': command('Bind and inspect an actual attempt output.', true, true),
  'select-attempt': command('Select a passed, inspected attempt.', true, true),
  validate: command('Run available deterministic Runtime validation.', false, false, true),
  'run-fixtures': command('Execute the canonical acceptance fixture runner.', false, false, true),
  demo: command('Run the local synthetic demonstration.', false, false, true),
});

const FLAG_ALIASES = Object.freeze({
  '--project': 'project',
  '--project-dir': 'project',
  '--root': 'project',
  '--input': 'input',
  '--input-file': 'input',
  '--json-file': 'input',
  '--json': 'input',
  '--expected-revision': 'expectedRevision',
  '--expected-version': 'expectedVersion',
  '--expected-hash': 'expectedHash',
});

const PEER_CANDIDATES = Object.freeze({
  store: ['tcis/project-store.mjs', 'tcis/store.mjs', 'tcis/state.mjs'],
  state: ['tcis/project-state.mjs'],
  workflow: ['tcis/workflow.mjs'],
  router: ['tcis/router.mjs', 'tcis/workflow-router.mjs'],
  capabilities: ['tcis/capabilities.mjs', 'tcis/capability-registry.mjs'],
  fixtures: ['tcis/fixtures.mjs', 'tcis/fixture-runner.mjs'],
});

const STORE_METHODS = Object.freeze({
  status: ['status', 'getStatus', 'readStatus', 'snapshot'],
  'register-claim': ['registerClaim', 'addClaim'],
  'register-right': ['registerRight', 'addRight'],
  'request-attempt': ['requestAttempt', 'registerAttemptRequest'],
  'inspect-attempt': ['inspectAttempt', 'registerAttemptInspection'],
  'select-attempt': ['selectAttempt'],
});

const WORKFLOW_FUNCTIONS = Object.freeze({
  next: ['next', 'getNext', 'nextAction', 'getNextAction'],
  propose: ['propose', 'proposeDecision', 'registerProposal'],
  feedback: ['feedback', 'applyFeedback', 'recordFeedback'],
  'confirm-lock': ['confirmLock', 'lockRevisedArtifact'],
  reopen: ['reopen', 'reopenArtifact'],
});

const ROUTER_FUNCTIONS = Object.freeze({
  next: ['next', 'routeNext', 'getNextAction', 'recommendNext', 'recommendNextMove'],
});

const FIXTURE_FUNCTIONS = Object.freeze({
  'run-fixtures': ['runFixtures', 'runAllFixtures'],
  demo: ['runDemo', 'demo'],
});

const PATH_VALUE_KEYS = /(?:^|_)(?:path|paths|file|files|dir|directory)$/i;
const ID_VALUE_KEYS = /(?:^|_)(?:id|ids)$/i;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const WRITE_COMMANDS = new Set([
  'init',
  'propose',
  'feedback',
  'confirm-lock',
  'reopen',
  'register-claim',
  'register-right',
  'request-attempt',
  'inspect-attempt',
  'select-attempt',
]);
const RECEIPT_COMMANDS = new Set(['validate', 'run-fixtures', 'demo']);

export class CliError extends Error {
  constructor(code, message, details = {}, exitCode = 2, options = {}) {
    super(message, options);
    this.name = 'CliError';
    this.code = code;
    this.details = details;
    this.exitCode = exitCode;
  }
}

export function parseCliArgs(argv) {
  if (!Array.isArray(argv)) {
    throw new CliError('CLI_ARGV_REQUIRED', 'CLI arguments must be an array.');
  }

  const args = [...argv];
  if (args.length === 0 || isHelpFlag(args[0])) return { kind: 'help', command: null };
  if (isVersionFlag(args[0])) return { kind: 'version' };

  if (args[0] === 'help') {
    if (args.length > 2) throw usageError('help accepts at most one command name.');
    const helpCommand = args[1] ?? null;
    if (helpCommand && !COMMAND_SPECS[helpCommand]) throw unknownCommand(helpCommand);
    return { kind: 'help', command: helpCommand };
  }

  const commandName = args.shift();
  const spec = COMMAND_SPECS[commandName];
  if (!spec) throw unknownCommand(commandName);

  const flags = {};
  const positionals = [];
  let wantsHelp = false;

  while (args.length > 0) {
    const token = args.shift();
    if (isHelpFlag(token)) {
      wantsHelp = true;
      continue;
    }
    if (isVersionFlag(token)) {
      throw usageError(`${token} is only valid as a global flag.`);
    }
    if (!token.startsWith('-')) {
      positionals.push(token);
      continue;
    }

    const [rawFlag, inlineValue] = splitFlag(token);
    const key = FLAG_ALIASES[rawFlag];
    if (!key) throw new CliError('CLI_UNKNOWN_FLAG', `Unknown flag: ${rawFlag}`, { flag: rawFlag, command: commandName });
    if (Object.hasOwn(flags, key)) {
      throw new CliError('CLI_DUPLICATE_FLAG', `Flag supplied more than once: ${rawFlag}`, { flag: rawFlag, command: commandName });
    }
    const value = inlineValue ?? args.shift();
    if (value === undefined || value.startsWith('--')) {
      throw new CliError('CLI_FLAG_VALUE_REQUIRED', `Flag requires a value: ${rawFlag}`, { flag: rawFlag, command: commandName });
    }
    flags[key] = value;
  }

  if (wantsHelp) return { kind: 'help', command: commandName };
  if (positionals.length > 1 || (positionals.length === 1 && flags.project)) {
    throw usageError(`${commandName} accepts at most one positional project path.`, { command: commandName, positionals });
  }
  if (positionals.length === 1) flags.project = positionals[0];

  if (spec.projectRequired && !flags.project) {
    throw new CliError('CLI_PROJECT_REQUIRED', `${commandName} requires --project <directory>.`, { command: commandName });
  }
  if (spec.inputRequired && !flags.input) {
    throw new CliError('CLI_INPUT_REQUIRED', `${commandName} requires --input <json-file>.`, { command: commandName });
  }
  if (!spec.projectAllowed && flags.project) {
    throw usageError(`${commandName} does not accept --project.`, { command: commandName });
  }
  if (!spec.inputAllowed && flags.input) {
    throw usageError(`${commandName} does not accept --input.`, { command: commandName });
  }
  if (!WRITE_COMMANDS.has(commandName) && ['expectedRevision', 'expectedVersion', 'expectedHash'].some((key) => Object.hasOwn(flags, key))) {
    throw usageError(`${commandName} does not accept write preconditions.`, { command: commandName });
  }

  return { kind: 'command', command: commandName, flags };
}

export async function runCli(argv, options = {}) {
  const parsed = parseCliArgs(argv);
  if (parsed.kind === 'help') return successEnvelope('help', helpReceipt(parsed.command));
  if (parsed.kind === 'version') return successEnvelope('version', await versionReceipt());

  const cwd = path.resolve(options.cwd ?? process.cwd());
  const projectDir = parsed.flags.project
    ? await resolveUserPath(parsed.flags.project, cwd, { label: 'project', mustExist: parsed.command !== 'init' })
    : null;
  const inputPath = parsed.flags.input
    ? await resolveUserPath(parsed.flags.input, cwd, { label: 'input', mustExist: true })
    : null;
  const input = inputPath ? await readJsonInput(inputPath) : undefined;

  if (input !== undefined && (!input || typeof input !== 'object' || Array.isArray(input))) {
    throw new CliError('CLI_INPUT_OBJECT_REQUIRED', 'JSON input must contain one object.', { path: inputPath });
  }
  if (input !== undefined) assertSafePayloadIds(input);
  if (projectDir && input !== undefined) assertContainedPayloadPaths(input, projectDir);
  const preconditions = extractPreconditions(input, parsed.command, parsed.flags);

  const context = Object.freeze({
    command: parsed.command,
    cwd,
    projectDir,
    input,
    inputPath,
    preconditions,
    flags: Object.freeze({ ...parsed.flags }),
  });
  const runtime = options.runtime ?? await createPeerRuntime({ cwd, packageRoot: options.packageRoot ?? PACKAGE_ROOT });
  const result = await executeRuntime(runtime, parsed.command, context);
  if (RECEIPT_COMMANDS.has(parsed.command)) assertVerifiedReceipt(parsed.command, result);
  return successEnvelope(parsed.command, result);
}

export async function main(argv = process.argv.slice(2), options = {}) {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  try {
    const receipt = await runCli(argv, options);
    stdout.write(`${stableJson(receipt)}\n`);
    return 0;
  } catch (error) {
    const receipt = failureEnvelope(error, commandHint(argv));
    stderr.write(`${stableJson(receipt)}\n`);
    return errorExitCode(error);
  }
}

export async function createPeerRuntime({ cwd = process.cwd(), packageRoot = PACKAGE_ROOT, moduleOverrides = {} } = {}) {
  const modules = {};
  for (const [peer, candidates] of Object.entries(PEER_CANDIDATES)) {
    modules[peer] = Object.hasOwn(moduleOverrides, peer)
      ? moduleOverrides[peer]
      : await importFirstExisting(candidates, packageRoot, peer);
  }
  return new PeerRuntime(modules, { cwd, packageRoot });
}

export function stableJson(value) {
  return JSON.stringify(sortJsonValue(toJsonValue(value)), null, 2);
}

class PeerRuntime {
  constructor(modules, options) {
    this.modules = modules;
    this.options = options;
    const Store = findStoreClass(modules.store);
    this.store = Store ? new Store() : null;
  }

  async execute(commandName, context) {
    switch (commandName) {
      case 'init': return this.init(context);
      case 'status': return this.status(context);
      case 'next': return this.next(context);
      case 'propose': return this.propose(context);
      case 'feedback': return this.feedback(context);
      case 'confirm-lock': return this.confirmLock(context);
      case 'reopen': return this.reopen(context);
      case 'register-claim': return this.registerClaim(context);
      case 'register-right': return this.registerRight(context);
      case 'request-attempt': return this.requestAttempt(context);
      case 'inspect-attempt': return this.updateAttempt(context, 'INSPECTED');
      case 'select-attempt': return this.updateAttempt(context, 'SELECTED');
      case 'validate': return this.validate(context);
      case 'run-fixtures': return this.runFixtureCommand(commandName, context);
      case 'demo': return this.runFixtureCommand(commandName, context);
      default: throw peerInterfaceError(commandName, 'Runtime', this.modules);
    }
  }

  async init(context) {
    const store = this.requireStore('init');
    return store.createProject(context.projectDir, stripCliMetadata(context.input));
  }

  async status(context) {
    return this.requireStore('status').loadSnapshot(context.projectDir);
  }

  async next(context) {
    const snapshot = await this.requireStore('next').loadSnapshot(context.projectDir);
    const recommend = requireExport(this.modules.router, 'router', 'next', ['recommendNextMove']);
    return recommend(snapshot);
  }

  async propose(context) {
    const store = this.requireStore('propose');
    const createPacket = requireExport(this.modules.workflow, 'workflow', 'propose', ['createDecisionPacket']);
    const snapshot = await store.loadSnapshot(context.projectDir);
    const artifactId = context.input.artifact_id ?? context.input.proposal?.artifact_id;
    const artifact = findSnapshotArtifact(snapshot, artifactId);
    const token = artifactMutationToken(context, artifact);
    assertSnapshotCas(this.modules.state, snapshot, artifact, token);
    const proposal = context.input.proposal ?? stripCliMetadata(context.input, ['artifact_id']);
    const packetArtifact = artifact.status === 'INTERNAL_REVIEW' ? { ...artifact, status: 'PROPOSED' } : artifact;
    const packet = createPacket(packetArtifact, proposal);
    const committed = packet.interaction_phase === 'CONFIRMATION'
      ? await store.commitInteraction(context.projectDir, { packet }, token)
      : await store.commitProposal(context.projectDir, { packet }, token);
    const persistedArtifact = findSnapshotArtifact(committed, artifact.artifact_id);
    const persistedPacket = committed.decision_packets.find((candidate) => candidate.packet_id === packet.packet_id);
    if (!persistedPacket) throw new CliError('CLI_PACKET_NOT_PERSISTED', 'The decision packet was not present after commit.', { packet_id: packet.packet_id }, 1);
    return {
      kind: 'tcis.proposal.receipt',
      packet: persistedPacket,
      artifact: persistedArtifact,
      project: committed.project,
    };
  }

  async feedback(context) {
    const store = this.requireStore('feedback');
    const applyFeedback = requireExport(this.modules.workflow, 'workflow', 'feedback', ['applyHumanFeedback']);
    const packet = requireInputRecord(context.input.packet, 'packet');
    const feedback = bindFeedbackToPacket(
      context.input.feedback ?? stripCliMetadata(context.input, ['packet', 'revised_artifact']),
      packet,
    );
    const snapshot = await store.loadSnapshot(context.projectDir);
    const artifact = findSnapshotArtifact(snapshot, packet.artifact_id);
    const token = artifactMutationToken(context, artifact);
    assertSnapshotCas(this.modules.state, snapshot, artifact, token);
    const workflowResult = applyFeedback({ artifact, packet, feedback });

    if (workflowResult.state === 'AWAITING_HUMAN') {
      throw new CliError(
        'CLI_HUMAN_FEEDBACK_REQUIRED',
        'The feedback command requires one explicit human response; silence cannot produce a successful write receipt.',
        { packet_id: packet.packet_id },
        2,
      );
    }
    if (workflowResult.state === 'CONFLICT') {
      const committed = await store.appendDecision(context.projectDir, workflowResult.decision_record, token);
      const persistedDecision = committed.decisions.find(
        (candidate) => candidate.decision_id === workflowResult.decision_record.decision_id,
      );
      if (!persistedDecision) {
        throw new CliError('CLI_CONFLICT_NOT_PERSISTED', 'The conflict decision was not present after commit.', {
          decision_id: workflowResult.decision_record.decision_id,
        }, 1);
      }
      return {
        kind: 'tcis.feedback.receipt',
        workflow: { ...workflowResult, decision_record: persistedDecision },
        decision_record: persistedDecision,
        project: committed.project,
        artifact: findSnapshotArtifact(committed, artifact.artifact_id),
      };
    }

    let commitSpec;
    if (workflowResult.state === 'REVISED') {
      const revision = requireInputRecord(context.input.revised_artifact, 'revised_artifact');
      const revisionSpec = buildRevisionArtifactSpec(artifact, workflowResult.artifact, revision);
      commitSpec = { feedback, revised_artifact: revisionSpec };
    } else {
      commitSpec = { feedback, to_status: workflowResult.artifact.status };
    }
    const committed = await store.commitFeedback(context.projectDir, commitSpec, token);
    const persistedArtifact = workflowResult.state === 'REVISED'
      ? latestRevisionOf(committed, artifact.artifact_id)
      : findSnapshotArtifact(committed, artifact.artifact_id);
    const persistedFeedback = committed.human_feedback.find((candidate) => candidate.feedback_id === feedback.feedback_id);
    if (!persistedFeedback) throw new CliError('CLI_FEEDBACK_NOT_PERSISTED', 'Human feedback was not present after commit.', { feedback_id: feedback.feedback_id }, 1);

    return {
      kind: 'tcis.feedback.receipt',
      workflow: { ...workflowResult, artifact: persistedArtifact },
      feedback: persistedFeedback,
      artifact: persistedArtifact,
      project: committed.project,
    };
  }

  async confirmLock(context) {
    const store = this.requireStore('confirm-lock');
    const confirm = requireExport(this.modules.workflow, 'workflow', 'confirm-lock', ['confirmLock']);
    const packet = requireInputRecord(context.input.packet, 'packet');
    const feedback = bindFeedbackToPacket(
      context.input.feedback ?? stripCliMetadata(context.input, ['packet']),
      packet,
    );
    const snapshot = await store.loadSnapshot(context.projectDir);
    const artifact = findSnapshotArtifact(snapshot, packet.artifact_id);
    const token = artifactMutationToken(context, artifact);
    assertSnapshotCas(this.modules.state, snapshot, artifact, token);
    const workflowResult = confirm({ artifact, packet, feedback });
    if (workflowResult.state === 'AWAITING_HUMAN') {
      return { kind: 'tcis.lock.receipt', workflow: workflowResult, project: snapshot.project, artifact };
    }

    const lockRecord = workflowResult.lock_record;
    const committed = await store.commitLock(context.projectDir, {
      feedback,
      lock_record: lockRecord,
      decision_record: workflowResult.decision_record,
    }, token);
    const persistedLock = committed.lock_records.find((candidate) => candidate.lock_id === lockRecord.lock_id);
    const persistedDecision = committed.decisions.find((candidate) => candidate.decision_id === workflowResult.decision_record.decision_id);
    if (!persistedLock || !persistedDecision) {
      throw new CliError('CLI_LOCK_NOT_PERSISTED', 'The lock interaction was incomplete after commit.', { artifact_id: artifact.artifact_id }, 1);
    }
    return {
      kind: 'tcis.lock.receipt',
      workflow: { ...workflowResult, artifact: findSnapshotArtifact(committed, artifact.artifact_id) },
      lock_record: persistedLock,
      decision_record: persistedDecision,
      project: committed.project,
    };
  }

  async reopen(context) {
    const store = this.requireStore('reopen');
    const plan = requireExport(this.modules.workflow, 'workflow', 'reopen', ['planReopen']);
    const snapshot = await store.loadSnapshot(context.projectDir);
    const artifactId = context.input.artifact_id;
    const artifact = findSnapshotArtifact(snapshot, artifactId);
    const reason = context.input.reason;
    const token = artifactMutationToken(context, artifact);
    assertSnapshotCas(this.modules.state, snapshot, artifact, token);
    const reopenPlan = plan({ artifactId, dependencies: snapshot.dependencies, reason });
    const committed = await store.invalidateDescendants(context.projectDir, artifactId, reason, token);
    return { kind: 'tcis.reopen.receipt', plan: reopenPlan, project: committed.project, snapshot: committed };
  }

  async registerClaim(context) {
    const record = context.input.claim ?? stripCliMetadata(context.input);
    return this.requireStore('register-claim').addClaim(
      context.projectDir,
      record,
      projectMutationToken(context),
    );
  }

  async registerRight(context) {
    const record = context.input.right ?? stripCliMetadata(context.input);
    return this.requireStore('register-right').addRight(
      context.projectDir,
      record,
      projectMutationToken(context),
    );
  }

  async requestAttempt(context) {
    const input = context.input.attempt ?? stripCliMetadata(context.input);
    const record = commandStatusRecord(input, 'REQUESTED', 'request-attempt');
    const snapshot = await this.requireStore('request-attempt').loadSnapshot(context.projectDir);
    const artifact = findSnapshotArtifact(snapshot, record.artifact_id);
    return this.store.addAttempt(context.projectDir, record, artifactMutationToken(context, artifact));
  }

  async updateAttempt(context, status) {
    const commandName = status === 'INSPECTED' ? 'inspect-attempt' : 'select-attempt';
    const store = this.requireStore(commandName);
    const attemptId = context.input.attempt_id;
    if (typeof attemptId !== 'string' || attemptId.length === 0) {
      throw new CliError('CLI_ATTEMPT_ID_REQUIRED', `${commandName} requires attempt_id.`, { command: commandName });
    }
    const snapshot = await store.loadSnapshot(context.projectDir);
    const attempt = snapshot.attempts.find((candidate) => candidate.attempt_id === attemptId);
    if (!attempt) throw new CliError('CLI_ATTEMPT_NOT_FOUND', `Attempt ${attemptId} was not found.`, { attempt_id: attemptId }, 1);
    const artifact = findSnapshotArtifact(snapshot, attempt.artifact_id);
    const rawPatch = context.input.patch ?? stripCliMetadata(context.input, ['attempt_id']);
    const patch = commandStatusRecord(rawPatch, status, commandName);
    return store.updateAttempt(context.projectDir, attemptId, patch, artifactMutationToken(context, artifact));
  }

  async validate(context) {
    const checks = [];
    const validationTargets = [
      ['workflow', this.modules.workflow, ['validateWorkflow']],
      ['router', this.modules.router, ['validateRouter']],
      ['capabilities', this.modules.capabilities, ['validateCapabilityRegistry', 'validateRegistry']],
    ];

    const store = this.requireStore('validate');
    const storeResult = await validateStoreRuntime(this.modules.store, {
      validatorContext: { ...context, store, modules: this.modules },
    });
    checks.push({ name: 'store', passed: receiptPassState(storeResult) === true, result: storeResult });
    for (const [name, peerModule, names] of validationTargets) {
      const handler = findNamedExport(peerModule, names);
      if (!handler) continue;
      const result = await handler({ ...context, store, modules: this.modules });
      checks.push({ name, passed: receiptPassState(result) === true, result });
    }
    if (context.projectDir) {
      const result = await store.verifyIntegrity(context.projectDir);
      checks.push({ name: 'project', passed: receiptPassState(result) === true, result });
    }
    if (this.modules.fixtures) {
      const loadFixtures = findNamedExport(this.modules.fixtures, ['loadFixtures']);
      const validateFixtures = findNamedExport(this.modules.fixtures, ['validateFixtureRegistry', 'validateFixtures']);
      if (loadFixtures && validateFixtures) {
        const result = await validateFixtures(await loadFixtures());
        checks.push({ name: 'fixtures', passed: receiptPassState(result) === true, result });
      }
    }
    if (checks.length === 0) throw peerInterfaceError('validate', 'Runtime validators', this.modules);
    return { kind: 'tcis.validation.receipt', passed: checks.every((check) => check.passed), checks };
  }

  async runFixtureCommand(commandName, context) {
    const fixtures = requirePeer(this.modules.fixtures, 'fixtures', commandName);
    const handler = findNamedExport(fixtures, FIXTURE_FUNCTIONS[commandName]);
    if (!handler) throw peerInterfaceError(commandName, 'fixtures', this.modules);
    if (commandName === 'run-fixtures') return handler();
    return handler({ ...context, modules: this.modules });
  }

  requireStore(commandName) {
    requirePeer(this.modules.store, 'store', commandName);
    if (!this.store || typeof this.store.createProject !== 'function' || typeof this.store.loadSnapshot !== 'function') {
      throw peerInterfaceError(commandName, 'ProjectStore', this.modules);
    }
    return this.store;
  }
}

function requireExport(peerModule, peer, commandName, names) {
  requirePeer(peerModule, peer, commandName);
  const handler = findNamedExport(peerModule, names);
  if (!handler) throw peerInterfaceError(commandName, peer, { [peer]: peerModule });
  return handler;
}

function requireInputRecord(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CliError('CLI_INPUT_RECORD_REQUIRED', `${name} must be an object.`, { field: name });
  }
  return value;
}

function bindFeedbackToPacket(feedback, packet) {
  if (Array.isArray(feedback)) return feedback.map((entry) => bindFeedbackToPacket(entry, packet));
  const record = requireInputRecord(feedback, 'feedback');
  return {
    schema_version: packet.schema_version,
    project_id: packet.project_id,
    ...record,
  };
}

function findSnapshotArtifact(snapshot, artifactId) {
  if (typeof artifactId !== 'string' || artifactId.length === 0) {
    throw new CliError('CLI_ARTIFACT_ID_REQUIRED', 'artifact_id is required.', {});
  }
  const artifact = snapshot.artifacts.find((candidate) => candidate.artifact_id === artifactId);
  if (!artifact) throw new CliError('CLI_ARTIFACT_NOT_FOUND', `Artifact ${artifactId} was not found.`, { artifact_id: artifactId }, 1);
  return artifact;
}

function latestRevisionOf(snapshot, previousArtifactId) {
  const revisions = snapshot.artifacts
    .filter((artifact) => artifact.previous_version_id === previousArtifactId)
    .sort((left, right) => right.version - left.version);
  if (revisions.length === 0) {
    throw new CliError('CLI_REVISED_ARTIFACT_NOT_PERSISTED', 'The revised artifact was not present after persistence.', { previous_artifact_id: previousArtifactId }, 1);
  }
  return revisions[0];
}

function buildRevisionArtifactSpec(previous, workflowArtifact, revision) {
  const protectedFields = new Set([
    'schema_version', 'project_id', 'artifact_id', 'path', 'content_hash', 'created_at', 'updated_at',
    'version', 'previous_version_id', 'status', 'type', 'stage', 'owner_capability', 'decision_bearing',
  ]);
  const workflowFields = Object.fromEntries(Object.entries(workflowArtifact).filter(([key]) => !protectedFields.has(key)));
  return {
    ...workflowFields,
    ...revision,
    type: previous.type,
    stage: previous.stage,
    status: 'REVISED',
    version: previous.version + 1,
    owner_capability: previous.owner_capability,
    decision_bearing: previous.decision_bearing,
    input_artifact_ids: revision.input_artifact_ids ?? previous.input_artifact_ids,
    previous_version_id: previous.artifact_id,
  };
}

function stripCliMetadata(input, extraKeys = []) {
  const omitted = new Set([
    'expected_revision', 'expectedRevision', 'expected_version', 'expectedVersion', 'expected_hash', 'expectedHash',
    'preconditions',
    ...extraKeys,
  ]);
  return Object.fromEntries(Object.entries(input).filter(([key]) => !omitted.has(key)));
}

function projectMutationToken(context) {
  return context.preconditions.expectedRevision;
}

function artifactMutationToken(context, artifact) {
  const revision = context.preconditions.expectedRevision;
  const version = context.preconditions.expectedVersion;
  const hash = context.preconditions.expectedHash;
  if (revision === undefined || version === undefined || hash === undefined) {
    throw new CliError(
      'CLI_ARTIFACT_CAS_REQUIRED',
      'Artifact writes require expected revision, version, and hash.',
      { artifact_id: artifact.artifact_id },
    );
  }
  return storeArtifactToken(revision, artifact, version, hash);
}

function storeArtifactToken(revision, artifact, version = artifact.version, hash = artifact.content_hash) {
  return {
    project_revision: revision,
    artifact_id: artifact.artifact_id,
    artifact_version: version,
    artifact_hash: hash,
    artifacts: {
      [artifact.artifact_id]: { artifact_version: version, artifact_hash: hash },
    },
  };
}

function assertSnapshotCas(stateModule, snapshot, artifact, token) {
  const assertRevision = requireExport(stateModule, 'state', 'CAS validation', ['assertExpectedRevision']);
  const assertArtifact = requireExport(stateModule, 'state', 'CAS validation', ['assertArtifactCas']);
  assertRevision(snapshot.project, token);
  assertArtifact(artifact, token);
}

function commandStatusRecord(input, status, commandName) {
  const record = { ...input };
  if (record.status !== undefined && record.status !== status) {
    throw new CliError('CLI_COMMAND_STATUS_CONFLICT', `${commandName} cannot write status ${record.status}.`, {
      command: commandName,
      expected_status: status,
      actual_status: record.status,
    });
  }
  record.status = status;
  return record;
}

function command(summary, projectRequired, inputRequired, optionalContext = false) {
  return Object.freeze({
    summary,
    projectRequired,
    inputRequired,
    projectAllowed: projectRequired || optionalContext,
    inputAllowed: inputRequired || optionalContext,
  });
}

function successEnvelope(commandName, result) {
  return { ok: true, command: commandName, result: result ?? null };
}

function failureEnvelope(error, commandName) {
  const safe = error && typeof error === 'object' ? error : new Error(String(error));
  return {
    ok: false,
    command: commandName,
    error: {
      type: safe.name || 'Error',
      code: safe.code || 'CLI_INTERNAL_ERROR',
      message: safe.message || 'Unknown CLI failure.',
      details: safeErrorDetails(safe.details),
    },
  };
}

function safeErrorDetails(details) {
  if (!details || typeof details !== 'object') return {};
  try {
    return toJsonValue(details);
  } catch (error) {
    return { serialization_error: error.code ?? 'CLI_NON_SERIALIZABLE_ERROR_DETAILS' };
  }
}

function helpReceipt(commandName) {
  if (commandName) {
    const spec = COMMAND_SPECS[commandName];
    return {
      kind: 'tcis.cli.help',
      command: commandName,
      summary: spec.summary,
      usage: usageFor(commandName, spec),
      flags: flagsFor(spec),
    };
  }
  return {
    kind: 'tcis.cli.help',
    usage: 'tcis <command> [--project <directory>] [--input <json-file>]',
    guarantees: ['local-only', 'no-silent-approval', 'stable-json-output', 'typed-nonzero-errors'],
    commands: Object.entries(COMMAND_SPECS).map(([name, spec]) => ({ name, summary: spec.summary, usage: usageFor(name, spec) })),
  };
}

async function versionReceipt() {
  try {
    const packageRecord = JSON.parse(await readFile(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'));
    return { kind: 'tcis.cli.version', name: packageRecord.name, version: packageRecord.version };
  } catch (error) {
    throw new CliError('CLI_PACKAGE_READ_FAILED', 'Unable to read the TCIS package version.', { cause: error.code ?? error.message }, 1, { cause: error });
  }
}

function usageFor(commandName, spec) {
  const parts = ['tcis', commandName];
  if (spec.projectRequired) parts.push('--project <directory>');
  else if (spec.projectAllowed) parts.push('[--project <directory>]');
  if (spec.inputRequired) parts.push('--input <json-file>');
  else if (spec.inputAllowed) parts.push('[--input <json-file>]');
  return parts.join(' ');
}

function flagsFor(spec) {
  const flags = [{ name: '--help', required: false, type: 'boolean' }];
  if (spec.projectAllowed) flags.push({ name: '--project', aliases: ['--project-dir', '--root'], required: spec.projectRequired, type: 'directory' });
  if (spec.inputAllowed) flags.push({ name: '--input', aliases: ['--input-file', '--json-file', '--json'], required: spec.inputRequired, type: 'json-file' });
  if (spec.inputRequired) {
    flags.push({ name: '--expected-revision', required: false, type: 'non-negative-integer' });
    flags.push({ name: '--expected-version', required: false, type: 'positive-integer' });
    flags.push({ name: '--expected-hash', required: false, type: 'sha256' });
  }
  return flags;
}

function splitFlag(token) {
  const index = token.indexOf('=');
  if (index < 0) return [token, undefined];
  const value = token.slice(index + 1);
  if (!value) throw new CliError('CLI_FLAG_VALUE_REQUIRED', `Flag requires a value: ${token.slice(0, index)}`, { flag: token.slice(0, index) });
  return [token.slice(0, index), value];
}

function isHelpFlag(value) {
  return value === '--help' || value === '-h';
}

function isVersionFlag(value) {
  return value === '--version' || value === '-V';
}

function unknownCommand(commandName) {
  return new CliError('CLI_UNKNOWN_COMMAND', `Unknown command: ${commandName}`, { command: commandName, commands: Object.keys(COMMAND_SPECS) });
}

function usageError(message, details = {}) {
  return new CliError('CLI_USAGE', message, details);
}

function commandHint(argv) {
  if (!Array.isArray(argv) || argv.length === 0 || argv[0].startsWith('-')) return null;
  if (argv[0] === 'help') return 'help';
  return argv[0];
}

async function resolveUserPath(rawPath, cwd, { label, mustExist }) {
  if (typeof rawPath !== 'string' || rawPath.length === 0 || rawPath.includes('\0')) {
    throw new CliError('CLI_INVALID_PATH', `${label} path must be a non-empty local path.`, { label });
  }
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(rawPath)) {
    throw new CliError('CLI_REMOTE_PATH_FORBIDDEN', `${label} must be a local path.`, { label, path: rawPath });
  }
  if (rawPath.split(/[\\/]+/u).includes('..')) {
    throw new CliError('CLI_PATH_ESCAPE', `${label} path may not traverse above the working directory.`, { label, path: rawPath });
  }

  const resolved = path.resolve(cwd, rawPath);
  if (label === 'project') assertSafeProjectRoot(resolved);
  if (!mustExist) {
    try {
      const metadata = await stat(resolved);
      if (!metadata.isDirectory()) {
        throw new CliError('CLI_PROJECT_NOT_DIRECTORY', `project path must be a directory: ${resolved}`, { path: resolved });
      }
      const canonical = await realpath(resolved);
      assertSafeProjectRoot(canonical);
      return canonical;
    } catch (error) {
      if (error instanceof CliError) throw error;
      if (error?.code === 'ENOENT') return resolved;
      throw new CliError('CLI_PROJECT_PATH_INVALID', `Unable to inspect project path: ${resolved}`, { path: resolved, cause: error.code ?? error.message }, 2, { cause: error });
    }
  }
  try {
    await access(resolved);
    const canonical = await realpath(resolved);
    if (label === 'project') {
      assertSafeProjectRoot(canonical);
      const metadata = await stat(canonical);
      if (!metadata.isDirectory()) {
        throw new CliError('CLI_PROJECT_NOT_DIRECTORY', `project path must be a directory: ${canonical}`, { path: canonical });
      }
    }
    if (label === 'input') {
      const metadata = await stat(canonical);
      if (!metadata.isFile()) {
        throw new CliError('CLI_INPUT_NOT_FILE', `input path must be a file: ${canonical}`, { path: canonical });
      }
    }
    return canonical;
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError(
      label === 'input' ? 'CLI_INPUT_NOT_FOUND' : 'CLI_PROJECT_NOT_FOUND',
      `${label} path does not exist: ${resolved}`,
      { label, path: resolved },
      2,
      { cause: error },
    );
  }
}

function assertSafeProjectRoot(projectDir) {
  const parsed = path.parse(projectDir);
  if (samePath(projectDir, parsed.root)) {
    throw new CliError('CLI_UNSAFE_PROJECT_ROOT', 'A filesystem root cannot be used as a TCIS project directory.', { path: projectDir });
  }
}

function samePath(left, right) {
  return process.platform === 'win32'
    ? path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase()
    : path.resolve(left) === path.resolve(right);
}

async function readJsonInput(inputPath) {
  let source;
  try {
    source = await readFile(inputPath, 'utf8');
  } catch (error) {
    throw new CliError('CLI_INPUT_READ_FAILED', `Unable to read JSON input: ${inputPath}`, { path: inputPath, cause: error.code ?? error.message }, 2, { cause: error });
  }
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new CliError('CLI_INVALID_JSON', `Input is not valid JSON: ${inputPath}`, { path: inputPath, cause: error.message }, 2, { cause: error });
  }
}

function assertContainedPayloadPaths(value, projectDir, key = '') {
  if (Array.isArray(value)) {
    for (const child of value) assertContainedPayloadPaths(child, projectDir, key);
    return;
  }
  if (!value || typeof value !== 'object') {
    if (PATH_VALUE_KEYS.test(key) && typeof value === 'string') assertProjectPath(value, projectDir, key);
    return;
  }
  for (const [childKey, child] of Object.entries(value)) assertContainedPayloadPaths(child, projectDir, childKey);
}

function assertSafePayloadIds(value, key = '') {
  if (Array.isArray(value)) {
    for (const child of value) assertSafePayloadIds(child, key);
    return;
  }
  if (!value || typeof value !== 'object') {
    if (ID_VALUE_KEYS.test(key) && typeof value === 'string') assertSafeId(value, key);
    return;
  }
  for (const [childKey, child] of Object.entries(value)) assertSafePayloadIds(child, childKey);
}

function assertSafeId(candidate, key) {
  if (!SAFE_ID.test(candidate) || candidate.includes('..') || /[. ]$/.test(candidate)) {
    throw new CliError(
      'CLI_UNSAFE_ID',
      `${key} must be a path-safe identifier of at most 128 ASCII characters.`,
      { key, value: candidate },
    );
  }
}

function extractPreconditions(input, commandName, flags = {}) {
  if (!WRITE_COMMANDS.has(commandName) || !input) return Object.freeze({});
  const nested = input.preconditions && typeof input.preconditions === 'object' && !Array.isArray(input.preconditions)
    ? input.preconditions
    : {};
  const inputRevision = firstDefined(input.expected_revision, input.expectedRevision, nested.expected_revision, nested.expectedRevision);
  const inputVersion = firstDefined(input.expected_version, input.expectedVersion, nested.expected_version, nested.expectedVersion);
  const inputHash = firstDefined(input.expected_hash, input.expectedHash, nested.expected_hash, nested.expectedHash);
  const flagRevision = parseIntegerFlag(flags.expectedRevision, '--expected-revision');
  const flagVersion = parseIntegerFlag(flags.expectedVersion, '--expected-version');
  const expectedRevision = reconcilePrecondition(inputRevision, flagRevision, 'expected_revision');
  const expectedVersion = reconcilePrecondition(inputVersion, flagVersion, 'expected_version');
  const expectedHash = reconcilePrecondition(inputHash, flags.expectedHash, 'expected_hash');

  if (expectedRevision !== undefined && (!Number.isInteger(expectedRevision) || expectedRevision < 0)) {
    throw new CliError('CLI_INVALID_EXPECTED_REVISION', 'expected_revision must be a non-negative integer.', { value: expectedRevision });
  }
  if (expectedVersion !== undefined && (!Number.isInteger(expectedVersion) || expectedVersion < 1)) {
    throw new CliError('CLI_INVALID_EXPECTED_VERSION', 'expected_version must be a positive integer.', { value: expectedVersion });
  }
  if (expectedHash !== undefined && (typeof expectedHash !== 'string' || !SHA256.test(expectedHash))) {
    throw new CliError('CLI_INVALID_EXPECTED_HASH', 'expected_hash must be a lowercase SHA-256 hash.', { value: expectedHash });
  }

  return Object.freeze({
    ...(expectedRevision === undefined ? {} : { expectedRevision, expected_revision: expectedRevision }),
    ...(expectedVersion === undefined ? {} : { expectedVersion, expected_version: expectedVersion }),
    ...(expectedHash === undefined ? {} : { expectedHash, expected_hash: expectedHash }),
  });
}

function parseIntegerFlag(value, flag) {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) throw new CliError('CLI_INVALID_PRECONDITION_FLAG', `${flag} must be an integer.`, { flag, value });
  return Number(value);
}

function reconcilePrecondition(inputValue, flagValue, name) {
  if (inputValue !== undefined && flagValue !== undefined && inputValue !== flagValue) {
    throw new CliError('CLI_PRECONDITION_CONFLICT', `${name} differs between JSON input and CLI flag.`, {
      name,
      input: inputValue,
      flag: flagValue,
    });
  }
  return inputValue ?? flagValue;
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined);
}

function assertVerifiedReceipt(commandName, receipt) {
  const passed = receiptPassState(receipt);
  if (passed === null) {
    throw new CliError(
      'CLI_UNVERIFIED_RECEIPT',
      `${commandName} did not return an explicit pass/fail receipt.`,
      { command: commandName, receipt: toJsonValue(receipt) },
      1,
    );
  }
  if (!passed) {
    const code = commandName === 'run-fixtures'
      ? 'TCIS_FIXTURES_FAILED'
      : commandName === 'validate'
        ? 'TCIS_VALIDATION_FAILED'
        : 'TCIS_DEMO_FAILED';
    throw new CliError(code, `${commandName} reported failure.`, { command: commandName, receipt: toJsonValue(receipt) }, 1);
  }
}

function receiptPassState(receipt) {
  if (typeof receipt === 'boolean') return receipt;
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return null;
  if (typeof receipt.ok === 'boolean') return receipt.ok;
  if (typeof receipt.valid === 'boolean') return receipt.valid;
  if (typeof receipt.passed === 'boolean') return receipt.passed;
  if (typeof receipt.failed === 'number') return receipt.failed === 0;
  if (typeof receipt.failure_count === 'number') return receipt.failure_count === 0;
  if (typeof receipt.status === 'string') {
    const status = receipt.status.toUpperCase();
    if (['PASS', 'PASSED', 'SUCCESS', 'COMPLETE', 'COMPLETED'].includes(status)) return true;
    if (['FAIL', 'FAILED', 'ERROR', 'BLOCKED', 'INCOMPLETE'].includes(status)) return false;
  }
  if (receipt.summary && typeof receipt.summary === 'object') return receiptPassState(receipt.summary);
  if (Array.isArray(receipt.checks) && receipt.checks.length > 0) {
    const states = receipt.checks.map(receiptPassState);
    return states.every((state) => state === true) ? true : states.some((state) => state === false) ? false : null;
  }
  return null;
}

function assertProjectPath(candidate, projectDir, key) {
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(candidate)) {
    throw new CliError('CLI_REMOTE_PATH_FORBIDDEN', `${key} must be a local project path.`, { key, path: candidate });
  }
  const normalized = candidate.replaceAll('\\', '/');
  const segments = normalized.split('/');
  if (path.win32.isAbsolute(candidate)
    || path.posix.isAbsolute(candidate)
    || segments.some((segment) => segment === '' || segment === '.' || segment === '..')
    || candidate.includes('\0')) {
    throw new CliError('CLI_PATH_ESCAPE', `${key} must be a contained project-relative path.`, { key, path: candidate });
  }
  const resolved = path.resolve(projectDir, candidate);
  const relative = path.relative(projectDir, resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new CliError('CLI_PATH_ESCAPE', `${key} escapes the project directory.`, { key, path: candidate, projectDir });
  }
}

async function importFirstExisting(candidates, packageRoot, peer) {
  for (const candidate of candidates) {
    const absolutePath = path.resolve(packageRoot, 'src', candidate);
    try {
      await access(absolutePath);
    } catch {
      continue;
    }
    try {
      return await import(pathToFileURL(absolutePath).href);
    } catch (error) {
      throw new CliError('CLI_PEER_IMPORT_FAILED', `Failed to import ${peer} peer module.`, { peer, path: absolutePath, cause: error.code ?? error.message }, 1, { cause: error });
    }
  }
  return null;
}

function findStoreClass(storeModule) {
  if (!storeModule) return null;
  return storeModule.ProjectStore ?? storeModule.Store ?? (typeof storeModule.default === 'function' ? storeModule.default : null);
}

function findNamedExport(peerModule, names) {
  if (!peerModule) return null;
  for (const name of names) {
    if (typeof peerModule[name] === 'function') return peerModule[name].bind(peerModule);
  }
  return null;
}

function findMethod(target, names) {
  if (!target) return null;
  for (const name of names) {
    if (typeof target[name] === 'function') return target[name].bind(target);
  }
  return null;
}

function findFunction(modules, containerNames, commandName) {
  const camelName = commandName.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
  for (const peerModule of modules) {
    if (!peerModule) continue;
    for (const containerName of containerNames) {
      const container = peerModule[containerName];
      if (!container) continue;
      const handler = container[commandName] ?? container[camelName];
      if (typeof handler === 'function') return handler.bind(container);
    }
  }
  return null;
}

function requirePeer(peerModule, peer, commandName) {
  if (peerModule) return peerModule;
  throw new CliError(
    'CLI_PEER_MODULE_UNAVAILABLE',
    `The ${peer} peer module required by ${commandName} is not present.`,
    { peer, command: commandName, candidates: PEER_CANDIDATES[peer] ?? [] },
    1,
  );
}

function peerInterfaceError(commandName, peer, modules) {
  return new CliError(
    'CLI_PEER_INTERFACE_MISMATCH',
    `No supported ${peer} interface was found for ${commandName}.`,
    {
      peer,
      command: commandName,
      loaded: Object.fromEntries(Object.entries(modules).map(([name, value]) => [name, Boolean(value)])),
    },
    1,
  );
}

function requiredPeerFor(commandName) {
  if (WORKFLOW_FUNCTIONS[commandName]) return 'workflow';
  if (STORE_METHODS[commandName]) return 'store';
  if (FIXTURE_FUNCTIONS[commandName]) return 'fixtures';
  return 'Runtime';
}

async function executeRuntime(runtime, commandName, context) {
  if (runtime && typeof runtime.execute === 'function') return runtime.execute(commandName, context);
  const camelName = commandName.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
  const handler = runtime?.[commandName] ?? runtime?.[camelName];
  if (typeof handler === 'function') return handler.call(runtime, context);
  throw new CliError('CLI_RUNTIME_INTERFACE_MISMATCH', 'Runtime must expose execute(command, context) or a command handler.', { command: commandName }, 1);
}

function errorExitCode(error) {
  if (Number.isInteger(error?.exitCode) && error.exitCode > 0 && error.exitCode <= 255) return error.exitCode;
  return 1;
}

function toJsonValue(value, seen = new WeakSet()) {
  if (value === undefined) return null;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function' || typeof value === 'symbol') return String(value);
  if (Buffer.isBuffer(value)) return value.toString('base64');
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return failureEnvelope(value, null).error;
  if (typeof value === 'object') {
    if (seen.has(value)) throw new CliError('CLI_NON_SERIALIZABLE_RESULT', 'Runtime result contains a circular reference.', {}, 1);
    seen.add(value);
    const converted = Array.isArray(value)
      ? value.map((child) => toJsonValue(child, seen))
      : Object.fromEntries(Object.entries(value).map(([key, child]) => [key, toJsonValue(child, seen)]));
    seen.delete(value);
    return converted;
  }
  return String(value);
}

function sortJsonValue(value) {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortJsonValue(child)]),
    );
  }
  return value;
}
