import {
  ARTIFACT_DEFINITIONS,
  STAGES,
  expectedArtifactType,
  nextStage,
  stageIndex,
  validateProject,
} from './contracts.mjs';
import { ContractError } from './errors.mjs';
import { nonEmptyString, uniqueStrings } from './utils.mjs';

const EARLY_PRODUCTION_CRAFT = Object.freeze([
  'director_of_photography',
  'production_designer',
  'editor',
]);

const STAGE_ROUTES = Object.freeze({
  P0_BRIEF_ALIGNMENT: route('account_project_lead', ['strategy_planning_lead']),
  P1_DIAGNOSIS: route('strategy_planning_lead', ['research_insight_lead', 'account_project_lead']),
  P2_COMMUNICATIONS_STRATEGY: route('strategy_planning_lead', ['brand_strategist', 'account_project_lead']),
  P3_CREATIVE_BRIEF: route('strategy_planning_lead', ['creative_director', 'account_project_lead']),
  P4_CREATIVE_ROUTES: route(
    'creative_director',
    ['copywriter', 'agency_art_director'],
    ['strategy_planning_lead'],
  ),
  P5_CORE_CREATIVE_DECISION: route(
    'creative_director',
    ['copywriter', 'agency_art_director', 'agency_producer'],
    ['strategy_planning_lead'],
  ),
  P6_TVC_EXPRESSION: route(
    'copywriter',
    ['agency_art_director', 'creative_director', 'agency_producer'],
    ['strategy_planning_lead'],
  ),
  P7_SCRIPT_AGENCY_BOARD: route(
    'creative_director',
    ['copywriter', 'agency_art_director', 'agency_producer'],
    ['strategy_planning_lead', 'claims_rights_challenger'],
  ),
  P8_VISUAL_PREDEVELOPMENT: route(
    'agency_art_director',
    ['copywriter', 'creative_director', 'agency_producer', 'reference_research_service'],
  ),
  P9_PRODUCTION_PITCH: route(
    'agency_producer',
    ['creative_director', 'agency_art_director', 'copywriter', 'reference_research_service'],
    ['claims_rights_challenger'],
  ),
  P10_DIRECTOR_TREATMENT_AWARD: route(
    'commercial_director',
    ['agency_producer', 'creative_director', 'production_company_producer'],
    ['claims_rights_challenger'],
  ),
  P11_PREPRODUCTION_PPM: route(
    'production_company_producer',
    ['commercial_director', 'agency_producer', 'creative_director'],
    ['claims_rights_challenger'],
    [
      {
        capability_id: 'commercial_director',
        responsibility: 'creative_authority',
        reason: 'Own P11 creative execution authority under the locked agency concept.',
      },
      {
        capability_id: 'production_company_producer',
        responsibility: 'production_authority',
        reason: 'Own P11 production authority for budget, schedule, safety, crew, and delivery.',
      },
    ],
  ),
  P12_PRODUCTION_SELECTS: route(
    'commercial_director',
    ['production_company_producer', 'agency_producer'],
    ['creative_director', 'claims_rights_challenger'],
  ),
  P13_OFFLINE_LOCK: route(
    'editor',
    ['commercial_director', 'post_producer', 'creative_director', 'agency_producer'],
    ['claims_rights_challenger'],
  ),
  P14_FINAL_RELEASE: route(
    'post_producer',
    ['editor', 'commercial_director', 'creative_director', 'agency_producer'],
    ['claims_rights_challenger'],
  ),
});

const STAGE_METHODS = Object.freeze({
  P0_BRIEF_ALIGNMENT: ['brief_alignment', 'decision_owner_mapping'],
  P1_DIAGNOSIS: ['M-R01', 'M-R02', 'M-S01'],
  P2_COMMUNICATIONS_STRATEGY: ['M-S02', 'M-S03'],
  P3_CREATIVE_BRIEF: ['M-S04'],
  P4_CREATIVE_ROUTES: ['M-C01', 'M-C02', 'M-C07', 'M-C08', 'M-J01', 'M-J02'],
  P5_CORE_CREATIVE_DECISION: ['M-C09', 'M-J01', 'M-J03', 'M-J04'],
  P6_TVC_EXPRESSION: ['M-C04', 'M-C06', 'M-C09'],
  P7_SCRIPT_AGENCY_BOARD: ['copy_craft', 'M-J02', 'M-J04'],
  P8_VISUAL_PREDEVELOPMENT: ['visual_predevelopment', 'reference_rationale'],
  P9_PRODUCTION_PITCH: ['production_pitch_readiness'],
  P10_DIRECTOR_TREATMENT_AWARD: ['M-P01'],
  P11_PREPRODUCTION_PPM: ['M-P02'],
  P12_PRODUCTION_SELECTS: ['M-P03'],
  P13_OFFLINE_LOCK: ['M-P03', 'offline_diagnosis'],
  P14_FINAL_RELEASE: ['release_qc', 'rights_and_claims_recheck'],
});

const SCOPE_BRANCHES = Object.freeze({
  single_tvc: {
    branch: 'one_off_film_concept',
    platform: 'NOT_APPLICABLE',
    requirements: ['film_concept', 'product_or_brand_role', 'film_engine'],
  },
  campaign_system: {
    branch: 'campaign_system',
    platform: 'CREATE',
    capabilities: ['brand_strategist', 'media_asset_strategist'],
    requirements: [
      'organizing_idea',
      'channel_roles',
      'execution_family',
      'platform_invariants',
      'platform_variables',
      'platform_prohibitions',
    ],
  },
  existing_platform_expression: {
    branch: 'existing_platform_expression',
    platform: 'INHERIT',
    capabilities: ['brand_strategist'],
    requirements: ['existing_platform_trace', 'film_expression', 'platform_consistency'],
  },
  social_native: {
    branch: 'social_native',
    platform: 'NOT_APPLICABLE',
    capabilities: ['media_asset_strategist'],
    requirements: [
      'channel_job',
      'native_premise',
      'opening_hook',
      'aspect_ratio_structure',
      'safe_zones',
      'sound_dependency',
      'creator_or_community_logic',
    ],
  },
  version_system: {
    branch: 'version_system',
    platform: 'NOT_APPLICABLE',
    capabilities: ['media_asset_strategist'],
    requirements: ['channel_jobs', 'adaptation_rules', 'copy_matrix', 'safe_zone_matrix', 'version_matrix'],
  },
  direct_response_or_offer: {
    branch: 'direct_response_or_offer',
    platform: 'NOT_APPLICABLE',
    capabilities: ['claims_rights_challenger'],
    requirements: ['proposition', 'offer', 'proof', 'cta', 'response_mechanism'],
  },
  brand_film: {
    branch: 'brand_film',
    platform: 'NOT_APPLICABLE',
    capabilities: ['brand_strategist'],
    requirements: ['emotional_change', 'brand_belonging', 'memory_device'],
  },
  product_demo: {
    branch: 'product_demo',
    platform: 'NOT_APPLICABLE',
    capabilities: ['claims_rights_challenger'],
    requirements: ['demonstration', 'visible_proof', 'claim_substantiation'],
  },
});

export function routeCapabilities({ project, artifacts = [], claims = [], rights = [], openBlocks = [] }) {
  validateProject(project);
  requireArray(artifacts, 'artifacts');
  requireArray(claims, 'claims');
  requireArray(rights, 'rights');
  requireArray(openBlocks, 'openBlocks');

  const requestedStage = project.current_stage;
  const timing = enforceProfessionalTiming({ project, artifacts });
  const effectiveStage = timing.effective_stage;
  const stageRoute = STAGE_ROUTES[effectiveStage];
  const scope = SCOPE_BRANCHES[project.scope_mode];
  const assignments = new Map();
  const hardBlocks = [];
  const warnings = [...timing.corrections];

  assign(assignments, 'creative_lead', 'orchestrator', false, 'Own the unresolved-problem route and human loop.');
  assign(assignments, stageRoute.owner, 'owner', false, `Own ${effectiveStage}.`);
  for (const capability of stageRoute.contributors) {
    assign(assignments, capability, 'contributor', false, `Contribute to ${effectiveStage}.`);
  }
  for (const capability of stageRoute.challengers) {
    assign(assignments, capability, 'challenger', false, `Challenge ${effectiveStage} within its authority.`);
  }
  for (const authority of stageRoute.authorities) {
    assign(
      assignments,
      authority.capability_id,
      authority.responsibility,
      false,
      authority.reason,
    );
  }

  if (stageIndex(effectiveStage) >= 2) {
    for (const capability of scope.capabilities ?? []) {
      assign(assignments, capability, 'conditional', true, `Required by ${project.scope_mode} scope.`);
    }
  }

  if (project.scope_mode === 'campaign_system' && stageIndex(requestedStage) >= 6 && !isLocked(artifacts, 'campaign_platform')) {
    warnings.push(correction(
      'CAMPAIGN_PLATFORM_REQUIRED',
      'Campaign scope requires a separately locked campaign platform before expression advances.',
      requestedStage,
      'P5_CORE_CREATIVE_DECISION',
    ));
  }

  if (scope.platform === 'NOT_APPLICABLE' && artifacts.some((artifact) => artifact?.type === 'campaign_platform')) {
    hardBlocks.push(block(
      'PLATFORM_SCOPE_MISMATCH',
      `A new campaign platform is not applicable to ${project.scope_mode} scope.`,
      'scope',
    ));
  }

  applyProductionBranch({
    project,
    stage: effectiveStage,
    artifacts,
    rights,
    assignments,
    hardBlocks,
  });

  hardBlocks.push(...claimAndRightBlocks({ stage: requestedStage, claims, rights }));
  hardBlocks.push(...normalizeOpenBlocks(openBlocks));

  const requiredArtifactTypes = requiredArtifactsForStage(effectiveStage, project.scope_mode, artifacts);
  const nextArtifactType = chooseNextArtifactType(requiredArtifactTypes, artifacts);
  const orderedAssignments = [...assignments.values()];
  const capabilities = orderedAssignments.map((entry) => entry.capability_id);
  const status = hardBlocks.length > 0 ? 'STOP' : 'ROUTED';

  return {
    status,
    disposition: status === 'STOP' ? 'STOP' : 'EXECUTE',
    requested_stage: requestedStage,
    stage: effectiveStage,
    effective_stage: effectiveStage,
    scope_mode: project.scope_mode,
    production_mode: project.production_mode,
    owner_capability: stageRoute.owner,
    capabilities,
    capability_ids: capabilities,
    assignments: orderedAssignments,
    methods: [...(STAGE_METHODS[effectiveStage] ?? [])],
    required_artifact_types: requiredArtifactTypes,
    next_artifact_type: nextArtifactType,
    scope_branch: {
      id: scope.branch,
      platform: scope.platform,
      requirements: [...scope.requirements],
    },
    production_branch: productionBranchSummary(project, effectiveStage),
    professional_timing: {
      requested_stage: requestedStage,
      effective_stage: effectiveStage,
      corrections: warnings,
    },
    hard_blocks: dedupeBlocks(hardBlocks),
    warnings,
  };
}

export function recommendNextMove(snapshot) {
  requireObject(snapshot, 'snapshot');
  const artifacts = snapshot.artifacts ?? [];
  const attempts = snapshot.attempts ?? [];
  requireArray(attempts, 'snapshot.attempts');

  const routed = routeCapabilities({
    project: snapshot.project,
    artifacts,
    claims: snapshot.claims ?? [],
    rights: snapshot.rights ?? [],
    openBlocks: snapshot.openBlocks ?? snapshot.open_blocks ?? [],
  });

  if (snapshot.project.status === 'STOPPED') {
    return move('STOP', 'PROJECT_STOPPED', routed, null, 'The project is explicitly stopped.');
  }
  if (snapshot.project.status === 'COMPLETE') {
    return move('SCOPE_COMPLETE', 'NO_ACTION', routed, null, 'The project is complete.');
  }
  if (routed.status === 'STOP') {
    return {
      ...move('STOP', 'RESOLVE_HARD_BLOCK', routed, routed.next_artifact_type, 'A non-compensable block prevents advancement.'),
      hard_blocks: routed.hard_blocks,
    };
  }

  if (stageIndex(routed.requested_stage) >= 13 && !hasActualMediaSelection({ artifacts, attempts })) {
    const productionRoute = routeCapabilities({
      project: { ...snapshot.project, current_stage: 'P12_PRODUCTION_SELECTS' },
      artifacts,
      claims: snapshot.claims ?? [],
      rights: snapshot.rights ?? [],
      openBlocks: [],
    });
    return move(
      'EXECUTE',
      'INSPECT_AND_SELECT_ACTUAL_MEDIA',
      productionRoute,
      'production_selects',
      'Actual pixels, frames, or audio must be inspected and selected before post can advance.',
    );
  }

  let targetType = routed.next_artifact_type;
  let targetStage = routed.stage;
  let targetRoute = routed;
  let artifact = latestArtifact(artifacts, targetType);

  const visitedTargets = new Set();
  while (artifact?.status === 'LOCKED') {
    const targetKey = `${targetStage}:${targetType}`;
    if (visitedTargets.has(targetKey)) {
      return move('STOP', 'ROUTING_CYCLE', targetRoute, targetType, 'The artifact route contains a cycle.');
    }
    visitedTargets.add(targetKey);
    const following = routeAfterLocked({ snapshot, artifacts, routed: targetRoute, targetType });
    if (!following) {
      return move('SCOPE_COMPLETE', 'NO_ACTION', targetRoute, null, 'All required decision-bearing artifacts are locked.');
    }
    targetType = following.type;
    targetStage = following.route.stage;
    targetRoute = following.route;
    if (targetRoute.status === 'STOP') {
      return {
        ...move('STOP', 'RESOLVE_HARD_BLOCK', targetRoute, targetType, 'A non-compensable block prevents advancement.'),
        hard_blocks: targetRoute.hard_blocks,
      };
    }
    artifact = latestArtifact(artifacts, targetType);
  }

  if (targetStage === 'P12_PRODUCTION_SELECTS' && !hasActualMediaSelection({ artifacts, attempts })) {
    return move(
      'EXECUTE',
      'INSPECT_AND_SELECT_ACTUAL_MEDIA',
      targetRoute,
      targetType,
      'Tool or prompt success is not media success; inspect actual outputs and bind a selected attempt.',
    );
  }

  if (!artifact) {
    return move('EXECUTE', 'CREATE_ARTIFACT', targetRoute, targetType, `Create the next ${targetType} candidate.`);
  }

  switch (artifact.status) {
    case 'DRAFT':
      return move('EXECUTE', 'DEVELOP_ARTIFACT', targetRoute, targetType, 'Develop the draft to professional review quality.');
    case 'INTERNAL_REVIEW':
      return move('EXECUTE', 'PROFESSIONAL_REVIEW', targetRoute, targetType, 'The named professional owner must complete review.');
    case 'PROPOSED':
      return move('AWAIT_HUMAN', 'COLLECT_HUMAN_FEEDBACK', targetRoute, targetType, 'Silence is not approval; retain PROPOSED state.');
    case 'REVISED':
      return move('AWAIT_HUMAN', 'CONFIRM_LOCK', targetRoute, targetType, 'Show the revision and request an explicit lock or reopen decision.');
    case 'STALE':
      return move('REOPEN', 'REVISE_STALE_ARTIFACT', targetRoute, targetType, 'An upstream change invalidated this artifact.');
    case 'BLOCKED':
      return move('STOP', 'RESOLVE_ARTIFACT_BLOCK', targetRoute, targetType, 'The current artifact is blocked.');
    default:
      return move('EXECUTE', 'DEVELOP_ARTIFACT', targetRoute, targetType, 'Continue the current professional artifact.');
  }
}

function applyProductionBranch({ project, stage, artifacts, rights, assignments, hardBlocks }) {
  const index = stageIndex(stage);

  if (project.production_mode === 'director_led') {
    const exception = findDirectorLedException(project);
    if (!exception.valid) {
      hardBlocks.push(block(
        'DIRECTOR_LED_EXCEPTION_REQUIRED',
        `Director-led early concept participation requires explicit fee, IP, scope, and approval boundaries: ${exception.missing.join(', ')}.`,
        'production_mode',
      ));
    } else if (index >= 4 && index <= 7) {
      assign(assignments, 'commercial_director', 'concept_partner', true, 'Explicit director-led exception.');
    }
  }

  if (project.production_mode === 'live_action' || project.production_mode === 'director_led') {
    if (index >= 11) {
      addLiveActionCraft(assignments);
    }
    return;
  }

  if (project.production_mode === 'animation') {
    if (index >= 5) {
      assign(assignments, 'animation_director', 'conditional', true, 'Animation direction enters after the core concept.');
      assign(assignments, 'visual_development_lead', 'conditional', true, 'Animation requires character/world visual development.');
      assign(assignments, 'editor', 'conditional', true, 'Editor enters early for animatic and timing.');
    }
    if (index >= 6) {
      assign(assignments, 'motion_designer', 'conditional', true, 'Animation motion development.');
      assign(assignments, 'sound_designer', 'conditional', true, 'Animation sound development.');
    }
    return;
  }

  if (project.production_mode === 'vfx_first') {
    if (index >= 4) {
      assign(assignments, 'vfx_supervisor', index < 11 ? 'feasibility_advisor' : 'conditional', true, 'VFX-first feasibility and execution.');
    }
    if (index >= 11) addLiveActionCraft(assignments);
    return;
  }

  if (project.production_mode === 'ai_native') {
    applyAiBranch({ project, stage, artifacts, rights, assignments, hardBlocks });
    return;
  }

  if (project.production_mode === 'hybrid') {
    if (index >= 5) {
      assign(assignments, 'visual_development_lead', 'conditional', true, 'Hybrid visual system development.');
      assign(assignments, 'vfx_supervisor', 'feasibility_advisor', true, 'Hybrid VFX feasibility.');
    }
    if (index >= 11) addLiveActionCraft(assignments);
    applyAiBranch({ project, stage, artifacts, rights, assignments, hardBlocks });
  }
}

function applyAiBranch({ project, stage, artifacts, rights, assignments, hardBlocks }) {
  const index = stageIndex(stage);
  if (index >= 8) {
    assign(assignments, 'visual_development_lead', 'conditional', true, 'AI-native canon and visual-system development.');
  }
  if (index < 11) return;

  const missing = [];
  if (!isLocked(artifacts, 'core_creative_concept')) missing.push('locked core concept');
  if (!isLocked(artifacts, 'script_agency_board')) missing.push('locked script/agency board');
  if (!hasLockedContract(project, artifacts, 'asset_canon')) missing.push('locked asset canon');
  if (!hasLockedContract(project, artifacts, 'shot_contract')) missing.push('locked shot contract');
  if (rights.length === 0) missing.push('AI/reference/likeness rights record');

  if (missing.length > 0) {
    if (index >= 12) {
      hardBlocks.push(block(
        'AI_PRODUCTION_CONTRACT_REQUIRED',
        `AI generation cannot start without ${missing.join(', ')}.`,
        'production_mode',
      ));
    }
    return;
  }

  assign(assignments, 'ai_generation_supervisor', 'operator', true, 'Compile approved intent, bind attempts, and inspect actual media.');
}

function addLiveActionCraft(assignments) {
  assign(assignments, 'director_of_photography', 'conditional', true, 'Live-action camera and lighting craft after award.');
  assign(assignments, 'production_designer', 'conditional', true, 'Live-action production design after award.');
  assign(assignments, 'casting_lead', 'conditional', true, 'Preproduction casting.');
  assign(assignments, 'location_scout', 'conditional', true, 'Preproduction location work.');
  assign(assignments, 'wardrobe_hmu', 'conditional', true, 'Preproduction wardrobe and HMU.');
}

function enforceProfessionalTiming({ project, artifacts }) {
  const requested = project.current_stage;
  const requestedIndex = stageIndex(requested);

  if (project.scope_mode === 'campaign_system'
    && requestedIndex >= 6
    && (!isLocked(artifacts, 'core_creative_concept') || !isLocked(artifacts, 'campaign_platform'))) {
    return timed('P5_CORE_CREATIVE_DECISION', correction(
      'CAMPAIGN_PLATFORM_BEFORE_EXPRESSION',
      'Campaign scope requires a separately locked, applicable platform before film expression advances.',
      requested,
      'P5_CORE_CREATIVE_DECISION',
    ));
  }
  if (requestedIndex >= 9 && !isLocked(artifacts, 'script_agency_board')) {
    return timed('P7_SCRIPT_AGENCY_BOARD', correction(
      'SCRIPT_BEFORE_PRODUCTION_INTERPRETATION',
      'A locked agency script/board is required before production pitch or director treatment.',
      requested,
      'P7_SCRIPT_AGENCY_BOARD',
    ));
  }
  if (requestedIndex >= 10 && !isLocked(artifacts, 'production_pitch')) {
    return timed('P9_PRODUCTION_PITCH', correction(
      'PRODUCTION_PITCH_BEFORE_TREATMENT',
      'Production pitch scope and shortlist must precede director treatment.',
      requested,
      'P9_PRODUCTION_PITCH',
    ));
  }
  if (requestedIndex >= 11 && !isLocked(artifacts, 'director_treatment_award')) {
    return timed('P10_DIRECTOR_TREATMENT_AWARD', correction(
      'DIRECTOR_AWARD_BEFORE_PREPRODUCTION',
      'Director treatment and award must be locked before formal preproduction.',
      requested,
      'P10_DIRECTOR_TREATMENT_AWARD',
    ));
  }
  if (requestedIndex >= 12 && !isLocked(artifacts, 'ppm_production_plan')) {
    return timed('P11_PREPRODUCTION_PPM', correction(
      'PPM_BEFORE_PRODUCTION',
      'PPM production plan must be locked before shooting or generation.',
      requested,
      'P11_PREPRODUCTION_PPM',
    ));
  }
  if (requestedIndex >= 13 && !isLocked(artifacts, 'production_selects')) {
    return timed('P12_PRODUCTION_SELECTS', correction(
      'ACTUAL_SELECTS_BEFORE_OFFLINE',
      'Actual media selects must be locked before offline.',
      requested,
      'P12_PRODUCTION_SELECTS',
    ));
  }
  if (requestedIndex >= 14 && !isLocked(artifacts, 'offline_lock')) {
    return timed('P13_OFFLINE_LOCK', correction(
      'OFFLINE_BEFORE_FINISH',
      'Offline picture lock must precede final release.',
      requested,
      'P13_OFFLINE_LOCK',
    ));
  }

  return { effective_stage: requested, corrections: [] };
}

function claimAndRightBlocks({ stage, claims, rights }) {
  const blocks = [];
  const index = stageIndex(stage);

  for (const claim of claims) {
    if (!claim || typeof claim !== 'object') continue;
    const id = claim.claim_id ?? '<unknown-claim>';
    const impossible = claim.clearance_status === 'BLOCKED'
      || claim.evidence_status === 'CONTRADICTED'
      || (claim.clearance_status === 'CLEARED' && claim.evidence_status !== 'SUPPORTED');
    const productionGate = index >= 9
      && claim.clearance_status !== 'NOT_APPLICABLE'
      && (claim.evidence_status !== 'SUPPORTED' || claim.clearance_status !== 'CLEARED');
    if (impossible || productionGate) {
      blocks.push(block('CLAIM_STOP', `Claim ${id} lacks supported and cleared status.`, 'claim', id));
    }
  }

  for (const right of rights) {
    if (!right || typeof right !== 'object') continue;
    const id = right.right_id ?? '<unknown-right>';
    const impossible = right.clearance_status === 'BLOCKED';
    const productionGate = index >= 11 && !['CLEARED', 'NOT_APPLICABLE'].includes(right.clearance_status);
    if (impossible || productionGate) {
      blocks.push(block('RIGHTS_STOP', `Right ${id} is not cleared for production use.`, 'right', id));
    }
  }

  return blocks;
}

function normalizeOpenBlocks(openBlocks) {
  const blocks = [];
  for (const entry of openBlocks) {
    if (nonEmptyString(entry)) {
      blocks.push(block('OPEN_BLOCK_STOP', entry, 'open_block'));
      continue;
    }
    if (!entry || typeof entry !== 'object') continue;
    const isHard = entry.hard === true
      || entry.blocking === true
      || ['FATAL', 'HARD'].includes(String(entry.severity ?? '').toUpperCase())
      || ['BLOCKED', 'STOP'].includes(String(entry.status ?? entry.disposition ?? '').toUpperCase());
    if (!isHard) continue;
    blocks.push(block(
      entry.code ?? 'OPEN_BLOCK_STOP',
      entry.message ?? entry.reason ?? 'An explicit open block prevents advancement.',
      entry.source ?? 'open_block',
      entry.id,
    ));
  }
  return blocks;
}

function requiredArtifactsForStage(stage, scopeMode, artifacts) {
  const required = [];
  const defaultType = expectedArtifactType(stage);
  if (defaultType) required.push(defaultType);
  if (stage === 'P5_CORE_CREATIVE_DECISION' && scopeMode === 'campaign_system') {
    if (isLocked(artifacts, 'core_creative_concept')) return ['campaign_platform'];
    required.push('campaign_platform');
  }
  return required;
}

function chooseNextArtifactType(requiredTypes, artifacts) {
  return requiredTypes.find((type) => !isLocked(artifacts, type)) ?? requiredTypes.at(-1) ?? null;
}

function routeAfterLocked({ snapshot, artifacts, routed, targetType }) {
  if (routed.stage === 'P5_CORE_CREATIVE_DECISION'
    && snapshot.project.scope_mode === 'campaign_system'
    && targetType === 'core_creative_concept'
    && !isLocked(artifacts, 'campaign_platform')) {
    return { type: 'campaign_platform', route: { ...routed, next_artifact_type: 'campaign_platform' } };
  }

  const followingStage = nextStage(routed.stage);
  if (!followingStage) return null;
  const followingRoute = routeCapabilities({
    project: { ...snapshot.project, current_stage: followingStage },
    artifacts,
    claims: snapshot.claims ?? [],
    rights: snapshot.rights ?? [],
    openBlocks: snapshot.openBlocks ?? snapshot.open_blocks ?? [],
  });
  return { type: followingRoute.next_artifact_type, route: followingRoute };
}

function hasActualMediaSelection({ artifacts, attempts }) {
  if (attempts.some((attempt) => attempt?.status === 'SELECTED'
    && attempt?.inspection?.passed === true
    && isContainedRelativePath(attempt.output_path)
    && isSha256(attempt.output_hash))) {
    return true;
  }

  const selects = latestArtifact(artifacts, 'production_selects');
  if (!selects) return false;
  return Array.isArray(selects.actual_media)
    && selects.actual_media.some((media) => media?.inspection?.passed === true
      && isContainedRelativePath(media.output_path ?? media.path)
      && isSha256(media.output_hash ?? media.hash));
}

function hasLockedContract(project, artifacts, name) {
  if (project?.[`${name}_locked`] === true) return true;
  if (project?.ai_contracts?.[`${name}_locked`] === true) return true;
  return artifacts.some((artifact) => artifact?.status === 'LOCKED'
    && (artifact.type === name || artifact.contract_type === name || artifact?.contracts?.[name] === 'LOCKED'));
}

function findDirectorLedException(project) {
  const candidates = [
    project.director_led_exception,
    project.production_exception,
    ...(Array.isArray(project.production_exceptions) ? project.production_exceptions : []),
    ...(Array.isArray(project.exceptions) ? project.exceptions : []),
  ].filter((entry) => entry && typeof entry === 'object');
  const exception = candidates.find((entry) => {
    const identity = entry.type ?? entry.mode ?? entry.id ?? 'director_led';
    return identity === 'director_led';
  });
  if (!exception) return { valid: false, missing: ['explicit exception', 'scope', 'fee', 'IP', 'approval boundaries'] };

  const missing = [];
  if (exception.explicit !== true) missing.push('explicit=true');
  if (!hasValue(exception.scope ?? exception.exception_scope)) missing.push('scope');
  if (!hasValue(exception.fee ?? exception.fee_terms ?? exception.paid_scope)) missing.push('fee');
  if (!hasValue(exception.ip ?? exception.ip_terms ?? exception.ip_boundary)) missing.push('IP');
  if (!hasValue(exception.approval_boundaries ?? exception.approvals ?? exception.authority_boundaries)) missing.push('approval boundaries');
  return { valid: missing.length === 0, missing, exception };
}

function productionBranchSummary(project, stage) {
  const summary = { id: project.production_mode, stage };
  if (project.production_mode === 'director_led') {
    const exception = findDirectorLedException(project);
    summary.early_concept_partner = exception.valid;
    summary.exception_required = true;
  }
  if (project.production_mode === 'animation') summary.editor_enters_early = stageIndex(stage) >= 5;
  if (project.production_mode === 'vfx_first') summary.early_feasibility_only = stageIndex(stage) < 11;
  if (['ai_native', 'hybrid'].includes(project.production_mode)) summary.actual_media_required = true;
  return summary;
}

function latestArtifact(artifacts, type) {
  if (!type) return null;
  return artifacts
    .filter((artifact) => artifact?.type === type)
    .toSorted((left, right) => (right.version ?? 0) - (left.version ?? 0))[0] ?? null;
}

function isLocked(artifacts, type) {
  const definition = ARTIFACT_DEFINITIONS[type];
  return artifacts.some((artifact) => artifact?.type === type
    && artifact?.status === 'LOCKED'
    && (!definition
      || (artifact.stage === definition.stage
        && artifact.owner_capability === definition.owner_capability
        && artifact.decision_bearing === definition.decision_bearing)));
}

function route(owner, contributors = [], challengers = [], authorities = []) {
  return Object.freeze({
    owner,
    contributors: Object.freeze(contributors),
    challengers: Object.freeze(challengers),
    authorities: Object.freeze(authorities.map((entry) => Object.freeze({ ...entry }))),
  });
}

function assign(assignments, capabilityId, responsibility, conditional, reason) {
  const existing = assignments.get(capabilityId);
  const priority = {
    creative_authority: 7,
    production_authority: 7,
    owner: 6,
    orchestrator: 5,
    concept_partner: 4,
    operator: 3,
    contributor: 2,
    conditional: 2,
    feasibility_advisor: 1,
    challenger: 1,
  };
  if (existing && (priority[existing.responsibility] ?? 0) >= (priority[responsibility] ?? 0)) return;
  assignments.set(capabilityId, {
    capability_id: capabilityId,
    responsibility,
    conditional,
    reason,
  });
}

function move(disposition, action, routed, artifactType, reason) {
  return {
    disposition,
    status: disposition,
    action,
    next_action: action,
    stage: routed.stage,
    artifact_type: artifactType,
    owner_capability: routed.owner_capability,
    capabilities: [...routed.capabilities],
    methods: [...routed.methods],
    reason,
    route: routed,
  };
}

function block(code, message, source, recordId = undefined) {
  return { code, message, source, ...(recordId ? { record_id: recordId } : {}) };
}

function correction(code, message, fromStage, toStage) {
  return { code, message, from_stage: fromStage, to_stage: toStage };
}

function timed(stage, entry) {
  return { effective_stage: stage, corrections: [entry] };
}

function dedupeBlocks(blocks) {
  const seen = new Set();
  return blocks.filter((entry) => {
    const key = `${entry.code}:${entry.record_id ?? ''}:${entry.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function hasValue(value) {
  if (nonEmptyString(value)) return true;
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value && typeof value === 'object' && Object.keys(value).length > 0);
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

function requireArray(value, path) {
  if (!Array.isArray(value)) throw new ContractError('ARRAY_REQUIRED', `${path} must be an array.`, { path });
}

function requireObject(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ContractError('OBJECT_REQUIRED', `${path} must be an object.`, { path });
  }
}

export const ROUTER_INVARIANTS = Object.freeze({
  stages: STAGES,
  early_production_craft: EARLY_PRODUCTION_CRAFT,
  artifact_owners: Object.freeze(
    Object.fromEntries(Object.entries(ARTIFACT_DEFINITIONS).map(([type, definition]) => [type, definition.owner_capability])),
  ),
});

export function validateRouter() {
  const project = {
    schema_version: '1.0.0', project_id: 'VALIDATION-ROUTER', title: 'Router validation',
    scope_mode: 'campaign_system', production_mode: 'hybrid', current_stage: 'P4_CREATIVE_ROUTES',
    status: 'ACTIVE', revision: 0, active_artifact_id: null,
    created_at: '2026-07-11T00:00:00.000Z', updated_at: '2026-07-11T00:00:00.000Z',
  };
  const route = routeCapabilities({ project });
  const passed = route.owner_capability === 'creative_director'
    && route.scope_branch.platform === 'CREATE'
    && route.capability_ids.includes('copywriter')
    && route.capability_ids.includes('agency_art_director')
    && !['commercial_director', 'director_of_photography', 'production_designer', 'editor'].includes(route.owner_capability);
  return {
    kind: 'tcis.router-validation.v1',
    passed,
    owner_capability: route.owner_capability,
    platform: route.scope_branch.platform,
    capability_ids: route.capability_ids,
  };
}
