import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CliError, main, parseCliArgs, runCli, stableJson } from '../src/cli.mjs';
import { ProjectStore } from '../src/tcis/store.mjs';

const root = path.resolve(import.meta.dirname, '..');
const bin = path.join(root, 'bin', 'tcis.mjs');
const requiredCommands = [
  'init',
  'status',
  'next',
  'propose',
  'feedback',
  'confirm-lock',
  'reopen',
  'register-claim',
  'register-right',
  'request-attempt',
  'inspect-attempt',
  'select-attempt',
  'validate',
  'run-fixtures',
  'demo',
];

test('bin help is stable JSON and lists every required command', () => {
  const execution = spawnSync(process.execPath, [bin, '--help'], { cwd: root, encoding: 'utf8' });
  assert.equal(execution.status, 0, execution.stderr);
  assert.equal(execution.stderr, '');
  const receipt = JSON.parse(execution.stdout);
  assert.equal(receipt.ok, true);
  assert.deepEqual(receipt.result.commands.map(({ name }) => name), requiredCommands);
  assert.equal(execution.stdout, `${stableJson(receipt)}\n`);
});

test('command parser accepts canonical flags, aliases and one project positional', () => {
  assert.deepEqual(parseCliArgs(['status', 'project-a']), {
    kind: 'command',
    command: 'status',
    flags: { project: 'project-a' },
  });
  assert.deepEqual(parseCliArgs(['propose', '--root=project-a', '--json-file', 'packet.json']), {
    kind: 'command',
    command: 'propose',
    flags: { project: 'project-a', input: 'packet.json' },
  });
  assert.deepEqual(parseCliArgs(['help', 'confirm-lock']), { kind: 'help', command: 'confirm-lock' });
  assert.throws(() => parseCliArgs(['status', '--unknown', 'x']), { code: 'CLI_UNKNOWN_FLAG' });
  assert.throws(() => parseCliArgs(['feedback', '--project', 'x']), { code: 'CLI_INPUT_REQUIRED' });
});

test('every declared command reaches a smoke handler', async (context) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'tcis-cli-smoke-'));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const projectDir = path.join(temporaryRoot, 'project');
  const inputPath = path.join(temporaryRoot, 'input.json');
  await mkdir(projectDir);
  await writeFile(inputPath, JSON.stringify({ artifact_id: 'ART-1' }), 'utf8');
  const seen = [];
  const runtime = {
    async execute(command) {
      seen.push(command);
      if (command === 'validate') return { passed: true };
      if (command === 'run-fixtures') return { failed: 0, total: 73 };
      if (command === 'demo') return { ok: true, scenario: 'synthetic' };
      return { command };
    },
  };

  for (const command of requiredCommands) {
    const args = [command];
    if (!['validate', 'run-fixtures', 'demo'].includes(command)) args.push('--project', projectDir);
    if (!['status', 'next', 'validate', 'run-fixtures', 'demo'].includes(command)) args.push('--input', inputPath);
    const receipt = await runCli(args, { runtime, cwd: temporaryRoot });
    assert.equal(receipt.command, command);
  }
  assert.deepEqual(seen, requiredCommands);
});

test('temp project init and status delegate parsed JSON without embedding store logic', async (context) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'tcis-cli-'));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const projectDir = path.join(temporaryRoot, 'project');
  const inputPath = path.join(temporaryRoot, 'init.json');
  const input = {
    project_id: 'CLI-001',
    title: 'CLI fixture',
    scope_mode: 'single_tvc',
    production_mode: 'live_action',
  };
  await writeFile(inputPath, JSON.stringify(input), 'utf8');

  const runtime = {
    async execute(command, request) {
      if (command === 'init') {
        await mkdir(request.projectDir, { recursive: true });
        await writeFile(path.join(request.projectDir, 'adapter-receipt.json'), JSON.stringify(request.input), 'utf8');
        return { initialized: true, project_id: request.input.project_id };
      }
      if (command === 'status') {
        const stored = JSON.parse(await readFile(path.join(request.projectDir, 'adapter-receipt.json'), 'utf8'));
        return { project_id: stored.project_id, status: 'ACTIVE' };
      }
      assert.fail(`unexpected command: ${command}`);
    },
  };

  const initialized = await runCli(['init', '--project', projectDir, '--input', inputPath], { runtime, cwd: temporaryRoot });
  assert.deepEqual(initialized.result, { initialized: true, project_id: 'CLI-001' });
  const status = await runCli(['status', '--project', projectDir], { runtime, cwd: temporaryRoot });
  assert.deepEqual(status.result, { project_id: 'CLI-001', status: 'ACTIVE' });
});

test('real filesystem CLI E2E keeps selection revised until a separate confirmation lock', async (context) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'tcis-cli-e2e-'));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const projectDir = path.join(temporaryRoot, 'project');
  let sequence = 0;
  const writeInput = async (value) => {
    const inputPath = path.join(temporaryRoot, `input-${sequence += 1}.json`);
    await writeFile(inputPath, JSON.stringify(value), 'utf8');
    return inputPath;
  };

  const initPath = await writeInput({
    project_id: 'PRJ-CLI-E2E',
    title: 'CLI real integration',
    scope_mode: 'single_tvc',
    production_mode: 'live_action',
  });
  const initialized = await runCli(['init', '--project', projectDir, '--input', initPath], { cwd: temporaryRoot });
  assert.equal(initialized.result.project.revision, 0);
  const initialStatus = await runCli(['status', '--project', projectDir]);
  assert.equal(initialStatus.result.project.project_id, 'PRJ-CLI-E2E');

  const store = new ProjectStore();
  const seeded = await store.createArtifact(projectDir, {
    artifact_id: 'ART-BRIEF-V1',
    type: 'client_brief',
    status: 'INTERNAL_REVIEW',
    path: 'artifacts/brief-v1.md',
    content: '# Client brief v1\n',
  }, 0);
  const proposedArtifact = seeded.artifacts.find((artifact) => artifact.artifact_id === 'ART-BRIEF-V1');
  const proposal = {
    decision_owner: 'client_brand_lead',
    decision_question: 'Which brief direction should advance?',
    options: [{ id: 'A', proposition: 'Product-led direction', strengths: ['Clear role'], risks: ['Needs sharper proof'] }],
    recommendation: { option_id: 'A', rationale: 'It keeps product causality explicit.' },
    known_facts: [],
    assumptions: [],
    unknowns: [],
    hard_blocks: [],
  };
  const proposalPath = await writeInput({ artifact_id: proposedArtifact.artifact_id, proposal });
  const proposed = await runCli([
    'propose', '--project', projectDir, '--input', proposalPath,
    '--expected-revision', '1',
    '--expected-version', String(proposedArtifact.version),
    '--expected-hash', proposedArtifact.content_hash,
  ]);
  assert.equal(proposed.result.packet.interaction_phase, 'PROPOSAL');
  assert.equal(proposed.result.artifact.status, 'PROPOSED');

  const silentFeedbackPath = await writeInput({ packet: proposed.result.packet, feedback: [] });
  await assert.rejects(runCli([
    'feedback', '--project', projectDir, '--input', silentFeedbackPath,
    '--expected-revision', '2', '--expected-version', '1', '--expected-hash', proposedArtifact.content_hash,
  ]), { code: 'CLI_HUMAN_FEEDBACK_REQUIRED' });

  const conflictPath = await writeInput({
    packet: proposed.result.packet,
    feedback: [
      {
        feedback_id: 'FB-CONFLICT-SELECT', packet_id: proposed.result.packet.packet_id, action: 'SELECT',
        decision_owner: 'client_brand_lead', selected_option_id: 'A', comment: 'Advance option A.',
      },
      {
        feedback_id: 'FB-CONFLICT-STOP', packet_id: proposed.result.packet.packet_id, action: 'STOP',
        decision_owner: 'client_brand_lead', comment: 'Do not advance any option.',
      },
    ],
  });
  const conflict = await runCli([
    'feedback', '--project', projectDir, '--input', conflictPath,
    '--expected-revision', '2', '--expected-version', '1', '--expected-hash', proposedArtifact.content_hash,
  ]);
  assert.equal(conflict.result.workflow.state, 'CONFLICT');
  assert.equal(conflict.result.decision_record.outcome, 'CONFLICT');
  const statusAfterConflict = await runCli(['status', '--project', projectDir]);
  assert.equal(statusAfterConflict.result.project.revision, 3);
  assert.equal(statusAfterConflict.result.decisions.at(-1).outcome, 'CONFLICT');
  assert.equal(statusAfterConflict.result.decisions.at(-1).conflict.original_requirements.length, 2);
  assert.equal(statusAfterConflict.result.artifacts.find((artifact) => artifact.artifact_id === proposedArtifact.artifact_id).status, 'PROPOSED');

  const prematureLockPath = await writeInput({
    packet: proposed.result.packet,
    feedback: {
      feedback_id: 'FB-PREMATURE-LOCK',
      packet_id: proposed.result.packet.packet_id,
      action: 'LOCK',
      decision_owner: 'client_brand_lead',
      comment: 'Lock immediately.',
      selected_option_id: 'A',
      confirmed_artifact_hash: proposedArtifact.content_hash,
    },
  });
  await assert.rejects(runCli([
    'confirm-lock', '--project', projectDir, '--input', prematureLockPath,
    '--expected-revision', '3', '--expected-version', '1', '--expected-hash', proposedArtifact.content_hash,
  ]), { code: 'REVISION_CONFIRMATION_REQUIRED' });

  const selectionPath = await writeInput({
    packet: proposed.result.packet,
    feedback: {
      feedback_id: 'FB-SELECT-A',
      packet_id: proposed.result.packet.packet_id,
      action: 'SELECT',
      decision_owner: 'client_brand_lead',
      comment: 'Select A and strengthen the proof.',
      selected_option_id: 'A',
    },
    revised_artifact: {
      artifact_id: 'ART-BRIEF-V2',
      path: 'artifacts/brief-v2.md',
      content: '# Client brief v2 with strengthened proof\n',
      signoffs: [
        { type: 'CLAIMS', status: 'PENDING', reference_id: 'SIGNOFF-CLAIMS' },
        { type: 'RIGHTS', status: 'NOT_APPLICABLE', reference_id: 'SIGNOFF-RIGHTS' },
        { type: 'PRODUCTION', status: 'PENDING', reference_id: 'SIGNOFF-PRODUCTION' },
        { type: 'TECHNICAL_QC', status: 'PENDING', reference_id: 'SIGNOFF-QC' },
      ],
    },
  });
  const revised = await runCli([
    'feedback', '--project', projectDir, '--input', selectionPath,
    '--expected-revision', '3', '--expected-version', '1', '--expected-hash', proposedArtifact.content_hash,
  ]);
  assert.equal(revised.result.artifact.status, 'REVISED');
  assert.equal(revised.result.artifact.version, 2);
  assert.notEqual(revised.result.artifact.content_hash, proposedArtifact.content_hash);
  assert.equal(revised.result.workflow.requires_confirmation, true);
  const statusAfterSelection = await runCli(['status', '--project', projectDir]);
  assert.equal(statusAfterSelection.result.artifacts.find((artifact) => artifact.artifact_id === 'ART-BRIEF-V2').status, 'REVISED');
  assert.equal(statusAfterSelection.result.artifacts.some((artifact) => artifact.status === 'LOCKED'), false);

  const confirmationProposalPath = await writeInput({
    artifact_id: revised.result.artifact.artifact_id,
    proposal: {
      ...proposal,
      decision_question: 'Lock the revised client brief?',
      prior_feedback_id: 'FB-SELECT-A',
      proposed_artifact_hash: proposedArtifact.content_hash,
      signoffs: [
        { type: 'CLIENT_DECISION', status: 'APPROVED', reference_id: 'SIGNOFF-CLIENT' },
        { type: 'STRATEGY', status: 'APPROVED', reference_id: 'SIGNOFF-STRATEGY' },
        { type: 'CREATIVE', status: 'APPROVED', reference_id: 'SIGNOFF-CREATIVE' },
      ],
    },
  });
  const confirmation = await runCli([
    'propose', '--project', projectDir, '--input', confirmationProposalPath,
    '--expected-revision', '4', '--expected-version', '2', '--expected-hash', revised.result.artifact.content_hash,
  ]);
  assert.equal(confirmation.result.packet.interaction_phase, 'CONFIRMATION');
  assert.equal(confirmation.result.packet.revised_artifact_hash, revised.result.artifact.content_hash);

  const lockPath = await writeInput({
    packet: confirmation.result.packet,
    feedback: {
      feedback_id: 'FB-CONFIRM-LOCK',
      packet_id: confirmation.result.packet.packet_id,
      action: 'LOCK',
      decision_owner: 'client_brand_lead',
      comment: 'Confirmed for lock.',
      selected_option_id: 'A',
      confirmed_artifact_hash: revised.result.artifact.content_hash,
    },
  });
  const locked = await runCli([
    'confirm-lock', '--project', projectDir, '--input', lockPath,
    '--expected-revision', '5', '--expected-version', '2', '--expected-hash', revised.result.artifact.content_hash,
  ]);
  assert.equal(locked.result.workflow.artifact.status, 'LOCKED');
  assert.equal(locked.result.decision_record.outcome, 'LOCK');
  assert.equal(locked.result.project.revision, 6);
  const finalStatus = await runCli(['status', '--project', projectDir]);
  const finalArtifact = finalStatus.result.artifacts.find((artifact) => artifact.artifact_id === 'ART-BRIEF-V2');
  assert.equal(finalArtifact.status, 'LOCKED');
  assert.equal(finalArtifact.pending_lock_confirmation, false);
  assert.equal(finalArtifact.revision_required, false);
  assert.equal(finalArtifact.locked_by, 'client_brand_lead');
  assert.equal(finalArtifact.locked_content_hash, revised.result.artifact.content_hash);
  assert.ok(finalArtifact.human_feedback_ids.includes('FB-CONFIRM-LOCK'));
  assert.equal(finalStatus.result.decisions.at(-1).outcome, 'LOCK');
  assert.equal(finalStatus.result.lock_records.at(-1).prior_feedback_id, 'FB-SELECT-A');
  assert.equal(finalStatus.result.lock_records.at(-1).confirmation_feedback_id, 'FB-CONFIRM-LOCK');
});

test('selection feedback and lock confirmation remain separate Runtime calls', async (context) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'tcis-cli-lock-'));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const projectDir = path.join(temporaryRoot, 'project');
  await mkdir(projectDir);
  const selectionPath = path.join(temporaryRoot, 'selection.json');
  const confirmationPath = path.join(temporaryRoot, 'confirmation.json');
  await writeFile(selectionPath, JSON.stringify({ packet_id: 'DP-1', action: 'SELECT', selected_option_id: 'A' }), 'utf8');
  await writeFile(confirmationPath, JSON.stringify({ artifact_id: 'ART-2', decision_owner: 'client_brand_lead' }), 'utf8');
  const calls = [];
  const runtime = {
    async execute(command, request) {
      calls.push({ command, input: request.input });
      if (command === 'feedback') return { artifact_id: 'ART-2', status: 'REVISED', locked: false };
      if (command === 'confirm-lock') return { artifact_id: 'ART-2', status: 'LOCKED', locked: true };
      assert.fail(`unexpected command: ${command}`);
    },
  };

  const revised = await runCli(['feedback', '--project', projectDir, '--input', selectionPath], { runtime });
  assert.equal(revised.result.status, 'REVISED');
  assert.equal(revised.result.locked, false);
  assert.deepEqual(calls.map(({ command }) => command), ['feedback']);

  const locked = await runCli(['confirm-lock', '--project', projectDir, '--input', confirmationPath], { runtime });
  assert.equal(locked.result.status, 'LOCKED');
  assert.deepEqual(calls.map(({ command }) => command), ['feedback', 'confirm-lock']);
});

test('run-fixtures executes the real peer runner and returns its 73-fixture receipt', async () => {
  const receipt = await runCli(['run-fixtures'], { cwd: root });
  assert.equal(receipt.ok, true);
  assert.equal(receipt.command, 'run-fixtures');
  assert.equal(receipt.result.status, 'PASS');
  assert.equal(receipt.result.summary.fixtureCount, 73);
  assert.equal(receipt.result.summary.passed, 73);
  assert.equal(receipt.result.summary.failed, 0);
  assert.equal(receipt.result.summary.skipped, 0);
  assert.equal(receipt.result.summary.unmapped, 0);
  assert.match(receipt.result.receiptDigest, /^[0-9a-f]{64}$/);
});

test('write preconditions are preserved in input and propagated explicitly', async (context) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'tcis-cli-cas-'));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const projectDir = path.join(temporaryRoot, 'project');
  const inputPath = path.join(temporaryRoot, 'feedback.json');
  await mkdir(projectDir);
  const input = {
    packet_id: 'DP-1',
    expected_revision: 7,
    expected_version: 3,
    expected_hash: 'a'.repeat(64),
  };
  await writeFile(inputPath, JSON.stringify(input), 'utf8');
  let observed;
  const runtime = { execute: async (_command, request) => {
    observed = request;
    return { status: 'REVISED' };
  } };

  await runCli([
    'feedback',
    '--project', projectDir,
    '--input', inputPath,
    '--expected-revision', '7',
    '--expected-version=3',
    '--expected-hash', 'a'.repeat(64),
  ], { runtime });
  assert.deepEqual(observed.input, input);
  assert.deepEqual(observed.preconditions, {
    expectedRevision: 7,
    expected_revision: 7,
    expectedVersion: 3,
    expected_version: 3,
    expectedHash: 'a'.repeat(64),
    expected_hash: 'a'.repeat(64),
  });
  await assert.rejects(
    runCli(['feedback', '--project', projectDir, '--input', inputPath, '--expected-revision', '8'], { runtime }),
    { code: 'CLI_PRECONDITION_CONFLICT' },
  );
});

test('unknown commands and path escapes fail with typed CLI errors', async (context) => {
  assert.throws(() => parseCliArgs(['not-a-command']), (error) => error instanceof CliError && error.code === 'CLI_UNKNOWN_COMMAND');

  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'tcis-cli-path-'));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const cwd = path.join(temporaryRoot, 'cwd');
  await mkdir(cwd);
  const inputPath = path.join(temporaryRoot, 'input.json');
  await writeFile(inputPath, '{}', 'utf8');
  await assert.rejects(
    runCli(['init', '--project', '../escaped', '--input', inputPath], { cwd, runtime: { execute: assert.fail } }),
    (error) => error instanceof CliError && error.code === 'CLI_PATH_ESCAPE',
  );

  const projectDir = path.join(temporaryRoot, 'project');
  await mkdir(projectDir);
  await writeFile(inputPath, JSON.stringify({ output_path: '../outside.png' }), 'utf8');
  await assert.rejects(
    runCli(['request-attempt', '--project', projectDir, '--input', inputPath], { runtime: { execute: assert.fail } }),
    (error) => error instanceof CliError && error.code === 'CLI_PATH_ESCAPE',
  );

  await assert.rejects(
    runCli(['status', '--project', path.parse(projectDir).root], { runtime: { execute: assert.fail } }),
    (error) => error instanceof CliError && error.code === 'CLI_UNSAFE_PROJECT_ROOT',
  );
});

test('malformed JSON, primitive input, unsafe IDs and invalid CAS values fail before Runtime dispatch', async (context) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'tcis-cli-input-'));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const projectDir = path.join(temporaryRoot, 'project');
  const inputPath = path.join(temporaryRoot, 'input.json');
  await mkdir(projectDir);
  const runtime = { execute: () => assert.fail('Runtime must not receive malformed input') };

  await writeFile(inputPath, '{', 'utf8');
  await assert.rejects(runCli(['feedback', '--project', projectDir, '--input', inputPath], { runtime }), { code: 'CLI_INVALID_JSON' });

  await writeFile(inputPath, '[]', 'utf8');
  await assert.rejects(runCli(['feedback', '--project', projectDir, '--input', inputPath], { runtime }), { code: 'CLI_INPUT_OBJECT_REQUIRED' });

  await writeFile(inputPath, JSON.stringify({ artifact_id: '../outside' }), 'utf8');
  await assert.rejects(runCli(['feedback', '--project', projectDir, '--input', inputPath], { runtime }), { code: 'CLI_UNSAFE_ID' });

  await writeFile(inputPath, JSON.stringify({ artifact_id: 'ART-1', expected_revision: '7' }), 'utf8');
  await assert.rejects(runCli(['feedback', '--project', projectDir, '--input', inputPath], { runtime }), { code: 'CLI_INVALID_EXPECTED_REVISION' });
});

test('validate, fixture and demo commands reject failed or unverified receipts', async () => {
  await assert.rejects(
    runCli(['validate'], { runtime: { execute: async () => ({ passed: false }) } }),
    { code: 'TCIS_VALIDATION_FAILED' },
  );
  await assert.rejects(
    runCli(['run-fixtures'], { runtime: { execute: async () => ({ failed: 1, total: 73 }) } }),
    { code: 'TCIS_FIXTURES_FAILED' },
  );
  await assert.rejects(
    runCli(['demo'], { runtime: { execute: async () => ({ scenario: 'synthetic' }) } }),
    { code: 'CLI_UNVERIFIED_RECEIPT' },
  );
});

test('main writes typed failures to stderr and returns a non-zero exit code', async () => {
  let stdout = '';
  let stderr = '';
  const exitCode = await main(['not-a-command'], {
    stdout: { write: (value) => { stdout += value; } },
    stderr: { write: (value) => { stderr += value; } },
  });
  assert.equal(exitCode, 2);
  assert.equal(stdout, '');
  const receipt = JSON.parse(stderr);
  assert.equal(receipt.ok, false);
  assert.equal(receipt.error.type, 'CliError');
  assert.equal(receipt.error.code, 'CLI_UNKNOWN_COMMAND');
  assert.equal(stderr, `${stableJson(receipt)}\n`);
});
