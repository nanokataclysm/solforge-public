import test from "node:test";
import assert from "node:assert/strict";
import {
  PREVIEW_DEPLOYMENT_CONTRACT,
  inspectPreviewDeploymentSource,
  normalizeGitHubRepository,
} from "../scripts/preflight-vercel-preview.mjs";

const ignoredStatusCommand =
  "status --porcelain=v1 --ignored=matching --untracked-files=all -- apps/orchestrator";
const indexFlagCommand =
  "ls-files -v --full-name -- apps/orchestrator";

function gitFixture(overrides = {}) {
  const values = {
    "rev-parse --show-toplevel": "/repo",
    "rev-parse HEAD": "a".repeat(40),
    "rev-parse refs/remotes/origin/main": "a".repeat(40),
    "branch --show-current": "main",
    "remote get-url origin": "git@github.com:nanokataclysm/solforge.git",
    "status --porcelain=v1 --untracked-files=all": "",
    [ignoredStatusCommand]: "",
    [indexFlagCommand]: "H apps/orchestrator/server.mjs",
    ...overrides,
  };
  return (args) => {
    const key = args.join(" ");
    if (!Object.hasOwn(values, key)) throw new Error("unexpected git command");
    const value = values[key];
    if (value instanceof Error) throw value;
    return value;
  };
}

function contractEnv(overrides = {}) {
  return {
    VERCEL_ORG_ID: PREVIEW_DEPLOYMENT_CONTRACT.vercelOrgId,
    VERCEL_PROJECT_ID: PREVIEW_DEPLOYMENT_CONTRACT.vercelProjectId,
    ...overrides,
  };
}

test("normalizes supported GitHub origin formats", () => {
  assert.equal(
    normalizeGitHubRepository("git@github.com:Nanokataclysm/Solforge.git"),
    "nanokataclysm/solforge",
  );
  assert.equal(
    normalizeGitHubRepository("https://github.com/nanokataclysm/solforge.git"),
    "nanokataclysm/solforge",
  );
  assert.equal(
    normalizeGitHubRepository("ssh://git@github.com/nanokataclysm/solforge"),
    "nanokataclysm/solforge",
  );
  assert.equal(normalizeGitHubRepository("https://example.com/repo"), null);
});

test("accepts an exact clean origin/main source on Node 24", () => {
  const result = inspectPreviewDeploymentSource({
    cwd: "/repo/apps/orchestrator",
    env: contractEnv(),
    nodeVersion: "24.15.0",
    runGit: gitFixture(),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.observed.ignoredDeploymentCandidateCount, 0);
  assert.equal(result.observed.hiddenIndexFlagCount, 0);
  assert.deepEqual(result.checks, {
    nodeMatchesContract: true,
    sourceRepositoryMatches: true,
    headMatchesOriginMain: true,
    worktreeClean: true,
    ignoredDeploymentCandidatesAbsent: true,
    hiddenIndexFlagsAbsent: true,
    vercelOrgMatches: true,
    vercelProjectMatches: true,
  });
});

test("rejects stale, dirty, wrong-runtime, and wrong-project sources", () => {
  const result = inspectPreviewDeploymentSource({
    env: contractEnv({
      VERCEL_ORG_ID: "team_wrong",
      VERCEL_PROJECT_ID: "prj_wrong",
    }),
    nodeVersion: "22.22.1",
    runGit: gitFixture({
      "rev-parse HEAD": "b".repeat(40),
      "remote get-url origin": "https://github.com/nanokataclysm/solforge-public.git",
      "status --porcelain=v1 --untracked-files=all": " M server.mjs",
    }),
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, [
    "node_major_mismatch",
    "worktree_dirty",
    "head_not_origin_main",
    "wrong_source_repository",
    "wrong_vercel_org",
    "wrong_vercel_project",
  ]);
});

test("rejects ignored files that could enter a Vercel upload", () => {
  const sensitiveName = "operator-private.before-deploy";
  const result = inspectPreviewDeploymentSource({
    env: contractEnv(),
    nodeVersion: "24.15.0",
    runGit: gitFixture({
      [ignoredStatusCommand]: [
        "!! apps/orchestrator/.env.local",
        "!! apps/orchestrator/.vercel/",
        "!! apps/orchestrator/debug.log",
        "!! apps/orchestrator/node_modules/",
        "!! apps/orchestrator/src/agents/",
        `!! apps/orchestrator/public/${sensitiveName}`,
        "!! apps/orchestrator/operator-archive.zip",
        "?? apps/orchestrator/ordinary-untracked.txt",
      ].join("\n"),
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.observed.ignoredDeploymentCandidateCount, 2);
  assert.equal(result.checks.ignoredDeploymentCandidatesAbsent, false);
  assert.deepEqual(result.errors, ["ignored_deployment_candidates_present"]);
  assert.equal(JSON.stringify(result).includes(sensitiveName), false);
});

test("rejects assume-unchanged and skip-worktree flags without exposing paths", () => {
  const sensitiveName = "operator-private.mjs";
  const result = inspectPreviewDeploymentSource({
    env: contractEnv(),
    nodeVersion: "24.15.0",
    runGit: gitFixture({
      [indexFlagCommand]: [
        "H apps/orchestrator/server.mjs",
        `h apps/orchestrator/config/${sensitiveName}`,
        "S apps/orchestrator/public/skip-worktree.js",
        "s apps/orchestrator/public/both-flags.js",
      ].join("\n"),
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.observed.hiddenIndexFlagCount, 3);
  assert.equal(result.checks.hiddenIndexFlagsAbsent, false);
  assert.deepEqual(result.errors, ["hidden_index_flags_present"]);
  assert.equal(JSON.stringify(result).includes(sensitiveName), false);
  assert.equal(JSON.stringify(result).includes("skip-worktree.js"), false);
});

test("fails closed when ignored-file scanning is unavailable", () => {
  const result = inspectPreviewDeploymentSource({
    env: contractEnv(),
    nodeVersion: "24.15.0",
    runGit: gitFixture({
      [ignoredStatusCommand]: new Error("scan failed"),
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.observed.ignoredDeploymentCandidateCount, null);
  assert.equal(result.checks.ignoredDeploymentCandidatesAbsent, false);
  assert.deepEqual(result.errors, ["ignored_file_scan_unavailable"]);
});

test("fails closed when index-flag scanning is unavailable", () => {
  const result = inspectPreviewDeploymentSource({
    env: contractEnv(),
    nodeVersion: "24.15.0",
    runGit: gitFixture({
      [indexFlagCommand]: new Error("scan failed"),
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.observed.hiddenIndexFlagCount, null);
  assert.equal(result.checks.hiddenIndexFlagsAbsent, false);
  assert.deepEqual(result.errors, ["index_flag_scan_unavailable"]);
});

test("fails closed when origin/main or linkage identifiers are unavailable", () => {
  const result = inspectPreviewDeploymentSource({
    env: {},
    nodeVersion: "24.15.0",
    runGit: gitFixture({
      "rev-parse refs/remotes/origin/main": new Error("missing ref"),
    }),
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, [
    "origin_main_unavailable",
    "vercel_org_id_missing",
    "vercel_project_id_missing",
  ]);
});

test("sanitized result never serializes unrelated environment secrets", () => {
  const secret = "do-not-print-this-secret";
  const result = inspectPreviewDeploymentSource({
    env: contractEnv({
      B2_APPLICATION_KEY: secret,
      NANOKAT_SIGNING_PRIVATE_KEY_PEM: secret,
    }),
    nodeVersion: "24.15.0",
    runGit: gitFixture(),
  });

  assert.equal(JSON.stringify(result).includes(secret), false);
});
