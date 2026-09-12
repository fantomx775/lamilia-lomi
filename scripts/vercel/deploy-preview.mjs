import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const API_ORIGIN = "https://api.vercel.com";
export const DEFAULT_PROJECT_ID = "prj_ktTjOHS0QW0pdfyhKaQs883MJvYd";
export const DEFAULT_PROJECT_NAME = "lamilia-lomi";
export const DEFAULT_TEAM_ID = "team_lS6KpgnOGBg7jJ1AKF0Z2QU4";
export const DEFAULT_SCOPE = "fantomxs-projects";

export function deploymentUrl(deployment) {
  if (typeof deployment?.url !== "string" || deployment.url.length === 0)
    return null;
  return deployment.url.startsWith("http")
    ? deployment.url
    : `https://${deployment.url}`;
}

export async function findReusablePreview({
  projectId,
  teamId,
  token,
  commitSha,
  fetchImpl = globalThis.fetch,
}) {
  if (!projectId || !teamId || !token || !commitSha) {
    throw new Error("Missing Lamilia Preview identity or Vercel credentials.");
  }

  const deployments = [];
  const seenCursors = new Set();
  let cursor;

  while (true) {
    const url = new URL(`${API_ORIGIN}/v6/deployments`);
    url.searchParams.set("projectId", projectId);
    url.searchParams.set("teamId", teamId);
    url.searchParams.set("limit", "100");

    if (cursor !== undefined) {
      const cursorKey = String(cursor);
      if (seenCursors.has(cursorKey)) {
        throw new Error("Vercel deployment pagination repeated a cursor.");
      }
      seenCursors.add(cursorKey);
      url.searchParams.set("until", cursorKey);
    }

    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      throw new Error(
        `Unable to inspect existing Lamilia Previews: HTTP ${response.status}`,
      );
    }

    const payload = await response.json();
    if (Array.isArray(payload?.deployments))
      deployments.push(...payload.deployments);

    const next = payload?.pagination?.next;
    if (
      next == null ||
      String(next) === "" ||
      String(next) === String(cursor ?? "")
    )
      break;
    cursor = next;
  }

  return (
    deployments
      .filter(
        (deployment) =>
          deployment?.target == null &&
          deployment?.readyState === "READY" &&
          deployment?.meta?.githubCommitSha === commitSha &&
          deploymentUrl(deployment) !== null,
      )
      .sort(
        (left, right) => Number(right.created ?? 0) - Number(left.created ?? 0),
      )[0] ?? null
  );
}

export function parseArgs(argv) {
  const options = { force: false, reason: "", sha: "", ref: "" };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--force") {
      options.force = true;
    } else if (
      argument === "--reason" ||
      argument === "--sha" ||
      argument === "--ref"
    ) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--"))
        throw new Error(`${argument} requires a value.`);
      options[argument.slice(2)] = value;
      index += 1;
    } else if (argument === "--help") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (options.force && !options.reason.trim()) {
    throw new Error(
      "--force requires --reason so the rebuild decision is recorded.",
    );
  }

  return options;
}

function gitValue(args) {
  try {
    return execFileSync("git", args, {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

export function resolveVercelCliEntrypoint({
  env = process.env,
  cwd = process.cwd(),
  nodePath = process.execPath,
} = {}) {
  const configured = env.VERCEL_CLI_ENTRYPOINT?.trim();
  const candidates = [
    configured ? resolve(cwd, configured) : null,
    resolve(cwd, "node_modules", "vercel", "dist", "vc.js"),
    join(dirname(nodePath), "node_modules", "vercel", "dist", "vc.js"),
  ].filter((candidate) => candidate !== null);

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

export function buildVercelInvocation(
  args,
  {
    platform = process.platform,
    nodePath = process.execPath,
    cliEntrypoint = resolveVercelCliEntrypoint({ nodePath }),
  } = {},
) {
  if (platform === "win32") {
    if (!cliEntrypoint) {
      throw new Error(
        "Vercel CLI entrypoint not found. Set VERCEL_CLI_ENTRYPOINT or install the Vercel CLI.",
      );
    }

    return { command: nodePath, args: [cliEntrypoint, ...args] };
  }

  return { command: "vercel", args };
}

export function buildVercelSpawnOptions({ cwd = process.cwd(), env } = {}) {
  return {
    cwd,
    env,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  };
}

export function buildDeployArgs({ commitSha, commitRef, scope, force = false }) {
  const deployArgs = [
    "deploy",
    "--target",
    "preview",
    "--scope",
    scope,
    "--yes",
    "--meta",
    `githubCommitSha=${commitSha}`,
    "--meta",
    `githubCommitRef=${commitRef}`,
  ];

  if (force) deployArgs.push("--force");
  return deployArgs;
}

function runVercel(args, env, runtime = {}) {
  const invocation = buildVercelInvocation(args, {
    platform: runtime.platform,
    nodePath: runtime.nodePath,
    cliEntrypoint: runtime.cliEntrypoint ?? resolveVercelCliEntrypoint({
      env,
      cwd: process.cwd(),
      nodePath: runtime.nodePath ?? process.execPath,
    }),
  });
  const spawnImpl = runtime.spawnImpl ?? spawn;

  return new Promise((resolvePromise, reject) => {
    const child = spawnImpl(
      invocation.command,
      invocation.args,
      buildVercelSpawnOptions({ cwd: process.cwd(), env }),
    );
    let stdout = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (stdout) process.stderr.write(stdout);
      if (code === 0) {
        resolvePromise(stdout);
      } else {
        reject(
          new Error(`Vercel CLI failed with exit code ${code ?? "unknown"}.`),
        );
      }
    });
  });
}

function extractDeploymentUrl(output) {
  const matches = output.match(/https?:\/\/[^\s"'`]+/g) ?? [];
  const candidate = matches.at(-1)?.replace(/[),.;]+$/, "");
  return candidate && deploymentUrl({ url: candidate });
}

export async function main(env = process.env) {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(
      'Usage: npm run vercel:preview [--force --reason "..."] [--sha <40-char-sha>] [--ref <git-ref>]\n',
    );
    return;
  }

  const token = env.VERCEL_TOKEN || env.VERCEL_API_KEY;
  const commitSha =
    options.sha || env.VERCEL_PREVIEW_SHA || gitValue(["rev-parse", "HEAD"]);
  const commitRef =
    options.ref ||
    env.VERCEL_PREVIEW_REF ||
    gitValue(["branch", "--show-current"]) ||
    "detached";

  if (!token) throw new Error("VERCEL_TOKEN or VERCEL_API_KEY is required.");
  if (!/^[0-9a-f]{40}$/i.test(commitSha)) {
    throw new Error(
      `Expected a full 40-character Git SHA, received: ${commitSha || "(empty)"}.`,
    );
  }

  const projectId = env.VERCEL_PROJECT_ID || DEFAULT_PROJECT_ID;
  const teamId = env.VERCEL_ORG_ID || env.VERCEL_TEAM_ID || DEFAULT_TEAM_ID;
  const scope = env.VERCEL_SCOPE || DEFAULT_SCOPE;

  if (!options.force) {
    const existing = await findReusablePreview({
      projectId,
      teamId,
      token,
      commitSha,
    });
    if (existing) {
      const url = deploymentUrl(existing);
      process.stderr.write(
        `Reusing READY Lamilia Preview for ${commitSha}: ${url}\n`,
      );
      process.stdout.write(`${url}\n`);
      return;
    }
  } else {
    process.stderr.write(
      `Forcing Lamilia Preview rebuild: ${options.reason}\n`,
    );
  }

  const childEnv = { ...env, VERCEL_TOKEN: token };
  await runVercel(
    ["link", "--project", DEFAULT_PROJECT_NAME, "--scope", scope, "--yes"],
    childEnv,
  );

  const deployArgs = buildDeployArgs({
    commitSha,
    commitRef,
    scope,
    force: options.force,
  });

  const output = await runVercel(deployArgs, childEnv);
  const url = extractDeploymentUrl(output);
  if (!url) throw new Error("Vercel CLI did not return a deployment URL.");
  process.stdout.write(`${url}\n`);
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
