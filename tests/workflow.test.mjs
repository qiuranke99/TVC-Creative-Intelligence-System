import test from 'node:test';
import assert from 'node:assert/strict';
import { ARTIFACT_DEFINITIONS, SCHEMA_VERSION } from '../src/tcis/contracts.mjs';
import { recommendNextMove, routeCapabilities } from '../src/tcis/router.mjs';
import { sha256 } from '../src/tcis/utils.mjs';
import {
  applyHumanFeedback,
  confirmLock,
  createDecisionPacket,
  planReopen,
} from '../src/tcis/workflow.mjs';

const NOW = '2026-07-11T00:00:00.000Z';

function makeProject(overrides = {}) {
  return {
    schema_version: SCHEMA_VERSION,
    project_id: 'PRJ-WORKFLOW',
    title: 'Workflow fixture',
    scope_mode: 'single_tvc',
    production_mode: 'live_action',
    current_stage: 'P4_CREATIVE_ROUTES',
    status: 'ACTIVE',
    revision: 0,
    active_artifact_id: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function makeArtifact(type = 'creative_routes', status = 'PROPOSED', overrides = {}) {
  const definition = ARTIFACT_DEFINITIONS[type];
  return {
    schema_version: SCHEMA_VERSION,
    project_id: 'PRJ-WORKFLOW',
    artifact_id: `ART-${type}`,
    type,
    stage: definition.stage,
    status,
    version: 1,
    owner_capability: definition.owner_capability,
    decision_bearing: true,
    input_artifact_ids: [],
    path: `project/${type}.json`,
    content_hash: sha256(`${type}-v1`),
    created_at: NOW,
    updated_at: NOW,
    previous_version_id: null,
    ...overrides,
  };
}

function locked(type, overrides = {}) {
  return makeArtifact(type, 'LOCKED', overrides);
}

function makeProposal(overrides = {}) {
  return {
    decision_owner: 'client_brand_lead',
    decision_question: 'Which route should advance?',
    options: [
      { id: 'A', proposition: 'Route A', strengths: ['Clear product role'], risks: ['Familiar'] },
      { id: 'B', proposition: 'Route B', strengths: ['Distinctive'], risks: ['Casting sensitivity'] },
    ],
    recommendation: { option_id: 'B', rationale: 'It best preserves brand causality.' },
    known_facts: [],
    assumptions: [],
    unknowns: [],
    hard_blocks: [],
    ...overrides,
  };
}

function makePacket(artifact = makeArtifact(), proposal = makeProposal()) {
  return createDecisionPacket(artifact, proposal);
}

function makeFeedback(packet, action, overrides = {}) {
  return {
    schema_version: SCHEMA_VERSION,
    project_id: packet.project_id,
    feedback_id: `FB-${action}`,
    packet_id: packet.packet_id,
    action,
    decision_owner: packet.decision_owner,
    comment: `${action} feedback`,
    selected_option_id: ['SELECT', 'LOCK'].includes(action) ? 'B' : null,
    ...overrides,
  };
}

test('one-off route uses the agency creative pair without a universal platform or early production craft', () => {
  const result = routeCapabilities({
    project: makeProject(),
    artifacts: [],
    claims: [],
    rights: [],
    openBlocks: [],
  });

  assert.equal(result.status, 'ROUTED');
  assert.equal(result.scope_branch.platform, 'NOT_APPLICABLE');
  assert.deepEqual(result.required_artifact_types, ['creative_routes']);
  assert.ok(result.capabilities.includes('creative_director'));
  assert.ok(result.capabilities.includes('copywriter'));
  assert.ok(result.capabilities.includes('agency_art_director'));
  for (const forbidden of ['director_of_photography', 'production_designer', 'editor']) {
    assert.equal(result.capabilities.includes(forbidden), false);
  }
});

test('campaign route enables a separate conditional platform and media asset strategy', () => {
  const result = routeCapabilities({
    project: makeProject({ scope_mode: 'campaign_system', current_stage: 'P5_CORE_CREATIVE_DECISION' }),
    artifacts: [],
    claims: [],
    rights: [],
    openBlocks: [],
  });

  assert.equal(result.scope_branch.platform, 'CREATE');
  assert.deepEqual(result.required_artifact_types, ['core_creative_concept', 'campaign_platform']);
  assert.ok(result.capabilities.includes('brand_strategist'));
  assert.ok(result.capabilities.includes('media_asset_strategist'));
});

test('campaign expression cannot bypass an unlocked campaign platform', () => {
  const result = routeCapabilities({
    project: makeProject({ scope_mode: 'campaign_system', current_stage: 'P6_TVC_EXPRESSION' }),
    artifacts: [locked('core_creative_concept')],
    claims: [],
    rights: [],
    openBlocks: [],
  });

  assert.equal(result.effective_stage, 'P5_CORE_CREATIVE_DECISION');
  assert.equal(result.next_artifact_type, 'campaign_platform');
  assert.ok(result.professional_timing.corrections.some((entry) => entry.code === 'CAMPAIGN_PLATFORM_BEFORE_EXPRESSION'));
});

test('social-native and version-system scopes route channel work without inventing a platform', () => {
  const cases = [
    ['social_native', 'native_premise'],
    ['version_system', 'version_matrix'],
  ];

  for (const [scopeMode, requirement] of cases) {
    const result = routeCapabilities({
      project: makeProject({ scope_mode: scopeMode, current_stage: 'P5_CORE_CREATIVE_DECISION' }),
      artifacts: [],
      claims: [],
      rights: [],
      openBlocks: [],
    });
    assert.equal(result.scope_branch.platform, 'NOT_APPLICABLE');
    assert.ok(result.capabilities.includes('media_asset_strategist'));
    assert.ok(result.scope_branch.requirements.includes(requirement));
  }
});

test('live action craft enters after award while animation editor and visual development enter early', () => {
  const earlyLive = routeCapabilities({
    project: makeProject({ current_stage: 'P7_SCRIPT_AGENCY_BOARD' }),
    artifacts: [], claims: [], rights: [], openBlocks: [],
  });
  for (const forbidden of ['director_of_photography', 'production_designer', 'editor']) {
    assert.equal(earlyLive.capabilities.includes(forbidden), false);
  }

  const awarded = [locked('script_agency_board'), locked('production_pitch'), locked('director_treatment_award')];
  const lateLive = routeCapabilities({
    project: makeProject({ current_stage: 'P11_PREPRODUCTION_PPM' }),
    artifacts: awarded, claims: [], rights: [], openBlocks: [],
  });
  assert.ok(lateLive.capabilities.includes('director_of_photography'));
  assert.ok(lateLive.capabilities.includes('production_designer'));

  const animation = routeCapabilities({
    project: makeProject({ production_mode: 'animation', current_stage: 'P6_TVC_EXPRESSION' }),
    artifacts: [], claims: [], rights: [], openBlocks: [],
  });
  assert.ok(animation.capabilities.includes('animation_director'));
  assert.ok(animation.capabilities.includes('visual_development_lead'));
  assert.ok(animation.capabilities.includes('editor'));
  assert.equal(animation.capabilities.includes('director_of_photography'), false);
});

test('P11 preserves commercial-director creative authority and production-company production authority', () => {
  const result = routeCapabilities({
    project: makeProject({ current_stage: 'P11_PREPRODUCTION_PPM' }),
    artifacts: [locked('script_agency_board'), locked('production_pitch'), locked('director_treatment_award')],
    claims: [], rights: [], openBlocks: [],
  });
  const assignments = new Map(result.assignments.map((entry) => [entry.capability_id, entry]));

  assert.equal(result.owner_capability, 'production_company_producer');
  assert.equal(assignments.get('commercial_director')?.responsibility, 'creative_authority');
  assert.equal(assignments.get('production_company_producer')?.responsibility, 'production_authority');
  assert.equal(assignments.get('agency_producer')?.responsibility, 'contributor');
  assert.equal(assignments.get('creative_director')?.responsibility, 'contributor');
});

test('P11 AI-native operator enters only after generation contracts and rights are locked', () => {
  const rights = [{ right_id: 'RIGHT-AI-P11', clearance_status: 'CLEARED', usage: ['paid-media'] }];
  const awarded = [
    locked('core_creative_concept'),
    locked('script_agency_board'),
    locked('production_pitch'),
    locked('director_treatment_award'),
  ];
  const p10 = routeCapabilities({
    project: makeProject({ production_mode: 'ai_native', current_stage: 'P10_DIRECTOR_TREATMENT_AWARD' }),
    artifacts: [...awarded, { type: 'asset_canon', status: 'LOCKED' }, { type: 'shot_contract', status: 'LOCKED' }],
    claims: [], rights, openBlocks: [],
  });
  const unlockedP11 = routeCapabilities({
    project: makeProject({ production_mode: 'ai_native', current_stage: 'P11_PREPRODUCTION_PPM' }),
    artifacts: awarded,
    claims: [], rights, openBlocks: [],
  });
  const readyP11 = routeCapabilities({
    project: makeProject({ production_mode: 'ai_native', current_stage: 'P11_PREPRODUCTION_PPM' }),
    artifacts: [...awarded, { type: 'asset_canon', status: 'LOCKED' }, { type: 'shot_contract', status: 'LOCKED' }],
    claims: [], rights, openBlocks: [],
  });

  assert.equal(p10.capabilities.includes('ai_generation_supervisor'), false);
  assert.equal(unlockedP11.status, 'ROUTED');
  assert.equal(unlockedP11.capabilities.includes('ai_generation_supervisor'), false);
  assert.equal(readyP11.status, 'ROUTED');
  assert.equal(
    readyP11.assignments.find((entry) => entry.capability_id === 'ai_generation_supervisor')?.responsibility,
    'operator',
  );
});

test('P14 keeps agency creative and production roles active through final release', () => {
  const result = routeCapabilities({
    project: makeProject({ current_stage: 'P14_FINAL_RELEASE' }),
    artifacts: [
      locked('script_agency_board'),
      locked('production_pitch'),
      locked('director_treatment_award'),
      locked('ppm_production_plan'),
      locked('production_selects'),
      locked('offline_lock'),
    ],
    claims: [], rights: [], openBlocks: [],
  });
  const assignments = new Map(result.assignments.map((entry) => [entry.capability_id, entry]));

  assert.equal(result.effective_stage, 'P14_FINAL_RELEASE');
  assert.equal(assignments.get('creative_director')?.responsibility, 'contributor');
  assert.equal(assignments.get('agency_producer')?.responsibility, 'contributor');
  assert.equal(assignments.get('creative_director')?.conditional, false);
  assert.equal(assignments.get('agency_producer')?.conditional, false);
});

test('AI-native production requires locked intent, canons, rights, and routes actual media selection', () => {
  const artifacts = [
    locked('core_creative_concept'),
    locked('script_agency_board'),
    locked('production_pitch'),
    locked('director_treatment_award'),
    locked('ppm_production_plan'),
    { type: 'asset_canon', status: 'LOCKED' },
    { type: 'shot_contract', status: 'LOCKED' },
  ];
  const rights = [{ right_id: 'RIGHT-AI-1', clearance_status: 'CLEARED', usage: ['paid-media'] }];
  const project = makeProject({ production_mode: 'ai_native', current_stage: 'P12_PRODUCTION_SELECTS' });
  const result = routeCapabilities({ project, artifacts, claims: [], rights, openBlocks: [] });

  assert.equal(result.status, 'ROUTED');
  assert.ok(result.capabilities.includes('ai_generation_supervisor'));
  assert.ok(result.methods.includes('M-P03'));

  const next = recommendNextMove({
    project,
    artifacts,
    claims: [],
    rights,
    openBlocks: [],
    attempts: [{ attempt_id: 'ATT-1', status: 'GENERATED', output_path: 'frame.png', output_hash: 'hash' }],
  });
  assert.equal(next.action, 'INSPECT_AND_SELECT_ACTUAL_MEDIA');
  assert.equal(next.artifact_type, 'production_selects');
});

test('AI-native generation stops when canon or rights contracts are absent', () => {
  const result = routeCapabilities({
    project: makeProject({ production_mode: 'ai_native', current_stage: 'P12_PRODUCTION_SELECTS' }),
    artifacts: [
      locked('script_agency_board'),
      locked('production_pitch'),
      locked('director_treatment_award'),
      locked('ppm_production_plan'),
    ],
    claims: [],
    rights: [],
    openBlocks: [],
  });

  assert.equal(result.status, 'STOP');
  assert.ok(result.hard_blocks.some((entry) => entry.code === 'AI_PRODUCTION_CONTRACT_REQUIRED'));
  assert.equal(result.capabilities.includes('ai_generation_supervisor'), false);
});

test('director-led early participation requires an explicit fee, IP, scope, and approval exception', () => {
  const unscoped = routeCapabilities({
    project: makeProject({ production_mode: 'director_led' }),
    artifacts: [], claims: [], rights: [], openBlocks: [],
  });
  assert.equal(unscoped.status, 'STOP');
  assert.ok(unscoped.hard_blocks.some((entry) => entry.code === 'DIRECTOR_LED_EXCEPTION_REQUIRED'));
  assert.equal(unscoped.capabilities.includes('commercial_director'), false);

  const explicit = routeCapabilities({
    project: makeProject({
      production_mode: 'director_led',
      director_led_exception: {
        explicit: true,
        scope: 'paid concept partnership',
        fee_terms: 'agreed',
        ip_terms: 'agency-approved use only',
        approval_boundaries: ['client', 'agency', 'claims'],
      },
    }),
    artifacts: [], claims: [], rights: [], openBlocks: [],
  });
  assert.equal(explicit.status, 'ROUTED');
  assert.ok(explicit.capabilities.includes('commercial_director'));
  assert.equal(explicit.capabilities.includes('director_of_photography'), false);
  assert.equal(explicit.capabilities.includes('production_designer'), false);
  assert.equal(explicit.capabilities.includes('editor'), false);
});

test('director treatment is rerouted to script when the agency script is not locked', () => {
  const result = routeCapabilities({
    project: makeProject({ current_stage: 'P10_DIRECTOR_TREATMENT_AWARD' }),
    artifacts: [], claims: [], rights: [], openBlocks: [],
  });

  assert.equal(result.requested_stage, 'P10_DIRECTOR_TREATMENT_AWARD');
  assert.equal(result.effective_stage, 'P7_SCRIPT_AGENCY_BOARD');
  assert.equal(result.next_artifact_type, 'script_agency_board');
  assert.equal(result.owner_capability, 'creative_director');
  assert.equal(result.capabilities.includes('commercial_director'), false);
});

test('next-move recommendation skips consecutive locked artifacts without stalling', () => {
  const result = recommendNextMove({
    project: makeProject({ current_stage: 'P4_CREATIVE_ROUTES' }),
    artifacts: [locked('creative_routes'), locked('core_creative_concept')],
    claims: [],
    rights: [],
    openBlocks: [],
    attempts: [],
  });

  assert.equal(result.disposition, 'EXECUTE');
  assert.equal(result.action, 'CREATE_ARTIFACT');
  assert.equal(result.stage, 'P6_TVC_EXPRESSION');
  assert.equal(result.artifact_type, 'tvc_expression');
});

test('blocked claims and rights produce independent STOP conditions', () => {
  const claimStop = routeCapabilities({
    project: makeProject({ current_stage: 'P9_PRODUCTION_PITCH' }),
    artifacts: [locked('script_agency_board')],
    claims: [{
      claim_id: 'CL-1',
      evidence_status: 'LIMITED',
      clearance_status: 'BLOCKED',
    }],
    rights: [],
    openBlocks: [],
  });
  assert.equal(claimStop.status, 'STOP');
  assert.ok(claimStop.hard_blocks.some((entry) => entry.code === 'CLAIM_STOP'));

  const rightsStop = routeCapabilities({
    project: makeProject({ current_stage: 'P11_PREPRODUCTION_PPM' }),
    artifacts: [locked('script_agency_board'), locked('production_pitch'), locked('director_treatment_award')],
    claims: [],
    rights: [{ right_id: 'R-1', clearance_status: 'BLOCKED' }],
    openBlocks: [],
  });
  assert.equal(rightsStop.status, 'STOP');
  assert.ok(rightsStop.hard_blocks.some((entry) => entry.code === 'RIGHTS_STOP'));
});

test('decision packets bind the exact artifact stage, owner, hash, named owner, and escape actions', () => {
  const artifact = makeArtifact();
  const packet = makePacket(artifact);

  assert.equal(packet.stage, artifact.stage);
  assert.equal(packet.artifact_owner_capability, artifact.owner_capability);
  assert.equal(packet.artifact_content_hash, artifact.content_hash);
  assert.equal(packet.decision_owner, 'client_brand_lead');
  assert.equal(packet.project_id, artifact.project_id);
  assert.equal(packet.interaction_phase, 'PROPOSAL');
  assert.ok(packet.allowed_responses.includes('NONE'));
  assert.ok(packet.allowed_responses.includes('REOPEN'));
  assert.equal(packet.allowed_responses.includes('LOCK'), false);

  assert.throws(
    () => createDecisionPacket(artifact, makeProposal({ stage: 'P5_CORE_CREATIVE_DECISION' })),
    { code: 'PACKET_STAGE_MISMATCH' },
  );
  assert.throws(
    () => createDecisionPacket(artifact, makeProposal({ decision_owner: 'TBD' })),
    { code: 'NAMED_DECISION_OWNER_REQUIRED' },
  );
});

test('artifact owner and decision-bearing authority must match the stage contract exactly', () => {
  assert.throws(
    () => createDecisionPacket(makeArtifact('creative_routes', 'PROPOSED', { owner_capability: 'production_designer' }), makeProposal()),
    { code: 'ARTIFACT_OWNER_MISMATCH' },
  );
  assert.throws(
    () => createDecisionPacket(makeArtifact('creative_routes', 'PROPOSED', { decision_bearing: false }), makeProposal()),
    { code: 'DECISION_BEARING_ARTIFACT_REQUIRED' },
  );
});

test('campaign platform packet cannot bypass project-aware applicability', () => {
  const artifact = makeArtifact('campaign_platform');
  const platform = {
    organizing_idea: 'Make every wait useful',
    brand_product_role: 'The product turns waiting into progress',
    invariants: ['Waiting becomes useful', 'Product causes the change'],
    variables: ['Audience', 'setting'],
    prohibitions: ['Passive end tag'],
    example_executions: ['Commute', 'Checkout', 'Airport'],
    coverage_dimensions: ['channel', 'situation'],
    execution_evidence: [
      { evidence_kind: 'STRUCTURED_PROTOTYPE', execution_id: 'Commute', mechanism_id: 'USE-WAIT', coverage: { channel: 'social', situation: 'commute' } },
      { evidence_kind: 'STRUCTURED_PROTOTYPE', execution_id: 'Checkout', mechanism_id: 'USE-WAIT', coverage: { channel: 'retail', situation: 'checkout' } },
      { evidence_kind: 'STRUCTURED_PROTOTYPE', execution_id: 'Airport', mechanism_id: 'USE-WAIT', coverage: { channel: 'online-video', situation: 'airport' } },
    ],
  };

  assert.throws(
    () => createDecisionPacket(artifact, makeProposal({ project: makeProject(), platform })),
    { code: 'PLATFORM_SCOPE_MISMATCH' },
  );
  assert.throws(
    () => createDecisionPacket(artifact, makeProposal({
      project: makeProject({ scope_mode: 'campaign_system' }),
      platform: { ...platform, example_executions: ['Commute', 'Commute', 'Airport'] },
    })),
    { code: 'DUPLICATE_PLATFORM_ENTRY' },
  );
  assert.throws(
    () => createDecisionPacket(artifact, makeProposal({
      project: makeProject({ scope_mode: 'campaign_system' }),
      platform: { ...platform, coverage_dimensions: ['channel', 7] },
    })),
    { code: 'STRING_REQUIRED' },
  );

  const packet = createDecisionPacket(artifact, makeProposal({
    project: makeProject({ scope_mode: 'campaign_system' }),
    platform,
  }));
  assert.equal(packet.campaign_platform_context.scope_mode, 'campaign_system');
  assert.deepEqual(packet.campaign_platform_context.platform.example_executions, ['Commute', 'Checkout', 'Airport']);
});

test('feedback action and owner must match the packet contract', () => {
  const artifact = makeArtifact();
  const packet = makePacket(artifact, makeProposal({ allowed_responses: ['SELECT', 'NONE', 'REOPEN'] }));

  assert.throws(
    () => applyHumanFeedback({ artifact, packet, feedback: makeFeedback(packet, 'ADVISE') }),
    { code: 'FEEDBACK_ACTION_NOT_ALLOWED' },
  );
  assert.throws(
    () => applyHumanFeedback({
      artifact,
      packet,
      feedback: makeFeedback(packet, 'SELECT', { decision_owner: 'agency_producer' }),
    }),
    { code: 'FEEDBACK_OWNER_MISMATCH' },
  );
});

test('silence preserves PROPOSED, first SELECT enters REVISED, and proposal LOCK is forbidden', () => {
  const artifact = makeArtifact();
  const packet = makePacket(artifact);

  const silent = applyHumanFeedback({ artifact, packet, feedback: null });
  assert.equal(silent.state, 'AWAITING_HUMAN');
  assert.equal(silent.artifact.status, 'PROPOSED');

  const result = applyHumanFeedback({ artifact, packet, feedback: makeFeedback(packet, 'SELECT') });
  assert.equal(result.state, 'REVISED');
  assert.equal(result.artifact.status, 'REVISED');
  assert.equal(result.requires_confirmation, true);
  assert.notEqual(result.artifact.status, 'LOCKED');
  assert.throws(
    () => applyHumanFeedback({ artifact, packet, feedback: makeFeedback(packet, 'LOCK') }),
    { code: 'FEEDBACK_ACTION_NOT_ALLOWED' },
  );
  assert.equal(artifact.status, 'PROPOSED');
});

test('conflicting stakeholder feedback remains a conflict for the named owner', () => {
  const artifact = makeArtifact();
  const packet = makePacket(artifact);
  const result = applyHumanFeedback({
    artifact,
    packet,
    feedback: [
      makeFeedback(packet, 'SELECT', { feedback_id: 'FB-CLIENT', selected_option_id: 'A' }),
      makeFeedback(packet, 'SELECT', {
        feedback_id: 'FB-PRODUCER',
        decision_owner: 'agency_producer',
        selected_option_id: 'B',
      }),
    ],
  });

  assert.equal(result.state, 'CONFLICT');
  assert.equal(result.artifact.status, 'PROPOSED');
  assert.equal(result.conflict.decision_owner, packet.decision_owner);
  assert.equal(result.conflict.original_requirements.length, 2);
  assert.match(result.conflict.recommendation, /do not average/i);
  assert.equal(result.decision_record.outcome, 'CONFLICT');
  assert.equal(result.decision_record.packet_id, packet.packet_id);
  assert.equal(result.decision_record.artifact_id, artifact.artifact_id);
});

test('NONE reopens exploration at the current stage without forcing a choice', () => {
  const artifact = makeArtifact();
  const packet = makePacket(artifact);
  const result = applyHumanFeedback({ artifact, packet, feedback: makeFeedback(packet, 'NONE') });

  assert.equal(result.state, 'REEXPLORE');
  assert.equal(result.artifact.status, 'DRAFT');
  assert.deepEqual(result.artifact.rejected_option_ids, ['A', 'B']);
});

test('lock requires a changed revised hash and exact hash confirmation', () => {
  const artifact = makeArtifact();
  const packet = makePacket(artifact);
  const selectionFeedback = makeFeedback(packet, 'SELECT');
  const firstSelection = applyHumanFeedback({
    artifact,
    packet,
    feedback: selectionFeedback,
  });

  assert.throws(
    () => createDecisionPacket(firstSelection.artifact, makeProposal({
      prior_feedback_id: selectionFeedback.feedback_id,
      proposed_artifact_hash: artifact.content_hash,
    })),
    { code: 'REVISED_HASH_REQUIRED' },
  );

  const orthogonalSignoffs = [
    { type: 'CLAIMS', status: 'BLOCKED', reference_id: 'SIGNOFF-CLAIMS' },
    { type: 'RIGHTS', status: 'PENDING', reference_id: 'SIGNOFF-RIGHTS' },
    { type: 'TECHNICAL_QC', status: 'PENDING', reference_id: 'SIGNOFF-QC' },
  ];
  const revised = {
    ...firstSelection.artifact,
    content_hash: sha256('creative-routes-v2'),
    signoffs: orthogonalSignoffs,
  };
  const approvalSignoffs = [
    { type: 'CLIENT_DECISION', status: 'APPROVED', reference_id: 'SIGNOFF-CLIENT' },
    { type: 'STRATEGY', status: 'APPROVED', reference_id: 'SIGNOFF-STRATEGY' },
    { type: 'CREATIVE', status: 'APPROVED', reference_id: 'SIGNOFF-CREATIVE' },
  ];
  const confirmationPacket = createDecisionPacket(revised, makeProposal({
    decision_question: 'Lock the revised Route B artifact?',
    prior_feedback_id: selectionFeedback.feedback_id,
    proposed_artifact_hash: artifact.content_hash,
    signoffs: approvalSignoffs,
  }));
  assert.equal(confirmationPacket.interaction_phase, 'CONFIRMATION');
  assert.equal(confirmationPacket.revised_artifact_hash, revised.content_hash);
  assert.ok(confirmationPacket.allowed_responses.includes('LOCK'));

  const lockFeedback = makeFeedback(confirmationPacket, 'LOCK', {
    confirmed_artifact_hash: revised.content_hash,
  });
  assert.throws(
    () => confirmLock({
      artifact: revised,
      packet: confirmationPacket,
      feedback: { ...lockFeedback, confirmed_artifact_hash: sha256('wrong-hash') },
    }),
    { code: 'EXACT_VALUE_REQUIRED' },
  );

  const lockedResult = confirmLock({
    artifact: revised,
    packet: confirmationPacket,
    feedback: lockFeedback,
  });
  assert.equal(lockedResult.artifact.status, 'LOCKED');
  assert.equal(lockedResult.lock_record.artifact_hash, revised.content_hash);
  assert.deepEqual(lockedResult.lock_record.signoffs, [
    ...orthogonalSignoffs,
    ...approvalSignoffs.filter((entry) => entry.type !== 'CLIENT_DECISION'),
    { type: 'CLIENT_DECISION', status: 'APPROVED', reference_id: lockFeedback.feedback_id },
  ]);
  assert.equal(lockedResult.lock_record.signoffs.find((entry) => entry.type === 'CLAIMS').status, 'BLOCKED');
  assert.equal(lockedResult.lock_record.signoffs.find((entry) => entry.type === 'RIGHTS').status, 'PENDING');
  assert.equal(lockedResult.lock_record.signoffs.find((entry) => entry.type === 'TECHNICAL_QC').status, 'PENDING');
});

test('direct confirmation of a proposed artifact is rejected even when the user says LOCK', () => {
  const artifact = makeArtifact();
  const packet = makePacket(artifact);
  assert.throws(
    () => confirmLock({
      artifact,
      packet,
      feedback: makeFeedback(packet, 'LOCK', { confirmed_artifact_hash: artifact.content_hash }),
    }),
    { code: 'REVISION_CONFIRMATION_REQUIRED' },
  );
});

test('production-select packet rejects prompt-only options and accepts inspected actual media', () => {
  const artifact = makeArtifact('production_selects');
  assert.throws(
    () => createDecisionPacket(artifact, makeProposal({
      options: [{ id: 'A', proposition: 'Prompt completed', strengths: [], risks: [], prompt: 'hero frame' }],
      recommendation: { option_id: 'A', rationale: 'Tool reported success.' },
    })),
    { code: 'ACTUAL_MEDIA_REQUIRED' },
  );

  const packet = createDecisionPacket(artifact, makeProposal({
    options: [{
      id: 'A',
      proposition: 'Inspected take A',
      strengths: ['Identity holds'],
      risks: ['Minor hand artifact'],
      actual_media: {
        output_path: 'production/take-a.mov',
        output_hash: sha256('actual-media'),
        inspection: { passed: true, observations: ['Product geometry is stable'] },
      },
    }],
    recommendation: { option_id: 'A', rationale: 'The actual take passes identity and product checks.' },
  }));
  assert.equal(packet.options[0].actual_media.inspection.passed, true);
});

test('reopen invalidates only transitive descendants and preserves unrelated artifacts', () => {
  const result = planReopen({
    artifactId: 'ART-STRATEGY',
    reason: 'Audience changed',
    dependencies: [
      { artifact_id: 'ART-STRATEGY', input_artifact_ids: [] },
      { artifact_id: 'ART-BRIEF', input_artifact_ids: ['ART-STRATEGY'] },
      { from_artifact_id: 'ART-BRIEF', to_artifact_id: 'ART-ROUTES', kind: 'DERIVED_FROM' },
      { artifact_id: 'ART-SCRIPT', input_artifact_ids: ['ART-ROUTES'] },
      { artifact_id: 'ART-RIGHTS', input_artifact_ids: ['ART-SOURCE'] },
      { artifact_id: 'ART-SOURCE', input_artifact_ids: [] },
    ],
  });

  assert.deepEqual(result.affected_artifact_ids, ['ART-BRIEF', 'ART-ROUTES', 'ART-SCRIPT']);
  assert.deepEqual(result.preserved_artifact_ids, ['ART-RIGHTS', 'ART-SOURCE']);
  assert.ok(result.transitions.every((entry) => entry.status === 'STALE'));
});
