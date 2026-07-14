import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ARTIFACT_DEFINITIONS, STAGE_ARTIFACT, STAGES } from '../src/tcis/contracts.mjs';
import { routeCapabilities } from '../src/tcis/router.mjs';
import { ProjectStore } from '../src/tcis/store.mjs';
import { sha256 } from '../src/tcis/utils.mjs';
import { runDemo } from '../src/tcis/fixture-runner.mjs';

const scenarios = JSON.parse(await readFile(new URL('../fixtures/scenarios/synthetic-projects.json', import.meta.url), 'utf8')).scenarios;

test('nine heterogeneous projects recover from disk and reach the correct professional route or STOP', async (context) => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'tcis-e2e-'));
  context.after(() => rm(workspace, { recursive: true, force: true }));

  for (const [scenarioIndex, scenario] of scenarios.entries()) {
    const root = path.join(workspace, scenario.id);
    const clock = () => new Date(`2026-07-11T00:00:${String(scenarioIndex).padStart(2, '0')}.000Z`);
    const writer = new ProjectStore({ clock });
    await writer.createProject(root, {
      project_id: scenario.id,
      title: scenario.title,
      scope_mode: scenario.scope_mode,
      production_mode: scenario.production_mode,
      current_stage: scenario.start_stage,
    });

    const recovered = await new ProjectStore({ clock }).loadSnapshot(root);
    assert.equal(recovered.project.project_id, scenario.id);
    assert.equal(recovered.project.scope_mode, scenario.scope_mode);
    assert.equal(recovered.project.production_mode, scenario.production_mode);

    const artifacts = lockedPrerequisites(recovered.project, scenario.start_stage);
    const route = routeCapabilities({ project: recovered.project, artifacts });
    assert.equal(route.owner_capability, scenario.expected_primary_capability, scenario.id);
    assert.equal(route.disposition, scenario.expected_disposition, scenario.id);
    assert.equal(route.scope_branch.platform, expectedPlatform(scenario.platform_action), scenario.id);
    if (scenario.expected_hard_block) {
      assert.ok(route.hard_blocks.some((block) => block.code === scenario.expected_hard_block), scenario.id);
    } else {
      assert.deepEqual(route.hard_blocks, [], scenario.id);
    }
    for (const forbidden of scenario.expected_forbidden_primary_capabilities ?? []) {
      assert.notEqual(route.owner_capability, forbidden, `${scenario.id}: ${forbidden}`);
    }
    assert.ok(scenario.proves.length > 0, scenario.id);
    assert.ok(scenario.does_not_prove.length > 0, scenario.id);
  }
});

test('CLI synthetic demo peer executes all nine bounded scenarios', () => {
  const receipt = runDemo();
  assert.equal(receipt.status, 'PASS');
  assert.equal(receipt.passed, true);
  assert.deepEqual(receipt.summary, { scenario_count: 9, passed: 9, failed: 0 });
  assert.equal(receipt.commercialProductionReadiness, 'NOT_PROVEN');
  assert.equal(receipt.realWorldValidation, 'NOT_RUN');
});

function lockedPrerequisites(project, startStage) {
  const startIndex = STAGES.indexOf(startStage);
  return STAGES.slice(0, startIndex).map((stage, index) => {
    const type = STAGE_ARTIFACT[stage];
    const definition = ARTIFACT_DEFINITIONS[type];
    return {
      schema_version: '1.0.0',
      project_id: project.project_id,
      artifact_id: `ART-${String(index).padStart(2, '0')}`,
      type,
      stage,
      status: 'LOCKED',
      version: 1,
      owner_capability: definition.owner_capability,
      decision_bearing: true,
      input_artifact_ids: [],
      path: `artifacts/${String(index).padStart(2, '0')}.md`,
      content_hash: sha256(`${project.project_id}:${stage}`),
      previous_version_id: null,
      created_at: project.created_at,
      updated_at: project.updated_at,
    };
  });
}

function expectedPlatform(action) {
  if (action === 'TEST_NEW_PLATFORM') return 'CREATE';
  if (action === 'INHERIT_EXISTING_PLATFORM') return 'INHERIT';
  return 'NOT_APPLICABLE';
}
