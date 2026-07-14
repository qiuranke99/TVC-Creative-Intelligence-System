import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  buildArtifacts,
  checkArtifacts,
  isCleanupEligibleGeneratedPath,
  loadRegistry,
  validateRegistry,
  writeArtifacts,
} from "../tools/generate-agent-configs.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const CORE_IDS = [
  "account_project_lead",
  "agency_art_director",
  "agency_producer",
  "ai_generation_supervisor",
  "brand_strategist",
  "claims_rights_challenger",
  "commercial_director",
  "copywriter",
  "creative_director",
  "creative_lead",
  "director_of_photography",
  "editor",
  "post_producer",
  "production_company_producer",
  "production_designer",
  "research_insight_lead",
  "strategy_planning_lead",
];

const CONDITIONAL_IDS = [
  "animation_director",
  "casting_lead",
  "location_scout",
  "media_asset_strategist",
  "memory_librarian",
  "motion_designer",
  "music_supervisor",
  "qa_red_team",
  "reference_research_service",
  "sound_designer",
  "vfx_supervisor",
  "visual_development_lead",
  "wardrobe_hmu",
];

const LEGACY_ROLE_IDS = [
  "advertising_director",
  "advertising_producer",
  "art_director",
  "editor_post_supervisor",
  "film_director",
  "prompt_handoff_specialist",
  "reference_scout",
  "senior_copywriter",
  "studio_pm",
  "studio_synthesizer",
  "video_strategy_director",
  "visual_director",
];

const LEGACY_ONLY_TOMLS = LEGACY_ROLE_IDS.map(
  (capabilityId) => `${capabilityId.replaceAll("_", "-")}.toml`,
);

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right, "en"));
}

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function byId(registry, capabilityId) {
  const capability = registry.capabilities.find(
    (candidate) => candidate.capability_id === capabilityId,
  );
  assert.ok(capability, `missing capability ${capabilityId}`);
  return capability;
}

async function listTomls() {
  const entries = await readdir(path.join(ROOT, ".codex", "agents"), {
    withFileTypes: true,
  });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".toml"))
    .map((entry) => entry.name);
}

async function createGeneratorSandbox() {
  const sandboxRoot = await mkdtemp(path.join(tmpdir(), "tcis-generator-cleanup-"));
  await mkdir(path.join(sandboxRoot, "tools"), { recursive: true });
  await mkdir(path.join(sandboxRoot, "capabilities"), { recursive: true });
  await mkdir(path.join(sandboxRoot, ".codex", "agents"), { recursive: true });
  await copyFile(
    path.join(ROOT, "tools", "generate-agent-configs.mjs"),
    path.join(sandboxRoot, "tools", "generate-agent-configs.mjs"),
  );
  await copyFile(
    path.join(ROOT, "capabilities", "registry.json"),
    path.join(sandboxRoot, "capabilities", "registry.json"),
  );
  const moduleUrl = `${pathToFileURL(path.join(sandboxRoot, "tools", "generate-agent-configs.mjs")).href}?sandbox=${Date.now()}`;
  return { sandboxRoot, generator: await import(moduleUrl) };
}

test("registry has the exact TCIS v3 portfolio and complete unique contracts", async () => {
  const { registry } = await loadRegistry();
  validateRegistry(registry);

  assert.equal(registry.capabilities.length, 30);
  assert.equal(new Set(registry.capabilities.map((item) => item.capability_id)).size, 30);
  assert.deepEqual(
    sorted(
      registry.capabilities
        .filter((capability) => capability.portfolio === "core")
        .map((capability) => capability.capability_id),
    ),
    CORE_IDS,
  );
  assert.deepEqual(
    sorted(
      registry.capabilities
        .filter((capability) => capability.portfolio === "conditional")
        .map((capability) => capability.capability_id),
    ),
    CONDITIONAL_IDS,
  );

  const ids = new Set(registry.capabilities.map((capability) => capability.capability_id));
  for (const legacyId of LEGACY_ROLE_IDS) {
    assert.equal(ids.has(legacyId), false, `legacy role remains canonical: ${legacyId}`);
  }

  for (const capability of registry.capabilities) {
    for (const field of [
      "purpose",
      "stage_entry",
      "stage_exit",
      "owns",
      "may_advise",
      "must_not_decide",
      "knowledge_modules",
      "method_cards",
      "tools",
      "skills",
      "inputs",
      "outputs",
      "authority",
      "failure_modes",
      "counterexamples",
      "fixtures",
      "ablation_claim",
    ]) {
      assert.ok(Object.hasOwn(capability, field), `${capability.capability_id}.${field} missing`);
    }
  }
});

test("professional ownership splits and migration boundaries are explicit", async () => {
  const { registry } = await loadRegistry();
  const agencyArtDirector = byId(registry, "agency_art_director");
  const productionDesigner = byId(registry, "production_designer");
  const agencyProducer = byId(registry, "agency_producer");
  const productionCompanyProducer = byId(registry, "production_company_producer");
  const editor = byId(registry, "editor");
  const postProducer = byId(registry, "post_producer");
  const commercialDirector = byId(registry, "commercial_director");
  const generationSupervisor = byId(registry, "ai_generation_supervisor");

  assert.match(agencyArtDirector.stage_entry.join(" "), /P4/);
  assert.match(agencyArtDirector.must_not_decide.join(" "), /production designer/i);
  assert.match(productionDesigner.stage_entry.join(" "), /P10/);
  assert.match(productionDesigner.must_not_decide.join(" "), /agency idea|agency board/i);

  assert.match(agencyProducer.stage_entry.join(" "), /P3/);
  assert.match(agencyProducer.must_not_decide.join(" "), /production-company crew/i);
  assert.match(productionCompanyProducer.stage_entry.join(" "), /P10/);
  assert.match(productionCompanyProducer.must_not_decide.join(" "), /agency idea/i);

  assert.match(editor.owns.join(" "), /picture-edit craft/i);
  assert.match(editor.must_not_decide.join(" "), /post budget|technical PASS/i);
  assert.match(postProducer.owns.join(" "), /technical-QC orchestration/i);
  assert.match(postProducer.must_not_decide.join(" "), /edit, VFX, grade/i);

  assert.match(commercialDirector.must_not_decide.join(" "), /agency concept before award/i);
  assert.match(commercialDirector.ablation_claim, /split into conflicting advertising and film director/i);
  assert.match(generationSupervisor.must_not_decide.join(" "), /concept/);
  assert.match(generationSupervisor.method_cards.join(" "), /M-P03/);
});

test("generated packages and manifest are exact projections of the registry", async () => {
  const { registry, registryText } = await loadRegistry();
  const artifacts = buildArtifacts(registry);
  await checkArtifacts(registry, artifacts, registryText);

  const manifest = JSON.parse(
    await readFile(path.join(ROOT, "capabilities", "generated-manifest.json"), "utf8"),
  );
  assert.equal(manifest.generated_files.length, 90);
  assert.deepEqual(sorted(manifest.custom_agent_ids), sorted([...CORE_IDS, ...CONDITIONAL_IDS].filter((id) => id !== "creative_lead")));
  assert.deepEqual(manifest.main_thread_capability_ids, ["creative_lead"]);

  for (const capability of registry.capabilities) {
    const packagePath = path.join(
      ROOT,
      "capabilities",
      capability.capability_id,
      "capability.json",
    );
    const markdownPath = path.join(
      ROOT,
      "capabilities",
      capability.capability_id,
      "CAPABILITY.md",
    );
    const packageText = await readFile(packagePath, "utf8");
    const capabilityPackage = JSON.parse(packageText);
    assert.equal(capabilityPackage.capability_id, capability.capability_id);
    assert.equal(capabilityPackage.generated.source, "capabilities/registry.json");
    assert.equal(
      capabilityPackage.generated.registry_entry_sha256,
      sha256(`${JSON.stringify(capability, null, 2)}\n`),
    );
    assert.equal(capabilityPackage.fixture_contract.blind_review_required, true);
    assert.match(await readFile(markdownPath, "utf8"), /Generated from `capabilities\/registry\.json`/);
  }
});

test("specialist TOMLs have exact parity, read-only sandboxes, and package-only Creative Lead", async () => {
  const { registry } = await loadRegistry();
  const artifacts = buildArtifacts(registry);
  const customAgents = registry.capabilities.filter(
    (capability) => capability.agent_surface === "custom-agent",
  );
  const expectedTomls = customAgents.map(
    (capability) => `${capability.capability_id.replaceAll("_", "-")}.toml`,
  );

  assert.equal(expectedTomls.length, 29);
  assert.deepEqual(sorted(await listTomls()), sorted(expectedTomls));
  assert.equal(expectedTomls.includes("creative-lead.toml"), false);
  await assert.rejects(
    readFile(path.join(ROOT, ".codex", "agents", "creative-lead.toml"), "utf8"),
    /ENOENT/,
  );
  await readFile(path.join(ROOT, "capabilities", "creative_lead", "capability.json"), "utf8");

  for (const capability of customAgents) {
    const fileName = `${capability.capability_id.replaceAll("_", "-")}.toml`;
    const relativePath = `.codex/agents/${fileName}`;
    const content = await readFile(path.join(ROOT, ".codex", "agents", fileName), "utf8");
    assert.equal(content, artifacts.get(relativePath), `${relativePath} drifted`);
    assert.match(content, new RegExp(`^name = "${capability.capability_id}"$`, "m"));
    assert.match(content, /^sandbox_mode = "read-only"$/m);
    assert.match(
      content,
      new RegExp(`capabilities/${capability.capability_id}/capability\\.json`),
    );
    assert.match(content, /sole role, authority, stage, method, tool, skill/);
  }

  const activeTomls = new Set(await listTomls());
  for (const legacyToml of LEGACY_ONLY_TOMLS) {
    assert.equal(activeTomls.has(legacyToml), false, `legacy TOML remains active: ${legacyToml}`);
  }
});

test("artifact construction is deterministic and uses only Node built-ins", async () => {
  const { registry } = await loadRegistry();
  const first = [...buildArtifacts(registry).entries()];
  const second = [...buildArtifacts(structuredClone(registry)).entries()];
  assert.deepEqual(second, first);

  const generatorSource = await readFile(
    path.join(ROOT, "tools", "generate-agent-configs.mjs"),
    "utf8",
  );
  const importSpecifiers = [...generatorSource.matchAll(/from\s+["']([^"']+)["']/g)].map(
    (match) => match[1],
  );
  assert.ok(importSpecifiers.length > 0);
  assert.ok(importSpecifiers.every((specifier) => specifier.startsWith("node:")));
});

test("tamper detection rejects changed, missing, and unexpected TOMLs and restores parity", async () => {
  const { registry, registryText } = await loadRegistry();
  const artifacts = buildArtifacts(registry);
  const targetPath = path.join(ROOT, ".codex", "agents", "commercial-director.toml");
  const extraPath = path.join(ROOT, ".codex", "agents", "legacy-alias.toml");
  const original = await readFile(targetPath, "utf8");

  try {
    await writeFile(targetPath, `${original}# tampered\n`, "utf8");
    await assert.rejects(
      checkArtifacts(registry, artifacts, registryText),
      /generated file drift: \.codex\/agents\/commercial-director\.toml/,
    );
  } finally {
    await writeFile(targetPath, original, "utf8");
  }

  try {
    await rm(targetPath);
    await assert.rejects(
      checkArtifacts(registry, artifacts, registryText),
      /missing generated file: \.codex\/agents\/commercial-director\.toml/,
    );
  } finally {
    await writeFile(targetPath, original, "utf8");
  }

  try {
    await writeFile(
      extraPath,
      'name = "legacy_alias"\nsandbox_mode = "read-only"\n',
      "utf8",
    );
    await assert.rejects(
      checkArtifacts(registry, artifacts, registryText),
      /unexpected active agent TOML: \.codex\/agents\/legacy-alias\.toml/,
    );
  } finally {
    await rm(extraPath, { force: true });
  }

  await checkArtifacts(registry, artifacts, registryText);
});

test("cleanup eligibility is limited to exact generated projection namespaces", () => {
  for (const relativePath of [
    "capabilities/retired_probe/capability.json",
    "capabilities/retired_probe/CAPABILITY.md",
    ".codex/agents/retired-probe.toml",
  ]) {
    assert.equal(isCleanupEligibleGeneratedPath(relativePath), true, relativePath);
  }

  for (const relativePath of [
    "capabilities/registry.json",
    "capabilities/generated-manifest.json",
    "capabilities/README.md",
    "capabilities/retired_probe/source.json",
    ".codex/agents/nested/retired-probe.toml",
    ".codex/agents/README.md",
    "capabilities/../AGENTS.md",
  ]) {
    assert.equal(isCleanupEligibleGeneratedPath(relativePath), false, relativePath);
  }
});

test("tampered prior manifests cannot delete canonical or non-generated sources", async () => {
  const { sandboxRoot, generator } = await createGeneratorSandbox();
  try {
    const { registry } = await generator.loadRegistry();
    const artifacts = generator.buildArtifacts(registry);
    await generator.writeArtifacts(registry, artifacts);

    const manifestPath = path.join(sandboxRoot, "capabilities", "generated-manifest.json");
    const registryPath = path.join(sandboxRoot, "capabilities", "registry.json");
    const probeDirectory = path.join(sandboxRoot, "capabilities", "retired_probe");
    const protectedSourcePath = path.join(probeDirectory, "source.json");
    const staleJsonPath = path.join(probeDirectory, "capability.json");
    const staleMarkdownPath = path.join(probeDirectory, "CAPABILITY.md");
    const staleAgentPath = path.join(sandboxRoot, ".codex", "agents", "retired-probe.toml");
    const nestedAgentPath = path.join(
      sandboxRoot,
      ".codex",
      "agents",
      "nested",
      "retired-probe.toml",
    );
    const registryBefore = await readFile(registryPath, "utf8");
    const generatedAgentContent = [...artifacts.entries()].find(([relativePath]) =>
      relativePath.startsWith(".codex/agents/"),
    )[1];

    await mkdir(probeDirectory, { recursive: true });
    await mkdir(path.dirname(nestedAgentPath), { recursive: true });
    await writeFile(protectedSourcePath, '{"authored":true}\n', "utf8");
    await writeFile(staleJsonPath, "{}\n", "utf8");
    await writeFile(staleMarkdownPath, "# stale\n", "utf8");
    await writeFile(staleAgentPath, generatedAgentContent, "utf8");
    await writeFile(nestedAgentPath, generatedAgentContent, "utf8");

    const tamperedManifest = JSON.parse(await readFile(manifestPath, "utf8"));
    for (const relativePath of [
      "capabilities/registry.json",
      "capabilities/retired_probe/source.json",
      ".codex/agents/nested/retired-probe.toml",
      "capabilities/retired_probe/capability.json",
      "capabilities/retired_probe/CAPABILITY.md",
      ".codex/agents/retired-probe.toml",
    ]) {
      tamperedManifest.generated_files.push({
        path: relativePath,
        sha256: "0".repeat(64),
      });
    }
    await writeFile(manifestPath, `${JSON.stringify(tamperedManifest, null, 2)}\n`, "utf8");

    await generator.writeArtifacts(registry, artifacts);

    assert.equal(await readFile(registryPath, "utf8"), registryBefore);
    assert.equal(await readFile(protectedSourcePath, "utf8"), '{"authored":true}\n');
    assert.equal(await readFile(nestedAgentPath, "utf8"), generatedAgentContent);
    await assert.rejects(readFile(staleJsonPath, "utf8"), /ENOENT/);
    await assert.rejects(readFile(staleMarkdownPath, "utf8"), /ENOENT/);
    await assert.rejects(readFile(staleAgentPath, "utf8"), /ENOENT/);
    assert.equal(await readFile(manifestPath, "utf8"), artifacts.get("capabilities/generated-manifest.json"));
  } finally {
    await rm(sandboxRoot, { recursive: true, force: true });
  }
});
