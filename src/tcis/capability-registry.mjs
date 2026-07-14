import { run } from '../../tools/generate-agent-configs.mjs';

export async function validateCapabilityRegistry() {
  try {
    const result = await run('check');
    return {
      kind: 'tcis.capability-validation.v1',
      passed: result.capabilityCount === 30 && result.agentCount === 29 && result.artifactCount > 0,
      capability_count: result.capabilityCount,
      specialist_agent_count: result.agentCount,
      generated_artifact_count: result.artifactCount,
      mode: result.mode,
    };
  } catch (error) {
    return {
      kind: 'tcis.capability-validation.v1',
      passed: false,
      error: { name: error.name, message: error.message, code: error.code ?? null },
    };
  }
}
