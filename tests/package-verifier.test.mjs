import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cp,
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
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXCLUDED_DIRECTORIES = new Set([".git", "node_modules", ".tcis-tmp", "coverage", "tmp"]);
const EXCLUDED_FILES = new Set(["MANIFEST.sha256", ".DS_Store", "Thumbs.db", "Desktop.ini"]);
const EXCLUDED_DIRECTORY_PATHS = new Set(["tasks/current"]);

function toPosix(value) {
  return value.split(path.sep).join("/");
}

async function listFilesRecursive(directory, packageRoot = directory) {
  const files = [];
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    const relativePath = toPosix(path.relative(packageRoot, absolutePath));
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRECTORIES.has(entry.name) || EXCLUDED_DIRECTORY_PATHS.has(relativePath)) continue;
      files.push(...(await listFilesRecursive(absolutePath, packageRoot)));
    } else if (
      entry.isFile()
      && !EXCLUDED_FILES.has(entry.name)
      && !entry.name.toLowerCase().endsWith(".log")
    ) {
      files.push(absolutePath);
    }
  }
  return files;
}

async function writeFreshManifest(packageRoot) {
  const manifestPath = path.join(packageRoot, "MANIFEST.sha256");
  const files = (await listFilesRecursive(packageRoot))
    .filter((filePath) => filePath !== manifestPath)
    .sort((left, right) =>
      toPosix(path.relative(packageRoot, left)).localeCompare(
        toPosix(path.relative(packageRoot, right)),
        "en",
      ),
    );
  const lines = [];
  for (const filePath of files) {
    const content = await readFile(filePath);
    const hash = createHash("sha256").update(content).digest("hex");
    lines.push(`${hash}  ${content.length}  ${toPosix(path.relative(packageRoot, filePath))}`);
  }
  const manifest = `${lines.join("\n")}\n`;
  await writeFile(manifestPath, manifest, "utf8");
  return manifest;
}

function runVerifier(packageRoot) {
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      path.join(packageRoot, "tools", "verify_tcis_package.ps1"),
    ],
    { cwd: packageRoot, encoding: "utf8" },
  );
  let summary = null;
  try {
    summary = JSON.parse(result.stdout);
  } catch {
    // Assertion messages below include raw process output for syntax/startup failures.
  }
  return { ...result, summary };
}

function manifestFailureDetail(result) {
  return result.summary?.checks?.find((check) => check.check === "manifest_integrity")?.detail;
}

test("standalone package manifest is normalized, contained, unique, and one-to-one", async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "tcis-package-verifier-"));
  const packageRoot = path.join(temporaryRoot, "package");
  const outsidePath = path.join(temporaryRoot, "outside.txt");

  try {
    await cp(ROOT, packageRoot, { recursive: true });
    await mkdir(path.join(packageRoot, ".git"), { recursive: true });
    await mkdir(path.join(packageRoot, "tmp"), { recursive: true });
    await mkdir(path.join(packageRoot, "node_modules", "probe"), { recursive: true });
    await mkdir(path.join(packageRoot, "tasks", "current"), { recursive: true });
    await writeFile(path.join(packageRoot, ".git", "config"), "local repository metadata\n", "utf8");
    await writeFile(path.join(packageRoot, "tmp", "runtime.json"), "{}\n", "utf8");
    await writeFile(path.join(packageRoot, "node_modules", "probe", "index.js"), "export {};\n", "utf8");
    await writeFile(path.join(packageRoot, "runtime.log"), "runtime output\n", "utf8");
    await writeFile(path.join(packageRoot, "tasks", "current", "client-private.md"), "private state\n", "utf8");
    const validManifest = await writeFreshManifest(packageRoot);
    const manifestPath = path.join(packageRoot, "MANIFEST.sha256");
    const readmeLine = validManifest
      .trimEnd()
      .split("\n")
      .find((line) => line.endsWith("  README.md"));
    assert.ok(readmeLine, "fresh manifest must contain README.md");
    assert.doesNotMatch(validManifest, /(?:^|  )\.git\//m);
    assert.doesNotMatch(validManifest, /(?:^|  )tmp\//m);
    assert.doesNotMatch(validManifest, /(?:^|  )node_modules\//m);
    assert.doesNotMatch(validManifest, /(?:^|  )runtime\.log$/m);
    assert.doesNotMatch(validManifest, /(?:^|  )tasks\/current\//m);

    const baseline = runVerifier(packageRoot);
    assert.equal(
      baseline.status,
      0,
      `fresh one-to-one manifest failed:\n${baseline.stdout}\n${baseline.stderr}`,
    );
    assert.equal(baseline.summary?.verdict, "PASS");

    await writeFile(manifestPath, `${validManifest}${readmeLine}\n`, "utf8");
    const duplicate = runVerifier(packageRoot);
    assert.notEqual(duplicate.status, 0);
    assert.match(manifestFailureDetail(duplicate), /duplicate manifest path: README\.md/);

    const outsideContent = Buffer.from("outside package\n", "utf8");
    await writeFile(outsidePath, outsideContent);
    const outsideHash = createHash("sha256").update(outsideContent).digest("hex");
    await writeFile(
      manifestPath,
      `${validManifest}${outsideHash}  ${outsideContent.length}  ../outside.txt\n`,
      "utf8",
    );
    const traversal = runVerifier(packageRoot);
    assert.notEqual(traversal.status, 0);
    assert.match(manifestFailureDetail(traversal), /invalid manifest path '\.\.\/outside\.txt'/);

    await writeFile(manifestPath, `${validManifest}${readmeLine.replace("README.md", "./README.md")}\n`, "utf8");
    const nonNormalized = runVerifier(packageRoot);
    assert.notEqual(nonNormalized.status, 0);
    assert.match(manifestFailureDetail(nonNormalized), /invalid manifest path '\.\/README\.md'/);

    await writeFile(
      manifestPath,
      validManifest
        .split("\n")
        .filter((line) => !line.endsWith("  README.md"))
        .join("\n"),
      "utf8",
    );
    const missing = runVerifier(packageRoot);
    assert.notEqual(missing.status, 0);
    assert.match(manifestFailureDetail(missing), /missing entry: README\.md/);

    await writeFile(
      manifestPath,
      `${validManifest}${"0".repeat(64)}  0  MANIFEST.sha256\n`,
      "utf8",
    );
    const extra = runVerifier(packageRoot);
    assert.notEqual(extra.status, 0);
    assert.match(manifestFailureDetail(extra), /unexpected entry: MANIFEST\.sha256/);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
