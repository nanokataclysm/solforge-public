import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const PREVIEW_DEPLOYMENT_CONTRACT = Object.freeze({
  nodeMajor: 24,
  sourceRepository: "nanokataclysm/solforge",
  vercelOrgId: "team_0HvhrkJmsM9Tnbu19sipMTZe",
  vercelProjectId: "prj_XQie2nAyYdgp7U7tHwxuPdWQ08yc",
});

function defaultRunGit(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trimEnd();
}

export function normalizeGitHubRepository(remote) {
  const value = String(remote ?? "").trim().replace(/\.git$/i, "");
  const scpMatch = /^git@github\.com:([^/]+)\/(.+)$/i.exec(value);
  if (scpMatch) {
    return `${scpMatch[1]}/${scpMatch[2]}`.toLowerCase();
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (
    parsed.hostname.toLowerCase() !== "github.com" ||
    !["https:", "ssh:"].includes(parsed.protocol) ||
    parsed.search ||
    parsed.hash
  ) {
    return null;
  }

  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts.length !== 2) return null;
  return `${parts[0]}/${parts[1]}`.toLowerCase();
}

function safeGit(runGit, args, cwd, code, errors) {
  try {
    return String(runGit(args, cwd)).trim();
  } catch {
    errors.push(code);
    return null;
  }
}

function normalizeAppRelativePath(path) {
  const normalized = String(path ?? "").trim().replaceAll("\\", "/");
  const prefix = "apps/orchestrator/";
  if (!normalized.startsWith(prefix)) return null;
  const relative = normalized.slice(prefix.length).replace(/\/$/u, "");
  if (!relative || relative.startsWith("../") || relative.includes("/../")) {
    return null;
  }
  return relative;
}

function isExplicitlyExcludedDeploymentPath(path) {
  const relative = normalizeAppRelativePath(path);
  if (!relative) return false;

  const segments = relative.split("/");
  const basename = segments.at(-1);
  if (segments[0] === "node_modules" || segments[0] === ".vercel") return true;
  if (
    relative === ".gcloudignore" ||
    relative === "src/agents" ||
    relative.startsWith("src/agents/")
  ) {
    return true;
  }
  if (basename === ".env" || basename.startsWith(".env.")) return true;
  return basename.endsWith(".log");
}

function ignoredDeploymentCandidateCount(output) {
  return String(output ?? "")
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .filter((entry) => entry.startsWith("!! "))
    .map((entry) => entry.slice(3))
    .filter((entry) => !isExplicitlyExcludedDeploymentPath(entry)).length;
}

function hiddenIndexFlagCount(output) {
  return String(output ?? "")
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter((entry) => {
      const tag = entry[0];
      return tag === "S" || /^[a-z]$/u.test(tag);
    }).length;
}

export function inspectPreviewDeploymentSource(options = {}) {
  const {
    cwd = process.cwd(),
    env = process.env,
    nodeVersion = process.versions.node,
    runGit = defaultRunGit,
  } = options;
  const errors = [];

  const root = safeGit(
    runGit,
    ["rev-parse", "--show-toplevel"],
    cwd,
    "git_root_unavailable",
    errors,
  );
  const gitCwd = root || cwd;
  const headSha = safeGit(
    runGit,
    ["rev-parse", "HEAD"],
    gitCwd,
    "head_unavailable",
    errors,
  );
  const originMainSha = safeGit(
    runGit,
    ["rev-parse", "refs/remotes/origin/main"],
    gitCwd,
    "origin_main_unavailable",
    errors,
  );
  const branch = safeGit(
    runGit,
    ["branch", "--show-current"],
    gitCwd,
    "branch_unavailable",
    errors,
  );
  const originRemote = safeGit(
    runGit,
    ["remote", "get-url", "origin"],
    gitCwd,
    "origin_remote_unavailable",
    errors,
  );
  const status = safeGit(
    runGit,
    ["status", "--porcelain=v1", "--untracked-files=all"],
    gitCwd,
    "worktree_status_unavailable",
    errors,
  );
  const ignoredStatus = safeGit(
    runGit,
    [
      "status",
      "--porcelain=v1",
      "--ignored=matching",
      "--untracked-files=all",
      "--",
      "apps/orchestrator",
    ],
    gitCwd,
    "ignored_file_scan_unavailable",
    errors,
  );
  const indexStatus = safeGit(
    runGit,
    ["ls-files", "-v", "--full-name", "--", "apps/orchestrator"],
    gitCwd,
    "index_flag_scan_unavailable",
    errors,
  );

  const nodeMajor = Number.parseInt(String(nodeVersion).split(".")[0], 10);
  const sourceRepository = normalizeGitHubRepository(originRemote);
  const worktreeClean = status === "";
  const ignoredCandidateCount =
    ignoredStatus === null ? null : ignoredDeploymentCandidateCount(ignoredStatus);
  const ignoredDeploymentCandidatesAbsent = ignoredCandidateCount === 0;
  const hiddenIndexFlags =
    indexStatus === null ? null : hiddenIndexFlagCount(indexStatus);
  const hiddenIndexFlagsAbsent = hiddenIndexFlags === 0;
  const headMatchesOriginMain =
    Boolean(headSha) && Boolean(originMainSha) && headSha === originMainSha;
  const nodeMatchesContract = nodeMajor === PREVIEW_DEPLOYMENT_CONTRACT.nodeMajor;
  const sourceRepositoryMatches =
    sourceRepository === PREVIEW_DEPLOYMENT_CONTRACT.sourceRepository;
  const vercelOrgMatches =
    env.VERCEL_ORG_ID === PREVIEW_DEPLOYMENT_CONTRACT.vercelOrgId;
  const vercelProjectMatches =
    env.VERCEL_PROJECT_ID === PREVIEW_DEPLOYMENT_CONTRACT.vercelProjectId;

  if (!Number.isSafeInteger(nodeMajor)) errors.push("invalid_node_version");
  else if (!nodeMatchesContract) errors.push("node_major_mismatch");
  if (status !== null && !worktreeClean) errors.push("worktree_dirty");
  if (ignoredCandidateCount > 0) {
    errors.push("ignored_deployment_candidates_present");
  }
  if (hiddenIndexFlags > 0) errors.push("hidden_index_flags_present");
  if (headSha && originMainSha && !headMatchesOriginMain) {
    errors.push("head_not_origin_main");
  }
  if (originRemote && !sourceRepositoryMatches) {
    errors.push("wrong_source_repository");
  }
  if (!env.VERCEL_ORG_ID) errors.push("vercel_org_id_missing");
  else if (!vercelOrgMatches) errors.push("wrong_vercel_org");
  if (!env.VERCEL_PROJECT_ID) errors.push("vercel_project_id_missing");
  else if (!vercelProjectMatches) errors.push("wrong_vercel_project");

  return {
    ok: errors.length === 0,
    stage: "preview_deployment_preflight",
    contract: PREVIEW_DEPLOYMENT_CONTRACT,
    observed: {
      nodeMajor: Number.isSafeInteger(nodeMajor) ? nodeMajor : null,
      sourceRepository,
      branch: branch || null,
      headSha,
      originMainSha,
      worktreeClean,
      ignoredDeploymentCandidateCount: ignoredCandidateCount,
      hiddenIndexFlagCount: hiddenIndexFlags,
      vercelOrgIdPresent: Boolean(env.VERCEL_ORG_ID),
      vercelProjectIdPresent: Boolean(env.VERCEL_PROJECT_ID),
    },
    checks: {
      nodeMatchesContract,
      sourceRepositoryMatches,
      headMatchesOriginMain,
      worktreeClean,
      ignoredDeploymentCandidatesAbsent,
      hiddenIndexFlagsAbsent,
      vercelOrgMatches,
      vercelProjectMatches,
    },
    errors,
  };
}

function isMainModule() {
  return Boolean(process.argv[1]) &&
    import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  const result = inspectPreviewDeploymentSource();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}
